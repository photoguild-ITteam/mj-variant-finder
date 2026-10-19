// ゴシック体の見本用フォント（src/fonts/gothic/gothic.css。scripts/build_gothic_webfont.py）を読み込む。
// 約 120KB あるので、見本を初めて出すとき（字形の詳細・検索結果の「ゴシック体の字形」）に読む。

import { h } from './dom.js';

const GOTHIC_CSS = new URL('../../fonts/gothic/gothic.css', import.meta.url).href;
/** @type {Promise<void> | null} gothic.css を読み終えたら解決する（読めなければ、次に要るときに読み直す） */
let gothicCss = null;

/** 見本用のゴシック体の @font-face を読み込む */
export function loadGothicFonts() {
  gothicCss ??= new Promise((resolve, reject) => {
    const link = h('link', {
      rel: 'stylesheet', href: GOTHIC_CSS,
      onload: () => resolve(),
      onerror: () => { link.remove(); gothicCss = null; reject(new Error(`${GOTHIC_CSS} を読み込めませんでした`)); },
    });
    document.head.append(link);
  });
  return gothicCss;
}

/**
 * 見本の字を描くフォントを読み込む。読めない・字が無いときは reject する
 * （呼ぶ側は、別のフォントで描いた字を見本と取り違えないよう、見本を消す）
 * @param {string} family gothic.css のフォント名
 * @param {string} text
 */
export async function loadGothicSample(family, text) {
  await loadGothicFonts();
  const faces = await document.fonts.load(`32px "${family}"`, text);
  if (!faces.length) throw new Error(`${family} に ${text} がありません`);
}
