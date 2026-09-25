// 字形の違いを色で示す（字形カードの「違いを色で表示」）。
// 異体字セレクタを付けずに表示される通常の字形と重ね、この字形だけにある部分と、
// 通常の字形だけにある部分に色を付ける。共通の部分は薄く表示する。

import { WEB_FONT_FAMILY } from '../font-detector.js';

const STORAGE_KEY = 'glyph-diff';
const SIZE = 192;                      // 描画に使う canvas の画素数（表示は CSS で 1em 四方に縮める）
const FONT = `${SIZE}px "${WEB_FONT_FAMILY}", "IPAmjMincho", "IPAmj明朝", serif`;
const SAME_THRESHOLD = 0.002;          // 違う画素がこの割合未満なら「通常の字形と同じ」とみなす

/** @type {Map<string, Uint8ClampedArray>} 文字列 → 描いた字の濃さ（画素ごと） */
const inkCache = new Map();
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
  const colors = themeColors();
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
    // 色を重ねる: 違う部分は濃く、共通の部分は薄く
    const layers = [[colors.onlyThis, onlyA], [colors.onlyBase, onlyB], [colors.common, common * 0.45]];
    let alpha = 0;
    let r = 0; let g = 0; let bl = 0;
    for (const [color, value] of layers) {
      const w = value / 255;
      r += color[0] * w; g += color[1] * w; bl += color[2] * w; alpha += w;
    }
    const o = i * 4;
    if (alpha > 0) {
      image.data[o] = r / alpha;
      image.data[o + 1] = g / alpha;
      image.data[o + 2] = bl / alpha;
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
  if (inkCache.has(text)) return inkCache.get(text);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(text, SIZE / 2, SIZE / 2);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const alpha = new Uint8ClampedArray(SIZE * SIZE);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  inkCache.set(text, alpha);
  return alpha;
}

/** 配色（ダーク/ライトで変わる CSS 変数）を RGB で読む */
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const rgb = (name) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = style.getPropertyValue(name).trim();
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  return { onlyThis: rgb('--crimson-bright'), onlyBase: rgb('--overlay-b'), common: rgb('--text') };
}

export function setupGlyphDiff() {
  document.body.classList.toggle('diff-mode', enabled);
  // ダーク/ライトを切り替えたら描き直す
  new MutationObserver(() => { if (enabled) refreshAll(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
