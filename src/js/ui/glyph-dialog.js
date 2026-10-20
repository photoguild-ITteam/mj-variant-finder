// 字形の詳細ダイアログ: コピー形式、画像の書き出し、ゴシック体で使う方法、MJ文字情報一覧表・縮退マップの全項目。

import { copyFormats, keyToChar } from '../db.js';
import { app } from './context.js';
import { $, h, infoTip, scrollBehavior } from './dom.js';
import { toggleCompare } from './compare.js';
import { exportImage } from './export-actions.js';
import { copyText } from './feedback.js';
import { glyphDetailSections, gothicPrint } from './glyph-info.js';
import { loadGothicSample } from './gothic-fonts.js';

/** @typedef {import('../db.js').Glyph} Glyph */
/**
 * MJ縮退マップの縮退先（Glyph の shrink の、info 以外の種別の要素。scripts/build_variant_db.py の build_shrink）.
 * @typedef {{ucs: string, x0213?: string, table?: string, rank?: string, kind?: string, hops?: number, remark?: string}} ShrinkItem
 */

/**
 * @param {Glyph} glyph
 * @param {'gothic'} [section] 開いたときに見せる欄（字形カードのゴシック体の印から開いたとき）
 */
export function openGlyphDialog(glyph, section) {
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
          glyph.char ? exportBox(glyph) : null,
          gothicBox(glyph))),
      h('div', { class: 'glyph-detail__sections' },
        sections.map((sec) => renderSection(sec)))),
  );
  $('#glyph-dialog').showModal();
  if (section === 'gothic') $('#glyph-gothic')?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
}

/** @param {Glyph} glyph */
function copyRows(glyph) {
  const f = copyFormats(glyph);
  /** @param {string} label @param {string} value @param {string} [valueClass] */
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

/** @param {Glyph} glyph */
function exportBox(glyph) {
  /** @param {string} label @param {'copyPng'|'downloadPng'|'downloadSvg'} action @param {boolean} [primary] */
  const button = (label, action, primary = false) => h('button', {
    class: `button button--small${primary ? ' button--primary' : ''}`, type: 'button', onclick: () => exportImage(action, glyph),
  }, label);
  return h('div', { class: 'export-box' },
    boxHead('画像として使う', 'export-box__label',
      'Canva など、IVS やフォントの扱いが不確かなアプリには画像で貼り付けると字形が崩れません。PNG は透明背景・1024px、SVG は拡大しても劣化しないアウトラインです。'),
    h('div', { class: 'export-box__buttons' },
      button('画像でコピー', 'copyPng', true),
      button('PNGで保存', 'downloadPng'),
      button('SVGで保存', 'downloadSvg')));
}

/**
 * 箱の見出しと、その説明の注記（説明は常には出さない）
 * @param {string} text
 * @param {string} className 見出しのクラス
 * @param {any} [note] 説明（無ければ注記を出さない）
 */
function boxHead(text, className, note) {
  const notes = [note].flat().filter(Boolean);
  return h('div', { class: 'box-head' },
    h('span', { class: className }, text),
    notes.length ? infoTip(`${text}の説明`, notes) : null);
}

/**
 * ゴシック体で使う方法: 使えるフォント・見本・ゴシック体用の文字（IVS なし）. 使えない（×）ときはその理由と代わりの方法
 * @param {Glyph} glyph
 */
function gothicBox(glyph) {
  const info = gothicPrint(glyph, app.db.meta.gothic);
  if (!info) return null;
  if (!info.usable) {
    return h('div', { class: 'gothic-box', id: 'glyph-gothic' }, boxHead('ゴシック体で使う', 'gothic-box__label'),
      h('p', { class: 'gothic-box__text' },
        `この字形を指す Moji_Joho の IVS に対応したゴシック体は無いため、ゴシック体では通常の字形（${info.base}）で表示されます。`,
        info.checked ? 'Adobe-Japan1 の IVS で出せる形とも見比べましたが、同じ形はありませんでした。' : null),
      h('p', { class: 'gothic-box__note' }, '文書や印刷でこの字形を使うときは、この字だけ IPAmj明朝 で組むか、外字を作ってください。'));
  }
  // ゴシックIVS: MJ の IVS とは番号が違う、Adobe-Japan1 の IVS を付けた字を使う
  const seq = info.aj1 ?? `U+${info.ucs}、IVS なし`;
  const text = !info.fonts.length
    ? `文字コード U+${info.ucs} の字（IVS なし）がある、ゴシック体のフォントが見つかっていません。`
    : info.withIvs
      ? `文書・印刷では、Adobe-Japan1 の IVS（${info.aj1}）を付けた字が、次のゴシック体でこの字形と同じ形になります。MJ の IVS（${glyph.ivs?.[0].replace('_', ' ')}）とは番号が違うので、下のボタンでコピーしてください。`
      : info.aj1
        ? `文書・印刷では、文字コード U+${info.ucs} の字（IVS なし）が、次のゴシック体でこの字形と同じ形になります。`
        : `文書・印刷では、文字コード U+${info.ucs} の字（IVS なし）を、次のゴシック体で使えます。`;
  const notes = [
    info.withIvs && h('p', {}, 'IVS を付けた字は、IVS に対応したアプリで使えます。同じ形かは、IPAmj明朝 と Noto Serif JP・Noto Sans JP の字形を見比べて確かめました。'),
    info.preview?.key === 'plangothic' && h('p', {}, '遍黒体は中国大陸の字形を基準にしたフォントで、細部が IPAmj明朝 と違うことがあります。'),
    info.preview && h('p', {}, `見本は、${info.preview.name} から字を抜き出して同梱したもので表示しています。`,
      info.fonts.some((f) => !f.installed) ? '文書で使うには、フォントを入手して端末にインストールしてください。' : null),
  ];
  return h('div', { class: 'gothic-box', id: 'glyph-gothic' }, boxHead('ゴシック体で使う', 'gothic-box__label', notes),
    info.preview ? gothicPreview(glyph, info.char, info.preview) : null,
    h('p', { class: 'gothic-box__text' }, text),
    info.fonts.length ? h('ul', { class: 'gothic-box__fonts' }, info.fonts.map((f) => h('li', {},
      h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.name), f.note ? `（${f.note}）` : null))) : null,
    h('div', { class: 'gothic-box__buttons' },
      h('button', {
        class: 'button button--small', type: 'button',
        onclick: () => copyText(info.char, `ゴシック体用の文字（${seq}）をコピーしました`),
      }, 'ゴシック体用の文字をコピー')),
    // 間違いを防ぐための注意は、注記に畳まず常に出す
    info.kusa ? h('p', { class: 'notice notice--warn notice--compact' },
      'この字形は、艹（くさかんむり）が「十 十」に分かれた4画のことがあります。ゴシック体では、つながった3画の艹で表示されることがあるので、見本で形を確かめてください。') : null);
}

