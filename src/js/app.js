// 起動と画面遷移。検索語は URL の #q= に持ち、戻る/進む・リンク共有に対応する。
// 各部品は ui/ 以下（結果の描画 results.js、字形カード glyph-card.js、比較 compare.js など）。

import { AuthRequiredError, KANA_ONLY, VariantDB } from './db.js';
import { setupCompare } from './ui/compare.js';
import { app } from './ui/context.js';
import { $, h } from './ui/dom.js';
import { renderQuickAccess, setupFilters } from './ui/filters.js';
import { setupFontStatus } from './ui/font-status.js';
import { setupGlyphDiff } from './ui/glyph-diff.js';
import { setupHandwriting } from './ui/handwriting.js';
import { setupImageSearch } from './ui/image-search.js';
import { isFilterable, renderResult } from './ui/results.js';
import { setupSessionWatch, showSessionExpired } from './ui/session.js';
import { setupTheme } from './ui/theme.js';

const DEFAULT_TITLE = '異体字検索 MJ Variant Finder — IPAmj明朝・MJ文字情報一覧表';
const wide = matchMedia('(min-width: 1000px)');

init().catch((err) => {
  console.error(err);
  if (err instanceof AuthRequiredError) {
    showSessionExpired();
    return;
  }
  $('#results').replaceChildren(h('div', { class: 'notice notice--error' },
    h('strong', {}, 'データの読み込みに失敗しました。'),
    h('p', {}, String(err.message ?? err)),
    h('p', { class: 'muted' }, 'file:// で開いている場合は、ローカルHTTPサーバー（例: python -m http.server）経由で開いてください。')));
});

async function init() {
  setupTheme();
  setupDialogs();
  setupCompare();
  setupGlyphDiff();
  setupSessionWatch();
  setupFontStatus();

  app.db = await VariantDB.load();

  setupSearchForm();
  setupHandwriting();
  setupImageSearch();
  setupFilters(() => {
    if (isFilterable(app.result)) search(app.query, { fromHash: true });
  });
  renderQuickAccess();
  renderDataMeta();

  window.addEventListener('hashchange', () => {
    const byUser = navigating;
    navigating = false;
    search(queryFromHash(), { fromHash: !byUser });
  });
  await search(queryFromHash(), { fromHash: true });
  if (!queryFromHash() && wide.matches) $('#q').focus();
}

// ---------------------------------------------------------------------------- 検索と URL

const queryFromHash = () => new URLSearchParams(location.hash.slice(1)).get('q') ?? '';

/** navigate() で URL を変えた直後か（戻る/進む・リンクから開いた場合と区別する） */
let navigating = false;

/** 検索語を URL に反映する（hashchange で search が走る）。同じ語なら描き直すだけ */
function navigate(rawQuery) {
  const query = rawQuery.trim();
  const hash = query ? `#q=${encodeURIComponent(query)}` : '';
  if (query === queryFromHash() && (hash || !location.hash || location.hash === '#')) {
    search(query);
  } else {
    navigating = true;
    location.hash = hash;
  }
}

async function search(query, { fromHash = false } = {}) {
  const input = $('#q');
  if (input.value !== query) input.value = query;
  document.title = query ? `${query} の異体字 — 異体字検索` : DEFAULT_TITLE;

  app.query = query;
  // 読み検索では人名・地名の辞書（遅延読み込み）を待つ。読めなくても検索は続ける
  if (KANA_ONLY.test(query.trim())) await app.db.ensureNames().catch((err) => console.warn(err));
  app.result = app.db.search(query, app.filters);
  await renderResult(app.result);

  // 狭い画面では「よく検索される異体字」が結果を押し下げるので、検索中は畳む（空の検索で開く）
  if (!wide.matches) $('#quick-access-box').open = !query;

  // 狭い画面では検索パネルの下に結果があるので、操作した後は結果までスクロールする
  if (!fromHash && !wide.matches) $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupSearchForm() {
  const input = $('#q');
  input.disabled = false;
  $('#search-form button[type="submit"]').disabled = false;
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(input.value);
  });
  // data-query を持つ要素（例・候補・関連字・人名など）はすべて検索語へのリンクとして扱う
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-query]');
    if (!target) return;
    e.preventDefault();
    navigate(target.dataset.query);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.target.closest('input, textarea, select, dialog')) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
}

// ---------------------------------------------------------------------------- その他

function setupDialogs() {
  $('#license-open').addEventListener('click', () => $('#license-dialog').showModal());
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    });
  }
}

function renderDataMeta() {
  const { generatedAt, counts } = app.db.meta;
  $('#data-meta').textContent = `データ生成: ${new Date(generatedAt).toLocaleDateString('ja-JP')} · ${counts.mjGlyphs.toLocaleString()} 字形 / ${counts.ucsChars.toLocaleString()} 文字`;
}
