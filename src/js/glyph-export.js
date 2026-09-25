// 字形を画像として書き出す: PNG（クリップボード / 保存）と SVG（アウトライン、保存）.
// Canva・Illustrator などフォントや IVS の扱いが不確かなアプリへ、字形を崩さず持ち込むための機能。

import { fetchOk } from './db.js';
import { WEB_FONT_FAMILY } from './font-detector.js';

const PNG_SIZE = 1024; // 1em あたりのピクセル数
const FONT_MAP_URL = new URL('../fonts/fonts-map.json', import.meta.url);
const FONTKIT_URL = new URL('../vendor/fontkit.js', import.meta.url);

const fileBase = (glyph) => glyph.mj;

// ---------------------------------------------------------------------------- PNG

/** 字形を 1em 四方の透明 PNG にする（全角の字送り幅 × アセント+ディセント）. */
export async function renderPng(glyph, { size = PNG_SIZE, color = '#000000' } = {}) {
  const font = `${size}px "${WEB_FONT_FAMILY}"`;
  await document.fonts.load(font, glyph.char);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const m = ctx.measureText(glyph.char);
  const ascent = m.fontBoundingBoxAscent ?? size * 0.88;
  const descent = m.fontBoundingBoxDescent ?? size * 0.12;
  canvas.width = Math.ceil(m.width);
  canvas.height = Math.ceil(ascent + descent);
  ctx.font = font; // サイズ変更でリセットされる
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(glyph.char, 0, ascent);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG を作成できませんでした'))), 'image/png');
  });
}

export async function copyPng(glyph, options) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('このブラウザは画像のコピーに対応していません');
  }
  // Safari はユーザー操作の直後に write を呼ぶ必要があるため、Blob ではなく Promise を渡す
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPng(glyph, options) })]);
}

export async function downloadPng(glyph, options) {
  saveBlob(await renderPng(glyph, options), `${fileBase(glyph)}.png`);
}

// ---------------------------------------------------------------------------- SVG

let fontkitPromise;
let fontMapPromise;
const fontCache = new Map();

async function fontFor(cp) {
  fontMapPromise ??= fetchOk(FONT_MAP_URL).then((r) => r.json());
  fontMapPromise.catch(() => { fontMapPromise = undefined; });
  const map = await fontMapPromise;
  const hit = map.find(([start, end]) => cp >= start && cp <= end);
  if (!hit) throw new Error(`U+${cp.toString(16).toUpperCase()} を含むフォントファイルがありません`);
  const file = hit[2];
  if (!fontCache.has(file)) {
    fontkitPromise ??= import(FONTKIT_URL.href);
    const promise = Promise.all([
      fontkitPromise,
      fetchOk(new URL(`../fonts/${file}`, import.meta.url)).then((r) => r.arrayBuffer()),
    ]).then(([fontkit, buf]) => fontkit.create(new Uint8Array(buf)));
    promise.catch(() => fontCache.delete(file));
    fontCache.set(file, promise);
  }
  return fontCache.get(file);
}

/**
 * コードポイント列（基底文字 + 異体字セレクタ）→ グリフ.
 * fontkit 2.0.4 の getVariationSelector は、defaultUVS を持つセレクタで nonDefaultUVS を探さない不具合があるため、
 * cmap format 14 を直接引く。
 */
function glyphFor(font, cps) {
  const [base, vs] = cps;
  const uvs = font._cmapProcessor?.uvs;
  if (vs && uvs) {
    const selector = uvs.varSelectors.toArray().find((s) => s.varSelector === vs);
    const mapping = selector?.nonDefaultUVS?.find((x) => x.unicodeValue === base);
    if (mapping) return font.getGlyph(mapping.glyphID);
  }
  return font.glyphForCodePoint(base);
}

const escapeXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/** 字形のアウトラインを SVG 文字列にする（viewBox は字送り幅 × アセント+ディセント、単位はフォント座標）. */
export async function buildSvg(glyph, { color = '#000000' } = {}) {
  const cps = [...glyph.char].map((ch) => ch.codePointAt(0));
  const font = await fontFor(cps[0]);
  const g = glyphFor(font, cps);
  if (!g || g.id === 0) throw new Error('フォントにこの字形がありません');
  const width = g.advanceWidth;
  const height = font.ascent - font.descent;
  const unicode = cps.map((cp) => `U+${cp.toString(16).toUpperCase()}`).join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${(width / font.unitsPerEm) * 256}" height="${(height / font.unitsPerEm) * 256}">`,
    `<title>${escapeXml(`${glyph.mj} ${unicode}`)}</title>`,
    `<desc>${escapeXml('字形: IPAmj明朝 Ver.006.01（IPAフォントライセンス v1.0）')}</desc>`,
    `<path transform="translate(0 ${font.ascent}) scale(1 -1)" fill="${escapeXml(color)}" d="${g.path.toSVG()}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

export async function downloadSvg(glyph, options) {
  const svg = await buildSvg(glyph, options);
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(glyph)}.svg`);
}

// ---------------------------------------------------------------------------- 共通

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
