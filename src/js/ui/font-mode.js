// 表示する書体の切り替え（明朝モード・ゴシックモード）。
// ゴシックモードでは、字の検索結果をゴシック体で出せる字形（通常の字形と、Adobe-Japan1 の IVS で出せる形）だけにし、
// 字の見出し・タブ・関連字もゴシック体（同梱の見本用フォント）で表示する。CSS は <html data-font-mode> を見る。

import { STORAGE_KEYS } from '../storage.js';
import { loadGothicFonts } from './gothic-fonts.js';

/** @typedef {'mincho' | 'gothic'} FontMode */

const STORAGE_KEY = STORAGE_KEYS.fontMode;

/** @returns {FontMode} */
export const fontMode = () => (document.documentElement.dataset.fontMode === 'gothic' ? 'gothic' : 'mincho');

/** @returns {FontMode | null} */
function saved() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'mincho' || value === 'gothic' ? value : null;
  } catch {
    return null;
  }
}

/** @param {FontMode} mode */
function apply(mode) {
  document.documentElement.dataset.fontMode = mode;
  for (const button of document.querySelectorAll('[data-font-mode]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-font-mode') === mode));
  }
  // 見出しなどをゴシック体で描くので、見本用フォントの @font-face を読んでおく（読めなければ端末のフォントで描く）
  if (mode === 'gothic') loadGothicFonts().catch((err) => console.warn(err));
}

/**
 * @param {() => void} onChange 切り替えたとき（今の検索結果を描き直す）
 */
export function setupFontMode(onChange) {
  apply(saved() ?? 'mincho');
  for (const button of document.querySelectorAll('[data-font-mode]')) {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-font-mode') === 'gothic' ? 'gothic' : 'mincho';
      if (mode === fontMode()) return;
      try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
      apply(mode);
      onChange();
    });
  }
}
