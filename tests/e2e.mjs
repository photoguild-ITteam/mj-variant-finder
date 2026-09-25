// ブラウザ E2E テスト。事前に `npm run serve` でリポジトリ直下を配信しておく。
//   npm install && npm run test:e2e
// スクリーンショットは tests/screenshots/ に出力（Git 管理外）。
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8765/';
const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const results = [];
/** 直近のテストで使っているページ（失敗時の後始末用） */
let currentPage = null;
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
    // 開いたままのダイアログが、次のテストの操作を塞がないようにする
    await currentPage?.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
  }
};

// ローカルではインストール済みの Chrome を使う。CI などで Playwright の Chromium を使うときは
// BROWSER_CHANNEL=chromium（channel を指定せず、playwright-core が入れたブラウザを使う）
const channel = process.env.BROWSER_CHANNEL ?? 'chrome';
const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });

const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE);

async function newPage({ viewport = { width: 1360, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const page = await context.newPage();
  currentPage = page;
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { page, errors, context };
}

// --- Webフォント経路（フォント未導入の利用者を想定）
{
  const { page, errors, context } = await newPage();
  // 端末に IPAmj明朝 があっても Webフォント（woff2）を使わせるため、fonts.css の local() を外す
  await context.route('**/src/fonts/fonts.css', async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace(/local\("[^"]+"\),/g, '') });
  });
  const firstFonts = [];
  page.on('request', (req) => { if (req.url().endsWith('.woff2')) firstFonts.push(req.url().split('/').pop()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#q:not([disabled])');

  await check('最初の画面では大きなフォントを読まない', async () => {
    // 最初の画面の字は mjv-preset.woff2 に入れてある。mjv-0020（英数字、50KB）は検索欄の入力用
    const unexpected = firstFonts.filter((name) => !['mjv-preset.woff2', 'mjv-0020.woff2'].includes(name));
    assert.deepEqual(unexpected, []);
    assert.ok(firstFonts.includes('mjv-preset.woff2'), firstFonts.join(','));
  });

  await check('フォント状態が判定される（IVS描き分け可）', async () => {
    await page.waitForFunction(() => document.querySelector('#font-status').dataset.state !== 'checking', null, { timeout: 30000 });
    const s = await page.getAttribute('#font-status', 'data-state');
    assert.ok(['local', 'webfont'].includes(s), s);
  });

  await check('Webフォント(woff2)で IVS が描き分けられる', async () => {
    const ok = await page.evaluate(async () => {
      const { testIvsRendering } = await import('./src/js/font-detector.js');
      return testIvsRendering('MJ Variant Mincho');
    });
    assert.equal(ok, true);
    const loaded = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.woff2')).map((r) => r.name.split('/').pop()));
    assert.ok(loaded.includes('mjv-9000.woff2'), loaded.join(','));
  });
  await page.screenshot({ path: OUT + '01-welcome.png' });

  await check('1. 渡辺 → 渡・辺 のタブと 辺 の関連字（邉・邊）', async () => {
    await page.fill('#q', '渡辺');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.tab');
    assert.deepEqual(await page.$$eval('.tab .glyph', (els) => els.map((e) => e.textContent)), ['渡', '辺']);
    await page.click('.tab:nth-child(2)');
    await page.waitForSelector('.char-hero__code:text("U+8FBA")');
    assert.doesNotMatch(await page.textContent('#results'), /\bnull\b|\[object /);
    const related = await page.$$eval('.related__glyph', (els) => els.map((e) => e.textContent));
    assert.deepEqual(new Set(related.slice(0, 2)), new Set(['邉', '邊']), related.join(''));
    await page.waitForSelector('.related .glyph-card');
  });
  await page.screenshot({ path: OUT + '02-watanabe.png', fullPage: true });

  await check('2. さいとう → 斉藤・斎藤・齊藤・齋藤', async () => {
    await page.fill('#q', 'さいとう');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.name-row');
    // 最初の欄（姓）の、読みが完全一致する行
    const words = await page.locator('.name-suggestions').first().locator('.name-row').first()
      .locator('.chip').allTextContents();
    assert.deepEqual(words, ['斉藤', '斎藤', '西東', '齊藤', '齋藤']);
    // 描画の取りこぼし（配列や null をそのまま DOM に入れた）で文字列が混ざっていないか
    assert.doesNotMatch(await page.textContent('#results'), /\bnull\b|\[object /);
    await page.click('.name-row .chip:text("齋藤")');
    await page.waitForSelector('.tab');
    assert.equal(await page.evaluate(() => decodeURIComponent(location.hash)), '#q=齋藤');
  });
  await page.screenshot({ path: OUT + '03-saito.png' });

  await check('人名・地名の辞書（姓・地名・異体字の置き換え）', async () => {
    await page.fill('#q', 'たかはし');
    await page.press('#q', 'Enter');
    // 前の検索結果と取り違えないよう、この検索でしか出ない候補を待つ
    await page.waitForSelector('.name-row .chip:text("髙橋")');
    const labels = await page.$$eval('.section-label', (els) => els.map((e) => e.textContent));
    assert.ok(labels.includes('姓'), labels.join(' / '));
    const words = await page.$$eval('.name-row .chip', (els) => els.map((e) => e.textContent));
    assert.ok(words.includes('高橋') && words.includes('髙橋'), words.join(' '));

    await page.fill('#q', 'はまざき');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.name-row .chip:text("濱﨑")');
    const sections = await page.$$eval('.section-label', (els) => els.map((e) => e.textContent));
    assert.ok(sections.some((t) => t.includes('異体字に置き換えた表記')), sections.join(' / '));
    await page.click('.name-row .chip:text("濱﨑")');
    await page.waitForSelector('.tab');
    assert.deepEqual(await page.$$eval('.tab .glyph', (els) => els.map((e) => e.textContent)), ['濱', '﨑']);
  });

  await check('3a. MJ026190 → 該当カードがフォーカス', async () => {
    await page.fill('#q', 'MJ026190');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.glyph-card.is-focus');
    assert.equal(await page.textContent('.glyph-card.is-focus .glyph-card__mj'), 'MJ026190');
  });

  await check('ゴシック体の印（○ 実装UCS / × IVSのみ / △ 字が無い）', async () => {
    const badge = (mj) => page.textContent(`.glyph-card[data-mj="${mj}"] .glyph-card__badges .badge:first-child`);
    assert.equal(await badge('MJ026190'), 'ゴシック○');
    assert.equal(await badge('MJ026191'), 'ゴシック×');
    assert.ok(await page.isVisible('.gothic-legend'));
    await page.fill('#q', 'U+20000');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.glyph-card[data-mj="MJ030312"]');
    assert.equal(await badge('MJ030312'), 'ゴシック△');
    await page.fill('#q', 'MJ026190');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.glyph-card.is-focus');
  });

  await check('4. IVS 文字のクリップボードコピー', async () => {
    await page.click('.glyph-card.is-focus .glyph-card__actions .button:first-child');
    await page.waitForSelector('.toast.is-visible');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(text, '邉\u{E010F}');
  });

  await check('字形詳細ダイアログ（コピー形式・縮退マップ）', async () => {
    await page.click('.glyph-card.is-focus .glyph-card__face');
    await page.waitForSelector('#glyph-dialog[open]');
    const values = await page.$$eval('.copy-row__value', (els) => els.map((e) => e.textContent));
    assert.deepEqual(values.slice(1), ['MJ026190', 'U+9089 U+E010F', '&#x9089;&#xE010F;', '\\u{9089}\\u{E010F}']);
    assert.ok((await page.textContent('#glyph-dialog')).includes('445000'));
  });
  await page.screenshot({ path: OUT + '04-glyph-dialog.png' });

  await check('画像でコピー（透明PNGがクリップボードに入る）', async () => {
    await page.click('#glyph-dialog .export-box button:has-text("画像でコピー")');
    await page.waitForSelector('.toast.is-visible:has-text("画像をコピーしました")');
    const info = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType('image/png');
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let ink = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) ink++;
      return { types: item.types, w: bmp.width, h: bmp.height, corner: data[3], ink };
    });
    assert.deepEqual(info.types, ['image/png']);
    assert.equal(info.w, 1024);
    assert.equal(info.corner, 0, '背景が透明でない');
    assert.ok(info.ink > 50000, `ink ${info.ink}`);
  });

  await check('SVGで保存（MJ026190.svg、アウトライン）', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#glyph-dialog .export-box button:has-text("SVGで保存")'),
    ]);
    assert.equal(download.suggestedFilename(), 'MJ026190.svg');
    const svg = await readFile(await download.path(), 'utf8');
    assert.match(svg, /<svg [^>]*viewBox="0 0 2048 2048"/);
    assert.match(svg, /<path [^>]*d="M[^"]{200,}"/);
    await page.click('#glyph-dialog .export-box button:has-text("PNGで保存")');
  });
  await page.keyboard.press('Escape');

  await check('SVG/PNG は IVS ごとに別の字形（辺 VS18 と VS19）', async () => {
    const result = await page.evaluate(async () => {
      const ex = await import('./src/js/glyph-export.js');
      const a = { mj: 'MJ025758', char: '辺\u{E0101}' };
      const b = { mj: 'MJ025759', char: '辺\u{E0102}' };
      const pathOf = (svg) => svg.match(/ d="([^"]+)"/)[1];
      const [sa, sb] = [pathOf(await ex.buildSvg(a)), pathOf(await ex.buildSvg(b))];
      const size = async (g) => (await ex.renderPng(g)).size;
      return { svgDiffer: sa !== sb, subpathsA: sa.split('Z').length, subpathsB: sb.split('Z').length, pngA: await size(a), pngB: await size(b) };
    });
    assert.ok(result.svgDiffer);
    assert.equal(result.subpathsB - result.subpathsA, 1, JSON.stringify(result)); // 点が1つ多い（輪郭 3 → 4）
    assert.notEqual(result.pngA, result.pngB);
  });

  await check('3b. U+8FBB / 9089_E010F / U+E0100 単体', async () => {
    await page.fill('#q', 'U+8FBB');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.char-hero__code:text("U+8FBB")');
    await page.fill('#q', '9089_E010F');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.glyph-card.is-focus .glyph-card__mj:text("MJ026190")');
    await page.fill('#q', 'U+E0100');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.notice--warn:has-text("VS17")');
  });

  await check('手書きで探す（十を書く → 候補 → その字で検索）', async () => {
    await page.click('#handwriting-open');
    await page.waitForSelector('#handwriting-dialog[open]');
    await page.waitForFunction(() => document.querySelector('#hw-status')?.textContent.includes('字から探します'), null, { timeout: 60000 });
    const box = await page.locator('#hw-canvas').boundingBox();
    const stroke = async (points) => {
      await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
      await page.mouse.down();
      for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 4 });
      await page.mouse.up();
    };
    await stroke([[0.15, 0.5], [0.5, 0.5], [0.85, 0.5]]);   // 十 の横棒
    await stroke([[0.5, 0.12], [0.5, 0.5], [0.5, 0.88]]);   // 十 の縦棒
    await page.waitForSelector('#hw-candidates .hw-candidate', { timeout: 30000 });
    const candidates = await page.$$eval('#hw-candidates .glyph', (els) => els.map((e) => e.textContent));
    assert.ok(candidates.includes('十'), candidates.join(''));
    await page.screenshot({ path: OUT + '10-handwriting.png' });
    await page.click('#hw-candidates [data-query="十"]');
    await page.waitForSelector('#handwriting-dialog', { state: 'hidden' }); // 閉じたダイアログは非表示扱い
    await page.waitForSelector('.char-hero__code:text("U+5341")');
    assert.equal(await page.evaluate(() => decodeURIComponent(location.hash)), '#q=十');
  });

  await check('画像から探す（字形を描いた画像 → MJ字形を特定）', async () => {
    // 本番同等の確認: 実フォントで邉(MJ026190)を描いた PNG を読み込ませる
    const dataUrl = await page.evaluate(async () => {
      const char = '邉\u{E010F}';
      await document.fonts.load('96px "MJ Variant Mincho"', char);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext('2d');
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
    await page.setInputFiles('#img-file', {
      name: 'glyph.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
    });
    await page.waitForSelector('#img-candidates .hw-candidate', { timeout: 60000 });
    const candidates = await page.$$eval('#img-candidates .hw-candidate', (els) => els.map((e) => e.title));
    assert.match(candidates[0], /MJ026190/, candidates.join(' / '));
    await page.screenshot({ path: OUT + '11-image-search.png' });
    await page.click('#img-candidates .hw-candidate');
    await page.waitForSelector('#image-dialog', { state: 'hidden' });
    await page.waitForSelector('.glyph-card.is-focus .glyph-card__mj:text("MJ026190")');
  });

  await check('5. 比較ビュー（重ね合わせ含む）', async () => {
    await page.fill('#q', '邉');
    await page.press('#q', 'Enter');
    // 前の検索結果のカードをつかまないよう、目的の字が出てから操作する
    await page.waitForSelector('.char-hero__code:text("U+9089")');
    await page.waitForSelector('.glyph-card');
    for (let i = 0; i < 4; i++) await page.locator('.glyph-card .glyph-card__compare').nth(i).click();
    assert.equal(await page.textContent('#compare-count'), '4');
    await page.click('#compare-open');
    await page.waitForSelector('#compare-dialog[open] .compare-item');
    assert.equal(await page.$$eval('#compare-stage .compare-item', (e) => e.length), 4);
    await page.check('#compare-overlay');
    assert.equal(await page.$$eval('#compare-stage .compare-item', (e) => e.length), 5);
  });
  await page.screenshot({ path: OUT + '05-compare.png' });
  await page.keyboard.press('Escape');

  await check('部首・画数フィルター（辶 17画 IVSあり）', async () => {
    await page.fill('#q', '');
    await page.press('#q', 'Enter');
    await page.click('#filters summary');
    await page.selectOption('#f-radical', '162');
    await page.fill('#f-strokes-min', '17');
    await page.fill('#f-strokes-max', '17');
    await page.check('#f-ivs');
    await page.waitForSelector('.candidate[data-query="邉"]');
  });
  await page.screenshot({ path: OUT + '06-filter.png' });

  await check('検索窓の幅とライセンスのモーダル', async () => {
    // 手書き・画像のボタンは検索窓の外に出したので、入力欄がつぶれない
    const input = await page.locator('#q').boundingBox();
    assert.ok(input.width > 150, `入力欄 ${Math.round(input.width)}px`);
    assert.equal(await page.locator('.search-box #handwriting-open').count(), 0);

    // ヘッダーの構造: リンクの中にリンクを入れない（入れるとブラウザが構造を組み替える）。
    // ロゴは背景と違う色の文字で表示される（リンクの色の継承で見えなくならない）
    assert.equal(await page.locator('a a').count(), 0);
    assert.equal(await page.locator('.brand .brand__company a[href="https://photoguild.jp/"]').count(), 1);
    // 文字色と背景色が「違う」だけでは足りない（ほぼ同じ濃色でも通ってしまう）ので、コントラスト比で確かめる
    const contrast = await page.locator('.brand__mark').evaluate((e) => {
      const luminance = (rgb) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const style = getComputedStyle(e);
      const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });
    assert.ok(contrast >= 4.5, `ロゴのコントラスト比が低い（見えにくい）: ${contrast.toFixed(2)}`);
    // 広い画面ではヘッダーに開発元を表示する（狭い画面では省く。ライセンスのモーダルには常にある）
    assert.match(await page.textContent('.site-header .brand__company'), /株式会社フォトギルド/);
    // ライセンスへのリンクはヘッダーにある（フッターには置かない）
    assert.equal(await page.locator('.site-header #license-open').count(), 1);
    assert.equal(await page.locator('.site-footer #license-open').count(), 0);
    await page.click('#license-open');
    await page.waitForSelector('#license-dialog[open]');
    const headings = await page.$$eval('#license-dialog h3', (els) => els.map((e) => e.textContent));
    assert.deepEqual(headings, ['ライセンスの構成', '文字のデータ', 'フォント', '手書き認識', '画像から探す', '人名・地名の読み', '開発', 'ソフトウェア']);
    const text = await page.textContent('#license-dialog');
    assert.match(text, /CC BY-SA 2\.1 JP/);
    assert.match(text, /CC BY-SA 3\.0/);
    assert.match(text, /Developed by 株式会社フォトギルド/);                                  // KanjiVG 由来は別のライセンス
    assert.match(text, /字形の同一性・正確性を保証するものではありません/); // 免責事項
    await page.click('#license-dialog [data-close]');
    await page.waitForSelector('#license-dialog', { state: 'hidden' });
  });

  await check('6. ダークモード切り替え', async () => {
    await page.click('#theme-toggle');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(10, 15, 28)');
    await page.fill('#q', '辺');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.glyph-card');
  });
  await page.screenshot({ path: OUT + '07-dark.png' });

  await check('コンソールエラーなし', async () => assert.deepEqual(errors, []));
  await context.close();
}

// --- ログイン切れの案内（任意機能）。既定では何も出さず、config.sessionWatch を設定したときだけ動く
if (isLocal) {
  const stubUnauthorized = (context) => context.route(/\/src\/data\/(chars\/.*|meta)\.json/, (route) => route.fulfill({ status: 401, body: '' }));

  {
    // 既定: sessionWatch 無効。401 でも「ログイン」ではなく通常の読み込み失敗として扱う
    const { page, context } = await newPage();
    await page.goto(BASE);
    await page.waitForSelector('#q:not([disabled])');
    await check('既定ではログイン切れの案内を出さない（sessionWatch 無効）', async () => {
      assert.equal(await page.locator('.session-banner').count(), 0);
      await stubUnauthorized(context);
      await page.fill('#q', '齋');
      await page.press('#q', 'Enter');
      await page.waitForSelector('.notice--error');
      assert.equal(await page.locator('.session-banner').count(), 0);
    });
    await context.close();
  }

  {
    // sessionWatch を有効にした場合（config.js を差し替えて再現）
    const { page, context } = await newPage();
    await context.route('**/src/js/config.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: "export const config = { sessionWatch: { message: 'ログインが切れました。', loginUrl: '/login/', loginLabel: 'ログイン' } };",
    }));
    await page.goto(BASE);
    await page.waitForSelector('#q:not([disabled])');
    await check('sessionWatch を有効にするとバナーを表示（データ取得・タブ復帰）', async () => {
      assert.equal(await page.isHidden('.session-banner'), true);
      await stubUnauthorized(context);
      await page.fill('#q', '齋');
      await page.press('#q', 'Enter');
      await page.waitForSelector('.session-banner:not([hidden])');
      await page.waitForSelector('.notice--error:has-text("ログインが必要です")');
      // ログインし直した想定: 401 をやめてタブ復帰 → バナーが消える
      await context.unroute(/\/src\/data\/(chars\/.*|meta)\.json/);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
      await page.waitForSelector('.session-banner', { state: 'hidden' });
    });
    await context.close();
  }
}

