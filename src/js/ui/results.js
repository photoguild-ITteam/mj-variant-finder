// 検索結果の描画。db.search() の結果の type ごとに描き分ける。

import { formatMJ, isFilterActive } from '../db.js';
import { charPanel } from './char-panel.js';
import { app } from './context.js';
import { $, h, loading, queryButton } from './dom.js';
import { reportError } from './session.js';

const PAGE_SIZE = 300;

/** 結果欄を差し替える。h() と同じく配列は平坦化し、null・false は無視する */
const show = (...nodes) => $('#results').replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));

/** 絞り込み条件を変えたときに描き直すべき結果か（文字・コード検索は絞り込みの影響を受けない） */
export const isFilterable = (result) => !result || ['empty', 'reading', 'filter', 'notfound'].includes(result.type);

export async function renderResult(result) {
  try {
    switch (result.type) {
      case 'empty': return renderWelcome();
      case 'text':
      case 'code': return await renderChars(result);
      case 'reading': return renderReading(result);
      case 'filter': return renderFilterList(result);
      case 'nochar': return await renderNoChar(result);
      default: return renderNotFound(result);
    }
  } catch (err) {
    renderLoadError(err);
  }
}

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

function renderNotFound(result) {
  const example = (query) => queryButton(query, query, 'chip chip--ghost');
  // 次にできることを示す（手書き・画像のボタンは検索欄の下にあるものを押す）
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

async function renderNoChar(result) {
  const glyph = await app.db.noCharGlyph(result.mj);
  show(h('div', { class: 'notice notice--warn' },
    h('strong', {}, `${formatMJ(result.mj)} には UCS 符号位置がありません`),
    h('p', {}, 'MJ文字情報一覧表で重複や図形誤りと判明した字形で、IPAmj明朝には実装されていません。'),
    glyph?.note ? h('p', {}, `備考: ${glyph.note}`) : null));
}

// ---------------------------------------------------------------------------- 文字・コード検索

async function renderChars(result) {
  const items = result.chars;
  const panelHost = h('div', { id: 'char-panel-host' });
  const tabs = items.length > 1 ? charTabs(items, (i, focusTab) => selectTab(i, focusTab).catch(renderLoadError)) : null;

  let tabToken = 0; // 最後に選んだタブの番号。読み込み中に切り替えたら、前のタブの結果は捨てる

  async function selectTab(i, focusTab = false) {
    if (tabs) {
      [...tabs.children].forEach((tab, j) => {
        tab.setAttribute('aria-selected', String(i === j));
        tab.tabIndex = i === j ? 0 : -1;
      });
      if (focusTab) tabs.children[i].focus();
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
    panel.querySelector('.glyph-card.is-focus')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const unknown = [...new Set(result.unknown ?? [])];
  show(
    h('div', { class: 'result-header' },
      h('h2', {}, result.type === 'code' ? `「${result.query}」` : `「${result.query}」の異体字`),
      h('p', {}, items.length > 1 ? `${items.length} 文字。タブで切り替えられます。` : '')),
    unknown.length ? h('div', { class: 'notice notice--spaced' }, `「${unknown.join('')}」は MJ文字情報一覧表に収録されていないため表示していません。`) : null,
    tabs,
    panelHost,
  );
  await selectTab(0);
}

/** 矢印キーでも移動できるタブ（WAI-ARIA tabs） */
function charTabs(items, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': '文字' },
    items.map((item, i) => {
      const entry = app.db.entry(item.key);
      return h('button', {
        class: 'tab', role: 'tab', type: 'button', id: `tab-${i}`,
        'aria-selected': String(i === 0), 'aria-controls': 'char-panel-host', tabindex: i === 0 ? '0' : '-1',
        onclick: () => onSelect(i, false),
        onkeydown: (e) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          onSelect((i + step + items.length) % items.length, true);
        },
      },
      h('span', { class: 'glyph' }, entry.char),
      h('span', { class: 'tab__meta' }, `${entry.glyphCount}字形`));
    }));
}

// ---------------------------------------------------------------------------- 読み・絞り込み

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

/** 呼び名（はしごだか など）に一致する字。IVS 付きの字形を指すものは、その字形を開く */
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

/** 人名・地名の候補を種別（姓・名・地名・異体字での表記）ごとにまとめる */
function nameSections(names) {
  const byKind = new Map();
  for (const group of names) {
    if (!byKind.has(group.kind)) byKind.set(group.kind, []);
    byKind.get(group.kind).push(group);
  }
  return [...byKind].map(([kind, groups]) => [
    h('h3', { class: 'section-label' }, kind === '異体字での表記'
      ? '異体字に置き換えた表記（実在の確認はしていません）' : kind),
    h('div', { class: 'name-suggestions' }, groups.map((group) => h('div', { class: 'name-row' },
      h('span', { class: 'name-row__reading' }, group.reading),
      group.words.map((word) => queryButton(word))))),
  ]);
}

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
      grid.append(candidate(app.db.entry(keys[i])));
    }
    shown = end;
    more.hidden = shown >= keys.length;
    more.textContent = `さらに表示（残り ${(keys.length - shown).toLocaleString()} 字）`;
  };
  more.addEventListener('click', renderPage);
  renderPage();
  return h('div', {}, grid, more);
}

function candidate(entry) {
  const policy = entry.jouyou ? ' / 常用' : entry.jinmei ? ' / 人名用' : '';
  return h('button', { class: 'candidate', type: 'button', dataset: { query: entry.char }, title: `U+${entry.key} / ${entry.strokes}画${policy}` },
    h('span', { class: 'glyph' }, entry.char),
    h('span', { class: 'candidate__meta' },
      entry.hasIVS ? h('span', { class: 'candidate__dot', title: 'IVS異体字あり' }) : null,
      String(entry.glyphCount)));
}
