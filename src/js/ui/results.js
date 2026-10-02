// 検索結果の描画。db.search() の結果の type ごとに描き分ける。

import { formatMJ, isFilterActive } from '../db.js';
import { getWordVariantSuggestions } from '../confusables.js';
import { charPanel } from './char-panel.js';
import { COMPARE_MAX, openCompareWithGlyphs } from './compare.js';
import { app } from './context.js';
import { $, h, loading, queryButton, scrollBehavior } from './dom.js';
import { errorMessage, showToast } from './feedback.js';
import { focusedGlyph } from './glyph-info.js';
import { reportError } from './session.js';

const PAGE_SIZE = 300;

/** @typedef {import('../db.js').SearchResult} SearchResult */
/** @typedef {import('../db.js').SearchItem} SearchItem */
/** @typedef {import('../db.js').Entry} Entry */
// search() の type は string と推論され、type では絞り込めない。描き分ける関数には、持っている項目で取り出した型を付ける
/** @typedef {Extract<SearchResult, {chars: unknown[]}> & {unknown?: string[]}} CharsResult 文字・コード検索（unknown は文字検索だけ） */
/** @typedef {Extract<SearchResult, {reading: string}>} ReadingResult 読み検索 */
/** @typedef {Extract<SearchResult, {candidates: string[]}>} FilterResult 絞り込みだけ（total と candidates を使う） */
/** @typedef {Extract<SearchResult, {mj: number}>} NoCharResult UCS を持たない MJ文字図形名 */
/** @typedef {Extract<SearchResult, {reason: string}>} NotFoundResult */

/**
 * 結果欄を差し替える。h() と同じく配列は平坦化し、null・false は無視する
 * @param {...any} nodes h() の子と同じ（要素・文字列・配列・null・false）
 */
const show = (...nodes) => $('#results').replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));

/**
 * 絞り込み条件を変えたときに描き直すべき結果か（文字・コード検索は絞り込みの影響を受けない）
 * @param {SearchResult | null} result
 */
export const isFilterable = (result) => !result || ['empty', 'reading', 'filter', 'notfound'].includes(result.type);

/** @param {SearchResult} result */
export async function renderResult(result) {
  try {
    await renderBody(result);
  } catch (err) {
    renderLoadError(err);
  }
  if (app.result === result) announce(result);
}

/** @param {SearchResult} result */
async function renderBody(result) {
  // type で絞り込めないので、type ごとの型にして渡す（CharsResult などの説明）
  switch (result.type) {
    case 'empty': return renderWelcome();
    case 'text':
    case 'code': return await renderChars(/** @type {CharsResult} */ (result));
    case 'reading': return renderReading(/** @type {ReadingResult} */ (result));
    case 'filter': return renderFilterList(/** @type {FilterResult} */ (result));
    case 'nochar': return await renderNoChar(/** @type {NoCharResult} */ (result));
    default: return renderNotFound(/** @type {NotFoundResult} */ (result));
  }
}

/**
 * 結果の見出しだけを読み上げる（#search-status は role="status"）.
 * #results 全体を aria-live にすると、検索のたびに結果の一覧がまるごと読み上げられるため。
 * @param {SearchResult} result
 */
function announce(result) {
  const results = $('#results');
  const heading = results.querySelector('h2')?.textContent.trim();
  const notice = results.querySelector('.notice strong')?.textContent.trim();
  $('#search-status').textContent = result.type === 'empty' ? '' : heading ? `${heading}を表示しました` : notice ?? '';
}

/** @param {any} err catch で受けた値（Error とは限らない。message があればそれを出す） */
export function renderLoadError(err) {
  const expired = reportError(err);
  show(h('div', { class: 'notice notice--error' },
    h('strong', {}, expired ? 'ログインが必要です' : '読み込みに失敗しました'),
    h('p', {}, expired
      ? 'ログインが切れています。上のバナーからログインし、「ログインしたので再読み込み」を押してください。'
      : String(err.message ?? err))));
}

