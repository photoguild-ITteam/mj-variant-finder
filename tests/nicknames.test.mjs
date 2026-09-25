// node --test tests/
// 呼び名（はしごだか など）と部首名の辞書（src/data/nicknames.json）が、MJ文字情報一覧表のデータと合っているか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VariantDB } from '../src/js/db.js';

const base = new URL('../src/data/', import.meta.url);
const db = await VariantDB.load(base, async (url) => JSON.parse(await readFile(url, 'utf8')));
const dict = await db.ensureNicknames();
const keyOf = (ch) => db.resolve(ch.codePointAt(0));

test('部首名: 例の字が、その部首を持っている（部首番号の誤りを見つける）', () => {
  const wrong = dict.radicals.filter((r) => {
    const key = keyOf(r.example);
    return !key || !db.radicalsOf(key).some((n) => [r.radical].flat().includes(n));
  }).map((r) => `${r.names[0]}（${r.radical}）の例 ${r.example}`);
  assert.deepEqual(wrong, []);
});

test('名前が重複していない', () => {
  const names = [...dict.radicals, ...dict.nicknames].flatMap((r) => r.names);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  assert.ok(names.every((n) => /^[ぁ-ゖー]+$/.test(n)), 'ひらがなで書く');
});

test('呼び名: 対象の字・字形が一覧表にあり、MJ文字図形名が合っている', async () => {
  for (const entry of dict.nicknames) {
    for (const [i, code] of entry.targets.entries()) {
      const [base, vs] = code.split('_');
      const key = db.resolve(parseInt(base, 16));
      assert.ok(key, `${entry.names[0]}: ${code} が無い`);
      if (!vs) continue;
      const glyph = (await db.detail(key)).glyphs.find((g) => g.ivs?.includes(code));
      assert.ok(glyph, `${entry.names[0]}: ${code} の字形が無い`);
      assert.equal(glyph.mj, entry.mj?.[i], `${entry.names[0]}: ${code} は ${glyph.mj}`);
    }
  }
});

test('呼び名で検索できる（完全一致・前方一致・IVS の字形）', () => {
  const r = db.search('はしごだか');
  assert.equal(r.type, 'reading');
  assert.deepEqual(r.nicknames[0].targets, [{ query: '髙', char: '髙', mj: undefined }]);

  // 字形を指す呼び名は、その字形を開くコードで検索する
  const nishi = db.search('たてにし').nicknames[0];
  assert.deepEqual(nishi.targets, [{ query: '897F_E0102', char: '西\u{E0102}', mj: 'MJ024197' }]);
  assert.equal(db.search(nishi.targets[0].query).chars[0].focus.ivs, '897F_E0102');

  // 社内で使っている呼び名
  assert.equal(db.search('みずはら').nicknames[0].targets[0].char, '厡');
  for (const name of ['いちてんつじ', 'しんにょうつじ']) {
    assert.equal(db.search(name).nicknames[0].targets[0].query, '8FBB_E0102', name);
  }

  // 「はしご」は読み（梯）でもあり、呼び名の前方一致も出す
  const ladder = db.search('はしご');
  assert.ok(ladder.candidates.length > 0);
  assert.equal(ladder.nicknames[0].name, 'はしごだか');
});

test('部首名＋の＋読みで検索できる（2つ目の部首でも引ける）', () => {
  const chars = (q) => db.search(q).byRadical?.keys.map((k) => String.fromCodePoint(parseInt(k, 16))) ?? [];
  assert.ok(['崎', '﨑', '嵜'].every((ch) => chars('やまへんのさき').includes(ch)));
  assert.deepEqual(chars('いしへんのさき').slice(0, 1), ['碕']);
  assert.ok(chars('ぎょうにんべんのとく').includes('德')); // 「にんべん」より長い名前を先に試す
  assert.ok(chars('つのへんのかい').includes('解'));       // 解 の最初の部首は 刀、2つ目が 角
  // 読みそのものに一致する字があるときや、部首名でないときは試さない
  assert.equal(db.search('ひのき').byRadical ?? null, null);
  assert.equal(db.search('たなか').byRadical ?? null, null);
});

test('部首での絞り込みも2つ目の部首で引ける', () => {
  const r = db.search('', { radical: 148 });
  assert.ok(r.candidates.includes(keyOf('解')));
});
