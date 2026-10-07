// ブラウザに保存する設定のキー。DOM に依存しない（tests/storage.test.mjs でテスト）。
//
// キーにはすべて mjv_ を付ける。github.io では同じ組織の別のページと保存場所（origin）を共有するので、
// theme のような一般的な名前だと、別のページの値とぶつかる。保存するキーと値の形は、互換を守る対象
// （docs/COMPATIBILITY.md）。形を変えるときは、古いキー・古い形から読み移す。

export const STORAGE_KEYS = {
  history: 'mjv_history',
  favorites: 'mjv_favorites',
  theme: 'mjv_theme',
  glyphDiff: 'mjv_glyph_diff',
};

/** 0.6 までのキー → 新しいキー。theme-init.js（通常のスクリプトで import できない）にも同じ対応を書いている */
export const LEGACY_KEYS = {
  [STORAGE_KEYS.theme]: 'theme',
  [STORAGE_KEYS.glyphDiff]: 'glyph-diff',
};

/**
 * 保存した値を読む. 新しいキーに値が無ければ、古いキーの値を1回だけ新しいキーへ写す.
 * 古いキーは消さない（同じ origin の別のページが、同じ名前のキーを使っているかもしれないため）。
 * @param {Pick<Storage, 'getItem' | 'setItem'>} storage
 * @param {string} key
 * @param {(value: string) => boolean} isValid 古いキーの値を受け入れるか（別のページが書いた値を取り込まない）
 * @returns {string | null}
 */
export function readSetting(storage, key, isValid) {
  const value = storage.getItem(key);
  if (value !== null) return value;
  const legacyKey = LEGACY_KEYS[key];
  const legacy = legacyKey ? storage.getItem(legacyKey) : null;
  if (legacy === null || !isValid(legacy)) return null;
  storage.setItem(key, legacy);
  return legacy;
}