function renderWelcome() {
  const { counts } = app.db.meta;
  /** @param {string} query */
  const example = (query) => queryButton(query, query, 'chip chip--ghost');
  show(h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state__glyph glyph', 'aria-hidden': 'true' }, '邊'),
    h('h2', {}, '異体字を探す'),
    h('p', {}, `MJ文字情報一覧表の ${counts.mjGlyphs.toLocaleString()} 字形（うち IVS ${counts.glyphsWithIVS.toLocaleString()} 字形）から検索します。`),
    h('ul', {},
      h('li', {}, '文字・単語: ', example('渡辺'), ' — 1文字ずつ異体字を表示'),
      h('li', {}, '読み: ', example('さいとう'), ' — 人名・地名と音訓から'),
      h('li', {}, '呼び名: ', example('はしごだか'), ' ', example('やまへんのさき'), ' — 字の呼び名や「部首名＋読み」でも'),
      h('li', {}, 'MJ文字図形名: ', example('MJ026190')),
      h('li', {}, 'Unicode / IVS: ', example('9089_E010F')),
      h('li', {}, '部首・画数: 左の「絞り込み」だけでも一覧できます'))));
}

/** @param {NotFoundResult} result */
function renderNotFound(result) {
  /** @param {string} query */
  const example = (query) => queryButton(query, query, 'chip chip--ghost');
  // 次にできることを示す（手書き・画像のボタンは検索欄の下にあるものを押す）
  /** @param {string} id ボタンのセレクタ @param {string} label */
  const openTool = (id, label) => h('button', { class: 'button button--small', type: 'button', onclick: () => $(id).click() }, label);
  show(h('div', { class: 'notice notice--warn' },
    h('strong', {}, '見つかりませんでした'),
    h('p', {}, result.reason ?? ''),
    isFilterActive(app.filters) ? h('p', { class: 'muted' }, '絞り込み条件が有効です。条件を外すと見つかる場合があります。') : null),
  h('div', { class: 'not-found-help' },
    h('h3', { class: 'section-label' }, 'ほかの探し方'),
    h('div', { class: 'not-found-help__tools' },
      openTool('#handwriting-open', '✍ 手書きで探す'),
      openTool('#image-open', '🖼 画像から探す')),
    h('ul', {},
      h('li', {}, '漢字（1文字でも単語でも）: ', example('渡辺')),
      h('li', {}, '読み（ひらがな）: ', example('さいとう'), ' — 人名・地名の読みにも対応'),
      h('li', {}, 'MJ文字図形名・コードポイント: ', example('MJ026190'), ' ', example('U+8FBB')))));
}

/** @param {NoCharResult} result */
async function renderNoChar(result) {
  let glyph;
  try {
    glyph = await app.db.noCharGlyph(result.mj);
  } catch (err) {
    if (app.result === result) throw err;
    return;
  }
  if (app.result !== result) return; // 読み込み中に別の検索をした
  show(h('div', { class: 'notice notice--warn' },
    h('strong', {}, `${formatMJ(result.mj)} には UCS 符号位置がありません`),
    h('p', {}, 'MJ文字情報一覧表で重複や図形誤りと判明した字形で、IPAmj明朝には実装されていません。'),
    glyph?.note ? h('p', {}, `備考: ${glyph.note}`) : null));
}

// ---------------------------------------------------------------------------- 文字・コード検索

