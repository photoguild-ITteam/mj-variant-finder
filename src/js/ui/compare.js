// 字形の比較: 画面下のトレイと、比較ダイアログ（並べる／先頭2字を重ねる）。

import { $, h } from './dom.js';
import { showToast } from './feedback.js';
import { sequenceLabel } from './glyph-info.js';

export const COMPARE_MAX = 8;

/** @type {object[]} 比較中の字形（MJ文字図形名で一意） */
const glyphs = [];

export const isCompared = (glyph) => glyphs.some((g) => g.mj === glyph.mj);

export function setupCompare() {
  $('#compare-clear').addEventListener('click', () => {
    glyphs.length = 0;
    update();
  });
  $('#compare-open').addEventListener('click', () => {
    renderStage();
    $('#compare-dialog').showModal();
  });
  $('#compare-size').addEventListener('input', applySize);
  $('#compare-guides').addEventListener('change', renderStage);
  $('#compare-overlay').addEventListener('change', renderStage);
}

/** @returns {boolean} 追加したか */
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
  $('#compare-tray').hidden = glyphs.length === 0;
  $('#compare-count').textContent = String(glyphs.length);
  $('#compare-list').replaceChildren(...glyphs.map((glyph) => h('li', {},
    h('button', { class: 'glyph', type: 'button', title: `${glyph.mj}（クリックで削除）`, onclick: () => toggleCompare(glyph) },
      glyph.char))));
  // 表示中の字形カードの「比較」ボタンの状態を合わせる
  for (const card of document.querySelectorAll('.glyph-card')) {
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
    h('div', { class: 'compare-item__label' }, glyph.mj, h('br'), sequenceLabel(glyph)))));
  stage.replaceChildren(...(items.length ? items : [h('p', { class: 'muted' }, '字形カードの「比較」で追加してください。')]));
}

function overlayItem(a, b) {
  return h('div', { class: 'compare-item compare-overlay' },
    h('div', { class: 'compare-item__glyph glyph' },
      h('span', { class: 'layer-a' }, a.char),
      h('span', { class: 'layer-b' }, b.char)),
    h('div', { class: 'compare-legend' }, h('span', { class: 'a' }, a.mj), h('span', { class: 'b' }, b.mj)));
}
