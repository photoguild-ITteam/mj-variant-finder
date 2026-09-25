// 使い方ガイド（guide.html）: テーマの切り替えと、目次の今いる節の表示。
// テーマの切り替えはツール本体と同じ ui/theme.js を使う（保存したテーマも共有する）。

import { setupTheme } from './ui/theme.js';

setupTheme();
setupTocSpy();

/** 画面に入っている節に合わせて、目次のリンクに is-active を付ける */
function setupTocSpy() {
  const sections = document.querySelectorAll('.guide-section[id]');
  const links = document.querySelectorAll('.guide-toc a[href^="#"]');
  if (!sections.length || !links.length) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const section of sections) observer.observe(section);
}