/**
 * 明朝体とゴシック体の見本を並べる
 * @param {Glyph} glyph
 * @param {string} char ゴシック体用の文字（IVS なし）
 * @param {import('./glyph-info.js').GothicPreview} preview
 */
function gothicPreview(glyph, char, preview) {
  // フォント名は CSS の .gothic-box__glyph--<key>（gothic.css のフォント名と同じ）
  const figure = h('figure', { class: 'gothic-box__figure' },
    h('div', { class: `gothic-box__glyph gothic-box__glyph--${preview.key}` }, char), h('figcaption', {}, preview.name));
  // 読み込めなかったら、別のフォントで描いた字を見本と取り違えないよう、見本を消す
  // （待つ間に別の字形の詳細に替わっていたら、その画面には触らない）
  loadGothicSample(preview.family, char)
    .catch(() => {
      if (figure.isConnected) figure.replaceWith(h('p', { class: 'gothic-box__note' }, 'ゴシック体の見本を読み込めませんでした。'));
    });
  return h('div', { class: 'gothic-box__pair' },
    h('figure', { class: 'gothic-box__figure' },
      h('div', { class: 'gothic-box__glyph glyph' }, glyph.char), h('figcaption', {}, 'IPAmj明朝')),
    figure);
}

/** @param {ReturnType<typeof glyphDetailSections>[number]} sec */
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

/** @param {Glyph['shrink']} shrink */
function shrinkCells(shrink) {
  if (!shrink) return [];
  const items = Object.entries(shrink)
    .filter(([kind]) => kind !== 'info')
    .flatMap(([kind, list]) => /** @type {ShrinkItem[]} */ (list).map((s) => {
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
