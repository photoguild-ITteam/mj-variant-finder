// 字形カード（字形・MJ文字図形名・符号・バッジ・コピー/画像/比較ボタン）と、その一覧。

import { app } from './context.js';
import { badge, h } from './dom.js';
import { isCompared, toggleCompare } from './compare.js';
import { exportImage } from './export-actions.js';
import { copyText, glyphMessage } from './feedback.js';
import { isDiffEnabled, renderFace, setDiffEnabled } from './glyph-diff.js';
import { openGlyphDialog } from './glyph-dialog.js';
import { GOTHIC_VARIANT, gothicStatus, sequenceLabel } from './glyph-info.js';

/**
 * @param {object[]} glyphs
 * @param {{mj?: string, ivs?: string, impl?: string} | null} [focus] 検索語が指した字形（強調表示する）
 */
export function glyphGrid(glyphs, focus = null) {
  return h('div', { class: 'glyph-grid' }, glyphs.map((g) => glyphCard(g, matchesFocus(g, focus))));
}

function matchesFocus(glyph, focus) {
  if (!focus) return false;
  if (focus.mj) return glyph.mj === focus.mj;
  if (focus.ivs) return Boolean(glyph.ivs?.includes(focus.ivs));
  if (focus.impl) return glyph.impl === focus.impl;
  return false;
}

/** 字形の一覧で絞り込める項目（一部の字形だけに当てはまるものを表示する） */
const GLYPH_FILTERS = [
  { label: '戸籍', title: '戸籍統一文字番号がある', test: (g) => g.koseki },
  { label: '住基', title: '住基ネット統一文字コードがある', test: (g) => g.juki },
  { label: '入管', title: '入管正字/外字コードがある', test: (g) => g.nyukanSei || g.nyukanGai },
  { label: 'JIS', title: 'JIS X 0213 の字形', test: (g) => g.jisLevel },
  { label: 'ゴシック○', title: 'ゴシック体でも使える', test: (g) => gothicStatus(g, app.db.meta.gothic)?.mark === '○' },
  { label: 'IVSあり', title: 'IVS（異体字セレクタ）で指定できる', test: (g) => g.ivs?.length },
];

/**
 * 字形の一覧の上に置く道具: 絞り込みと「違いを色で表示」.
 * @param {object[]} glyphs
 * @param {HTMLElement} grid glyphGrid() の戻り値（カードの並びは glyphs と同じ）
 */
export function glyphTools(glyphs, grid) {
  const cards = [...grid.children];
  const active = new Set();
  const status = h('span', { class: 'glyph-tools__status', 'aria-live': 'polite' });
  const empty = h('p', { class: 'muted glyph-tools__empty', hidden: true }, '条件に合う字形はありません。');
  grid.after(empty);

  const apply = () => {
    let shown = 0;
    cards.forEach((card, i) => {
      const visible = [...active].every((f) => f.test(glyphs[i]));
      card.classList.toggle('is-filtered-out', !visible);
      if (visible) shown++;
    });
    status.textContent = active.size ? `${glyphs.length} 字形中 ${shown} 字形` : '';
    empty.hidden = shown > 0;
  };

  const filters = GLYPH_FILTERS
    .map((f) => ({ ...f, count: glyphs.filter((g) => f.test(g)).length }))
    .filter((f) => f.count > 0 && f.count < glyphs.length)
    .map((f) => h('button', {
      class: 'chip chip--toggle', type: 'button', 'aria-pressed': 'false', title: f.title,
      onclick: (e) => {
        const on = !active.has(f);
        if (on) active.add(f); else active.delete(f);
        e.currentTarget.setAttribute('aria-pressed', String(on));
        apply();
      },
    }, f.label, h('span', { class: 'chip__count' }, String(f.count))));

  return h('div', { class: 'glyph-tools' },
    filters.length ? h('div', { class: 'glyph-tools__filters', role: 'group', 'aria-label': '字形の絞り込み' },
      h('span', { class: 'glyph-tools__label' }, '絞り込み'), filters, status) : null,
    diffToggle());
}

function diffToggle() {
  return h('div', { class: 'glyph-tools__diff' },
    h('button', {
      class: 'button button--small diff-toggle', type: 'button', 'aria-pressed': String(isDiffEnabled()),
      onclick: () => setDiffEnabled(!isDiffEnabled()),
    }, '違いを色で表示'),
    h('span', { class: 'diff-legend' },
      h('span', { class: 'diff-legend__this' }, 'この字形だけ'),
      h('span', { class: 'diff-legend__base' }, '通常の字形（IVSなし）だけ')));
}

/** 凡例（ゴシック体の判定データがあるときだけ） */
export function gothicLegend() {
  if (!app.db.meta.gothic) return null;
  return h('p', { class: 'gothic-legend' },
    badge('ゴシック○', 'ok'), ' ゴシック体でも使える　',
    badge('ゴシック△', 'warn'), ' ゴシック体に字が無いことがある　',
    badge('ゴシック×', 'muted'), ' IVSでのみ区別でき、ゴシック体では通常の字形になる');
}

function glyphBadges(g) {
  const gothic = gothicStatus(g, app.db.meta.gothic);
  return [
    gothic && badge(`ゴシック${gothic.mark}`, GOTHIC_VARIANT[gothic.mark], `${gothic.label}: ${gothic.detail}`),
    g.policy && badge(g.policy.replace('漢字', ''), 'gold'),
    g.jisLevel && badge(g.jisLevel.replace('水準', ''), 'navy'),
    g.koseki && badge('戸籍', null, `戸籍統一文字番号 ${g.koseki}`),
    g.juki && badge('住基', null, `住基ネット統一文字コード ${g.juki}`),
    (g.nyukanSei || g.nyukanGai) && badge('入管', null, '入管正字/外字コードあり'),
    g.svs && badge('SVS', null, `SVS ${g.svs}`),
    g.ivdOnly && badge('IVD新規', 'crimson', 'IVD 2026 追加。IPAmj明朝に字形がない場合があります'),
  ];
}

function face(g) {
  const button = h('button', {
    class: 'glyph-card__face glyph', type: 'button', 'aria-label': `${g.mj} の詳細`,
    dataset: g.char ? { char: g.char } : {}, onclick: () => openGlyphDialog(g),
  }, h('span', { class: 'glyph-card__char' }, g.char ?? '？'));
  if (isDiffEnabled()) renderFace(button);
  return button;
}

function glyphCard(g, focused) {
  const selected = isCompared(g);
  const classes = ['glyph-card', focused && 'is-focus', selected && 'is-selected'].filter(Boolean).join(' ');
  return h('article', { class: classes, dataset: { mj: g.mj } },
    face(g),
    h('div', { class: 'glyph-card__body' },
      h('span', { class: 'glyph-card__mj' }, g.mj),
      h('span', { class: 'glyph-card__seq' }, sequenceLabel(g)),
      h('div', { class: 'glyph-card__badges' }, glyphBadges(g))),
    h('div', { class: 'glyph-card__actions' },
      h('button', {
        class: 'button', type: 'button', disabled: !g.char,
        onclick: () => copyText(g.char, glyphMessage(g.char, ` をコピーしました（${sequenceLabel(g)}）`)),
      }, 'コピー'),
      h('button', {
        class: 'button', type: 'button', disabled: !g.char, title: '透明PNG画像としてコピー（Canva などに貼り付け）',
        onclick: () => exportImage('copyPng', g),
      }, '画像'),
      h('button', {
        class: 'button glyph-card__compare', type: 'button', 'aria-pressed': String(selected),
        onclick: () => toggleCompare(g),
      }, '比較')));
}
