// 字形・関連字の表示用ラベル。DOM に依存しない（tests/glyph-info.test.mjs でテスト）。

import { hex, parseSequence, vsNumber } from '../db.js';

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
