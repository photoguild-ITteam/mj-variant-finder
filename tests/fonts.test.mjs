// node --test tests/
// 最初の画面用の小さなフォント（mjv-preset.woff2）に、そこで表示する字がすべて入っているか。
// ゴシック体の見本用フォント（src/fonts/gothic/）に、字形の詳細で見本を出す字がすべて入っているか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function presetRange() {
  const face = read('src/fonts/fonts.css').match(/@font-face\{font-family:"MJ Variant Mincho Preset";[^}]*\}/);
  assert.ok(face, 'fonts.css に MJ Variant Mincho Preset が無い（python scripts/build_webfont.py で作り直す）');
  const ranges = face[0].match(/unicode-range:([^;]+)/)[1].split(',').map((r) => {
    const [a, b = a] = r.replace(/U\+/g, '').split('-');
    return [parseInt(a, 16), parseInt(b, 16)];
  });
  return (ch) => ranges.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);
}

test('よく検索される異体字・ロゴ・ようこそ画面の字が入っている', () => {
  const covers = presetRange();
  const { quickAccess } = JSON.parse(read('src/data/search-index.json'));
  const missing = [...quickAccess.join(''), '異', '邊'].filter((ch) => !covers(ch));
  assert.deepEqual(missing, [], 'search-index.json の quickAccess を変えたら、フォントも作り直す');
  assert.match(read('index.html'), /class="brand__mark"[^>]*><span aria-hidden="true">異<\/span>/);
  assert.match(read('src/js/ui/results.js'), /'empty-state__glyph glyph'.*'邊'\)/);
});

test('IVS 表示の判定に使う字が入っている', () => {
  const covers = presetRange();
  const detector = read('src/js/font-detector.js');
  for (const name of ['IVS_SAMPLE_A', 'IVS_SAMPLE_B']) {
    const sample = detector.match(new RegExp(`${name} = '(.)`))[1]; // 基底の字（後ろに異体字セレクタが続く）
    assert.ok(covers(sample), `${name} の ${sample}`);
  }
});

// ゴシック体の見本用フォント（src/fonts/gothic/。scripts/build_gothic_webfont.py）
const GOTHIC_FAMILIES = { notocjk: 'MJ Variant Gothic N', plangothic: 'MJ Variant Gothic P' };

/** gothic.css のフォント名ごとの unicode-range（[[始め, 終わり], ...]） */
function gothicRanges() {
  /** @type {Record<string, [number, number][]>} */
  const ranges = {};
  for (const face of read('src/fonts/gothic/gothic.css').matchAll(/@font-face\{([^}]*)\}/g)) {
    const family = face[1].match(/font-family:"([^"]+)"/)[1];
    for (const r of face[1].match(/unicode-range:([^;]+)/)[1].split(',')) {
      const [a, b = a] = r.replace(/U\+/g, '').split('-');
      (ranges[family] ??= []).push([parseInt(a, 16), parseInt(b, 16)]);
    }
  }
  return ranges;
}

test('ゴシック体の見本: gothic.css が指すファイルがあり、名前を変えた派生フォントだけを使う', () => {
  const css = read('src/fonts/gothic/gothic.css');
  const files = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(files.length > 0);
  for (const file of files) assert.ok(existsSync(new URL(`src/fonts/gothic/${file}`, root)), file);
  assert.deepEqual(Object.keys(gothicRanges()).sort(), Object.values(GOTHIC_FAMILIES).sort());
  assert.doesNotMatch(css, /local\(/, '見本は判定に使った版の形を見せる（端末のフォントを使わない）');
  for (const name of ['OFL-NotoSansCJK.txt', 'OFL-Plangothic.txt']) {
    assert.match(read(`src/fonts/gothic/${name}`), /SIL Open Font License/, name);
  }
});

test('ゴシック体の見本: 字形の gothic が指すフォントに、その字が入っている', () => {
  const ranges = gothicRanges();
  const covers = (family, cp) => ranges[family].some(([a, b]) => cp >= a && cp <= b);
  const missing = [];
  for (const name of readdirSync(new URL('src/data/chars/', root))) {
    if (name === 'none.json') continue;
    for (const entry of Object.values(JSON.parse(read(`src/data/chars/${name}`)))) {
      for (const g of entry.glyphs) {
        if (!g.impl) continue;
        // Noto Sans CJK JP にあればそちら（字形の詳細もこの順で見本を選ぶ）
        const key = ['notocjk', 'plangothic'].find((k) => g.gothic?.includes(k));
        if (key && !covers(GOTHIC_FAMILIES[key], parseInt(g.impl, 16))) missing.push(`${g.mj} U+${g.impl}`);
      }
    }
  }
  assert.deepEqual(missing.slice(0, 10), [], 'python scripts/build_gothic_webfont.py で作り直す');
});