/** @param {CharsResult} result */
async function renderChars(result) {
  const items = result.chars;
  const panelHost = h('div', { id: 'char-panel-host', role: items.length > 1 ? 'tabpanel' : null });
  const tabs = items.length > 1 ? charTabs(items, (i, focusTab) => selectTab(i, focusTab).catch(renderLoadError)) : null;

  let tabToken = 0; // 最後に選んだタブの番号。読み込み中に切り替えたら、前のタブの結果は捨てる

  /** @param {number} i @param {boolean} [focusTab] */
  async function selectTab(i, focusTab = false) {
    if (tabs) {
      [.../** @type {HTMLCollectionOf<HTMLElement>} */ (tabs.children)].forEach((tab, j) => {
        tab.setAttribute('aria-selected', String(i === j));
        tab.tabIndex = i === j ? 0 : -1;
      });
      if (focusTab) /** @type {HTMLElement} */ (tabs.children[i]).focus();
      panelHost.setAttribute('aria-labelledby', tabs.children[i].id);
    }
    panelHost.replaceChildren(loading());
    const token = ++tabToken;
    const isCurrent = () => app.result === result && token === tabToken; // 読み込み中に別の検索・別のタブにしていない
    let panel;
    try {
      panel = await charPanel(items[i]);
    } catch (err) {
      if (isCurrent()) throw err;
      return;
    }
    if (!isCurrent()) return;
    panelHost.replaceChildren(panel);
    panel.querySelector('.glyph-card.is-focus')?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  }

  const exportMultiBtn = items.length > 1 && items.length <= COMPARE_MAX ? h('button', {
    class: 'button button--small button--ghost',
    type: 'button',
    title: `「${result.query}」の各文字を比較リストに追加して連結画像を書き出します`,
    onclick: async () => {
      const targetGlyphs = [];
      try {
        for (const item of items) {
          const detail = await app.db.detail(item.key);
          const target = focusedGlyph(detail.glyphs, item.focus);
          if (target) targetGlyphs.push(target);
        }
      } catch (err) {
        showToast(reportError(err)
          ? 'ログインが切れています。ログインしてから再読み込みしてください'
          : `字形を読み込めませんでした: ${errorMessage(err)}`);
        return;
      }
      if (app.result !== result) return; // 読み込み中に別の検索をした
      openCompareWithGlyphs(targetGlyphs);
    },
  }, '📷 連結書き出し・比較') : null;

  const suggestions = result.type === 'text' ? getWordVariantSuggestions(result.query) : [];
  const suggestionRow = suggestions.length ? h('div', { class: 'variant-suggestions' },
    h('span', { class: 'variant-suggestions__label' }, '💡 他の表記候補:'),
    h('div', { class: 'variant-suggestions__chips' }, suggestions.map((s) => {
      const isWarn = s.type === 'confusable';
      return queryButton(s.word, h('span', { class: 'variant-suggestion-chip' },
        h('span', { class: 'variant-suggestion-chip__word' }, s.word),
        h('span', { class: 'variant-suggestion-chip__diff' }, `(${s.from}→${s.to})`),
      ), `chip chip--ghost${isWarn ? ' chip--warn' : ''}`);
    })),
  ) : null;

  const unknown = [...new Set(result.unknown ?? [])];
  show(
    h('div', { class: 'result-header' },
      h('div', { class: 'result-header__title-row' },
        h('h2', {}, result.type === 'code' ? `「${result.query}」` : `「${result.query}」の異体字`),
        exportMultiBtn),
      h('p', {}, items.length > 1 ? `${items.length} 文字。タブで切り替えられます。` : ''),
      suggestionRow),
    unknown.length ? h('div', { class: 'notice notice--spaced' }, `「${unknown.join('')}」は MJ文字情報一覧表に収録されていないため表示していません。`) : null,
    tabs,
    panelHost,
  );
  await selectTab(0);
}

/**
 * 矢印キーでも移動できるタブ（WAI-ARIA tabs）
 * @param {SearchItem[]} items
 * @param {(i: number, focusTab: boolean) => void} onSelect
 */
function charTabs(items, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': '文字' },
    items.map((item, i) => {
      // item.key は db.search() が索引から返したものなので、必ず見つかる
      const entry = /** @type {NonNullable<ReturnType<typeof app.db.entry>>} */ (app.db.entry(item.key));
      return h('button', {
        class: 'tab', role: 'tab', type: 'button', id: `tab-${i}`,
        'aria-selected': String(i === 0), 'aria-controls': 'char-panel-host', tabindex: i === 0 ? '0' : '-1',
        onclick: () => onSelect(i, false),
        onkeydown: (/** @type {KeyboardEvent} */ e) => {
          // 左右で隣のタブ、Home・End で最初・最後のタブ（WAI-ARIA のタブの操作）
          const next = /** @type {Record<string, number | undefined>} */ ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 })[e.key];
          if (next === undefined) return;
          e.preventDefault();
          onSelect((next + items.length) % items.length, true);
        },
      },
      h('span', { class: 'glyph' }, entry.char),
      h('span', { class: 'tab__meta' }, `${entry.glyphCount}字形`));
    }));
}

// ---------------------------------------------------------------------------- 読み・絞り込み

/** @param {ReadingResult} result */
function renderReading(result) {
  const { nicknames = [], byRadical = null } = result;
  show(
    h('div', { class: 'result-header' },
      h('h2', {}, `読み「${result.reading}」`),
      h('p', {}, result.total
        ? `音訓が一致する文字 ${result.total.toLocaleString()} 字${isFilterActive(app.filters) ? '（絞り込み中）' : ''}。● は IVS 異体字あり、数字は字形数`
        : (nicknames.length || byRadical || result.names.length ? '候補から選んでください。' : '一致する文字がありません。'))),
    nicknames.length ? nicknameSection(nicknames) : null,
    byRadical ? [
      h('h3', { class: 'section-label' }, `部首と読み: 「${byRadical.radicalName}」で読みが「${byRadical.reading}」の字`),
      candidateGrid(byRadical.keys),
    ] : null,
    result.names.length ? nameSections(result.names) : null,
    result.candidates.length ? [
      h('h3', { class: 'section-label' }, '音訓が一致する文字'),
      candidateGrid(result.candidates, result.exactCount),
    ] : null,
  );
}

