// 混同しやすい字・異構字・類形字の辞書と相互リンクのテスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFUSABLE_GROUPS, getConfusablesForChar, getWordVariantSuggestions } from '../src/js/confusables.js';
import { VariantDB } from '../src/js/db.js';

const fetchJson = async (url) => JSON.parse(await readFile(url));
const db = await VariantDB.load(new URL('../src/data/', import.meta.url), fetchJson);

test('収録文字はすべて MJ文字情報一覧表（IPAmj明朝）に実在する', () => {
  for (const group of CONFUSABLE_GROUPS) {
    for (const ch of group.chars) {
      const key = db.resolve(ch.codePointAt(0));
      assert.ok(key, `「${ch}」（グループ: ${group.name}）が MJ DB に見つかりません`);
    }
  }
});

test('相互リンクの整合性: AからBが引ければ、BからもAが引ける', () => {
  for (const group of CONFUSABLE_GROUPS) {
    for (const a of group.chars) {
      const rels = getConfusablesForChar(a);
      const match = rels.find((r) => r.group.name === group.name);
      assert.ok(match, `「${a}」からグループ「${group.name}」が取得できません`);
      for (const b of group.chars) {
        if (a !== b) {
          assert.ok(match.others.includes(b), `「${a}」の相手文字に「${b}」が含まれていません`);
        }
      }
    }
  }
});

test('島・嶋・嶌の相互リンク', () => {
  const shima = getConfusablesForChar('島');
  assert.equal(shima.length, 1);
  assert.deepEqual(shima[0].others, ['嶋', '嶌', '㠀']);

  const shima2 = getConfusablesForChar('嶋');
  assert.ok(shima2[0].others.includes('島'));
  assert.ok(shima2[0].others.includes('嶌'));

  const shima3 = getConfusablesForChar('嶌');
  assert.ok(shima3[0].others.includes('島'));
  assert.ok(shima3[0].others.includes('嶋'));
});

test('柳・栁の相互リンク', () => {
  const yanagi = getConfusablesForChar('柳');
  assert.ok(yanagi.some((r) => r.others.includes('栁')));

  const maruyanagi = getConfusablesForChar('栁');
  assert.ok(maruyanagi.some((r) => r.others.includes('柳')));
});

test('柿（カキ）と杮（コケラ）の類似字リンクと解説', () => {
  const kaki = getConfusablesForChar('柿');
  const rel = kaki.find((r) => r.group.name === 'カキとコケラ');
  assert.ok(rel);
  assert.equal(rel.group.type, 'confusable');
  assert.ok(rel.others.includes('杮'));
  assert.ok(rel.group.notes['柿'].includes('果物'));
  assert.ok(rel.group.notes['杮'].includes('こけら落とし'));

  const kokera = getConfusablesForChar('杮');
  const rel2 = kokera.find((r) => r.group.name === 'カキとコケラ');
  assert.ok(rel2);
  assert.ok(rel2.others.includes('柿'));
});

test('荻（オギ）と萩（ハギ）の類似字リンク', () => {
  const ogi = getConfusablesForChar('荻');
  assert.ok(ogi.some((r) => r.others.includes('萩')));

  const hagi = getConfusablesForChar('萩');
  assert.ok(hagi.some((r) => r.others.includes('荻')));
});

test('単語の表記候補サジェスト（getWordVariantSuggestions）', () => {
  // 中島 → 中嶋、中嶌
  const nakajima = getWordVariantSuggestions('中島');
  const words1 = nakajima.map((s) => s.word);
  assert.ok(words1.includes('中嶋'));
  assert.ok(words1.includes('中嶌'));

  // 柳田 → 栁田
  const yanagida = getWordVariantSuggestions('柳田');
  assert.ok(yanagida.map((s) => s.word).includes('栁田'));

  // 柿落とし → 杮落とし
  const kokeraOtoshi = getWordVariantSuggestions('柿落とし');
  assert.ok(kokeraOtoshi.map((s) => s.word).includes('杮落とし'));
  assert.equal(kokeraOtoshi.find((s) => s.word === '杮落とし').type, 'confusable');

  // 山崎 → 山﨑、山嵜、山碕
  const yamazaki = getWordVariantSuggestions('山崎');
  const words2 = yamazaki.map((s) => s.word);
  assert.ok(words2.includes('山﨑'));
  assert.ok(words2.includes('山嵜'));

  // 存在しない文字や長すぎるクエリは空配列
  assert.deepEqual(getWordVariantSuggestions(''), []);
  assert.deepEqual(getWordVariantSuggestions('あいうえおかきくけこ'), []);
});
