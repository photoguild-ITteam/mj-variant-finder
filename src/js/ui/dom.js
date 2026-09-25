// DOM を組み立てる小さな道具。文字列の子はテキストノードになる（innerHTML は使わない）。

export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * @param {string} tag
 * @param {Record<string, any>} [attrs] class / dataset / on<event> / その他の属性。null・false は付けない
 * @param {...any} children 配列は平坦化し、null・false は無視する
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** バッジ. variant は gold / navy / crimson / ok / warn / muted */
export const badge = (text, variant, title) =>
  h('span', { class: variant ? `badge badge--${variant}` : 'badge', title }, text);

export const loading = (text = '読み込み中…') =>
  h('div', { class: 'loading' }, h('span', { class: 'loading__spinner', 'aria-hidden': 'true' }), text);

/** 検索語として扱うボタン（クリックは app.js がまとめて拾って検索する） */
export const queryButton = (query, label = query, className = 'chip') =>
  h('button', { class: className, type: 'button', dataset: { query } }, label);
