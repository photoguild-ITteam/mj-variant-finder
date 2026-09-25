// 使い方ガイドページ（guide.html）の補助スクリプト
// DOM 操作・テーマ切り替え・目次（TOC）のアクティブ追従

(() => {
  // テーマ切り替え
  const STORAGE_KEY = 'theme';
  const THEME_COLOR = { light: '#f6f3ec', dark: '#0a0f1c' };
  const systemDark = matchMedia('(prefers-color-scheme: dark)');

  const currentTheme = () => document.documentElement.dataset.theme;

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = THEME_COLOR[theme] ?? '#f6f3ec';
    }
  }

  function setupTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      applyTheme(next);
    });
    systemDark.addEventListener('change', (e) => {
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
      if (!saved) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  // 目次のアクティブ追従（IntersectionObserver）
  function setupTocSpy() {
    const sections = document.querySelectorAll('.guide-section[id]');
    const tocLinks = document.querySelectorAll('.guide-toc a[href^="#"]');
    if (!sections.length || !tocLinks.length) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocLinks.forEach((link) => {
            const href = link.getAttribute('href');
            if (href === `#${id}`) {
              link.classList.add('is-active');
            } else {
              link.classList.remove('is-active');
            }
          });
        }
      }
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach((sec) => observer.observe(sec));
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupTheme();
    setupTocSpy();
  });
})();