/**
 * 呼び名（はしごだか など）に一致する字。IVS 付きの字形を指すものは、その字形を開く
 * @param {ReadingResult['nicknames']} nicknames
 */
function nicknameSection(nicknames) {
  return [
    h('h3', { class: 'section-label' }, '呼び名'),
    h('div', { class: 'nickname-list' }, nicknames.map((n) => h('div', { class: 'nickname-row' },
      h('span', { class: 'nickname-row__name' }, n.name),
      h('span', { class: 'nickname-row__targets' }, n.targets.map((t) => h('button', {
        class: 'chip nickname-target', type: 'button', dataset: { query: t.query }, title: t.mj ?? t.query,
      }, h('span', { class: 'glyph' }, t.char), t.mj ? h('span', { class: 'nickname-target__mj' }, t.mj) : null))),
      h('span', { class: 'nickname-row__note' }, n.note)))),
  ];
}

/**
 * 人名・地名の候補を種別（姓・名・地名・異体字での表記）ごとにまとめる
 * @param {ReadingResult['names']} names
 */
function nameSections(names) {
  /** @type {Map<string, ReadingResult['names']>} 種別 → 読みごとの表記 */
  const byKind = new Map();
  for (const group of names) {
    if (!byKind.has(group.kind)) byKind.set(group.kind, []);
    byKind.get(group.kind)?.push(group); // 直前で set しているので必ずある
  }
  return [...byKind].map(([kind, groups]) => [
    h('h3', { class: 'section-label' }, kind === '異体字での表記'
      ? '異体字に置き換えた表記（実在の確認はしていません）' : kind),
    h('div', { class: 'name-suggestions' }, groups.map((group) => h('div', { class: 'name-row' },
      h('span', { class: 'name-row__reading' }, group.reading),
      group.words.map((word) => queryButton(word))))),
  ]);
}

/** @param {FilterResult} result */
function renderFilterList(result) {
  show(
    h('div', { class: 'result-header' },
      h('h2', {}, '絞り込み結果'),
      h('p', {}, `${result.total.toLocaleString()} 字。● は IVS 異体字あり、数字は字形数`)),
    result.candidates.length ? candidateGrid(result.candidates) : h('div', { class: 'notice' }, '条件に一致する文字がありません。'),
  );
}

/**
 * 候補の文字の一覧（PAGE_SIZE 件ずつ「さらに表示」）.
 * @param {string[]} keys
 * @param {number} [exactCount] 先頭から何件が完全一致か（以降に「前方一致」の区切りを入れる）
 */
function candidateGrid(keys, exactCount = keys.length) {
  const grid = h('div', { class: 'candidate-grid' });
  const more = h('button', { class: 'button more-button', type: 'button' });
  let shown = 0;

  const renderPage = () => {
    const end = Math.min(shown + PAGE_SIZE, keys.length);
    for (let i = shown; i < end; i++) {
      if (i === exactCount && exactCount > 0) grid.append(h('p', { class: 'candidate-divider' }, '前方一致'));
      // keys は db.search() が索引から返したものなので、必ず見つかる
      grid.append(candidate(/** @type {Entry} */ (app.db.entry(keys[i]))));
    }
    shown = end;
    more.hidden = shown >= keys.length;
    more.textContent = `さらに表示（残り ${(keys.length - shown).toLocaleString()} 字）`;
  };
  more.addEventListener('click', renderPage);
  renderPage();
  return h('div', {}, grid, more);
}

/** @param {Entry} entry */
function candidate(entry) {
  const policy = entry.jouyou ? ' / 常用' : entry.jinmei ? ' / 人名用' : '';
  return h('button', { class: 'candidate', type: 'button', dataset: { query: entry.char }, title: `U+${entry.key} / ${entry.strokes}画${policy}` },
    h('span', { class: 'glyph' }, entry.char),
    h('span', { class: 'candidate__meta' },
      entry.hasIVS ? h('span', { class: 'candidate__dot', title: 'IVS異体字あり' }) : null,
      String(entry.glyphCount)));
}
