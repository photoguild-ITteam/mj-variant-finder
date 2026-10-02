// DOM を組み立てる小さな道具。文字列の子はテキストノードになる（innerHTML は使わない）。

/**
 * querySelector の短縮.
 * 戻り値には型を付けない（id で引く要素がダイアログか入力欄かは、呼ぶ側が index.html の形で知っている）。
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {any}
 */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [attrs] class / dataset / on<event> / その他の属性。null・false は付けない
 * @param {...any} children 配列は平坦化し、null・false は無視する
 * @returns {HTMLElementTagNameMap[K]}
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

/** JS で動かすスクロールの behavior. 「視差効果を減らす」の設定では動きを付けない */
export const scrollBehavior = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * バッジ. variant は gold / navy / crimson / ok / warn / muted
 * @param {string} text
 * @param {string | null} [variant]
 * @param {string} [title]
 */
export const badge = (text, variant, title) =>
  h('span', { class: variant ? `badge badge--${variant}` : 'badge', title }, text);

export const loading = (text = '読み込み中…') =>
  h('div', { class: 'loading' }, h('span', { class: 'loading__spinner', 'aria-hidden': 'true' }), text);

/**
 * 検索語として扱うボタン（クリックは app.js がまとめて拾って検索する）
 * @param {string} query
 * @param {string | Node} [label]
 * @param {string} [className]
 */
export const queryButton = (query, label = query, className = 'chip') =>
  h('button', { class: className, type: 'button', dataset: { query } }, label);
