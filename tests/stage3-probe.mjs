// 【調査用・一時的】画像検索の段3（実フォントでの描き直し）が CI（Linux）でだけ外れる原因を調べる。
// 入力と候補を描いた画像を tests/screenshots/probe-*.png に保存し、相関と文字幅を出力する。
// 原因が分かったらこのファイルと test.yml の呼び出しは消す。
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8765/';
const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const channel = process.env.BROWSER_CHANNEL ?? 'chrome';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
const page = await browser.newPage();
await page.goto(BASE);
await page.waitForSelector('#q');

const result = await page.evaluate(async () => {
  const F = await import('./src/js/image-search/features.js');
  const FAMILY = '"MJ Variant Mincho"';
  const draw = async (text, px, size, { fallback = true, fill = '#000' } = {}) => {
    const font = `${px}px ${FAMILY}${fallback ? ', serif' : ''}`;
    await document.fonts.load(font, text);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fill;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2);
    const image = ctx.getImageData(0, 0, size, size);
    let minX = size, maxX = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (image.data[(y * size + x) * 4] < 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    return { image, png: canvas.toDataURL('image/png'), width: ctx.measureText(text).width, inkX: [minX, maxX] };
  };
  const corr = (a, b) => {
    let ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; d += x * y; na += x * x; nb += y * y; }
    return +(d / Math.sqrt(na * nb)).toFixed(4);
  };
  const vs = (n) => String.fromCodePoint(0xe0100 + n);

  const out = { userAgent: navigator.userAgent, width: {}, corr: {}, pngs: {} };
  // e2e と同じ入力（96px、フォールバックなし、#111）
  const input = await draw('邉' + vs(15), 96, 160, { fallback: false, fill: '#111' });
  out.pngs.input = input.png;
  const norm = F.normalizeImage(input.image);
  // 文字幅: セレクタが見える字として描かれていれば、IVS 付きの幅が広がる
  for (const [name, text] of [['base', '邉'], ['E010F', '邉' + vs(15)], ['E0111', '邉' + vs(17)], ['selectorOnly', vs(15)]]) {
    const r = await draw(text, 96, 160, { fallback: false });
    out.width[name] = { measure: +r.width.toFixed(1), inkX: r.inkX };
  }
  out.width.input = { measure: +input.width.toFixed(1), inkX: input.inkX };
  // 段3と同じ描き方（64*1.4px、128px、serif フォールバックあり）で候補を描いて比べる
  for (let n = 15; n <= 20; n++) {
    const r = await draw('邉' + vs(n), 64 * 1.4, 128);
    out.corr[`E01${(0x0f + n - 15).toString(16).toUpperCase().padStart(2, '0')}`] = corr(norm, F.normalizeImage(r.image));
    if (n <= 17) out.pngs[`cand-${n}`] = r.png;
  }
  out.corr.baseOnly = corr(norm, F.normalizeImage((await draw('邉', 64 * 1.4, 128)).image));
  out.fonts = [...document.fonts].filter((f) => f.status !== 'unloaded').map((f) => `${f.family} ${f.status} ${f.unicodeRange.slice(0, 20)}`);
  return out;
});

for (const [name, url] of Object.entries(result.pngs)) {
  writeFileSync(OUT + `probe-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
delete result.pngs;
console.log(JSON.stringify(result, null, 2));
await browser.close();
