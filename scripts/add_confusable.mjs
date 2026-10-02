#!/usr/bin/env node
// 混同しやすい字・異構字辞書（src/js/confusables.js）へのグループ追加スクリプト
// 使用例:
//   # 異構字グループの追加
//   node scripts/add_confusable.mjs --type variant --name "さき" --chars "崎,﨑,嵜,㟢,碕" --desc "「崎」の異構字。"
//   # 類似字・誤認注意グループの追加
//   node scripts/add_confusable.mjs --type confusable --name "奇と㟢" --chars "奇,㟢" --desc "山冠の有無による誤認。" --notes "奇:大＋可（8画）,㟢:山冠＋奇（11画）"
//   # 既存グループへの文字の追加（同じ --type と --name を指定する。既存の文字・説明・メモは残す）
//   node scripts/add_confusable.mjs --type variant --name "さき" --chars "埼" --notes "埼:埼玉の埼。"
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
                 既存のグループに指定したときは、足りない文字だけを末尾に追加する（1文字でもよい）
  --desc, -d     グループ全体の説明（既存のグループでは、指定したときだけ置き換える）
  --notes        各文字ごとの見分け方メモ（カンマ区切りの "文字:メモ" 形式）
                 例: "奇:大＋可（8画）。,㟢:山冠＋奇（11画）。"
  --file         書き換えるファイル（既定: src/js/confusables.js。テスト用）
  --dry-run      ファイルを更新せず、検証結果と生成コードのみ表示
  --help, -h     このヘルプを表示
`;

const CONFUSABLES_PATH = fileURLToPath(new URL('../src/js/confusables.js', import.meta.url));
const DATA_DIR = new URL('../src/data/', import.meta.url);

/** 「2. 類似字」の見出し。異構字グループはこの前（1. の末尾）に足す */
const SECTION2 = `  // ${'='.repeat(74)}\n  // 2. 類似字・誤認頻出字グループ`;
/** CONFUSABLE_GROUPS の終わり。類似字グループはこの前に足す */
const GROUPS_END = '];\n\n// 高速ルックアップ用のインデックスマップ';

/** U+2028・U+2029（文字列リテラルの中に生で書けない） */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/** JS の単一引用符の文字列リテラルにする */
export const quote = (s) => `'${String(s)
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/\r/g, '\\r')
  .replace(/\n/g, '\\n')
  .replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`)}'`;

/** グループ1つ分のコード（2スペース字下げ、末尾は "  },"） */
export function buildGroupCode({ type, name, chars, desc, notes }) {
  const notesLines = chars.map((ch) => `      ${quote(ch)}: ${quote(notes[ch])},`).join('\n');
  return `  {
    type: ${quote(type)},
    name: ${quote(name)},
    chars: [${chars.map(quote).join(', ')}],
    desc: ${quote(desc)},
    notes: {
${notesLines}
    },
  },`;
}

/**
 * 引数と既存のグループから、書き込むグループを作る.
 * 既存のグループでは、文字は既存の順のまま足りないものを末尾に足し、説明・メモは指定したものだけを置き換える。
 * @returns {{group: object, added: string[]}} added は新しく入る文字（既存のグループで空なら変更なし）
 */
export function mergeGroup(existing, { type, name, chars, desc, notes }) {
  const defaultNote = (ch) => `${ch}の解説。`;
  if (!existing) {
    return {
      group: {
        type,
        name,
        chars,
        desc: desc || `「${chars.join('・')}」の${type === 'variant' ? '異構字' : '類似字'}グループ。`,
        notes: Object.fromEntries(chars.map((ch) => [ch, notes[ch] || defaultNote(ch)])),
      },
      added: chars,
    };
  }
  const added = chars.filter((ch) => !existing.chars.includes(ch));
  const allChars = [...existing.chars, ...added];
  return {
    group: {
      type,
      name,
      chars: allChars,
      desc: desc || existing.desc,
      notes: Object.fromEntries(allChars.map((ch) => [ch, notes[ch] || existing.notes?.[ch] || defaultNote(ch)])),
    },
    added,
  };
}

/**
 * confusables.js のソースにグループを書き込む（既存なら置き換え、無ければ種別ごとのセクションの末尾に足す）.
 * 位置が分からないときは例外を投げる（壊れたファイルを書かない）。
 */
