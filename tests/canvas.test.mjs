import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context2d } from '../src/js/canvas.js';

test('context2d: 取れたコンテキストを返し、取れなければ大きさ入りの例外にする', () => {
  const ctx = { fillRect() {} };
  const ok = /** @type {any} */ ({ width: 10, height: 10, getContext: () => ctx });
  assert.equal(context2d(ok), ctx);
  // 大きすぎる canvas では getContext が null を返す
  const huge = /** @type {any} */ ({ width: 40000, height: 30000, getContext: () => null });
  assert.throws(() => context2d(huge), /40000×30000.*大きすぎる/);
});
