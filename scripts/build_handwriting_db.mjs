// 手書き認識用の参照パターンを作る。
//   KanjiVG（CC BY-SA 3.0）の筆画データ → Kanji Canvas（MIT）の特徴抽出 → src/data/handwriting-patterns.json
//
//   npm run build:handwriting        # data/raw/ に無ければ KanjiVG をダウンロード
//
// 形式: { version, source, grid, chars: [[文字, 画数, [[[x,y],...], ...], 指紋], ...] }
// 先頭3つは Kanji Canvas の refPatterns と同じ並び（文字・画数・特徴点）。
// 4つ目は 8x8 の「墨の量」を 0-15 で表した指紋（16進64桁）。総当たりは遅いので、
// 画面側はまず画数と指紋で候補を数百字に絞り、その中だけ Kanji Canvas で照合する。
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { GRID, signature } from '../src/js/handwriting/signature.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KANJIVG = {
  url: 'https://github.com/KanjiVG/kanjivg/releases/download/r20250816/kanjivg-20250816.xml.gz',
  version: 'r20250816',
  license: 'CC BY-SA 3.0',
  page: 'https://kanjivg.tagaini.net/',
  sha256: 'b36579789775ea912d5e98356bf243f54fb953fa3b58a16c2d6995f252e2a3e2',
};
KANJIVG.gz = `${ROOT}data/raw/kanjivg-${KANJIVG.version}.xml.gz`;
KANJIVG.xml = `${ROOT}data/raw/kanjivg-${KANJIVG.version}.xml`;
const SAMPLE_STEP = 6; // KanjiVG の 109x109 座標系での分割間隔
const OUT = `${ROOT}src/data/handwriting-patterns.json`;

// ---------------------------------------------------------------- KanjiVG の読み込み

async function verifySha256(path, expected) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  const actual = hash.digest('hex');
  if (actual !== expected) {
    throw new Error(
      `SHA256 不一致 (${basename(path)}):\n` +
      `  期待値: ${expected}\n` +
      `  実際値: ${actual}\n` +
      `新しい版に上げた場合は KANJIVG の sha256 を書き換えてください（docs/ARCHITECTURE.md）`
    );
  }
}

