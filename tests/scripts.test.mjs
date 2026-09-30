// scripts/add_nickname.mjs および scripts/add_confusable.mjs の単体テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
