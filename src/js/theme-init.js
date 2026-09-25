// 描画前にテーマを確定させてちらつきを防ぐ（CSP で inline script を禁止しても動くよう外部ファイルにしている）。
// 保存値が無ければ OS の設定を使い、必ず data-theme を付ける（CSS は data-theme だけを見る）。
(() => {
  let theme = null;
  try {
    theme = localStorage.getItem('theme');
  } catch {}
  if (theme !== 'dark' && theme !== 'light') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
