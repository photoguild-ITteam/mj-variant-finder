// scripts/add_nickname.mjs および scripts/add_confusable.mjs の単体テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_NICKNAME = fileURLToPath(new URL('../scripts/add_nickname.mjs', import.meta.url));
const SCRIPT_CONFUSABLE = fileURLToPath(new URL('../scripts/add_confusable.mjs', import.meta.url));

function runScript(scriptPath, args) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

test('add_nickname.mjs: --help が正常に表示される', () => {
  const { status, stdout } = runScript(SCRIPT_NICKNAME, ['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /使用方法:/);
  assert.match(stdout, /--char/);
});

test('add_nickname.mjs: 通常文字の dry-run で MJ番号とターゲットコードが自動解決される', () => {
  const { status, stdout } = runScript(SCRIPT_NICKNAME, [
    '--char', '髙',
    '--names', 'てすとだか',
    '--note', 'テスト用説明',
    '--dry-run',
  ]);
  assert.equal(status, 0);
  assert.match(stdout, /"9AD9"/);
  assert.match(stdout, /"MJ028902"/);
  assert.match(stdout, /"てすとだか"/);
  assert.match(stdout, /\[DRY RUN\]/);
});

test('add_nickname.mjs: IVS文字の dry-run で IVSコードと字形MJ番号が自動解決される', () => {
  const { status, stdout } = runScript(SCRIPT_NICKNAME, [
    '--char', '辻󠄂', // U+8FBB U+E0102
    '--names', 'てすとつじ',
    '--note', 'テスト用1点しんにょう',
    '--dry-run',
  ]);
  assert.equal(status, 0);
  assert.match(stdout, /"8FBB_E0102"/);
  assert.match(stdout, /"MJ025760"/);
  assert.match(stdout, /\[DRY RUN\]/);
});

test('add_nickname.mjs: ひらがな以外の呼び名はバリデーションエラーになる', () => {
  const { status, stderr } = runScript(SCRIPT_NICKNAME, [
    '--char', '髙',
    '--names', '漢字まじり',
    '--note', 'テスト',
    '--dry-run',
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /ひらがな.*で入力してください/);
});

test('add_nickname.mjs: 既存の呼び名との重複はエラーになる', () => {
  const { status, stderr } = runScript(SCRIPT_NICKNAME, [
    '--char', '髙',
    '--names', 'はしごだか',
    '--note', 'テスト',
    '--dry-run',
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /既に登録されています/);
});

test('add_nickname.mjs: 部首別名の dry-run が成功する', () => {
  const { status, stdout } = runScript(SCRIPT_NICKNAME, [
    '--radical', '46',
    '--names', 'てすとやま',
    '--dry-run',
  ]);
  assert.equal(status, 0);
  assert.match(stdout, /部首 46 に別名を追加します/);
});

test('add_confusable.mjs: --help が正常に表示される', () => {
  const { status, stdout } = runScript(SCRIPT_CONFUSABLE, ['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /使用方法:/);
  assert.match(stdout, /--type/);
});

test('add_confusable.mjs: 正常な dry-run でグループコードが生成される', () => {
  const { status, stdout } = runScript(SCRIPT_CONFUSABLE, [
    '--type', 'confusable',
    '--name', 'テストグループ',
    '--chars', '日,白',
    '--desc', '日のテスト説明',
    '--notes', '日:ひのメモ,白:しろのメモ',
    '--dry-run',
  ]);
  assert.equal(status, 0);
  assert.match(stdout, /type: 'confusable'/);
  assert.match(stdout, /name: 'テストグループ'/);
  assert.match(stdout, /'日': 'ひのメモ'/);
  assert.match(stdout, /'白': 'しろのメモ'/);
  assert.match(stdout, /\[DRY RUN\]/);
});

test('add_confusable.mjs: MJ DB に存在しない文字はエラーになる', () => {
  const { status, stderr } = runScript(SCRIPT_CONFUSABLE, [
    '--type', 'confusable',
    '--name', 'テストグループ',
    '--chars', '日,🍎',
    '--desc', 'テスト',
    '--dry-run',
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /MJ データベースに存在しません/);
});

// --- add_confusable.mjs で実際にファイルを書き換える（src/js/confusables.js の写しに対して）

const CONFUSABLES = new URL('../src/js/confusables.js', import.meta.url);

/** confusables.js を一時ディレクトリに写し、スクリプトで書き換えた後のグループ一覧を返す */
async function runOnCopy(args) {
  const dir = await mkdtemp(join(tmpdir(), 'confusables-'));
  const file = join(dir, 'confusables.js');
  await copyFile(CONFUSABLES, file);
  const res = runScript(SCRIPT_CONFUSABLE, [...args, '--file', file]);
  const source = await readFile(file, 'utf8');
  const { CONFUSABLE_GROUPS } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  await rm(dir, { recursive: true });
  return { ...res, source, groups: CONFUSABLE_GROUPS };
}

const { CONFUSABLE_GROUPS: ORIGINAL } = await import(CONFUSABLES.href);
const withoutGroup = (groups, name) => JSON.stringify(groups.filter((g) => g.name !== name));

test('add_confusable.mjs: 既存グループに文字を足すと、既存の文字・説明・メモを残して末尾に足す', async () => {
  const before = ORIGINAL.find((g) => g.name === 'しま');
  const { status, stderr, groups } = await runOnCopy([
    '--type', 'variant', '--name', 'しま', '--chars', '島,隝', '--notes', '隝:阝＋島。',
  ]);
  assert.equal(status, 0, stderr);
  const after = groups.find((g) => g.name === 'しま');
  assert.deepEqual(after.chars, [...before.chars, '隝']);
  assert.equal(after.desc, before.desc);
  assert.deepEqual(after.notes, { ...before.notes, '隝': '阝＋島。' });
  // ほかのグループは変わらない
  assert.equal(groups.length, ORIGINAL.length);
  assert.equal(withoutGroup(groups, 'しま'), withoutGroup(ORIGINAL, 'しま'));
});

test('add_confusable.mjs: 新しい異構字グループは「1.」の末尾に、2スペース字下げで足す', async () => {
  const { status, stderr, source, groups } = await runOnCopy([
    '--type', 'variant', '--name', 'テストしま', '--chars', '嶹,𡶒', '--desc', "引用符 ' とバックスラッシュ \\ を含む説明",
  ]);
  assert.equal(status, 0, stderr);
  assert.equal(groups.length, ORIGINAL.length + 1);
  const i = groups.findIndex((g) => g.name === 'テストしま');
  assert.equal(groups[i].desc, "引用符 ' とバックスラッシュ \\ を含む説明");
  assert.equal(groups[i - 1].type, 'variant');
  assert.equal(groups[i + 1].type, 'confusable');
  assert.match(source, /\n {2}\{\n {4}type: 'variant',\n {4}name: 'テストしま',/);
  assert.match(source, /\n {2}\/\/ =+\n {2}\/\/ 2\. 類似字/); // 見出しの区切り線はそのまま
});

test('add_confusable.mjs: 新しい類似字グループは末尾に足す', async () => {
  const { status, stderr, groups } = await runOnCopy([
    '--type', 'confusable', '--name', 'テスト昌と晶', '--chars', '昌,晶,品',
  ]);
  assert.equal(status, 0, stderr);
  assert.deepEqual(groups.at(-1).chars, ['昌', '晶', '品']);
  assert.equal(JSON.stringify(groups.slice(0, -1)), JSON.stringify(ORIGINAL));
});

test('add_confusable.mjs: 2文字以上の要素はエラーになる', () => {
  const { status, stderr } = runScript(SCRIPT_CONFUSABLE, [
    '--type', 'confusable', '--name', 'テスト', '--chars', '日,白い', '--dry-run',
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /1文字ではありません/);
});

test('add_confusable.mjs: 1文字のみの指定はエラーになる', () => {
  const { status, stderr } = runScript(SCRIPT_CONFUSABLE, [
    '--type', 'variant',
    '--name', 'テスト',
    '--chars', '日',
    '--desc', 'テスト',
    '--dry-run',
  ]);
  assert.equal(status, 1);
  assert.match(stderr, /2文字以上の文字をカンマ区切りで指定/);
});
