// 主な機能の動作確認（Chromium 以外のブラウザ向けの短い e2e）。事前に `npm run serve` でリポジトリ直下を配信しておく。
//   BROWSER=webkit npm run test:e2e:smoke     （webkit / firefox / chromium。既定は webkit）
//   ブラウザは先に入れておく: npx playwright-core install webkit（CI は --with-deps 付き）
//
// tests/e2e.mjs（Chromium）の中から、ブラウザの違いが出やすいものを選んで確かめる:
// Webフォントでの IVS の描き分け、検索、ダイアログ、PNG・SVG の書き出し、手書き（モジュールのワーカー）、
// 画像から探す、スマホ幅、ガイド。クリップボードは、Playwright が Chromium にしか権限を与えられないので対象外。
//
// 注意: Linux の WebKit は文字の描画に HarfBuzz を使い、macOS・iOS の Safari（CoreText）とは違う。
// ここが通っても Safari・iPhone で確かめたことにはならない（実機での確認は別に行う。Issue #59）。
import { chromium, firefox, webkit } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8765/';
const ENGINES = { chromium, firefox, webkit };
const engineName = process.env.BROWSER ?? 'webkit';
const engine = ENGINES[engineName];
if (!engine) throw new Error(`BROWSER は ${Object.keys(ENGINES).join(' / ')} のどれか: ${engineName}`);

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
  }
};

const browser = await engine.launch({ headless: true });

