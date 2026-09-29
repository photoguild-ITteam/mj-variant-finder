// 字形を画像として書き出す: PNG（クリップボード / 保存）と SVG（アウトライン、保存）.
// Canva・Illustrator などフォントや IVS の扱いが不確かなアプリへ、字形を崩さず持ち込むための機能。

import { fetchOk } from './db.js';
import { WEB_FONT_FAMILY } from './font-detector.js';

const PNG_SIZE = 1024; // 1em あたりのピクセル数
const FONT_MAP_URL = new URL('../fonts/fonts-map.json', import.meta.url);
const FONTKIT_URL = new URL('../vendor/fontkit.js', import.meta.url);

const fileBase = (glyph) => glyph.mj;

// ---------------------------------------------------------------------------- PNG

/** 字形を 1em 四方の透明 PNG にする（全角の字送り幅 × アセント+ディセント）. */
export async function renderPng(glyph, { size = PNG_SIZE, color = '#000000' } = {}) {
  const font = `${size}px "${WEB_FONT_FAMILY}"`;
  await document.fonts.load(font, glyph.char);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const m = ctx.measureText(glyph.char);
  const ascent = m.fontBoundingBoxAscent ?? size * 0.88;
  const descent = m.fontBoundingBoxDescent ?? size * 0.12;
  canvas.width = Math.ceil(m.width);
  canvas.height = Math.ceil(ascent + descent);
  ctx.font = font; // サイズ変更でリセットされる
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(glyph.char, 0, ascent);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG を作成できませんでした'))), 'image/png');
  });
}

export async function copyPng(glyph, options) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('このブラウザは画像のコピーに対応していません');
  }
  // Safari はユーザー操作の直後に write を呼ぶ必要があるため、Blob ではなく Promise を渡す
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPng(glyph, options) })]);
}

export async function downloadPng(glyph, options) {
  saveBlob(await renderPng(glyph, options), `${fileBase(glyph)}.png`);
}

// ---------------------------------------------------------------------------- SVG

let fontkitPromise;
let fontMapPromise;
const fontCache = new Map();

async function fontFor(cp) {
  fontMapPromise ??= fetchOk(FONT_MAP_URL).then((r) => r.json());
  fontMapPromise.catch(() => { fontMapPromise = undefined; });
  const map = await fontMapPromise;
  const hit = map.find(([start, end]) => cp >= start && cp <= end);
  if (!hit) throw new Error(`U+${cp.toString(16).toUpperCase()} を含むフォントファイルがありません`);
  const file = hit[2];
  if (!fontCache.has(file)) {
    fontkitPromise ??= import(FONTKIT_URL.href);
    const promise = Promise.all([
      fontkitPromise,
      fetchOk(new URL(`../fonts/${file}`, import.meta.url)).then((r) => r.arrayBuffer()),
    ]).then(([fontkit, buf]) => fontkit.create(new Uint8Array(buf)));
    promise.catch(() => fontCache.delete(file));
    fontCache.set(file, promise);
  }
  return fontCache.get(file);
}

/**
 * コードポイント列（基底文字 + 異体字セレクタ）→ グリフ.
 * fontkit 2.0.4 の getVariationSelector は、defaultUVS を持つセレクタで nonDefaultUVS を探さない不具合があるため、
 * cmap format 14 を直接引く。
 */
function glyphFor(font, cps) {
  const [base, vs] = cps;
  const uvs = font._cmapProcessor?.uvs;
  if (vs && uvs) {
    const selector = uvs.varSelectors.toArray().find((s) => s.varSelector === vs);
    const mapping = selector?.nonDefaultUVS?.find((x) => x.unicodeValue === base);
    if (mapping) return font.getGlyph(mapping.glyphID);
  }
  return font.glyphForCodePoint(base);
}

const escapeXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/** 字形のアウトラインを SVG 文字列にする（viewBox は字送り幅 × アセント+ディセント、単位はフォント座標）. */
export async function buildSvg(glyph, { color = '#000000' } = {}) {
  const cps = [...glyph.char].map((ch) => ch.codePointAt(0));
  const font = await fontFor(cps[0]);
  const g = glyphFor(font, cps);
  if (!g || g.id === 0) throw new Error('フォントにこの字形がありません');
  const width = g.advanceWidth;
  const height = font.ascent - font.descent;
  const unicode = cps.map((cp) => `U+${cp.toString(16).toUpperCase()}`).join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${(width / font.unitsPerEm) * 256}" height="${(height / font.unitsPerEm) * 256}">`,
    `<title>${escapeXml(`${glyph.mj} ${unicode}`)}</title>`,
    `<desc>${escapeXml('字形: IPAmj明朝 Ver.006.01（IPAフォントライセンス v1.0）')}</desc>`,
    `<path transform="translate(0 ${font.ascent}) scale(1 -1)" fill="${escapeXml(color)}" d="${g.path.toSVG()}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

export async function downloadSvg(glyph, options) {
  const svg = await buildSvg(glyph, options);
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(glyph)}.svg`);
}

// ---------------------------------------------------------------------------- 複数文字の連結書き出し

function multiFileBase(glyphs) {
  const chars = glyphs.map((g) => g.char.replace(/[\uE0100-\uE01EF]/g, '')).join('');
  const mjs = glyphs.map((g) => g.mj).filter(Boolean).join('_');
  return mjs ? `${chars}_${mjs}` : chars || 'glyphs';
}

