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

let tipCount = 0;

/**
 * 注記: 「?」に畳んだ説明。マウスを乗せる・キーボードで選ぶと出る（CSS の :hover・:focus-within）.
 * タッチの端末では押すと開閉する（setupTips() がまとめて受ける）
 * @param {string} label 「?」の読み上げ名（text が無いとき）
 * @param {any} content 説明（文字列・要素・その配列）
 * @param {{text?: string, end?: boolean}} [options] text: 「?」の横に出す見出し。end: 説明を右端にそろえる（画面の右寄りに置くとき）
 */
export function infoTip(label, content, { text, end = false } = {}) {
  const id = `tip-${++tipCount}`;
  return h('span', { class: `tip${end ? ' tip--end' : ''}` },
    h('button', {
      class: 'tip__button', type: 'button', 'aria-label': text ? null : label, 'aria-describedby': id, 'aria-expanded': 'false',
    }, text ? h('span', { class: 'tip__text' }, text) : null, h('span', { class: 'tip__icon', 'aria-hidden': 'true' }, '?')),
    h('span', { class: 'tip__body', role: 'tooltip', id }, content));
}

/** @param {Element | null} except 開いたままにする注記 */
function closeTips(except) {
  for (const tip of document.querySelectorAll('.tip.is-open')) {
    if (tip === except) continue;
    tip.classList.remove('is-open');
    tip.querySelector('.tip__button')?.setAttribute('aria-expanded', 'false');
  }
}

/**
 * 注記を押したときの開閉（タッチの端末用）と、外を押す・Esc で閉じる。1 回だけ呼ぶ.
 * Esc は、マウスを乗せたまま・キーボードで選んだままの注記も隠す（離れると元に戻る）
 */
export function setupTips() {
  document.addEventListener('click', (e) => {
    const button = e.target instanceof Element ? e.target.closest('.tip__button') : null;
    const tip = button?.closest('.tip') ?? null;
    if (!button || !tip) {
      closeTips(null);
      return;
    }
    const open = !tip.classList.contains('is-open');
    closeTips(tip);
    tip.classList.toggle('is-open', open);
    tip.classList.remove('is-dismissed');
    button.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeTips(null);
    for (const tip of document.querySelectorAll('.tip')) {
      if (tip.matches(':hover, :focus-within')) tip.classList.add('is-dismissed');
    }
  });
  /** @param {Event & {relatedTarget?: EventTarget | null}} e */
  const undismiss = (e) => {
    const tip = e.target instanceof Element ? e.target.closest('.tip.is-dismissed') : null;
    if (tip && !(e.relatedTarget instanceof Node && tip.contains(e.relatedTarget))) tip.classList.remove('is-dismissed');
  };
  document.addEventListener('mouseout', undismiss);
  document.addEventListener('focusout', undismiss);
}

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