/** @param {{width: number, height: number}} [viewport] */
async function newPage(viewport = { width: 1360, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  // 端末に IPAmj明朝 があっても Webフォント（woff2）を使わせる
  await context.route('**/src/fonts/fonts.css', async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace(/local\("[^"]+"\),/g, '') });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { page, errors, context };
}

/** @param {import('playwright-core').Page} page @param {string} query */
async function search(page, query) {
  await page.fill('#q', query);
  await page.press('#q', 'Enter');
}

{
  const { page, errors, context } = await newPage();

  await check('起動して、Webフォントで IVS が描き分けられる', async () => {
    await page.goto(BASE);
    await page.waitForSelector('#q:not([disabled])');
    await page.waitForFunction(() => document.querySelector('#font-status')?.getAttribute('data-state') !== 'checking', null, { timeout: 30000 });
    // 端末に IPAmj明朝 があれば local（CI の Linux には無いので webfont）。どちらでも、下で Webフォントを直接確かめる
    const state = await page.getAttribute('#font-status', 'data-state');
    assert.ok(state === 'local' || state === 'webfont', `フォント状態: ${state}`);
    const ok = await page.evaluate(async () => {
      const { testIvsRendering } = await import('./src/js/font-detector.js');
      return testIvsRendering('MJ Variant Mincho');
    });
    assert.equal(ok, true, 'IVS の字形が描き分けられない（Webフォントの cmap format 14 が効いていない）');
  });

  await check('文字・読み・MJ文字図形名で検索できる', async () => {
    await search(page, '渡辺');
    await page.waitForSelector('.tab');
    assert.deepEqual(await page.$$eval('.tab .glyph', (els) => els.map((e) => e.textContent)), ['渡', '辺']);
    await search(page, 'さいとう');
    await page.waitForSelector('.name-row .chip:text("齋藤")');
    await search(page, 'MJ026190');
    await page.waitForSelector('.glyph-card.is-focus .glyph-card__mj:text("MJ026190")');
  });

  await check('字形詳細ダイアログ（コピー形式）と SVG・PNG の保存', async () => {
    await page.click('.glyph-card.is-focus .glyph-card__face');
    await page.waitForSelector('#glyph-dialog[open]');
    const values = await page.$$eval('.copy-row__value', (els) => els.map((e) => e.textContent));
    assert.deepEqual(values.slice(1), ['MJ026190', 'U+9089 U+E010F', '&#x9089;&#xE010F;', '\\u{9089}\\u{E010F}']);
    const [svgDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#glyph-dialog .export-box button:has-text("SVGで保存")'),
    ]);
    assert.equal(svgDownload.suggestedFilename(), 'MJ026190.svg');
    assert.match(await readFile(await svgDownload.path(), 'utf8'), /<path [^>]*d="M[^"]{200,}"/);
    const [pngDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#glyph-dialog .export-box button:has-text("PNGで保存")'),
    ]);
    assert.equal(pngDownload.suggestedFilename(), 'MJ026190.png');
    const png = await readFile(await pngDownload.path());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1024); // 幅（1em あたり 1024px）
    await page.keyboard.press('Escape');
    await page.waitForSelector('#glyph-dialog', { state: 'hidden' });
  });

  await check('比較（重ね合わせ）', async () => {
    await search(page, '邉');
    await page.waitForSelector('.glyph-card');
    const buttons = page.locator('.glyph-card__compare');
    for (let i = 0; i < 2; i++) await buttons.nth(i).click();
    await page.click('#compare-open');
    await page.waitForSelector('#compare-dialog[open] .compare-item');
    await page.check('#compare-overlay');
    assert.equal(await page.$$eval('#compare-stage .compare-item', (e) => e.length), 3);
    await page.click('#compare-dialog [data-close]');
    await page.click('#compare-clear');
  });

  await check('手書きで探す（モジュールのワーカー）', async () => {
    await page.click('#handwriting-open');
    await page.waitForSelector('#handwriting-dialog[open]');
    await page.waitForFunction(() => document.querySelector('#hw-status')?.textContent?.includes('字から探します'), null, { timeout: 60000 });
    const box = await page.locator('#hw-canvas').boundingBox();
    assert.ok(box);
    /** @param {number[][]} points */
    const stroke = async (points) => {
      await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
      await page.mouse.down();
      for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 4 });
      await page.mouse.up();
    };
    await stroke([[0.15, 0.5], [0.5, 0.5], [0.85, 0.5]]); // 十 の横棒
    await stroke([[0.5, 0.12], [0.5, 0.5], [0.5, 0.88]]); // 十 の縦棒
    await page.waitForSelector('#hw-candidates [data-query="十"]', { timeout: 30000 });
    await page.click('#hw-candidates [data-query="十"]');
    await page.waitForSelector('.char-hero__code:text("U+5341")');
  });

  await check('画像から探す', async () => {
    const dataUrl = await page.evaluate(async () => {
      const char = '邉\u{E010F}';
      await document.fonts.load('96px "MJ Variant Mincho"', char);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 160, 160);
      ctx.fillStyle = '#111';
      ctx.font = '96px "MJ Variant Mincho"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(char, 80, 80);
      return canvas.toDataURL('image/png');
    });
    await page.click('#image-open');
    await page.waitForSelector('#image-dialog[open]');
    await page.setInputFiles('#img-file', { name: 'glyph.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
    await page.waitForSelector('#img-candidates .hw-candidate', { timeout: 60000 });
    const first = await page.getAttribute('#img-candidates .hw-candidate', 'title');
    assert.match(first ?? '', /MJ026190/);
    await page.keyboard.press('Escape');
  });

  await check('ダークモード', async () => {
    await page.click('#theme-toggle');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  });

  await check('コンソールエラー・CSP 違反なし', async () => assert.deepEqual(errors, []));
  await context.close();
}

{
  const { page, errors, context } = await newPage({ width: 390, height: 844 });
  await check('スマホ幅で横スクロールなし・ガイドが開ける', async () => {
    await page.goto(BASE + '#q=%E6%B8%A1%E8%BE%BA');
    await page.waitForSelector('.tab');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.goto(BASE + 'guide.html');
    await page.waitForSelector('.guide-section');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  });
  await check('スマホ幅でコンソールエラーなし', async () => assert.deepEqual(errors, []));
  await context.close();
}

await browser.close();
console.log(`${engineName} ${browser.version()}`);
for (const r of results) console.log(r.join(' | '));
if (results.some(([s]) => s === 'FAIL')) process.exitCode = 1;