async function readKanjiVG() {
  if (!existsSync(KANJIVG.gz)) {
    console.error(`download ${KANJIVG.url}`);
    const res = await fetch(KANJIVG.url);
    if (!res.ok) throw new Error(`KanjiVG のダウンロードに失敗しました (${res.status})`);
    const gzPart = `${KANJIVG.gz}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), createWriteStream(gzPart));
      await verifySha256(gzPart, KANJIVG.sha256);
      renameSync(gzPart, KANJIVG.gz);
    } catch (err) {
      if (existsSync(gzPart)) unlinkSync(gzPart);
      throw err;
    }
  } else {
    await verifySha256(KANJIVG.gz, KANJIVG.sha256);
  }

  if (!existsSync(KANJIVG.xml) || statSync(KANJIVG.xml).size === 0) {
    const xmlPart = `${KANJIVG.xml}.part`;
    try {
      await pipeline(createReadStream(KANJIVG.gz), createGunzip(), createWriteStream(xmlPart));
      renameSync(xmlPart, KANJIVG.xml);
    } catch (err) {
      if (existsSync(xmlPart)) unlinkSync(xmlPart);
      throw err;
    }
  }
  return readFileSync(KANJIVG.xml, 'utf8');
}

/** <kanji id="kvg:kanji_09089"> ごとに、筆画の d 属性を順番に取り出す */
function* kanjiEntries(xml) {
  for (const m of xml.matchAll(/<kanji id="kvg:kanji_([0-9a-fA-F]+)">([\s\S]*?)<\/kanji>/g)) {
    if (m[1].includes('-')) continue; // 異体フォーム（-Kaisho など）は使わない
    yield [String.fromCodePoint(parseInt(m[1], 16)), [...m[2].matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((p) => p[1])];
  }
}

// ---------------------------------------------------------------- SVG パス → 点列

const NUMBERS = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
const COMMANDS = /([MmCcSsLlQqTtZzHhVv])([^MmCcSsLlQqTtZzHhVv]*)/g;

const lerpLine = (a, b) => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_STEP));
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);
};

const lerpCubic = (p0, p1, p2, p3) => {
  const rough = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(2, Math.round(rough / SAMPLE_STEP));
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const u = 1 - t;
    return [
      u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
    ];
  });
};

/** SVG のパス（M/L/H/V/C/S/Q/T/Z）を折れ線の点列にする */
function flattenPath(d) {
  const points = [];
  let cur = [0, 0];
  let startPoint = [0, 0];
  let prevControl = null;
  for (const [, rawCmd, rawArgs] of d.matchAll(COMMANDS)) {
    const nums = (rawArgs.match(NUMBERS) ?? []).map(Number);
    const relative = rawCmd === rawCmd.toLowerCase();
    const abs = (x, y) => (relative ? [cur[0] + x, cur[1] + y] : [x, y]);
    let cmd = rawCmd.toUpperCase();
    let i = 0;
    do {
      if (cmd === 'Z') {
        points.push(...lerpLine(cur, startPoint));
        cur = startPoint;
        break;
      }
      const need = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 }[cmd];
      if (i + need > nums.length) break;
      const a = nums.slice(i, i + need);
      i += need;
      if (cmd === 'M') {
        cur = abs(a[0], a[1]);
        startPoint = cur;
        points.push(cur);
        cmd = 'L'; // M に続く数値の並びは L と同じ扱い
      } else if (cmd === 'L' || cmd === 'H' || cmd === 'V') {
        const next = cmd === 'L' ? abs(a[0], a[1])
          : cmd === 'H' ? [relative ? cur[0] + a[0] : a[0], cur[1]]
            : [cur[0], relative ? cur[1] + a[0] : a[0]];
        points.push(...lerpLine(cur, next));
        cur = next;
        prevControl = null;
      } else {
        // 3次ベジェに揃える（S/T は直前の制御点を鏡映）
        const mirror = prevControl ? [2 * cur[0] - prevControl[0], 2 * cur[1] - prevControl[1]] : cur;
        let c1, c2, end;
        if (cmd === 'C') [c1, c2, end] = [abs(a[0], a[1]), abs(a[2], a[3]), abs(a[4], a[5])];
        else if (cmd === 'S') [c1, c2, end] = [mirror, abs(a[0], a[1]), abs(a[2], a[3])];
        else {
          const q = cmd === 'Q' ? abs(a[0], a[1]) : mirror;
          end = cmd === 'Q' ? abs(a[2], a[3]) : abs(a[0], a[1]);
          c1 = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])];
          c2 = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])];
          prevControl = q;
        }
        points.push(...lerpCubic(cur, c1, c2, end));
        cur = end;
        if (cmd === 'C' || cmd === 'S') prevControl = c2;
      }
    } while (i < nums.length);
  }
  return points;
}

// ---------------------------------------------------------------- Kanji Canvas の特徴抽出

/** ブラウザ用の kanji-canvas.js（無改変）を Node で読み込む */
function loadKanjiCanvas() {
  const context = createContext({ document: { addEventListener() {} } });
  context.window = context;
  runInContext(readFileSync(`${ROOT}src/vendor/kanji-canvas.js`, 'utf8'), context);
  return context.KanjiCanvas;
}

async function main() {
  const xml = await readKanjiVG();
  const kc = loadKanjiCanvas();
  const chars = [];
  let skipped = 0;
  for (const [char, paths] of kanjiEntries(xml)) {
    const strokes = paths.map(flattenPath).filter((s) => s.length >= 2);
    if (!strokes.length) {
      skipped++;
      continue;
    }
    // 画面側と同じ前処理: 位置と大きさをそろえて（モーメント正規化）特徴点を取り出す
    kc.recordedPattern_build = strokes;
    const features = kc.extractFeatures(kc.momentNormalize('build'), 20).map((s) => s.map(([x, y]) => [Math.round(x), Math.round(y)]));
    chars.push([char, features.length, features, signature(features)]);
  }

  const data = {
    version: KANJIVG.version,
    source: {
      title: `KanjiVG ${KANJIVG.version}`, license: KANJIVG.license, page: KANJIVG.page,
      copyright: 'Copyright (C) 2009-2013 Ulrich Apel', notice: 'licenses/KANJIVG-NOTICE.txt',
    },
    algorithm: { name: 'Kanji Canvas', license: 'MIT', page: 'https://github.com/asdfjkl/kanjicanvas' },
    grid: GRID,
    chars,
  };
  const json = JSON.stringify(data);
  writeFileSync(OUT, json);
  const strokeTotal = chars.reduce((sum, c) => sum + c[1], 0);
  console.error(`${chars.length} 字（筆画 ${strokeTotal}, 平均 ${(strokeTotal / chars.length).toFixed(1)}）`
    + `${skipped ? ` / 筆画なしで除外 ${skipped}` : ''} → ${OUT} ${(json.length / 1e6).toFixed(1)} MB`);
}

// テストから signature() を import できるよう、CLI として呼ばれたときだけ実行する
if (process.argv[1]?.endsWith('build_handwriting_db.mjs')) await main();
