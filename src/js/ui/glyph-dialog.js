// 字形の詳細ダイアログ: コピー形式、画像の書き出し、MJ文字情報一覧表・縮退マップの全項目。

import { copyFormats, keyToChar } from '../db.js';
import { app } from './context.js';
import { $, h } from './dom.js';
import { toggleCompare } from './compare.js';
import { exportImage } from './export-actions.js';
import { copyText } from './feedback.js';
import { glyphDetailSections } from './glyph-info.js';

export function openGlyphDialog(glyph) {
  $('#glyph-dialog-title').textContent = `${glyph.mj} の詳細`;
  const sections = glyphDetailSections(glyph, app.db.meta.gothic);

  $('#glyph-dialog-body').replaceChildren(
    h('div', { class: 'glyph-detail' },
      h('div', { class: 'glyph-detail__top' },
        h('div', { class: 'glyph-detail__glyph glyph' }, glyph.char ?? '？'),
        h('div', {},
          glyph.ivdOnly ? h('p', { class: 'notice notice--warn notice--compact' },
            'この IVS は IVD 2026-08-03 で追加されたもので、IPAmj明朝 Ver.006.01 には字形がありません。コピー用の文字には実装済みの符号を使っています。') : null,
          glyph.char ? copyRows(glyph) : h('p', {}, 'この字形には符号位置がありません。'),
          h('div', { class: 'glyph-detail__actions' },
            h('button', { class: 'button button--small', type: 'button', onclick: () => toggleCompare(glyph) }, '比較に追加/削除')),
          glyph.char ? exportBox(glyph) : null)),
      h('div', { class: 'glyph-detail__sections' },
        sections.map((sec) => renderSection(sec)))),
  );
  $('#glyph-dialog').showModal();
}

function copyRows(glyph) {
  const f = copyFormats(glyph);
  const row = (label, value, valueClass = '') => h('div', { class: 'copy-row' },
    h('span', { class: 'copy-row__label' }, label),
    h('span', { class: `copy-row__value ${valueClass}` }, value),
    h('button', { class: 'button button--small', type: 'button', onclick: () => copyText(value, `${label}をコピーしました`) }, 'コピー'));
  return h('div', { class: 'copy-rows' },
    row('文字', f.char, 'glyph'),
    row('MJ文字図形名', f.mj),
    row('Unicode', f.unicode),
    row('HTML参照', f.html),
    row('JS/CSS', f.js));
}

function exportBox(glyph) {
  const button = (label, action, primary = false) => h('button', {
    class: `button button--small${primary ? ' button--primary' : ''}`, type: 'button', onclick: () => exportImage(action, glyph),
  }, label);
  return h('div', { class: 'export-box' },
    h('span', { class: 'export-box__label' }, '画像として使う'),
    h('div', { class: 'export-box__buttons' },
      button('画像でコピー', 'copyPng', true),
      button('PNGで保存', 'downloadPng'),
      button('SVGで保存', 'downloadSvg')),
    h('p', { class: 'export-box__note' },
      'Canva など、IVS やフォントの扱いが不確かなアプリには画像で貼り付けると字形が崩れません。PNG は透明背景・1024px、SVG は拡大しても劣化しないアウトラインです。'));
}

function renderSection(sec) {
  const trs = sec.rows.map(([label, value]) => {
    if (label === 'MJ縮退マップ') {
      return h('tr', {},
        h('th', { scope: 'row' }, label),
        h('td', {}, shrinkCells(value)));
    }
    return h('tr', {},
      h('th', { scope: 'row' }, label),
      h('td', {}, value));
  });

  return h('div', { class: 'glyph-detail__section', id: `glyph-sec-${sec.id}` },
    h('h3', { class: 'glyph-detail__section-title' }, sec.title),
    h('table', { class: 'info-table' }, h('tbody', {}, trs)));
}

function shrinkCells(shrink) {
  if (!shrink) return [];
  const items = Object.entries(shrink)
    .filter(([kind]) => kind !== 'info')
    .flatMap(([kind, list]) => list.map((s) => {
      const ch = keyToChar(s.ucs);
      const notes = [s.kind, s.table && `別表第四 表${s.table} ${s.rank}`, s.hops != null && `${s.hops}ホップ`, s.remark].filter(Boolean);
      return h('li', {},
        `${app.db.relationLabel(kind)}: `,
        h('button', { class: 'chip', type: 'button', dataset: { query: ch }, onclick: () => $('#glyph-dialog').close() },
          h('span', { class: 'glyph' }, ch), ` U+${s.ucs}`),
        notes.map((t) => ` ${t}`));
    }));
  return [
    items.length ? h('ul', { class: 'shrink-list' }, items) : null,
    shrink.info ? h('div', { class: 'muted' }, `参考情報: ${shrink.info}`) : null,
  ];
}
