// 字形の比較: 画面下のトレイと、比較ダイアログ（並べる／先頭2字を重ねる）。

import { $, h } from './dom.js';
import { exportMultiImage } from './export-actions.js';
import { showToast } from './feedback.js';
import { sequenceLabel } from './glyph-info.js';

export const COMPARE_MAX = 8;

/** @type {import('../db.js').Glyph[]} 比較中の字形（MJ文字図形名で一意） */
const glyphs = [];

/** @param {import('../db.js').Glyph} glyph */
export const isCompared = (glyph) => glyphs.some((g) => g.mj === glyph.mj);

function clearAll() {
  glyphs.length = 0;
  update();
}

export function setupCompare() {
  $('#compare-clear').addEventListener('click', clearAll);
  // 比較画面の中からも消せるようにする（開いている間、画面下のトレイは押せないので隠している）
  $('#compare-clear-all').addEventListener('click', () => {
    clearAll();
    $('#compare-dialog').close();
    showToast('比較リストを空にしました');
  });
  $('#compare-open').addEventListener('click', () => {
    renderStage();
    $('#compare-dialog').showModal();
  });
  $('#compare-size').addEventListener('input', applySize);
  $('#compare-guides').addEventListener('change', renderStage);
  $('#compare-overlay').addEventListener('change', renderStage);

  // 複数文字の連結書き出し
  const getExportOptions = () => ({
    direction: $('#compare-export-dir')?.value ?? 'horizontal',
    size: Number($('#compare-export-size')?.value ?? 1024),
  });

  $('#compare-copy-png')?.addEventListener('click', () => {
    if (glyphs.length < 2) return;
    exportMultiImage('copyMultiPng', [...glyphs], getExportOptions());
  });
  $('#compare-download-png')?.addEventListener('click', () => {
    if (glyphs.length < 2) return;
    exportMultiImage('downloadMultiPng', [...glyphs], getExportOptions());
  });
  $('#compare-download-svg')?.addEventListener('click', () => {
    if (glyphs.length < 2) return;
    exportMultiImage('downloadMultiSvg', [...glyphs], getExportOptions());
  });
}

/**
 * @param {import('../db.js').Glyph} glyph
 * @param {{silent?: boolean}} [options] silent: 上限を超えてもトーストを出さない
 * @returns {boolean} 追加したか
 */
export function addToCompare(glyph, { silent = false } = {}) {
  if (!glyph.char || isCompared(glyph)) return false;
  if (glyphs.length >= COMPARE_MAX) {
    if (!silent) showToast(`比較できるのは ${COMPARE_MAX} 字形までです`);
    return false;
  }
  glyphs.push(glyph);
  update();
  return true;
}

/** @param {import('../db.js').Glyph} glyph */
export function toggleCompare(glyph) {
  const i = glyphs.findIndex((g) => g.mj === glyph.mj);
  if (i === -1) {
    addToCompare(glyph);
  } else {
    glyphs.splice(i, 1);
    update();
  }
}

function update() {
  const tray = $('#compare-tray');
  tray.hidden = glyphs.length === 0;
  // 画面下に固定したトレイがフッターの文字を隠さないよう、その高さだけフッターの下に余白を取る
  requestAnimationFrame(() => document.body.style.setProperty('--tray-space', tray.hidden ? '0px' : `${tray.offsetHeight + 24}px`));
  $('#compare-count').textContent = String(glyphs.length);
  $('#compare-list').replaceChildren(...glyphs.map((glyph) => h('li', {},
    h('button', {
      class: 'glyph', type: 'button', title: `${glyph.mj}（クリックで削除）`, 'aria-label': `${glyph.mj} を比較から外す`,
      onclick: () => toggleCompare(glyph),
    },
      glyph.char))));
  // 表示中の字形カードの「比較」ボタンの状態を合わせる
  for (const card of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.glyph-card'))) {
    const selected = glyphs.some((g) => g.mj === card.dataset.mj);
    card.classList.toggle('is-selected', selected);
    $('.glyph-card__compare', card)?.setAttribute('aria-pressed', String(selected));
  }
  if ($('#compare-dialog').open) renderStage();
}

function applySize() {
  $('#compare-stage').style.setProperty('--size', `${$('#compare-size').value}px`);
}

function renderStage() {
  const stage = $('#compare-stage');
  stage.classList.toggle('show-guides', $('#compare-guides').checked);
  applySize();
  const items = [];
  if ($('#compare-overlay').checked && glyphs.length >= 2) items.push(overlayItem(glyphs[0], glyphs[1]));
  items.push(...glyphs.map((glyph) => h('div', { class: 'compare-item' },
    h('div', { class: 'compare-item__glyph glyph' }, glyph.char),
    h('div', { class: 'compare-item__label' }, glyph.mj, h('br'), sequenceLabel(glyph)),
    h('button', {
      class: 'button button--small compare-item__remove', type: 'button', 'aria-label': `${glyph.mj} を比較から外す`,
      onclick: () => toggleCompare(glyph),
    }, '外す'))));
  stage.replaceChildren(...(items.length ? items : [h('p', { class: 'muted' }, '字形カードの「比較」で追加してください。')]));

  const exportBox = $('#compare-export');
  if (exportBox) exportBox.hidden = glyphs.length < 2;
}

/**
 * 指定した字形リストを比較リストにセットして比較ダイアログを開く
 * @param {import('../db.js').Glyph[]} newGlyphs
 */
export function openCompareWithGlyphs(newGlyphs) {
  for (const g of newGlyphs) {
    addToCompare(g, { silent: true });
  }
  renderStage();
  $('#compare-dialog').showModal();
}

/**
 * @param {import('../db.js').Glyph} a
 * @param {import('../db.js').Glyph} b
 */
function overlayItem(a, b) {
  return h('div', { class: 'compare-item compare-overlay' },
    h('div', { class: 'compare-item__glyph glyph' },
      h('span', { class: 'layer-a' }, a.char),
      h('span', { class: 'layer-b' }, b.char)),
    h('div', { class: 'compare-legend' }, h('span', { class: 'a' }, a.mj), h('span', { class: 'b' }, b.mj)));
}
