// node --test tests/
// 公開するサイトの中身を確かめる。
// e2e はリポジトリ全体を配信して確かめるので、GitHub Pages に載せ忘れたページ（リンク切れになる）を見つけられない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const deploy = readFileSync(new URL('.github/workflows/deploy-pages.yml', ROOT), 'utf8');
const pages = readdirSync(ROOT).filter((name) => name.endsWith('.html'));

test('リポジトリ直下の HTML はすべて GitHub Pages に載せる', () => {
  assert.ok(pages.includes('index.html'));
  const copiesAll = /cp \.\/\*\.html _site\//.test(deploy);
  for (const page of pages) {
    assert.ok(copiesAll || deploy.includes(`cp ${page} `), `${page} が deploy-pages.yml で _site にコピーされていない`);
  }
});

test('ページ同士のリンク先（.html）が存在する', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(page, ROOT), 'utf8');
    for (const [, href] of html.matchAll(/href="([^"#:?]+\.html)(?:#[^"]*)?"/g)) {
      assert.ok(pages.includes(href), `${page} → ${href} が無い`);
    }
  }
});
