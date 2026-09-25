// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gothicStatus, ivsListLabel, relationDirection, sequenceLabel } from '../src/js/ui/glyph-info.js';

const GOTHIC_META = {
  fonts: [
    { key: 'noto', name: 'Noto Sans JP', ok: true },
    { key: 'biz', name: 'BIZ UDゴシック', ok: false },
  ],
};

test('sequenceLabel: IVS / 実装したUCS / なし', () => {
  assert.equal(sequenceLabel({ ivs: ['9089_E010F'], impl: '9089' }), '9089 E010F（VS32）');
  assert.equal(sequenceLabel({ impl: 'FA10' }), 'U+FA10');
  assert.equal(sequenceLabel({}), 'UCSなし');
});

test('ivsListLabel: IVD 追加分に注記', () => {
  assert.equal(
    ivsListLabel({ ivs: ['2B9E4_E0100', '535A_E010A'], ivdOnly: ['535A_E010A'] }),
    '2B9E4 E0100（VS17） / 535A E010A（VS27） ※IVD 2026 追加',
  );
  assert.equal(ivsListLabel({}), undefined);
});

test('relationDirection', () => {
  assert.equal(relationDirection({ out: ['koseki'], in: [] }), '縮退先');
  assert.equal(relationDirection({ out: [], in: ['koseki'] }), '縮退元');
  assert.equal(relationDirection({ out: ['jis'], in: ['koseki'] }), '相互');
});

test('gothicStatus: ○ は ok=true のフォントすべてに字がある', () => {
  const s = gothicStatus({ char: '邉', impl: '9089', gothic: ['noto'] }, GOTHIC_META);
  assert.equal(s.mark, '○');
  assert.match(s.detail, /Noto Sans JP ○ \/ BIZ UDゴシック ×/);
});

test('gothicStatus: △ は判定用フォントに欠けがある', () => {
  assert.equal(gothicStatus({ char: 'x', impl: '20000', gothic: [] }, GOTHIC_META).label, 'ゴシック体に字がない');
  assert.equal(gothicStatus({ char: 'x', impl: '20000', gothic: ['biz'] }, GOTHIC_META).label, '一部のゴシック体にしか字がない');
});

test('gothicStatus: × は実装したUCS が無い（IVS でしか区別できない）', () => {
  assert.equal(gothicStatus({ char: '邉\u{E0119}', ivs: ['9089_E0119'] }, GOTHIC_META).mark, '×');
});

test('gothicStatus: 判定データや文字が無ければ null', () => {
  assert.equal(gothicStatus({ char: '邉', impl: '9089' }, null), null);
  assert.equal(gothicStatus({ impl: '9089' }, GOTHIC_META), null);
});
