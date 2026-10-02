// 字形・関連字の表示用ラベル。DOM に依存しない（tests/glyph-info.test.mjs でテスト）。

import { hex, parseSequence, radicalChar, vsNumber } from '../db.js';

export const RELATION_SHORT = {
  koseki: '戸籍通達',
  kokuji582: '告示582号',
  jis: 'JIS包摂/UCS統合',
  compat: '互換漢字',
  ivs: 'IVS共有',
  dict: '辞書類',
  analogy: '類推',
  unihanSemantic: '意味',
  unihanSpecialized: '特定意味',
  unihanZ: 'Z異体',
  unihanTraditional: '繁体',
  unihanSimplified: '簡体',
};

export const DIRECTION_HELP = {
  縮退先: 'この字の字形を、この文字で代用（縮退）できる',
  縮退元: 'この文字の字形を、この字で代用（縮退）できる',
  相互: '双方向に縮退の関係がある',
};

export const DICT_LABELS = {
  daikanwa: '大漢和',
  nihongoKanji: '日本語漢字辞典',
  shinDaijiten: '新大字典',
  daijigen: '大字源',
  daikangorin: '大漢語林',
};

/** 関連字の向き（db.related() の要素） */
export function relationDirection(rel) {
  if (rel.out.length && rel.in.length) return '相互';
  return rel.out.length ? '縮退先' : '縮退元';
}

/**
 * 検索語が指した字形か（db.search() の chars の focus）.
 * @param {{mj?: string, ivs?: string, impl?: string} | null} focus
 */
export function matchesFocus(glyph, focus) {
  if (!focus) return false;
  if (focus.mj) return glyph.mj === focus.mj;
  if (focus.ivs) return Boolean(glyph.ivs?.includes(focus.ivs));
  if (focus.impl) return glyph.impl === focus.impl;
  return false;
}

/** 検索語が指した字形。指していなければ（見つからなければ）先頭の字形 */
export const focusedGlyph = (glyphs, focus) => glyphs.find((g) => matchesFocus(g, focus)) ?? glyphs[0];

/** カードに出す符号の表記: "9089 E010F（VS32）" / "U+9089" / "UCSなし" */
export function sequenceLabel(glyph) {
  if (glyph.ivs) {
    const [base, vs] = parseSequence(glyph.ivs[0]);
    return `${hex(base)} ${hex(vs)}（VS${vsNumber(vs)}）`;
  }
  return glyph.impl ? `U+${glyph.impl}` : 'UCSなし';
}

/** 詳細画面の IVS 行: "9089 E010F（VS32） / ..." */
export function ivsListLabel(glyph) {
  return glyph.ivs
    ?.map((seq) => `${seq.replace('_', ' ')}（VS${vsNumber(parseSequence(seq)[1])}）${glyph.ivdOnly?.includes(seq) ? ' ※IVD 2026 追加' : ''}`)
    .join(' / ');
}

export const GOTHIC_VARIANT = { '○': 'ok', '△': 'warn', '×': 'muted' };

/**
 * ゴシック体で使えるか.
 * Moji_Joho の IVS に対応したゴシック体は無いので、実装したUCS を持たない（IVS でしか区別できない）字形は ×。
 * 実装したUCS があり、判定用のゴシック体（ok=true のもの）すべてに字があれば ○、欠けていれば △。
 * @param {object} glyph
 * @param {{fonts: {key: string, name: string, ok: boolean}[]} | null} gothicMeta meta.json の gothic
 * @returns {{mark: '○'|'△'|'×', label: string, detail: string} | null} 判定データが無ければ null
 */
export function gothicStatus(glyph, gothicMeta) {
  if (!gothicMeta || !glyph.char) return null;
  if (!glyph.impl) {
    return {
      mark: '×',
      label: 'IVSでのみ区別できる字形',
      detail: 'Moji_Joho の IVS に対応したゴシック体は無いため、ゴシック体では通常の字形で表示されます。この字形は明朝体（IPAmj明朝）でのみ使えます。',
    };
  }
  const has = new Set(glyph.gothic ?? []);
  const perFont = gothicMeta.fonts.map((f) => `${f.name} ${has.has(f.key) ? '○' : '×'}`).join(' / ');
  if (gothicMeta.fonts.filter((f) => f.ok).every((f) => has.has(f.key))) {
    return { mark: '○', label: 'ゴシック体でも使える', detail: `文字コード（U+${glyph.impl}）で表せる字形です。${perFont}` };
  }
  return {
    mark: '△',
    label: has.size ? '一部のゴシック体にしか字がない' : 'ゴシック体に字がない',
    detail: `文字コード（U+${glyph.impl}）で表せますが、ゴシック体のフォントに字が無いことがあります。${perFont}`,
  };
}

