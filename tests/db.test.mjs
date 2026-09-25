// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VariantDB, copyFormats, vsNumber, toHiragana, radicalChar } from '../src/js/db.js';

const base = new URL('../src/data/', import.meta.url);
const db = await VariantDB.load(base, async (url) => JSON.parse(await readFile(url, 'utf8')));

test('helpers', () => {
  assert.equal(vsNumber(0xe0100), 17);
  assert.equal(vsNumber(0xe010f), 32);
  assert.equal(vsNumber(0xfe00), 1);
  assert.equal(toHiragana('サイトウ'), 'さいとう');
  assert.equal(radicalChar(162), String.fromCodePoint(0x2fa1)); // ⾡ 辵
});

test('複数文字は1文字ずつに分解（渡辺）', () => {
  const r = db.search('渡辺');
  assert.equal(r.type, 'text');
  assert.deepEqual(r.chars.map((c) => c.key), ['6E21', '8FBA']);
});

test('IVS 付き文字列はその字形にフォーカス', () => {
  const r = db.search('邉\u{E010F}');
  assert.deepEqual(r.chars, [{ key: '9089', focus: { ivs: '9089_E010F' } }]);
});

test('互換漢字は対応UCSへ', () => {
  const r = db.search('塚'); // 互換漢字 塚
  assert.equal(r.chars[0].key, '585A');
  assert.deepEqual(r.chars[0].focus, { impl: 'FA10' });
});

test('読み検索（さいとう → 人名プリセット、さい → 斎・齋）', () => {
  const r = db.search('さいとう');
  assert.equal(r.type, 'reading');
  // names.json を読む前は手作業のプリセットだけを返す
  assert.deepEqual(r.names[0], { kind: '姓・地名', reading: 'さいとう', words: ['斉藤', '斎藤', '齊藤', '齋藤'] });
  const sai = db.search('サイ');
  assert.ok(sai.candidates.slice(0, sai.exactCount).includes('658E'));
  assert.ok(sai.candidates.includes('9F4B'));
  assert.ok(db.search('わたなべ').names[0].words.includes('渡邉'));
});

test('人名・地名の辞書（names.json）を読むと、姓・名・地名・置き換えに分かれる', async () => {
  await db.ensureNames();
  const kinds = (reading) => Object.fromEntries(db.search(reading).names
    .filter((g) => g.reading === reading).map((g) => [g.kind, g.words]));

  const watanabe = kinds('わたなべ');
  assert.deepEqual(watanabe['姓'], ['渡辺', '渡邉', '渡邊', '渡部']);
  assert.ok(watanabe['地名'].includes('渡辺'));

  // 辞書に無い異体字の表記は、置き換えで補う（髙橋・山﨑 は手作業プリセット、濱﨑 は生成）
  assert.ok(kinds('たかはし')['姓'].includes('髙橋'));
  assert.ok(kinds('はまざき')['異体字での表記'].includes('濱﨑'));
  assert.ok(kinds('かしま')['地名'].includes('鹿嶋市'));  // 「かしまし」でも「かしま」でも引ける
  assert.ok(db.names.surnames['さいとう'].includes('齋藤'));
});

test('MJ文字図形名', () => {
  assert.deepEqual(db.search('MJ026190').chars, [{ key: '9089', focus: { mj: 'MJ026190' } }]);
  assert.deepEqual(db.search('mj26190').chars[0].key, '9089');
  assert.equal(db.search('MJ999999').type, 'notfound');
});

test('コードポイント表記', () => {
  assert.equal(db.search('U+8FBB').chars[0].key, '8FBB');
  assert.deepEqual(db.search('8FBB_E0102').chars[0].focus, { ivs: '8FBB_E0102' });
  assert.deepEqual(db.search('U+9089 U+E010F').chars, [{ key: '9089', focus: { ivs: '9089_E010F' } }]);
  assert.deepEqual(db.search('&#x9089;&#xE010F;').chars[0].focus, { ivs: '9089_E010F' });
  assert.equal(db.search('&#36794;').chars[0].key, '8FBA');
  const vs = db.search('U+E0100');
  assert.equal(vs.type, 'notfound');
  assert.match(vs.reason, /VS17/);
});

test('部首・画数フィルター', () => {
  const r = db.search('', { radical: 162, strokesMin: 17, strokesMax: 17, ivsOnly: true });
  assert.equal(r.type, 'filter');
  assert.ok(r.candidates.includes('9089'));
  const filtered = db.search('へん', { policy: 'jouyou' });
  assert.ok(filtered.candidates.includes('8FBA'));
  assert.ok(!filtered.candidates.includes('908A'));
});

test('詳細と関連字（辺 → 邉・邊）', async () => {
  const detail = await db.detail('9089');
  const g = detail.glyphs.find((x) => x.mj === 'MJ026190');
  assert.deepEqual(copyFormats(g), {
    char: '邉\u{E010F}',
    mj: 'MJ026190',
    unicode: 'U+9089 U+E010F',
    html: '&#x9089;&#xE010F;',
    js: '\\u{9089}\\u{E010F}',
  });
  const rel = await db.related('8FBA');
  const keys = rel.primary.map((r) => r.key);
  assert.ok(keys.includes('9089') && keys.includes('908A'));
});