export function applyGroup(source, group, { exists }) {
  const code = buildGroupCode(group);
  if (exists) {
    const head = `  {\n    type: ${quote(group.type)},\n    name: ${quote(group.name)},\n`;
    const start = source.indexOf(head);
    // グループの閉じ括弧は2スペース字下げ（notes の閉じ括弧は4スペースなので一致しない）
    const end = start === -1 ? -1 : source.indexOf('\n  },\n', start);
    if (start === -1 || end === -1 || source.indexOf(head, start + 1) !== -1) {
      throw new Error(`既存グループ「${group.name}」(${group.type}) のコード位置を特定できませんでした。手動で確認してください。`);
    }
    return source.slice(0, start) + code + source.slice(end + '\n  },'.length);
  }
  const marker = group.type === 'variant' ? SECTION2 : GROUPS_END;
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`グループを足す位置（${marker.split('\n').at(-1).trim()}）が見つかりませんでした。`);
  const insert = group.type === 'variant' ? `${code}\n\n` : `${code}\n`;
  return source.slice(0, idx) + insert + source.slice(idx);
}

/** "文字:メモ,文字:メモ" を {文字: メモ} にする（\, はメモの中のカンマ） */
export function parseNotes(text) {
  const notes = {};
  for (const pair of (text ?? '').split(/(?<=[^\\]),/)) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim().replace(/\\,/g, ',');
    if (k && v) notes[k] = v;
  }
  return notes;
}

async function main() {
  const { values } = parseArgs({
    options: {
      type: { type: 'string', short: 't' },
      name: { type: 'string', short: 'n' },
      chars: { type: 'string', short: 'c' },
      desc: { type: 'string', short: 'd' },
      notes: { type: 'string' },
      file: { type: 'string' },
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

  const chars = [...new Set(values.chars.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean))];
  for (const ch of chars) {
    if ([...ch].length !== 1) {
      console.error(`エラー: 「${ch}」は1文字ではありません。--chars (-c) には1文字ずつカンマ区切りで指定してください。`);
      process.exit(1);
    }
  }
  const notes = parseNotes(values.notes);

  // 2. DB を読み込んで文字の実在確認
  const db = await VariantDB.load(DATA_DIR, async (url) => JSON.parse(await readFile(url, 'utf8')));
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (!db.resolve(cp)) {
      console.error(`エラー: 文字「${ch}」(U+${cp.toString(16).toUpperCase()}) は MJ データベースに存在しません。`);
      process.exit(1);
    }
  }

  // 3. confusables.js の読み込みと既存チェック
  const path = values.file ?? CONFUSABLES_PATH;
  const fileContent = await readFile(path, 'utf8');
  const { CONFUSABLE_GROUPS } = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);

  const existing = CONFUSABLE_GROUPS.find((g) => g.name === values.name && g.type === values.type);
  if (existing) {
    console.log(`グループ「${values.name}」(${values.type}) は既に存在します。既存の文字: [${existing.chars.join(', ')}]`);
  } else if (chars.length < 2) {
    console.error('エラー: --chars (-c) には2文字以上の文字をカンマ区切りで指定してください。');
    process.exit(1);
  }
  const { group, added } = mergeGroup(existing, { type: values.type, name: values.name, chars, desc: values.desc, notes });
  if (existing) {
    const changesText = added.length || values.desc || Object.keys(notes).length;
    if (!changesText) {
      console.log('指定された文字はすべて既にグループに含まれています。変更はありません。');
      return;
    }
    if (added.length) console.log(`以下の新しい文字を追加します: [${added.join(', ')}]`);
  }

  // 4. コード生成
  const groupCode = buildGroupCode(group);
  console.log('\n生成されるグループコード:');
  console.log(groupCode);

  if (values['dry-run']) {
    console.log('\n[DRY RUN] ファイルは更新されませんでした。');
    return;
  }

  // 5. ファイル更新
  let updatedContent;
  try {
    updatedContent = applyGroup(fileContent, group, { exists: Boolean(existing) });
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    process.exit(1);
  }
  await writeFile(path, updatedContent, 'utf8');
  console.log(`\n✔ ${path} を更新しました。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('実行時エラー:', err);
    process.exit(1);
  });
}