const DICT_ORDER = ['daikanwa', 'daijigen', 'shinDaijiten', 'daikangorin', 'nihongoKanji'];

/**
 * 字形詳細ダイアログ用のセクション構造を生成する。
 * DOM に依存せず、純粋なデータ構造を返す（tests/glyph-info.test.mjs でテスト）。
 *
 * @param {object} glyph 字形オブジェクト
 * @param {{fonts: {key: string, name: string, ok: boolean}[]} | null} [gothicMeta]
 * @returns {Array<{ id: string, title: string, rows: Array<[string, ...any]> }>}
 */
export function glyphDetailSections(glyph, gothicMeta = null) {
  const gothic = gothicStatus(glyph, gothicMeta);

  // 1. 文字符号・規格
  const codeRows = [
    ['MJ文字図形名', glyph.mj],
    ['対応するUCS', glyph.ucs && `U+${glyph.ucs}`],
    ['実装したUCS', glyph.impl && `U+${glyph.impl}`],
    ['IVS (Moji_Joho)', ivsListLabel(glyph)],
    ['SVS', glyph.svs?.replace('_', ' ')],
    ['対応する互換漢字', glyph.compat && `U+${glyph.compat}`],
    ['JIS X 0213', glyph.x0213 && `${glyph.x0213}（${glyph.jisLevel ?? ''}${glyph.x0213Class != null ? `・包摂区分 ${glyph.x0213Class}` : ''}）`],
    ['JIS X 0212', glyph.x0212],
    ['ゴシック体', gothic && `${gothic.mark} ${gothic.label}。${gothic.detail}`],
  ];

  // 2. 文字の属性
  const attrRows = [
    ['部首・内画数', glyph.radicals?.map(([r, s]) => `${radicalChar(r)}（${r}）+${s ?? '?'}`).join(' / ')],
    ['総画数', glyph.strokes],
    ['読み', glyph.readings?.join('・')],
    ['漢字施策', glyph.policy],
    ['MJ文字図形バージョン', glyph.version],
    ['備考', glyph.note],
  ];

  // 3. 公的典拠・行政コード（出典）
  const officialRows = [
    ['戸籍統一文字番号', glyph.koseki],
    ['住基ネット統一文字コード', glyph.juki],
    ['登記統一文字番号', glyph.touki],
    ['入管正字コード', glyph.nyukanSei],
    ['入管外字コード', glyph.nyukanGai],
  ];

  // 4. 漢和辞典の典拠（出典）
  const dictRows = [];
  if (glyph.dict) {
    const keys = Object.keys(glyph.dict);
    keys.sort((a, b) => {
      const ia = DICT_ORDER.indexOf(a);
      const ib = DICT_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    for (const k of keys) {
      dictRows.push([DICT_LABELS[k] ?? k, glyph.dict[k]]);
    }
  }

  // 5. MJ縮退マップ・公的代替根拠
  const shrinkRows = [];
  if (glyph.shrink && Object.keys(glyph.shrink).length > 0) {
    shrinkRows.push(['MJ縮退マップ', glyph.shrink]);
  }

  const filterRows = (rows) => rows.filter(([, ...values]) => values.some((v) => v != null && v !== ''));

  const sections = [
    { id: 'code', title: '文字符号・規格', rows: filterRows(codeRows) },
    { id: 'attribute', title: '文字の属性', rows: filterRows(attrRows) },
    { id: 'official', title: '公的典拠・行政コード', rows: filterRows(officialRows) },
    { id: 'dictionary', title: '漢和辞典の典拠', rows: filterRows(dictRows) },
    { id: 'shrink', title: 'MJ縮退マップ・公的代替根拠', rows: filterRows(shrinkRows) },
  ];

  return sections.filter((s) => s.rows.length > 0);
}

