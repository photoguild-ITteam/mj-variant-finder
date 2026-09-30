#!/usr/bin/env node
// 俗称辞書（src/data/nicknames.json）への呼び名・部首名追加スクリプト
// 使用例:
//   node scripts/add_nickname.mjs --char 㟢 --names やまかんむりのき,やまき --note "「崎」の異構字。山冠に奇"
//   node scripts/add_nickname.mjs --char "辻󠄂" --names いちてんつじ --note "1点しんにょうの辻"
//   node scripts/add_nickname.mjs --radical 46 --names やまかんむり,やまがしら
//   node scripts/add_nickname.mjs --char 髙 --names はしごだか --note "..." --dry-run

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { VariantDB, isVariationSelector } from '../src/js/db.js';

const HELP = `
使用方法:
  # 文字の俗称（呼び名）を追加
  node scripts/add_nickname.mjs --char <文字|コード> --names <呼び名,...> --note <説明> [--mj <MJ番号>] [--dry-run]

  # 部首の別名を追加
  node scripts/add_nickname.mjs --radical <部首番号 1-214> --names <別名,...> [--example <例の字>] [--dry-run]

オプション:
  --char, -c     対象の文字（例: 㟢、辻󠄂）またはコード（例: 37E2、8FBB_E0102）
  --names, -n    追加する呼び名（カンマ区切り、ひらがなのみ）
  --note         字の呼び名に関する説明・由来
  --mj           MJ文字図形名（省略時は字形データから自動判別）
  --radical, -r  部首番号（1〜214）
  --example, -e  部首の例字（省略時は既存の例字、またはDBから自動選出）
  --dry-run      ファイルを更新せず、検証結果と追加予定の内容のみ表示
  --help, -h     このヘルプを表示
`;

const DICT_PATH = fileURLToPath(new URL('../src/data/nicknames.json', import.meta.url));
const DATA_DIR = new URL('../src/data/', import.meta.url);