// --- 端末フォントあり（この PC）
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await check('フォント状態を判定（端末に IPAmj明朝 があれば local、無ければ webfont）', async () => {
    await page.waitForFunction(() => document.querySelector('#font-status').dataset.state !== 'checking', null, { timeout: 30000 });
    // 端末に入っているかは環境による。CI では入っていないので webfont、入っている PC では local
    const state = await page.getAttribute('#font-status', 'data-state');
    assert.ok(['local', 'webfont'].includes(state), state);
  });
  await context.close();
}

// --- 字形の一覧の使いやすさ（違いを色で表示・絞り込み・見つからないとき・比較トレイ）
{
  const { page, errors, context } = await newPage();
  await page.goto(BASE + '#q=' + encodeURIComponent('邉'));
  await page.waitForSelector('.glyph-card');
  const main = page.locator('.char-panel .panel-section').first();

  await check('違いを色で表示（通常の字形と同じ字形には印）', async () => {
    await main.locator('.diff-toggle').click();
    await page.waitForFunction(() => document.querySelectorAll('.char-panel .panel-section:first-of-type .glyph-card__face.is-diff canvas').length >= 10);
    // 邉（U+9089）を IVS なしで表示すると MJ026190 の字形になる
    await page.waitForSelector('.glyph-card[data-mj="MJ026190"] .glyph-card__face.is-default-glyph');
    assert.equal(await page.locator('.glyph-card[data-mj="MJ026191"] .glyph-card__face.is-default-glyph').count(), 0);
    // 設定は次の検索にも引き継ぐ。切ると元の表示に戻る
    await page.fill('#q', '辺');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.char-hero__code:text("U+8FBA")');
    await page.waitForSelector('.glyph-card__face.is-diff canvas, .glyph-card__face.is-default-glyph');
    await page.locator('.diff-toggle').first().click();
    assert.equal(await page.locator('.glyph-card__face canvas').count(), 0);
    assert.equal(await page.locator('.glyph-card__face.is-diff').count(), 0);
  });

  await check('字形の絞り込み（戸籍）', async () => {
    await page.fill('#q', '邉');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.char-hero__code:text("U+9089")');
    const chip = main.locator('.glyph-tools__filters .chip', { hasText: '戸籍' });
    const expected = Number(await chip.locator('.chip__count').textContent());
    await chip.click();
    assert.equal(await main.locator('.glyph-card:not(.is-filtered-out)').count(), expected);
    assert.match(await main.locator('.glyph-tools__status').textContent(), new RegExp(`16 字形中 ${expected} 字形`));
    await chip.click();
    assert.equal(await main.locator('.glyph-card.is-filtered-out').count(), 0);
  });

  await check('見つからないときは、ほかの探し方を示す', async () => {
    await page.fill('#q', 'xyz');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.not-found-help');
    await page.click('.not-found-help button:has-text("手書きで探す")');
    await page.waitForSelector('#handwriting-dialog[open]');
    await page.keyboard.press('Escape');
  });

  await check('比較トレイがフッターの文字を隠さない', async () => {
    await page.fill('#q', '邉');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.glyph-card .glyph-card__compare');
    await page.locator('.glyph-card .glyph-card__compare').first().click();
    await page.waitForSelector('#compare-tray:not([hidden])');
    // フッターの余白は次の描画で付くので、付いてから最下部へ
    await page.waitForFunction(() => parseFloat(document.body.style.getPropertyValue('--tray-space')) > 0);
    // フォントの読み込みや、画面に入ってから描くカードで高さが変わるので、高さが落ち着くまで最下部へ送る
    await page.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        const height = document.documentElement.scrollHeight;
        window.scrollTo(0, height);
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (document.documentElement.scrollHeight === height && Math.ceil(window.scrollY + innerHeight) >= height) break;
      }
    });
    const [textBottom, trayTop] = await page.evaluate(() => [
      document.querySelector('#data-meta').getBoundingClientRect().bottom,
      document.querySelector('#compare-tray').getBoundingClientRect().top,
    ]);
    assert.ok(textBottom <= trayTop, `フッター ${textBottom} > トレイ ${trayTop}`);
    await page.click('#compare-clear');
  });

  await check('一覧の操作でエラーが出ない', async () => assert.deepEqual(errors, []));
  await context.close();
}

