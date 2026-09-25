// 字形カード（字形・MJ文字図形名・符号・バッジ・コピー/画像/比較ボタン）と、その一覧。

import { app } from './context.js';
import { badge, h } from './dom.js';
import { isCompared, toggleCompare } from './compare.js';
import { exportImage } from './export-actions.js';
import { copyText, glyphMessage } from './feedback.js';
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

function glyphCard(g, focused) {
  const selected = isCompared(g);
  const classes = ['glyph-card', focused && 'is-focus', selected && 'is-selected'].filter(Boolean).join(' ');
  return h('article', { class: classes, dataset: { mj: g.mj } },
    h('button', { class: 'glyph-card__face glyph', type: 'button', 'aria-label': `${g.mj} の詳細`, onclick: () => openGlyphDialog(g) },
      g.char ?? '？'),
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
