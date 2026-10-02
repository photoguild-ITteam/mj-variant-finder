// node --test tests/
// 検索履歴・お気に入りのデータロジックの単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_MAX,
  FAVORITES_MAX,
  updateHistoryList,
  toggleFavoriteInList,
  removeFromList,
  loadStorage,
} from '../src/js/ui/history.js';

test('updateHistoryList: 空文字や空白のみは追加しない', () => {
  const initial = ['渡辺', 'さいとう'];
  assert.deepEqual(updateHistoryList(initial, ''), initial);
  assert.deepEqual(updateHistoryList(initial, '   '), initial);
  assert.deepEqual(updateHistoryList(initial, null), initial);
});

test('updateHistoryList: 新しい検索語を先頭に追加', () => {
  const initial = ['渡辺', 'さいとう'];
  const res = updateHistoryList(initial, '高');
  assert.deepEqual(res, ['高', '渡辺', 'さいとう']);
});

test('updateHistoryList: 既存の語は重複せず先頭に移動', () => {
  const initial = ['高', '渡辺', 'さいとう'];
  const res = updateHistoryList(initial, 'さいとう');
  assert.deepEqual(res, ['さいとう', '高', '渡辺']);
});

test('updateHistoryList: 最大件数を超えたら古いものを切り詰め', () => {
  let list = [];
  for (let i = 0; i < HISTORY_MAX + 5; i++) {
    list = updateHistoryList(list, `word_${i}`);
  }
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(list[0], `word_${HISTORY_MAX + 4}`);
  assert.ok(!list.includes('word_0'));
});

test('toggleFavoriteInList: お気に入りの追加と解除（トグル）', () => {
  let favs = ['邊'];
  favs = toggleFavoriteInList(favs, '髙');
  assert.deepEqual(favs, ['髙', '邊']);

  // 再度呼ぶと解除
  favs = toggleFavoriteInList(favs, '髙');
  assert.deepEqual(favs, ['邊']);
});

test('toggleFavoriteInList: 最大件数で制限', () => {
  let favs = [];
  for (let i = 0; i < FAVORITES_MAX + 5; i++) {
    favs = toggleFavoriteInList(favs, `fav_${i}`);
  }
  assert.equal(favs.length, FAVORITES_MAX);
  assert.equal(favs[0], `fav_${FAVORITES_MAX + 4}`);
});

test('removeFromList: 個別削除', () => {
  const list = ['A', 'B', 'C'];
  assert.deepEqual(removeFromList(list, 'B'), ['A', 'C']);
  assert.deepEqual(removeFromList(list, 'Z'), ['A', 'B', 'C']);
});

test('loadStorage: 文字列の配列でなければ空として扱う（壊れた値・別のページが書いた値）', () => {
  const saved = globalThis.localStorage;
  const values = { arr: '["渡辺",1,"さいとう"]', obj: '{"theme":"dark"}', broken: '[', str: '"x"' };
  globalThis.localStorage = /** @type {any} */ ({ getItem: (key) => values[key] ?? null });
  try {
    assert.deepEqual(loadStorage('arr'), ['渡辺', 'さいとう']);
    assert.deepEqual(loadStorage('obj'), []);
    assert.deepEqual(loadStorage('broken'), []);
    assert.deepEqual(loadStorage('str'), []);
    assert.deepEqual(loadStorage('none'), []);
  } finally {
    globalThis.localStorage = saved;
  }
});
