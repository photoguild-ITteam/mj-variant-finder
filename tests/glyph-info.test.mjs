import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  focusedGlyph, glyphDetailSections, gothicPrint, gothicStatus, ivsListLabel, matchesFocus, relationDirection, sequenceLabel,
} from '../src/js/ui/glyph-info.js';

// 邉 の字形（一部）。シャードの ivs は配列
const HEN = [
  { mj: 'MJ026190', ivs: ['9089_E010F'] },
  { mj: 'MJ026193', ivs: ['9089_E011F'] },
  { mj: 'MJ000000', impl: 'FA10' },
];

test('matchesFocus: MJ番号 / IVS（配列に含まれるか）/ 実装したUCS', () => {
  assert.equal(matchesFocus(HEN[1], { ivs: '9089_E011F' }), true);
  assert.equal(matchesFocus(HEN[0], { ivs: '9089_E011F' }), false);
  assert.equal(matchesFocus(HEN[1], { mj: 'MJ026193' }), true);
  assert.equal(matchesFocus(HEN[2], { impl: 'FA10' }), true);
  assert.equal(matchesFocus(HEN[0], null), false);
});

test('focusedGlyph: 検索語が指した字形。無ければ先頭', () => {
  assert.equal(focusedGlyph(HEN, { ivs: '9089_E011F' }).mj, 'MJ026193');
  assert.equal(focusedGlyph(HEN, { mj: 'MJ026193' }).mj, 'MJ026193');
  assert.equal(focusedGlyph(HEN, null).mj, 'MJ026190');
  assert.equal(focusedGlyph(HEN, { ivs: '9089_E0100' }).mj, 'MJ026190');
  assert.equal(focusedGlyph([], null), undefined);
});

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

const PRINT_META = {
  fonts: [...GOTHIC_META.fonts, { key: 'notocjk', name: 'Noto Sans CJK JP', ok: false }, { key: 'plangothic', name: '遍黒体', ok: false }],
};
const fontKeys = (info) => info.fonts.map((f) => f.key);

test('gothicPrint: ○ は Windows に入っているゴシック体を案内し、IVS を除いた字を使う', () => {
  const info = gothicPrint({ char: '邉\u{E010F}', impl: '9089', ivs: ['9089_E010F'], gothic: ['noto', 'biz', 'notocjk'] }, PRINT_META);
  assert.equal(info.usable, true);
  assert.equal(info.char, '邉');
  assert.deepEqual(fontKeys(info), ['noto', 'biz']);
  assert.equal(info.preview.family, 'MJ Variant Gothic N');
  assert.equal(info.kusa, false);
});

test('gothicPrint: △ は入手できるフォントを案内する。見本は Noto Sans CJK JP を先に使う', () => {
  const ext = gothicPrint({ char: '\u{20000}', impl: '20000', gothic: ['plangothic'] }, PRINT_META);
  assert.deepEqual(fontKeys(ext), ['plangothic']);
  assert.equal(ext.preview.family, 'MJ Variant Gothic P');
  const both = gothicPrint({ char: '䁩', impl: '4069', gothic: ['notocjk', 'plangothic'] }, PRINT_META);
  assert.deepEqual(fontKeys(both), ['notocjk', 'plangothic']);
  assert.equal(both.preview.key, 'notocjk');
  const none = gothicPrint({ char: '\u{20000}', impl: '20000', gothic: [] }, PRINT_META);
  assert.deepEqual([none.fonts, none.preview], [[], null]);
});

test('gothicPrint: 艸部の △ には、艹の画数の注意を付ける（○ には付けない）', () => {
  assert.equal(gothicPrint({ char: '\u{26AF7}', impl: '26AF7', radicals: [[140, 3]], gothic: ['plangothic'] }, PRINT_META).kusa, true);
  assert.equal(gothicPrint({ char: '\u{26AF7}', impl: '26AF7', radicals: [[5, 3], [140, 3]], gothic: ['plangothic'] }, PRINT_META).kusa, true);
  assert.equal(gothicPrint({ char: '葛', impl: '845B', radicals: [[140, 9]], gothic: ['noto'] }, PRINT_META).kusa, false);
});

test('gothicPrint: × はゴシック体が無く、IVS を除いた通常の字形になる', () => {
  assert.deepEqual(gothicPrint({ char: '邉\u{E0119}', ivs: ['9089_E0119'] }, PRINT_META), { usable: false, base: '邉', checked: false });
  // Adobe-Japan1 の IVS の形と見比べて、同じ形が無かったもの
  assert.deepEqual(gothicPrint({ char: '与\u{E0104}', ivs: ['4E0E_E0104'], aj1: null }, PRINT_META), { usable: false, base: '与', checked: true });
  assert.equal(gothicPrint({ char: '邉', impl: '9089' }, null), null);
});

test('ゴシックIVS: 同じ形を Adobe-Japan1 の IVS で出せる × の字形', () => {
  const glyph = { char: '与\u{E0103}', ivs: ['4E0E_E0103'], aj1: { seq: '4E0E_E0101', gothic: ['noto', 'notocjk'] } };
  const s = gothicStatus(glyph, PRINT_META);
  assert.equal(s.mark, 'IVS');
  assert.match(s.detail, /Adobe-Japan1 の IVS（4E0E E0101）/);
  assert.match(s.detail, /Noto Sans JP・Noto Sans CJK JP/);
  const info = gothicPrint(glyph, PRINT_META);
  assert.equal(info.char, '与\u{E0101}'); // MJ の IVS（E0103）ではなく、Adobe-Japan1 の IVS を付けた字
  assert.equal(info.aj1, '4E0E E0101');
  assert.equal(info.withIvs, true);
  assert.deepEqual(fontKeys(info), ['noto', 'notocjk']);
  assert.equal(info.preview.family, 'MJ Variant Gothic N');
  // 既定の形（IVS なし）と同じ: IVS を付けない。拡張B の字でも IVS の有無を取り違えない
  const plain = gothicPrint({ char: '\u{20B9F}\u{E0102}', ivs: ['20B9F_E0102'], aj1: { seq: '20B9F', gothic: ['notocjk'] } }, PRINT_META);
  assert.deepEqual([plain.char, plain.withIvs, plain.aj1], ['\u{20B9F}', false, '20B9F（IVS なし）']);
});

test('gothicStatus: × の説明は、見比べて同じ形が無かったものだけ、そう書く', () => {
  assert.doesNotMatch(gothicStatus({ char: '邉\u{E0119}', ivs: ['9089_E0119'] }, PRINT_META).detail, /見比べ/);
  assert.match(gothicStatus({ char: '与\u{E0104}', ivs: ['4E0E_E0104'], aj1: null }, PRINT_META).detail, /同じ形はありませんでした/);
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

