// 公開前に、プレースホルダー（YOUR-ORG / YOUR-COMPANY など）を実際の値に置き換える。
//
//   node scripts/set-identity.mjs --org my-org --company "株式会社Example" --site https://example.co.jp \
//        --security-mail security@example.co.jp [--year 2026]
//
// 置き換え対象: LICENSE、README.md、SECURITY.md、package.json、LICENSES.md、.github/ISSUE_TEMPLATE/config.yml
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));
const required = ['org', 'company', 'site', 'security-mail'];
const missing = required.filter((key) => !args[key]);
if (missing.length) {
  console.error(`必要な指定: ${required.map((k) => `--${k}`).join(' ')}\n足りない: ${missing.map((k) => `--${k}`).join(' ')}`);
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['LICENSE', 'README.md', 'SECURITY.md', 'package.json', 'LICENSES.md', '.github/ISSUE_TEMPLATE/config.yml'];
const replacements = [
  [/security@YOUR-COMPANY\.example/g, args['security-mail']],
  [/https:\/\/YOUR-COMPANY\.example/g, args.site.replace(/\/$/, '')],
  [/YOUR-ORG/g, args.org],
  [/YOUR-COMPANY/g, args.company],
];
if (args.year) replacements.push([/Copyright \(c\) \d{4}/, `Copyright (c) ${args.year}`]);

for (const file of files) {
  let text = readFileSync(root + file, 'utf8');
  for (const [pattern, value] of replacements) text = text.replace(pattern, value);
  writeFileSync(root + file, text);
}
// 置き換えの案内文（公開前に消す）
const licenses = readFileSync(`${root}LICENSES.md`, 'utf8').replace(/\n- 著作権者名（`LICENSE` の `.*?`）は、公開前に置き換えてください。\n/, '\n');
writeFileSync(`${root}LICENSES.md`, licenses);
console.log('置き換えました。git diff で確認してください。');
