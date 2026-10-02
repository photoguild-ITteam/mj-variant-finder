// 1文字分のパネル: 概要（読み・画数・部首など）、字形バリエーション、関連する異体字。

import { radicalChar } from '../db.js';
import { getConfusablesForChar } from '../confusables.js';
import { app } from './context.js';
import { COMPARE_MAX, addToCompare } from './compare.js';
import { badge, h, loading, queryButton } from './dom.js';
import { copyText, errorMessage, showToast } from './feedback.js';
import { glyphGrid, glyphTools, gothicLegend } from './glyph-card.js';
import { DIRECTION_HELP, RELATION_SHORT, relationDirection } from './glyph-info.js';
import { isFavorite, toggleFavorite } from './history.js';
import { reportError } from './session.js';

/** @typedef {import('../db.js').Glyph} Glyph */
/** @typedef {import('../db.js').Entry} Entry */
/** @typedef {import('../db.js').RelatedChar} RelatedChar */

/** @param {import('../db.js').SearchItem} item db.search() の chars の要素 */
export async function charPanel(item) {
  const { db } = app;
  // item.key は db.search() が索引から返したものなので、必ず見つかる
  const entry = /** @type {Entry} */ (db.entry(item.key));
  const [detail, related] = await Promise.all([db.detail(item.key), db.related(item.key)]);

  const confSection = confusablesSection(entry, detail.glyphs);
  /** @type {HTMLElement[]} */
  const sections = [hero(entry, detail.glyphs)];
  if (confSection) sections.push(confSection);
  sections.push(glyphSection(detail.glyphs, item.focus));
  if (related.primary.length || related.reference.length) sections.push(relatedSection(related));
  return h('article', { class: 'char-panel' }, sections);
}

/** @param {Entry} entry @param {Glyph[]} glyphs */
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
  const favTarget = entry.char;
  let favActive = isFavorite(favTarget);
  const favBtn = h('button', {
    class: `button button--small button--fav${favActive ? ' button--fav-active' : ''}`,
    type: 'button',
    onclick: () => {
      favActive = toggleFavorite(favTarget);
      favBtn.classList.toggle('button--fav-active', favActive);
      favBtn.textContent = favActive ? '★ お気に入り中' : '☆ お気に入り';
      showToast(favActive ? `「${favTarget}」をお気に入りに追加しました` : `「${favTarget}」をお気に入りから解除しました`);
    },
  }, favActive ? '★ お気に入り中' : '☆ お気に入り');

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
        h('button', { class: 'button button--small', type: 'button', onclick: compareAll }, '比較に追加'),
        favBtn)));
}

/** @param {Glyph[]} glyphs @param {import('../db.js').Focus | null} focus */
function glyphSection(glyphs, focus) {
  const grid = glyphGrid(glyphs, focus);
  const section = h('section', { class: 'panel-section' },
    h('div', { class: 'panel-section__head' },
      h('h3', {}, `字形バリエーション（${glyphs.length}）`),
      h('p', {}, '字形をクリックすると詳細とコピー形式を表示')),
    gothicLegend(),
    grid);
  // 絞り込みは grid の直後に「該当なし」の表示を足すので、grid を置いてから作る
  grid.before(glyphTools(glyphs, grid));
  return section;
}

/** @param {{primary: RelatedChar[], reference: RelatedChar[]}} related db.related() の戻り値 */
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

/** @param {RelatedChar} rel */
function relationBadges(rel) {
  const direction = relationDirection(rel);
  return [
    badge(direction, 'navy', DIRECTION_HELP[direction]),
    ...rel.kinds.map((kind) => badge(RELATION_SHORT[kind] ?? kind, kind.startsWith('unihan') ? null : 'gold', app.db.relationLabel(kind))),
  ];
}

/**
 * 開いたときに初めて字形を読み込む関連字の行.
 * @param {RelatedChar} rel
 * @param {boolean} open 最初から開いておくか
 */
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
      content.replaceChildren(h('p', { class: 'muted' }, `読み込めませんでした: ${errorMessage(err)}`));
    }
  };
  details.addEventListener('toggle', load);
  if (open) {
    details.open = true;
    queueMicrotask(load);
  }
  return details;
}

/** @param {Entry} entry @param {Glyph[]} glyphs */
function confusablesSection(entry, glyphs) {
  const rels = getConfusablesForChar(entry.char);
  if (!rels.length) return null;

  const rows = rels.map(({ group, others }) => {
    const isWarn = group.type === 'confusable';
    const chips = others.map((other) => {
      // other は1文字の文字列なので codePointAt(0) は必ず数
      const otherKey = app.db.resolve(/** @type {number} */ (other.codePointAt(0)));
      const note = group.notes?.[other];
      const shortNote = note ? note.replace(/^【[^】]+】/, '').split('。')[0] : '';
      return queryButton(other, h('span', { class: 'confusable-chip__inner' },
        h('span', { class: 'glyph confusable-chip__glyph' }, other),
        otherKey ? h('span', { class: 'confusable-chip__code' }, `U+${otherKey}`) : null,
        shortNote ? h('span', { class: 'confusable-chip__note' }, shortNote) : null,
      ), `chip chip--confusable${isWarn ? ' chip--warn' : ''}`);
    });

    const compareGroup = async () => {
      const primary = glyphs.find((g) => g.impl === entry.key) ?? glyphs[0];
      const targetGlyphs = [primary];
      for (const other of others) {
        const otherKey = app.db.resolve(/** @type {number} */ (other.codePointAt(0)));
        if (otherKey) {
          try {
            const detail = await app.db.detail(otherKey);
            const target = detail?.glyphs?.find((g) => g.impl === otherKey) ?? detail?.glyphs?.[0];
            if (target) targetGlyphs.push(target);
          } catch {
            // エラー時はスキップ
          }
        }
      }
      targetGlyphs.slice(0, COMPARE_MAX).forEach((g) => addToCompare(g, { silent: true }));
      showToast(`「${[entry.char, ...others].join('」「')}」を比較リストに追加しました`);
    };

    const myNote = group.notes?.[entry.char];

    return h('div', { class: `confusables-bar${isWarn ? ' confusables-bar--warn' : ''}` },
      h('div', { class: 'confusables-bar__header' },
        badge(isWarn ? '⚠️ 似ている別の字（混同注意）' : '💡 異構字・異体字', isWarn ? 'crimson' : 'gold'),
        h('span', { class: 'confusables-bar__desc' }, group.desc),
        h('button', {
          class: 'button button--small button--ghost confusables-bar__compare-btn',
          type: 'button',
          onclick: compareGroup,
          title: `「${entry.char}」と「${others.join('」「')}」を比較リストに追加して並べます`,
        }, '➕ 並べて比較')),
      h('div', { class: 'confusables-bar__body' },
        h('div', { class: 'confusables-bar__chips' }, chips),
        myNote ? h('p', { class: 'confusables-bar__mynote' }, `※ この文字（${entry.char}）: ${myNote}`) : null));
  });

  return h('div', { class: 'confusables-section' }, rows);
}

