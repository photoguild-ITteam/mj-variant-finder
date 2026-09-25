// 外部ライブラリをブラウザ向け ESM 1ファイルにまとめ、同梱した依存パッケージのライセンス本文を
// src/vendor/THIRD_PARTY_LICENSES.txt に集める（npm run build:vendor）。
//   - fontkit: SVG 書き出しでフォントから輪郭を取り出す（npm から取得）
//   - kanji-canvas: 手書き認識の照合（src/vendor/kanji-canvas.js を無改変で同梱し、ワーカー用に ESM 化）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// パッケージに LICENSE ファイルが無い場合（fontkit など）に使う MIT License 本文
const MIT_TEXT = `MIT License

Copyright (c) <COPYRIGHT HOLDER>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const bundle = (entry, outfile) => build({
  entryPoints: [join(root, entry)],
  outfile: join(root, outfile),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

const result = await bundle('scripts/vendor/fontkit-entry.mjs', 'src/vendor/fontkit.js');
await bundle('scripts/vendor/kanji-canvas-entry.mjs', 'src/vendor/kanji-canvas.bundle.js');

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const at = input.lastIndexOf('node_modules/');
  if (at === -1) continue;
  const segs = input.slice(at + 'node_modules/'.length).split('/');
  const name = segs[0].startsWith('@') ? `${segs[0]}/${segs[1]}` : segs[0];
  packages.set(name, join(root, input.slice(0, at + 'node_modules/'.length) + name));
}

const sections = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? name;
  const text = licenseFile
    ? readFileSync(join(dir, licenseFile), 'utf8').trim()
    : pkg.license === 'MIT'
      ? MIT_TEXT.replace('<COPYRIGHT HOLDER>', author)
      : `${pkg.license} License. Copyright (c) ${author}`;
  return `${'='.repeat(72)}\n${name}@${pkg.version} — ${pkg.license}\n${pkg.homepage ?? pkg.repository?.url ?? ''}\n${'='.repeat(72)}\n\n${text}\n`;
});

writeFileSync(
  join(root, 'src/vendor/THIRD_PARTY_LICENSES.txt'),
  `src/vendor/fontkit.js に同梱しているパッケージのライセンス\n\n${sections.join('\n')}`,
);
console.log(`bundled ${packages.size} packages: ${[...packages.keys()].join(', ')}`);
