// IPAmj明朝の導入状況と、ブラウザで IVS が描き分けられるかを判定する。

export const WEB_FONT_FAMILY = 'MJ Variant Mincho';
const LOCAL_FAMILIES = ['IPAmjMincho', 'IPAmj明朝'];

// 邉 の IVS 違い（MJ026190 と MJ026191）。フォントが IVS に対応していれば字形が変わる
const IVS_SAMPLE_A = '邉\u{E010F}';
const IVS_SAMPLE_B = '邉\u{E0119}';
const WIDTH_SAMPLE = 'あ永邉𠮷mmmWWiil';

function canvasContext(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext('2d', { willReadFrequently: true });
}

/**
 * 端末に IPAmj明朝がインストールされているか（文字幅の比較）.
 * Safari などは指紋採取対策でユーザーが追加したフォントを見せないため、false でも未導入とは限らない.
 */
export function detectLocalFont() {
  const ctx = canvasContext(10);
  const fallbacks = ['monospace', 'serif', 'sans-serif'];
  const measure = (font) => {
    ctx.font = font;
    return ctx.measureText(WIDTH_SAMPLE).width;
  };
  return LOCAL_FAMILIES.some((family) =>
    fallbacks.some((fb) => measure(`72px "${family}", ${fb}`) !== measure(`72px ${fb}`)),
  );
}

function renderSignature(ctx, text, family, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.font = `${size * 0.8}px "${family}"`;
  ctx.fillText(text, size * 0.1, size * 0.1);
  const { data } = ctx.getImageData(0, 0, size, size);
  let hash = 0;
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 128) {
      ink++;
      hash = (hash * 31 + i) >>> 0;
    }
  }
  return { hash, ink };
}

/** 指定フォントで IVS の字形が描き分けられるか. */
export async function testIvsRendering(family) {
  try {
    await document.fonts.load(`64px "${family}"`, IVS_SAMPLE_A + IVS_SAMPLE_B);
  } catch {
    return false;
  }
  const size = 64;
  const ctx = canvasContext(size);
  const a = renderSignature(ctx, IVS_SAMPLE_A, family, size);
  const b = renderSignature(ctx, IVS_SAMPLE_B, family, size);
  return a.ink > 0 && b.ink > 0 && a.hash !== b.hash;
}

/**
 * @returns {Promise<{local: boolean, webFontIvs: boolean, status: 'local'|'webfont'|'unsupported'}>}
 */
export async function detectFontStatus() {
  const local = detectLocalFont();
  const webFontIvs = await testIvsRendering(WEB_FONT_FAMILY);
  const status = webFontIvs ? (local ? 'local' : 'webfont') : 'unsupported';
  return { local, webFontIvs, status };
}