/**
 * 複数字形を連結した透明 PNG を作成する（横書き・縦書き対応、高解像度対応）
 * @param {Array<{char: string, mj?: string}>} glyphs
 * @param {{ size?: number, direction?: 'horizontal'|'vertical', color?: string }} [options]
 * @returns {Promise<Blob>}
 */
export async function renderMultiPng(glyphs, { size = PNG_SIZE, direction = 'horizontal', color = '#000000' } = {}) {
  if (!glyphs?.length) throw new Error('文字が指定されていません');
  const font = `${size}px "${WEB_FONT_FAMILY}"`;
  await Promise.all(glyphs.map((g) => document.fonts.load(font, g.char)));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;

  const metrics = glyphs.map((g) => {
    const m = ctx.measureText(g.char);
    const ascent = m.fontBoundingBoxAscent ?? size * 0.88;
    const descent = m.fontBoundingBoxDescent ?? size * 0.12;
    return {
      char: g.char,
      width: Math.ceil(m.width),
      ascent,
      descent,
    };
  });

  const maxAscent = Math.max(...metrics.map((m) => m.ascent));
  const maxDescent = Math.max(...metrics.map((m) => m.descent));
  const charHeight = Math.ceil(maxAscent + maxDescent);

  if (direction === 'horizontal') {
    const totalWidth = metrics.reduce((sum, m) => sum + m.width, 0);
    canvas.width = Math.max(1, totalWidth);
    canvas.height = Math.max(1, charHeight);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';

    let x = 0;
    for (const m of metrics) {
      ctx.fillText(m.char, x, maxAscent);
      x += m.width;
    }
  } else {
    // 縦書き: 各文字を 1em の正方形セルに中央揃えで配置
    const maxWidth = Math.max(...metrics.map((m) => m.width), size);
    const totalHeight = glyphs.length * size;
    canvas.width = Math.max(1, maxWidth);
    canvas.height = Math.max(1, totalHeight);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';

    let y = 0;
    for (const m of metrics) {
      const x = (maxWidth - m.width) / 2;
      ctx.fillText(m.char, x, y + maxAscent);
      y += size;
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG を作成できませんでした'))), 'image/png');
  });
}

export async function copyMultiPng(glyphs, options) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('このブラウザは画像のコピーに対応していません');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderMultiPng(glyphs, options) })]);
}

export async function downloadMultiPng(glyphs, options) {
  saveBlob(await renderMultiPng(glyphs, options), `${multiFileBase(glyphs)}.png`);
}

/**
 * 複数字形を連結した SVG 文字列を作成する
 * @param {Array<{char: string, mj?: string}>} glyphs
 * @param {{ direction?: 'horizontal'|'vertical', color?: string }} [options]
 * @returns {Promise<string>}
 */
export async function buildMultiSvg(glyphs, { direction = 'horizontal', color = '#000000' } = {}) {
  if (!glyphs?.length) throw new Error('文字が指定されていません');

  const items = [];
  for (const glyph of glyphs) {
    const cps = [...glyph.char].map((ch) => ch.codePointAt(0));
    const font = await fontFor(cps[0]);
    const g = glyphFor(font, cps);
    if (!g || g.id === 0) throw new Error(`「${glyph.char}」の字形がフォントにありません`);
    items.push({ glyph, font, g, cps });
  }

  const em = items[0].font.unitsPerEm; // 通常 2048
  const paths = [];

  let totalWidth = 0;
  let totalHeight = 0;

  if (direction === 'horizontal') {
    let currentX = 0;
    let maxHeight = 0;
    for (const item of items) {
      const width = item.g.advanceWidth;
      const height = item.font.ascent - item.font.descent;
      if (height > maxHeight) maxHeight = height;
      paths.push(`<path transform="translate(${currentX} ${item.font.ascent}) scale(1 -1)" fill="${escapeXml(color)}" d="${item.g.path.toSVG()}"/>`);
      currentX += width;
    }
    totalWidth = currentX;
    totalHeight = maxHeight || em;
  } else {
    // 縦書き
    let currentY = 0;
    let maxWidth = 0;
    for (const item of items) {
      const width = item.g.advanceWidth;
      if (width > maxWidth) maxWidth = width;
      const x = (em - width) / 2;
      paths.push(`<path transform="translate(${x} ${currentY + item.font.ascent}) scale(1 -1)" fill="${escapeXml(color)}" d="${item.g.path.toSVG()}"/>`);
      currentY += em;
    }
    totalWidth = maxWidth || em;
    totalHeight = currentY;
  }

  const title = glyphs.map((g) => g.char).join('');
  const scale = 256 / em;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth * scale}" height="${totalHeight * scale}">`,
    `<title>${escapeXml(title)}</title>`,
    `<desc>${escapeXml('字形: IPAmj明朝 Ver.006.01（IPAフォントライセンス v1.0）')}</desc>`,
    ...paths,
    '</svg>',
    '',
  ].join('\n');
}

export async function downloadMultiSvg(glyphs, options) {
  const svg = await buildMultiSvg(glyphs, options);
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${multiFileBase(glyphs)}.svg`);
}

// ---------------------------------------------------------------------------- 共通

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
