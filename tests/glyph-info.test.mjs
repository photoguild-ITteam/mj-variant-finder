import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glyphDetailSections, gothicStatus, ivsListLabel, relationDirection, sequenceLabel } from '../src/js/ui/glyph-info.js';

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

test('glyphDetailSections: セクション分割と出典・典拠の整理', () => {
  const glyph = {
    mj: 'MJ022192',
    ucs: '8401',
    koseki: '351440',
    juki: 'J+B9CD',
    touki: '00351440',
    strokes: 12,
    readings: ['カイ', 'キ', 'ギ', 'まめがら'],
    ivs: ['8401_E0102'],
    char: '萁󠄂',
    jisLevel: '第3水準',
    x0213: '1-91-04',
    x0213Class: '2',
    radicals: [[140, 8]],
    dict: {
      daikanwa: '31248',
      nihongoKanji: '10330',
      shinDaijiten: '13938',
      daijigen: '8330',
      daikangorin: '9508',
    },
    shrink: {
      jis: [{ ucs: '8401', x0213: '1-91-04' }],
      koseki: [{ ucs: '8401', x0213: '1-91-04', kind: '戸籍統一文字情報 親字・正字', hops: 1 }],
    },
  };

  const sections = glyphDetailSections(glyph, GOTHIC_META);
  assert.equal(sections.length, 5);

  const [codeSec, attrSec, officialSec, dictSec, shrinkSec] = sections;

  // 1. 文字符号・規格
  assert.equal(codeSec.id, 'code');
  assert.equal(codeSec.title, '文字符号・規格');
  assert.deepEqual(codeSec.rows.map(([label]) => label), [
    'MJ文字図形名',
    '対応するUCS',
    'IVS (Moji_Joho)',
    'JIS X 0213',
    'ゴシック体',
  ]);

  // 2. 文字の属性
  assert.equal(attrSec.id, 'attribute');
  assert.equal(attrSec.title, '文字の属性');
  assert.deepEqual(attrSec.rows.map(([label]) => label), [
    '部首・内画数',
    '総画数',
    '読み',
  ]);

  // 3. 公的典拠・行政コード（出典）
  assert.equal(officialSec.id, 'official');
  assert.equal(officialSec.title, '公的典拠・行政コード');
  assert.deepEqual(officialSec.rows, [
    ['戸籍統一文字番号', '351440'],
    ['住基ネット統一文字コード', 'J+B9CD'],
    ['登記統一文字番号', '00351440'],
  ]);

  // 4. 漢和辞典の典拠（出典）: 定義順で各辞書が展開される
  assert.equal(dictSec.id, 'dictionary');
  assert.equal(dictSec.title, '漢和辞典の典拠');
  assert.deepEqual(dictSec.rows, [
    ['大漢和', '31248'],
    ['大字源', '8330'],
    ['新大字典', '13938'],
    ['大漢語林', '9508'],
    ['日本語漢字辞典', '10330'],
  ]);

  // 5. MJ縮退マップ・公的代替根拠
  assert.equal(shrinkSec.id, 'shrink');
  assert.equal(shrinkSec.title, 'MJ縮退マップ・公的代替根拠');
});

test('glyphDetailSections: 空のセクションは除外される', () => {
  const minimalGlyph = {
    mj: 'MJ099999',
    strokes: 5,
  };
  const sections = glyphDetailSections(minimalGlyph, null);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, 'code');
  assert.equal(sections[1].id, 'attribute');
});

