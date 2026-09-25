// node --test tests/
// 手書き認識の中核（画数と指紋で候補を絞り、Kanji Canvas で照合する）を Node で確かめる。
// 入力には参照データ自身の特徴点を使う（＝きれいに書いた場合に相当）。
// 実際の手書きに対する精度は scripts/build_handwriting_db.mjs のコメント参照（1位 92% / 上位10 99%）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRecognizer } from '../src/js/handwriting/recognizer.js';
import { GRID, signature, signatureDistance } from '../src/js/handwriting/signature.js';

const data = JSON.parse(readFileSync(new URL('../src/data/handwriting-patterns.json', import.meta.url), 'utf8'));
const byChar = new Map(data.chars.map((entry) => [entry[0], entry]));
const recognize = createRecognizer(data.chars);

test('参照データ', () => {
  assert.equal(data.grid, GRID);
  assert.ok(data.chars.length > 6000, `${data.chars.length} 字`);
  assert.match(data.source.license, /CC BY-SA/);
  for (const ch of '辺邉邊斎齋高吉崎辻葛') assert.ok(byChar.has(ch), ch);
});

test('指紋: 同じ字は一致し、別の字とは離れる', () => {
  const [, , pattern, stored] = byChar.get('辺');
  assert.equal(signature(pattern), stored);
  assert.equal(signatureDistance(stored, stored), 0);
  assert.ok(signatureDistance(stored, byChar.get('邊')[3]) > 20);
});

test('きれいに書いた字は1位で当たる', () => {
  for (const ch of ['一', '十', '辺', '高', '齋', '邉']) {
    const candidates = recognize(byChar.get(ch)[2]);
    assert.equal(candidates[0], ch, `${ch} → ${candidates.slice(0, 5).join('')}`);
  }
  // 点の有無だけが違う字は入れ替わることがある（大 → 太 が 1 位）。上位には入る
  assert.ok(recognize(byChar.get('大')[2]).slice(0, 3).includes('大'));
});

test('筆画が揺れても上位に残る', () => {
  // 手書きのばらつきの代わりに、点をずらして少し傾ける
  const jitter = (pattern, amount) => pattern.map((stroke, s) => stroke.map(([x, y], i) => [
    x + amount * Math.sin(s + i) + 0.04 * (y - 128),
    y + amount * Math.cos(s * 2 + i),
  ]));
  for (const ch of ['十', '辺', '高']) {
    const candidates = recognize(jitter(byChar.get(ch)[2], 8));
    assert.ok(candidates.slice(0, 10).includes(ch), `${ch} → ${candidates.slice(0, 10).join('')}`);
  }
});

test('MJ の異体字そのもの（髙・𠮷 など）は収録されていない', () => {
  for (const ch of '髙𠮷﨑德槗') assert.equal(byChar.has(ch), false, ch);
  // 元の字は収録されているので、そこから関連字をたどれる
  for (const ch of '高吉崎徳橋') assert.ok(byChar.has(ch), ch);
});
