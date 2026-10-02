// トースト通知とクリップボードへのコピー。

import { $, h } from './dom.js';

const TOAST_MS = 2200;

/**
 * 例外の文言. catch で受けた値は Error とは限らない（文字列などが投げられることもある）ので、文字列にして返す.
 * @param {unknown} err
 * @param {string} [fallback] Error でないときの文言（既定は String(err)）
 */
export const errorMessage = (err, fallback = String(err)) => (err instanceof Error ? err.message : fallback);
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/** @param {string | Node} message */
export function showToast(message) {
  const toast = $('#toast');
  toast.replaceChildren(message);
  topLayer().append(toast);
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), TOAST_MS);
}

/**
 * 字形を含むトースト（例: 「邉 をコピーしました」）
 * @param {string} char
 * @param {string} text
 */
export const glyphMessage = (char, text) => h('span', {}, h('span', { class: 'glyph' }, char), text);

/**
 * @param {string} text
 * @param {string | Node} message コピーできたときのトースト
 */
export async function copyText(text, message) {
  if (await writeClipboard(text)) showToast(message);
  else showToast('コピーできませんでした');
}

/**
 * @param {string} text
 * @returns {Promise<boolean>} コピーできたか
 */
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 権限が無い・非セキュアな環境向けの旧方式
    const proxy = h('textarea', { class: 'clipboard-proxy', 'aria-hidden': 'true' });
    proxy.value = text;
    topLayer().append(proxy);
    proxy.select();
    const ok = document.execCommand('copy');
    proxy.remove();
    return ok;
  }
}

/**
 * 通知やコピー用の要素を置く場所。モーダルのダイアログを開いている間は、その外側が inert になり
 * 背景の裏に隠れる（読み上げもされない）ので、開いているダイアログの中に置く
 */
function topLayer() {
  const open = document.querySelectorAll('dialog[open]');
  return open.length ? open[open.length - 1] : document.body;
}
