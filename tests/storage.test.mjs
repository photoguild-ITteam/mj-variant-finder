import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_KEYS, STORAGE_KEYS, readSetting } from '../src/js/storage.js';

/** localStorage の代わり（Map） */
const fakeStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
};
const isTheme = (v) => v === 'light' || v === 'dark';

test('キーはすべて mjv_ で始まる（同じ origin の別のページとぶつからない）', () => {
  for (const key of Object.values(STORAGE_KEYS)) assert.match(key, /^mjv_/);
});

test('readSetting: 新しいキーがあればそれを使い、古いキーは見ない', () => {
  const s = fakeStorage({ mjv_theme: 'light', theme: 'dark' });
  assert.equal(readSetting(s, STORAGE_KEYS.theme, isTheme), 'light');
});

test('readSetting: 新しいキーが無ければ古いキーから写し、古いキーは消さない', () => {
  const s = fakeStorage({ theme: 'dark', 'glyph-diff': 'on' });
  assert.equal(readSetting(s, STORAGE_KEYS.theme, isTheme), 'dark');
  assert.equal(s.map.get('mjv_theme'), 'dark');
  assert.equal(s.map.get('theme'), 'dark');
  assert.equal(readSetting(s, STORAGE_KEYS.glyphDiff, (v) => v === 'on' || v === 'off'), 'on');
  assert.equal(s.map.get('mjv_glyph_diff'), 'on');
});

test('readSetting: 古いキーの値が正しくなければ取り込まない（別のページが書いた値）', () => {
  const s = fakeStorage({ theme: 'solarized' });
  assert.equal(readSetting(s, STORAGE_KEYS.theme, isTheme), null);
  assert.equal(s.map.has('mjv_theme'), false);
});

test('readSetting: 古いキーの無いもの（履歴）は、新しいキーだけを見る', () => {
  assert.equal(LEGACY_KEYS[STORAGE_KEYS.history], undefined);
  assert.equal(readSetting(fakeStorage(), STORAGE_KEYS.history, () => true), null);
});