async function main() {
  const { values } = parseArgs({
    options: {
      char: { type: 'string', short: 'c' },
      names: { type: 'string', short: 'n' },
      note: { type: 'string' },
      mj: { type: 'string' },
      radical: { type: 'string', short: 'r' },
      example: { type: 'string', short: 'e' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help || (!values.char && !values.radical)) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  // 1. 引数の基本チェック
  if (!values.names) {
    console.error('エラー: --names (-n) で呼び名を1つ以上指定してください（カンマ区切り）。');
    process.exit(1);
  }

  const rawNames = values.names.split(/[,、\s]+/).map((s) => s.trim()).filter(Boolean);
  if (rawNames.length === 0) {
    console.error('エラー: 有効な呼び名が指定されていません。');
    process.exit(1);
  }

  // ひらがなチェック
  for (const name of rawNames) {
    if (!/^[ぁ-ゖー]+$/.test(name)) {
      console.error(`エラー: 呼び名「${name}」はひらがな（ぁ-ゖー）で入力してください。`);
      process.exit(1);
    }
  }

  // 2. DB と 辞書の読み込み
  const db = await VariantDB.load(DATA_DIR, async (url) => JSON.parse(await readFile(url, 'utf8')));
  const dictRaw = await readFile(DICT_PATH, 'utf8');
  const dict = JSON.parse(dictRaw);

  // 重複チェック用の既存名セット
  const existingNames = new Map();
  for (const entry of dict.nicknames) {
    for (const name of entry.names) existingNames.set(name, `俗称: ${entry.targets.join(',')} (${entry.note})`);
  }
  for (const rad of dict.radicals) {
    for (const name of rad.names) existingNames.set(name, `部首 ${rad.radical}: 例字「${rad.example}」`);
  }

  // 重複検証
  for (const name of rawNames) {
    if (existingNames.has(name)) {
      console.error(`エラー: 呼び名「${name}」は既に登録されています -> ${existingNames.get(name)}`);
      process.exit(1);
    }
  }

  // 3A. 部首別名の追加
  if (values.radical) {
    const radNum = parseInt(values.radical, 10);
    if (isNaN(radNum) || radNum < 1 || radNum > 214) {
      console.error(`エラー: 部首番号は 1 から 214 の範囲で指定してください（入力: ${values.radical}）。`);
      process.exit(1);
    }

    let radEntry = dict.radicals.find((r) => r.radical === radNum || (Array.isArray(r.radical) && r.radical.includes(radNum)));
    if (radEntry) {
      // 既存部首エントリへの名前追加
      radEntry.names.push(...rawNames);
      if (values.example) radEntry.example = values.example;
      console.log(`部首 ${radNum} に別名を追加します:`, rawNames);
    } else {
      // 新規部首エントリの作成
      let example = values.example;
      if (!example) {
        console.error(`エラー: 部首 ${radNum} は辞書に未登録です。--example でその部首を持つ例の字を指定してください。`);
        process.exit(1);
      }
      radEntry = {
        names: rawNames,
        radical: radNum,
        example,
      };
      dict.radicals.push(radEntry);
      console.log(`新規部首エントリを追加します:`, radEntry);
    }

    // 例字がその部首を持っているか検証
    const exKey = db.resolve(radEntry.example.codePointAt(0));
    if (!exKey || !db.radicalsOf(exKey).some((n) => [radEntry.radical].flat().includes(n))) {
      console.error(`エラー: 例字「${radEntry.example}」は部首 ${radNum} を持っていません。`);
      process.exit(1);
    }
  }

  // 3B. 文字の俗称（呼び名）の追加
  if (values.char) {
    if (!values.note) {
      console.error('エラー: 文字の俗称を追加する場合は --note で説明を指定してください。');
      process.exit(1);
    }

    const { targetCode, mj, charDisplay } = await resolveTarget(values.char, values.mj, db);

    const newEntry = {
      names: rawNames,
      targets: [targetCode],
      ...(mj ? { mj: [mj] } : {}),
      note: values.note,
    };

    console.log(`文字「${charDisplay}」(${targetCode}) に俗称を追加します:`);
    console.log(JSON.stringify(newEntry, null, 2));

    dict.nicknames.push(newEntry);
  }

  // 4. 保存（または dry-run）
  if (values['dry-run']) {
    console.log('\n[DRY RUN] ファイルは更新されませんでした。');
    return;
  }

  const updatedJson = JSON.stringify(dict, null, 2) + '\n';
  await writeFile(DICT_PATH, updatedJson, 'utf8');
  console.log(`\n✔ ${DICT_PATH} を更新しました。`);
}

/**
 * 入力文字またはコードから targetCode と MJ番号 を解決する
 */
async function resolveTarget(input, userMj, db) {
  let baseKey = null;
  let vsKey = null;
  let charDisplay = input;

  if (input.includes('_')) {
    // "8FBB_E0102" 形式
    const [b, v] = input.split('_');
    baseKey = b.toUpperCase();
    vsKey = v.toUpperCase();
  } else if (/^[0-9a-fA-F]{4,5}$/.test(input)) {
    // "37E2" 形式
    baseKey = input.toUpperCase();
  } else {
    // 実際の文字（"辻󠄂" や "㟢"）
    const cps = [...input].map((c) => c.codePointAt(0));
    baseKey = db.resolve(cps[0]);
    const vsCp = cps.find((cp) => isVariationSelector(cp));
    if (vsCp) vsKey = vsCp.toString(16).toUpperCase();
  }

  if (!baseKey || !db.resolve(parseInt(baseKey, 16))) {
    console.error(`エラー: コードまたは文字「${input}」は MJ データベースに存在しません。`);
    process.exit(1);
  }

  const targetCode = vsKey ? `${baseKey}_${vsKey}` : baseKey;
  const detail = await db.detail(baseKey);
  if (!detail || !detail.glyphs || detail.glyphs.length === 0) {
    console.error(`エラー: 文字「${baseKey}」の詳細データが見つかりません。`);
    process.exit(1);
  }

  let mj = userMj ?? null;
  if (!mj) {
    if (vsKey) {
      const g = detail.glyphs.find((glyph) => glyph.ivs?.includes(targetCode));
      if (!g) {
        console.error(`エラー: IVS コード「${targetCode}」に対応する字形が文字「${baseKey}」内に見つかりません。`);
        process.exit(1);
      }
      mj = g.mj;
    } else if (detail.glyphs.length === 1) {
      mj = detail.glyphs[0].mj;
    }
  }

  charDisplay = String.fromCodePoint(parseInt(baseKey, 16)) + (vsKey ? String.fromCodePoint(parseInt(vsKey, 16)) : '');
  return { targetCode, mj, charDisplay };
}

main().catch((err) => {
  console.error('実行時エラー:', err);
  process.exit(1);
});