// --- OSS としての表示（ソースへのリンク・非公式の明記・共有用の画像）
{
  const { page, context } = await newPage();
  await page.goto(BASE);
  await page.waitForSelector('#q:not([disabled])');
  await check('ソースへのリンク・非公式の明記・共有用の画像', async () => {
    const repo = 'https://github.com/photoguild-ITteam/mj-variant-finder';
    assert.equal(await page.getAttribute('.site-header #source-link', 'href'), repo);
    assert.equal(await page.locator(`.site-footer a[href="${repo}"]`).count(), 1);
    // 提供元の公式ツールと誤解されないよう、フッターとモーダルの両方に書く
    assert.match(await page.textContent('.site-footer'), /無関係の非公式のツール/);
    assert.match(await page.textContent('#license-dialog'), /無関係の非公式のツール/);
    assert.match(await page.textContent('.site-footer'), /MJ Variant Finder/);
    // 検索欄の例が途中で切れない
    const clipped = await page.locator('#q').evaluate((input) => {
      const ctx = document.createElement('canvas').getContext('2d');
      const style = getComputedStyle(input, '::placeholder');
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      const padding = parseFloat(getComputedStyle(input).paddingLeft) + parseFloat(getComputedStyle(input).paddingRight);
      return ctx.measureText(input.placeholder).width > input.clientWidth - padding;
    });
    assert.equal(clipped, false, '検索欄の例が切れている');
    // 共有用の画像（og:image）は公開先の絶対URL。同じ画像がリポジトリにある
    const image = await page.getAttribute('meta[property="og:image"]', 'content');
    assert.match(image, /^https:\/\/.+\/src\/images\/og\.png$/);
    assert.equal(await page.getAttribute('meta[name="twitter:card"]', 'content'), 'summary_large_image');
    assert.equal((await page.request.get(BASE + 'src/images/og.png')).status(), 200);
  });
  await context.close();
}

