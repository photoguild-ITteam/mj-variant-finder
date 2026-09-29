// 検索履歴（最近見た文字）とお気に入り（ピン留め）の管理・描画。
// localStorage に保存し、ブラウザ内だけで完結する（外部通信なし）。

import { $, h } from './dom.js';

export const STORAGE_KEY_HISTORY = 'mjv_history';
export const STORAGE_KEY_FAVORITES = 'mjv_favorites';
export const HISTORY_MAX = 10;
export const FAVORITES_MAX = 20;

// ---------------------------------------------------------------------------- 純粋ロジック（テスト可能）

/**
 * 検索履歴リストを更新する（新しいものが先頭、重複排除、最大件数で切り詰め）
 * @param {string[]} list
 * @param {string} query
 * @param {number} [max]
 * @returns {string[]}
 */
export function updateHistoryList(list, query, max = HISTORY_MAX) {
  const q = query?.trim();
  if (!q) return [...list];
  const next = [q, ...list.filter((item) => item !== q)];
  return next.slice(0, max);
}

/**
 * お気に入りリストのトグル（存在すれば削除、なければ先頭に追加）
 * @param {string[]} list
 * @param {string} query
 * @param {number} [max]
 * @returns {string[]}
 */
export function toggleFavoriteInList(list, query, max = FAVORITES_MAX) {
  const q = query?.trim();
  if (!q) return [...list];
  if (list.includes(q)) {
    return list.filter((item) => item !== q);
  }
  const next = [q, ...list];
  return next.slice(0, max);
}

/**
 * リストから指定アイテムを削除
 * @param {string[]} list
 * @param {string} query
 * @returns {string[]}
 */
export function removeFromList(list, query) {
  const q = query?.trim();
  if (!q) return [...list];
  return list.filter((item) => item !== q);
}

// ---------------------------------------------------------------------------- ストレージ操作

function loadStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStorage(key, data) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // クォータ超過やストレージ無効時は無視
  }
}

let historyCache = null;
let favoritesCache = null;

function ensureCache() {
  if (historyCache === null) historyCache = loadStorage(STORAGE_KEY_HISTORY);
  if (favoritesCache === null) favoritesCache = loadStorage(STORAGE_KEY_FAVORITES);
}

export function getHistory() {
  ensureCache();
  return [...historyCache];
}

export function getFavorites() {
  ensureCache();
  return [...favoritesCache];
}

export function isFavorite(query) {
  ensureCache();
  const q = query?.trim();
  return Boolean(q && favoritesCache.includes(q));
}

export function addHistory(query) {
  ensureCache();
  const q = query?.trim();
  if (!q) return;
  historyCache = updateHistoryList(historyCache, q);
  saveStorage(STORAGE_KEY_HISTORY, historyCache);
  renderHistoryBar();
}

export function removeHistoryItem(query) {
  ensureCache();
  historyCache = removeFromList(historyCache, query);
  saveStorage(STORAGE_KEY_HISTORY, historyCache);
  renderHistoryBar();
}

export function clearHistory() {
  ensureCache();
  historyCache = [];
  saveStorage(STORAGE_KEY_HISTORY, historyCache);
  renderHistoryBar();
}

export function toggleFavorite(query) {
  ensureCache();
  const q = query?.trim();
  if (!q) return false;
  const isNowFav = !favoritesCache.includes(q);
  favoritesCache = toggleFavoriteInList(favoritesCache, q);
  saveStorage(STORAGE_KEY_FAVORITES, favoritesCache);
  renderHistoryBar();
  return isNowFav;
}

export function removeFavoriteItem(query) {
  ensureCache();
  favoritesCache = removeFromList(favoritesCache, query);
  saveStorage(STORAGE_KEY_FAVORITES, favoritesCache);
  renderHistoryBar();
}

// ---------------------------------------------------------------------------- UI描画

/**
 * 検索パネル内の履歴・お気に入りバーを描画する
 */
export function renderHistoryBar() {
  const container = $('#search-history');
  if (!container) return;

  ensureCache();
  const hasFav = favoritesCache.length > 0;
  const hasHist = historyCache.length > 0;

  if (!hasFav && !hasHist) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const rows = [];

  // お気に入り行
  if (hasFav) {
    const favChips = favoritesCache.map((item) =>
      h('span', { class: 'chip-item chip-item--fav' },
        h('button', {
          class: 'chip-item__btn glyph',
          type: 'button',
          'data-query': item,
          title: `「${item}」を検索`,
        }, item),
        h('button', {
          class: 'chip-item__remove',
          type: 'button',
          'aria-label': `「${item}」をお気に入りから解除`,
          title: 'お気に入りから解除',
          onclick: (e) => {
            e.stopPropagation();
            removeFavoriteItem(item);
          },
        }, '×')));

    rows.push(
      h('div', { class: 'search-history__row' },
        h('span', { class: 'search-history__label search-history__label--fav' }, '★ お気に入り:'),
        ...favChips));
  }

  // 履歴行
  if (hasHist) {
    const histChips = historyCache.map((item) =>
      h('span', { class: 'chip-item' },
        h('button', {
          class: 'chip-item__btn',
          type: 'button',
          'data-query': item,
          title: `「${item}」を再検索`,
        }, item),
        h('button', {
          class: 'chip-item__remove',
          type: 'button',
          'aria-label': `「${item}」を履歴から削除`,
          title: '削除',
          onclick: (e) => {
            e.stopPropagation();
            removeHistoryItem(item);
          },
        }, '×')));

    rows.push(
      h('div', { class: 'search-history__row' },
        h('span', { class: 'search-history__label' }, '最近の検索:'),
        ...histChips,
        h('button', {
          class: 'search-history__clear',
          type: 'button',
          onclick: () => clearHistory(),
        }, '履歴を消去')));
  }

  container.replaceChildren(...rows);
}
