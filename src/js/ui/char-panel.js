// 1文字分のパネル: 概要（読み・画数・部首など）、字形バリエーション、関連する異体字。

import { radicalChar } from '../db.js';
import { app } from './context.js';
import { COMPARE_MAX, addToCompare } from './compare.js';
import { badge, h, loading, queryButton } from './dom.js';
import { copyText, showToast } from './feedback.js';
import { glyphGrid, gothicLegend } from './glyph-card.js';
import { DIRECTION_HELP, RELATION_SHORT, relationDirection } from './glyph-info.js';
import { reportError } from './session.js';

/** @param {{key: string, focus?: object | null}} item db.search() の chars の要素 */
export async function charPanel(item) {
  const { db } = app;
  const entry = db.entry(item.key);
  const [detail, related] = await Promise.all([db.detail(item.key), db.related(item.key)]);

  const sections = [hero(entry, detail.glyphs), glyphSection(detail.glyphs, item.focus)];
  if (related.primary.length || related.reference.length) sections.push(relatedSection(related));
  return h('article', { class: 'char-panel' }, sections);
}

function hero(entry, glyphs) {
  const primary = glyphs.find((g) => g.impl === entry.key) ?? glyphs[0];
  const ivsCount = glyphs.filter((g) => g.ivs).length;
  const readings = [...new Set(glyphs.flatMap((g) => g.readings ?? []))];
  const facts = [
    entry.jouyou && badge('常用漢字', 'gold'),
    entry.jinmei && badge('人名用漢字', 'gold'),
    primary.jisLevel && badge(`JIS ${primary.jisLevel}`, 'navy'),
    entry.strokes > 0 && badge(`総画数 ${entry.strokes}`),
    entry.radical > 0 && badge(`部首 ${radicalChar(entry.radical)} (${entry.radical})`),
    badge(`字形 ${glyphs.length}`),
    ivsCount > 0 && badge(`IVS ${ivsCount}`, 'crimson'),
  ];
  const copyAll = () => copyText(glyphs.filter((g) => g.char).map((g) => g.char).join(' '), `${glyphs.length} 字形をコピーしました`);
  const compareAll = () => {
    glyphs.slice(0, COMPARE_MAX).forEach((g) => addToCompare(g, { silent: true }));
    showToast('比較リストに追加しました');
  };

  return h('div', { class: 'char-hero' },
    h('div', { class: 'char-hero__glyph glyph', 'aria-hidden': 'true' }, entry.char),
    h('div', {},
      h('h3', { class: 'char-hero__title' },
        h('span', { class: 'glyph' }, entry.char),
        h('span', { class: 'char-hero__code' }, `U+${entry.key}`)),
      h('div', { class: 'char-hero__facts' }, facts),
      readings.length ? h('p', { class: 'char-hero__readings' }, `読み: ${readings.join('・')}`) : null,
      h('div', { class: 'char-hero__actions' },
        h('button', { class: 'button button--small', type: 'button', onclick: copyAll }, '全バリエーションをコピー'),
        h('button', { class: 'button button--small', type: 'button', onclick: compareAll }, '比較に追加'))));
}

function glyphSection(glyphs, focus) {
  return h('section', { class: 'panel-section' },
    h('div', { class: 'panel-section__head' },
      h('h3', {}, `字形バリエーション（${glyphs.length}）`),
      h('p', {}, '字形をクリックすると詳細とコピー形式を表示')),
    gothicLegend(),
    glyphGrid(glyphs, focus));
}

function relatedSection({ primary, reference }) {
  // 関連字が多いときは上位だけ開いておく（開くと字形を読み込む）
  const openCount = primary.length <= 3 ? 3 : 2;
  return h('section', { class: 'panel-section' },
    h('div', { class: 'panel-section__head' },
      h('h3', {}, `関連する異体字（${primary.length}）`),
      h('p', {}, '縮退先: この字の字形の代用になる文字 / 縮退元: この字で代用される文字')),
    primary.length
      ? h('div', { class: 'related-list' }, primary.map((r, i) => relatedItem(r, i < openCount)))
      : h('p', { class: 'muted' }, 'MJ縮退マップに基づく関連字はありません。'),
    reference.length ? h('details', { class: 'reference-toggle' },
      h('summary', {}, `参考: Unihan のみに基づく関連（${reference.length}）— 中国語圏の簡体字・繁体字の対応を含みます`),
      h('div', { class: 'related-list' }, reference.map((r) => relatedItem(r, false)))) : null);
}

function relationBadges(rel) {
  const direction = relationDirection(rel);
  return [
    badge(direction, 'navy', DIRECTION_HELP[direction]),
    ...rel.kinds.map((kind) => badge(RELATION_SHORT[kind] ?? kind, kind.startsWith('unihan') ? null : 'gold', app.db.relationLabel(kind))),
  ];
}

/** 開いたときに初めて字形を読み込む関連字の行 */
function relatedItem(rel, open) {
  const content = h('div', { class: 'related__content' });
  const details = h('details', { class: 'related' },
    h('summary', {},
      h('span', { class: 'related__glyph glyph' }, rel.char),
      h('span', { class: 'related__info' },
        h('span', { class: 'related__code' }, `U+${rel.key} · ${rel.entry?.glyphCount ?? 0}字形`),
        h('span', { class: 'related__kinds' }, relationBadges(rel))),
      h('span', { class: 'related__toggle' }, '字形 ')),
    content);

  let loaded = false;
  const load = async () => {
    if (loaded || !details.open) return;
    loaded = true;
    content.replaceChildren(loading());
    try {
      const detail = await app.db.detail(rel.key);
      content.replaceChildren(
        glyphGrid(detail.glyphs),
        h('p', { class: 'related__more' }, queryButton(rel.char, `「${rel.char}」を中心に表示`, 'button button--small')));
    } catch (err) {
      loaded = false; // 次に開いたときに再試行する
      reportError(err);
      content.replaceChildren(h('p', { class: 'muted' }, `読み込めませんでした: ${err.message}`));
    }
  };
  details.addEventListener('toggle', load);
  if (open) {
    details.open = true;
    queueMicrotask(load);
  }
  return details;
}
