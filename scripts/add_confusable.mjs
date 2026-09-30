#!/usr/bin/env node
// 混同しやすい字・異構字辞書（src/js/confusables.js）へのグループ追加スクリプト
// 使用例:
//   # 異構字グループの追加
//   node scripts/add_confusable.mjs --type variant --name "さき" --chars "崎,﨑,嵜,㟢,碕" --desc "「崎」の異構字。"
//   # 類似字・誤認注意グループの追加
//   node scripts/add_confusable.mjs --type confusable --name "奇と㟢" --chars "奇,㟢" --desc "山冠の有無による誤認。" --notes "奇:大＋可（8画）,㟢:山冠＋奇（11画）"
//   node scripts/add_confusable.mjs ... --dry-run

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VariantDB } from '../src/js/db.js';

const HELP = `
使用方法:
  node scripts/add_confusable.mjs --type <variant|confusable> --name <識別名> --chars <文字,...> --desc <説明> [--notes <文字:メモ,...>] [--dry-run]

オプション:
  --type, -t     グループ種別: 'variant'（異構字・代表的異体字）または 'confusable'（類似字・誤認頻出字）
  --name, -n     グループの識別名（例: "さき"、"カキとコケラ"）
  --chars, -c    相互リンクする文字のリスト（カンマ区切り、例: "崎,﨑,嵜,㟢,碕"）
  --desc, -d     グループ全体の説明
  --notes        各文字ごとの見分け方メモ（カンマ区切りの "文字:メモ" 形式）
                 例: "奇:大＋可（8画）。,㟢:山冠＋奇（11画）。"
  --dry-run      ファイルを更新せず、検証結果と生成コードのみ表示
  --help, -h     このヘルプを表示
`;

const CONFUSABLES_PATH = fileURLToPath(new URL('../src/js/confusables.js', import.meta.url));
const DATA_DIR = new URL('../src/data/', import.meta.url);

async function main() {
  const { values } = parseArgs({
    options: {
      type: { type: 'string', short: 't' },
      name: { type: 'string', short: 'n' },
      chars: { type: 'string', short: 'c' },
      desc: { type: 'string', short: 'd' },
      notes: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values.type || !values.name || !values.chars) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  // 1. 引数バリデーション
  if (!['variant', 'confusable'].includes(values.type)) {
    console.error(`エラー: --type (-t) は 'variant' または 'confusable' を指定してください（入力: ${values.type}）。`);
    process.exit(1);
  }

  const chars = values.chars.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean);
  if (chars.length < 2) {
    console.error('エラー: --chars (-c) には2文字以上の文字をカンマ区切りで指定してください。');
    process.exit(1);
  }

  const desc = values.desc || `「${chars.join('・')}」の${values.type === 'variant' ? '異構字' : '類似字'}グループ。`;

  // notes のパース
  const notesMap = {};
  if (values.notes) {
    const pairs = values.notes.split(/(?<=[^\\]),/);
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx !== -1) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k && v) notesMap[k] = v;
      }
    }
  }

  // 2. DB を読み込んで文字の実在確認
  const db = await VariantDB.load(DATA_DIR, async (url) => JSON.parse(await readFile(url, 'utf8')));
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const key = db.resolve(cp);
    if (!key) {
      console.error(`エラー: 文字「${ch}」(U+${cp.toString(16).toUpperCase()}) は MJ データベースに存在しません。`);
      process.exit(1);
    }
  }

  // 3. confusables.js の読み込みと既存チェック
  const fileContent = await readFile(CONFUSABLES_PATH, 'utf8');
  const fileUrl = pathToFileURL(CONFUSABLES_PATH).href + '?t=' + Date.now();
  const { CONFUSABLE_GROUPS } = await import(fileUrl);

  const existingGroup = CONFUSABLE_GROUPS.find((g) => g.name === values.name && g.type === values.type);
  if (existingGroup) {
    console.log(`グループ「${values.name}」(${values.type}) は既に存在します。既存の文字: [${existingGroup.chars.join(', ')}]`);
    const newChars = chars.filter((c) => !existingGroup.chars.includes(c));
    if (newChars.length === 0) {
      console.log('指定された文字はすべて既にグループに含まれています。変更はありません。');
      return;
    }
    console.log(`以下の新しい文字を追加します: [${newChars.join(', ')}]`);
  }

  // 4. コード生成
  const notesLines = chars.map((ch) => {
    const noteText = notesMap[ch] || (existingGroup?.notes?.[ch] ?? `${ch}の解説。`);
    return `      '${ch}': '${noteText.replace(/'/g, "\\'")}',`;
  }).join('\n');

  const groupCode = `  {
    type: '${values.type}',
    name: '${values.name.replace(/'/g, "\\'")}',
    chars: [${chars.map((c) => `'${c}'`).join(', ')}],
    desc: '${desc.replace(/'/g, "\\'")}',
    notes: {
${notesLines}
    },
  },`;

  console.log('\n生成されるグループコード:');
  console.log(groupCode);

  if (values['dry-run']) {
    console.log('\n[DRY RUN] ファイルは更新されませんでした。');
    return;
  }

  // 5. ファイル更新
  let updatedContent = fileContent;
  if (existingGroup) {
    // 既存グループの置換
    // 正規表現で該当グループのブロックを検索
    const escapedName = values.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`  {\\s*type:\\s*'${values.type}',\\s*name:\\s*'${escapedName}',[\\s\\S]*?},\\n`, 'm');
    if (regex.test(fileContent)) {
      updatedContent = fileContent.replace(regex, groupCode + '\n');
    } else {
      console.error('エラー: 既存グループのコード位置を特定できませんでした。手動で確認してください。');
      process.exit(1);
    }
  } else {
    // 新規グループの挿入
    // variant の場合は 1. 異構字セクションの末尾、confusable の場合は 2. 類似字セクションの末尾
    if (values.type === 'variant') {
      const marker = '// 2. 類似字・誤認頻出字グループ';
      const idx = fileContent.indexOf(marker);
      if (idx !== -1) {
        updatedContent = fileContent.slice(0, idx) + groupCode + '\n\n  ' + fileContent.slice(idx);
      } else {
        const endMarker = '];\n\n// 高速ルックアップ用のインデックスマップ';
        updatedContent = fileContent.replace(endMarker, groupCode + '\n' + endMarker);
      }
    } else {
      const endMarker = '];\n\n// 高速ルックアップ用のインデックスマップ';
      const idx = fileContent.indexOf(endMarker);
      if (idx !== -1) {
        updatedContent = fileContent.slice(0, idx) + groupCode + '\n' + fileContent.slice(idx);
      } else {
        console.error('エラー: CONFUSABLE_GROUPS の末尾位置を特定できませんでした。');
        process.exit(1);
      }
    }
  }

  await writeFile(CONFUSABLES_PATH, updatedContent, 'utf8');
  console.log(`\n✔ ${CONFUSABLES_PATH} を更新しました。`);
}

main().catch((err) => {
  console.error('実行時エラー:', err);
  process.exit(1);
});
