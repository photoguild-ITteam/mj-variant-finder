// node --test tests/
// 最初の画面用の小さなフォント（mjv-preset.woff2）に、そこで表示する字がすべて入っているか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
