import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiFileBase } from '../src/js/glyph-export.js';

test('multiFileBase: 異体字セレクタだけを外し、漢字は残す', () => {
  const glyphs = [
    { char: '邉\u{E010F}', mj: 'MJ026190' },
    { char: '辺', mj: 'MJ026180' },
  ];
  assert.equal(multiFileBase(glyphs), '邉辺_MJ026190_MJ026180');
});

test('multiFileBase: サロゲートペアの字（𠮷）も残す', () => {
  assert.equal(multiFileBase([{ char: '𠮷\u{E0100}', mj: 'MJ000000' }]), '𠮷_MJ000000');
});

test('multiFileBase: MJ番号が無ければ字だけ、字も無ければ glyphs', () => {
  assert.equal(multiFileBase([{ char: '辺' }]), '辺');
  assert.equal(multiFileBase([]), 'glyphs');
});
