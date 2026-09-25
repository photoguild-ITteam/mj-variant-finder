// 字形の詳細ダイアログ: コピー形式、画像の書き出し、MJ文字情報一覧表・縮退マップの全項目。

import { copyFormats, keyToChar, radicalChar } from '../db.js';
import { app } from './context.js';
import { $, h } from './dom.js';
import { toggleCompare } from './compare.js';
import { exportImage } from './export-actions.js';
import { copyText } from './feedback.js';
import { DICT_LABELS, gothicStatus, ivsListLabel } from './glyph-info.js';

export function openGlyphDialog(glyph) {
  $('#glyph-dialog-title').textContent = `${glyph.mj} の詳細`;
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
      h('table', { class: 'info-table' }, h('tbody', {}, infoRows(glyph)))),
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

function infoRows(g) {
  const gothic = gothicStatus(g, app.db.meta.gothic);
  /** @type {[string, ...any][]} 値が空の行は出さない */
  const rows = [
    ['MJ文字図形名', g.mj],
    ['対応するUCS', g.ucs && `U+${g.ucs}`],
    ['実装したUCS', g.impl && `U+${g.impl}`],
    ['IVS (Moji_Joho)', ivsListLabel(g)],
    ['SVS', g.svs?.replace('_', ' ')],
    ['対応する互換漢字', g.compat && `U+${g.compat}`],
    ['JIS X 0213', g.x0213 && `${g.x0213}（${g.jisLevel ?? ''}${g.x0213Class != null ? `・包摂区分 ${g.x0213Class}` : ''}）`],
    ['JIS X 0212', g.x0212],
    ['ゴシック体', gothic && `${gothic.mark} ${gothic.label}。${gothic.detail}`],
    ['漢字施策', g.policy],
    ['戸籍統一文字番号', g.koseki],
    ['住基ネット統一文字コード', g.juki],
    ['入管正字コード', g.nyukanSei],
    ['入管外字コード', g.nyukanGai],
    ['登記統一文字番号', g.touki],
    ['部首・内画数', g.radicals?.map(([r, s]) => `${radicalChar(r)}（${r}）+${s ?? '?'}`).join(' / ')],
    ['総画数', g.strokes],
    ['読み', g.readings?.join('・')],
    ['辞書', g.dict && Object.entries(g.dict).map(([k, v]) => `${DICT_LABELS[k] ?? k} ${v}`).join(' / ')],
    ['MJ文字図形バージョン', g.version],
    ['備考', g.note],
    ['MJ縮退マップ', ...shrinkCells(g.shrink)],
  ];
  return rows
    .filter(([, ...values]) => values.some((v) => v != null && v !== ''))
    .map(([label, ...values]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, values)));
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
