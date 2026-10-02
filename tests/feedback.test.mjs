import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../src/js/ui/feedback.js';

test('errorMessage: Error なら message、それ以外は文字列か fallback', () => {
  assert.equal(errorMessage(new Error('読み込めません (404)')), '読み込めません (404)');
  assert.equal(errorMessage(new TypeError('x')), 'x');
  assert.equal(errorMessage('文字列で投げた'), '文字列で投げた');
  assert.equal(errorMessage(undefined), 'undefined');
  assert.equal(errorMessage({ status: 500 }, '画像をコピーできませんでした'), '画像をコピーできませんでした');
});