// --- スマホ幅
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(BASE + '#q=' + encodeURIComponent('渡邉'));
  await page.waitForSelector('.glyph-card');
  await check('スマホ幅で横スクロールなし', async () => {
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= iw, `${sw} > ${iw}`);
  });
  await check('スマホ幅では検索中「よく検索される異体字」を畳む', async () => {
    assert.equal(await page.locator('#quick-access-box[open]').count(), 0);
  });
  await check('スマホ幅で検索すると結果までスクロールする', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.fill('#q', '斎藤');
    await page.press('#q', 'Enter');
    await page.waitForSelector('.result-header h2:has-text("斎藤")');
    await page.waitForFunction(() => Math.abs(document.querySelector('#results').getBoundingClientRect().top) < 80, null, { timeout: 5000 });
  });
  await page.goto(BASE + '#q=' + encodeURIComponent('渡邉'));
  await page.waitForSelector('.result-header h2:has-text("渡邉")');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUT + '08-mobile.png' });
  await page.evaluate(() => document.querySelector('#results').scrollIntoView());
  await page.screenshot({ path: OUT + '09-mobile-results.png' });
  await context.close();
}

await browser.close();
for (const r of results) console.log(r.join(' | '));
process.exitCode = results.some((r) => r[0] === 'FAIL') ? 1 : 0;
