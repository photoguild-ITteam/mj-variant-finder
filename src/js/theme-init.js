// 描画前にテーマを確定させてちらつきを防ぐ（CSP で inline script を禁止しても動くよう外部ファイルにしている）。
// 保存値が無ければ OS の設定を使い、必ず data-theme を付ける（CSS は data-theme だけを見る）。
// あわせて、app.js（module）が動かない環境での案内も出す（module が読めないと app.js 側では何もできないため）。
(() => {
  /** @type {string | null} */
  let theme = null;
  try {
    // キーは mjv_theme（src/js/storage.js）。0.6 までの theme から1回だけ写す（古いキーは消さない）。
    // このファイルは通常のスクリプトで storage.js を import できないので、同じ処理をここに書いている
    theme = localStorage.getItem('mjv_theme');
    const legacy = localStorage.getItem('theme');
    if (theme === null && (legacy === 'dark' || legacy === 'light')) {
      theme = legacy;
      localStorage.setItem('mjv_theme', legacy);
    }
  } catch {}
  if (theme !== 'dark' && theme !== 'light') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();


// file:// では多くのブラウザが module を読み込まず、古いブラウザは app.js の構文を解釈できない。
// どちらも「読み込んでいます…」のまま止まるので、ここ（通常のスクリプト）で案内する
const APP_START_TIMEOUT_MS = 15000;

/**
 * @param {string} title
 * @param {string} text
 */
function showStartupNotice(title, text) {
  const results = document.getElementById('results');
  if (!results) return;
  const notice = document.createElement('div');
  notice.className = 'notice notice--error';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  notice.append(strong, p);
  results.replaceChildren(notice);
}

document.addEventListener('DOMContentLoaded', () => {
  if (location.protocol === 'file:') {
    showStartupNotice('このままでは動きません', 'ファイルを直接開くと動きません。HTTP サーバー経由で開いてください（例: npm run serve または python -m http.server）。');
    return;
  }
  // app.js は実行を始めた時点で data-app を付ける（データの読み込みが遅いだけなら案内しない）
  setTimeout(() => {
    if (document.documentElement.dataset.app !== 'started') {
      showStartupNotice('起動できませんでした', 'このブラウザでは動かない可能性があります。最新の Chrome・Edge・Safari・Firefox で開いてください。');
    }
  }, APP_START_TIMEOUT_MS);
});
