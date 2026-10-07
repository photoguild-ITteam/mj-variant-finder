// 検索履歴（最近見た文字）とお気に入り（ピン留め）の管理・描画。
// localStorage に保存し、ブラウザ内だけで完結する（外部通信なし）。

import { STORAGE_KEYS } from '../storage.js';
import { $, h } from './dom.js';

export const STORAGE_KEY_HISTORY = STORAGE_KEYS.history;
export const STORAGE_KEY_FAVORITES = STORAGE_KEYS.favorites;
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

/**
 * 保存した一覧を読む. 文字列の配列でなければ空として扱う
 * （壊れた値や、同じ origin の別のページが同じキーに書いた値で、検索や起動を止めないため）。
 * @param {string} key
 * @returns {string[]}
 */
export function loadStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} key
 * @param {string[]} data
 */
function saveStorage(key, data) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // クォータ超過やストレージ無効時は無視
  }
}

/** @type {string[] | null} 最初に使うときに localStorage から読む */
let historyCache = null;
/** @type {string[] | null} */
let favoritesCache = null;

const historyList = () => (historyCache ??= loadStorage(STORAGE_KEY_HISTORY));
const favoritesList = () => (favoritesCache ??= loadStorage(STORAGE_KEY_FAVORITES));

export function getHistory() {
  return [...historyList()];
}

export function getFavorites() {
  return [...favoritesList()];
}

/** @param {string} query */
export function isFavorite(query) {
  const q = query?.trim();
  return Boolean(q && favoritesList().includes(q));
}

/** @param {string} query */
export function addHistory(query) {
  const q = query?.trim();
  if (!q) return;
  historyCache = updateHistoryList(historyList(), q);
  saveStorage(STORAGE_KEY_HISTORY, historyCache);
  renderHistoryBar();
}

/** @param {string} query */
export function removeHistoryItem(query) {
  historyCache = removeFromList(historyList(), query);
  saveStorage(STORAGE_KEY_HISTORY, historyCache);
  renderHistoryBar();
}

export function clearHistory() {
  historyCache = [];
  saveStorage(STORAGE_KEY_HISTORY, historyCache);
  renderHistoryBar();
}

/**
 * @param {string} query
 * @returns {boolean} お気に入りになったか
 */
export function toggleFavorite(query) {
  const q = query?.trim();
  if (!q) return false;
  const isNowFav = !favoritesList().includes(q);
  favoritesCache = toggleFavoriteInList(favoritesList(), q);
  saveStorage(STORAGE_KEY_FAVORITES, favoritesCache);
  renderHistoryBar();
  return isNowFav;
}

/** @param {string} query */
export function removeFavoriteItem(query) {
  favoritesCache = removeFromList(favoritesList(), query);
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

  const favorites = favoritesList();
  const history = historyList();
  const hasFav = favorites.length > 0;
  const hasHist = history.length > 0;

  if (!hasFav && !hasHist) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const rows = [];

  // お気に入り行
  if (hasFav) {
    const favChips = favorites.map((item) =>
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
          onclick: (/** @type {MouseEvent} */ e) => {
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
    const histChips = history.map((item) =>
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
          onclick: (/** @type {MouseEvent} */ e) => {
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
