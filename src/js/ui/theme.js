// ダーク/ライトの切り替え。
// 初期値は theme-init.js が描画前に <html data-theme> へ入れる（保存値、無ければ OS の設定）。
// CSS は data-theme だけを見る。

import { $ } from './dom.js';

const STORAGE_KEY = 'theme';
const THEME_COLOR = { light: '#f6f3ec', dark: '#0a0f1c' };
const systemDark = matchMedia('(prefers-color-scheme: dark)');

const current = () => document.documentElement.dataset.theme;

function savedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
  $('meta[name="theme-color"]').content = THEME_COLOR[theme];
}

export function setupTheme() {
  apply(current() === 'dark' ? 'dark' : 'light');
  $('#theme-toggle').addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    apply(next);
  });
  // 手動で選んでいなければ OS の設定変更に追従する
  systemDark.addEventListener('change', (e) => {
    if (!savedTheme()) apply(e.matches ? 'dark' : 'light');
  });
}
