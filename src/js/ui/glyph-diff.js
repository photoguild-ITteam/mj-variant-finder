// 字形の違いを色で示す（字形カードの「違いを色で表示」）。
// 異体字セレクタを付けずに表示される通常の字形と重ね、この字形だけにある部分と、
// 通常の字形だけにある部分に色を付ける。共通の部分は薄く表示する。

import { WEB_FONT_FAMILY } from '../font-detector.js';

const STORAGE_KEY = 'glyph-diff';
const SIZE = 192;                      // 描画に使う canvas の画素数（表示は CSS で 1em 四方に縮める）
const FONT = `${SIZE}px "${WEB_FONT_FAMILY}", "IPAmjMincho", "IPAmj明朝", serif`;
const SAME_THRESHOLD = 0.002;          // 違う画素がこの割合未満なら「通常の字形と同じ」とみなす
const INK_CACHE_MAX = 256;             // 覚えておく字の数（1字 SIZE*SIZE = 約36KB なので、約9MB まで）

/**
 * 文字列 → 描いた字の濃さ（画素ごと）。Map の順序を使い、最近使ったものを後ろに置いて、
 * INK_CACHE_MAX を超えたら前（しばらく使っていないもの）から捨てる
 * @type {Map<string, Uint8ClampedArray>}
 */
const inkCache = new Map();
/** @type {CanvasRenderingContext2D | null} ink() で使い回す canvas（描いてすぐ読むので、共有しても混ざらない） */
let inkContext = null;
/** themeColors() の結果。テーマを切り替えたら捨てる */
let colorCache = null;
let enabled = load();

function load() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export const isDiffEnabled = () => enabled;

/** 表示中のすべての字形カードに反映する（切り替えボタンから呼ぶ） */
export function setDiffEnabled(value) {
  enabled = value;
  try { localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off'); } catch {}
  document.body.classList.toggle('diff-mode', value);
  for (const button of document.querySelectorAll('.diff-toggle')) button.setAttribute('aria-pressed', String(value));
  refreshAll();
}

/** 字形カードの表面（.glyph-card__face）を、今の設定に合わせて描く */
export function renderFace(face) {
  const text = face.dataset.char;
  if (!text) return;
  if (!enabled) {
    face.querySelector('canvas')?.remove();
    face.classList.remove('is-diff', 'is-default-glyph');
    return;
  }
  drawDiff(face, text).catch((err) => console.warn('差分を描けませんでした', err));
}

function refreshAll() {
  for (const face of document.querySelectorAll('.glyph-card__face[data-char]')) renderFace(face);
}

async function drawDiff(face, text) {
  const base = String.fromCodePoint(text.codePointAt(0)); // 異体字セレクタなし
  await document.fonts.load(FONT, text + base);
  const [a, b] = [ink(text), ink(base)];
  const { onlyThis, onlyBase, common: commonColor } = themeColors();
  const canvas = face.querySelector('canvas') ?? document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(SIZE, SIZE);
  let differ = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const onlyA = Math.max(0, a[i] - b[i]);
    const onlyB = Math.max(0, b[i] - a[i]);
    const common = Math.min(a[i], b[i]);
    if (a[i] > 128 || b[i] > 128) total++;
    if (onlyA > 128 || onlyB > 128) differ++;
    // 色を重ねる: 違う部分は濃く、共通の部分は薄く（画素ごとに配列を作らないよう、3色を直接足す）
    const wThis = onlyA / 255;
    const wBase = onlyB / 255;
    const wCommon = (common * 0.45) / 255;
    const alpha = wThis + wBase + wCommon;
    const o = i * 4;
    if (alpha > 0) {
      image.data[o] = (onlyThis[0] * wThis + onlyBase[0] * wBase + commonColor[0] * wCommon) / alpha;
      image.data[o + 1] = (onlyThis[1] * wThis + onlyBase[1] * wBase + commonColor[1] * wCommon) / alpha;
      image.data[o + 2] = (onlyThis[2] * wThis + onlyBase[2] * wBase + commonColor[2] * wCommon) / alpha;
      image.data[o + 3] = Math.min(255, alpha * 255);
    }
  }
  if (!enabled) return; // 描いている間に切り替えられた
  // 通常の字形と同じなら色を付けず、そのまま表示して印だけ付ける
  const same = total > 0 && differ / total < SAME_THRESHOLD;
  face.classList.toggle('is-default-glyph', same);
  face.classList.toggle('is-diff', !same);
  face.title = same ? '異体字セレクタなしで表示される通常の字形と同じです' : '赤: この字形だけにある部分 / 青: 通常の字形だけにある部分';
  if (same) {
    canvas.remove();
    return;
  }
  ctx.putImageData(image, 0, 0);
  if (canvas.parentNode !== face) face.append(canvas);
}

/** 字を描いて、画素ごとの濃さ（0〜255）を返す */
function ink(text) {
  const cached = inkCache.get(text);
  if (cached) {
    inkCache.delete(text);
    inkCache.set(text, cached); // 最近使ったものとして後ろへ
    return cached;
  }
  if (!inkContext) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    inkContext = canvas.getContext('2d', { willReadFrequently: true });
    inkContext.textAlign = 'center';
    inkContext.textBaseline = 'middle';
    inkContext.fillStyle = '#000';
  }
  const ctx = inkContext;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.font = FONT; // フォントを読み込んだ後の描画でも確実に使われるよう、毎回指定する
  ctx.fillText(text, SIZE / 2, SIZE / 2);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const alpha = new Uint8ClampedArray(SIZE * SIZE);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  inkCache.set(text, alpha);
  if (inkCache.size > INK_CACHE_MAX) inkCache.delete(inkCache.keys().next().value);
  return alpha;
}

/** 配色（ダーク/ライトで変わる CSS 変数）を RGB で読む。テーマが変わるまでは同じなので覚えておく */
function themeColors() {
  if (colorCache) return colorCache;
  const style = getComputedStyle(document.documentElement);
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (name) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = style.getPropertyValue(name).trim();
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  colorCache = { onlyThis: rgb('--crimson-bright'), onlyBase: rgb('--overlay-b'), common: rgb('--text') };
  return colorCache;
}

export function setupGlyphDiff() {
  document.body.classList.toggle('diff-mode', enabled);
  // ダーク/ライトを切り替えたら、配色を読み直して描き直す
  new MutationObserver(() => {
    colorCache = null;
    if (enabled) refreshAll();
  })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
