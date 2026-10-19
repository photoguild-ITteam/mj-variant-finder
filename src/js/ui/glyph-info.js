// 字形・関連字の表示用ラベル。DOM に依存しない（tests/glyph-info.test.mjs でテスト）。

import { hex, keyToChar, parseSequence, radicalChar, vsNumber } from '../db.js';

/** @typedef {import('../db.js').Glyph} Glyph */
/** @typedef {import('../db.js').Focus | null} Focus 検索語が指した字形（db.search() の chars の focus） */

/** @type {Record<string, string>} 関係の種別 → 短い表記 */
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

/** @type {Record<string, string>} */
export const DICT_LABELS = {
  daikanwa: '大漢和',
  nihongoKanji: '日本語漢字辞典',
  shinDaijiten: '新大字典',
  daijigen: '大字源',
  daikangorin: '大漢語林',
};

/**
 * 関連字の向き.
 * @param {{out: string[], in: string[]}} rel db.related() の要素
 */
export function relationDirection(rel) {
  if (rel.out.length && rel.in.length) return '相互';
  return rel.out.length ? '縮退先' : '縮退元';
}

/**
 * 検索語が指した字形か（db.search() の chars の focus）.
 * @param {Glyph} glyph
 * @param {Focus} focus
 */
export function matchesFocus(glyph, focus) {
  if (!focus) return false;
  if (focus.mj) return glyph.mj === focus.mj;
  if (focus.ivs) return Boolean(glyph.ivs?.includes(focus.ivs));
  if (focus.impl) return glyph.impl === focus.impl;
  return false;
}

/**
 * 検索語が指した字形。指していなければ（見つからなければ）先頭の字形.
 * @param {Glyph[]} glyphs
 * @param {Focus} focus
 */
export const focusedGlyph = (glyphs, focus) => glyphs.find((g) => matchesFocus(g, focus)) ?? glyphs[0];

/**
 * カードに出す符号の表記: "9089 E010F（VS32）" / "U+9089" / "UCSなし".
 * @param {Glyph} glyph
 */
export function sequenceLabel(glyph) {
  if (glyph.ivs) {
    const [base, vs] = parseSequence(glyph.ivs[0]);
    return `${hex(base)} ${hex(vs)}（VS${vsNumber(vs)}）`;
  }
  return glyph.impl ? `U+${glyph.impl}` : 'UCSなし';
}

/**
 * 詳細画面の IVS 行: "9089 E010F（VS32） / ...".
 * @param {Glyph} glyph
 */
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
 * @param {import('../db.js').Glyph} glyph
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

/**
 * 文書・印刷でゴシック体として使うときに案内するフォント（キーは glyph.gothic・meta.json の gothic.fonts）.
 * installed は Windows に入っているもの。○ の字形はこれで足りるので、入手が要るフォントは案内しない.
 * @typedef {{key: string, name: string, url: string, installed?: boolean, note?: string}} GothicPrintFont
 * @type {GothicPrintFont[]}
 */
export const GOTHIC_PRINT_FONTS = [
  { key: 'noto', name: 'Noto Sans JP', url: 'https://fonts.google.com/noto/specimen/Noto+Sans+JP', installed: true, note: 'Windows 11 に入っています' },
  { key: 'biz', name: 'BIZ UDゴシック', url: 'https://fonts.google.com/specimen/BIZ+UDGothic', installed: true, note: 'Windows に入っています' },
  { key: 'notocjk', name: 'Noto Sans CJK JP', url: 'https://github.com/notofonts/noto-cjk/releases', note: '全字の版（Windows の Noto Sans JP には無い字があります）' },
  { key: 'plangothic', name: '遍黒体（Plangothic）', url: 'https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project/releases', note: 'P1・P2 の2ファイル' },
];

/**
 * 見本に使う同梱フォント（src/fonts/gothic/gothic.css）. Noto Sans CJK JP にあればそちら.
 * @typedef {{key: string, family: string, name: string}} GothicPreview family は gothic.css のフォント名
 * @type {GothicPreview[]}
 */
export const GOTHIC_PREVIEW = [
  { key: 'notocjk', family: 'MJ Variant Gothic N', name: 'Noto Sans CJK JP' },
  { key: 'plangothic', family: 'MJ Variant Gothic P', name: '遍黒体' },
];

const KUSA_RADICAL = 140; // 艸部

/**
 * 字形をゴシック体で使うための案内（字形の詳細の「ゴシック体で使う」）.
 * - usable: false … IVS でしか区別できない（×）。ゴシック体では base（IVS を除いた字）の通常の字形になる
 * - usable: true … 文字コード ucs の字 char（IVS なし）を fonts のゴシック体で使える。preview は見本に使う同梱フォント
 *   kusa: 艸部の △。IPAmj明朝 は艹が4画（十十）のことがあり、ゴシック体では3画になることがある
 * @param {Glyph} glyph
 * @param {{fonts: {key: string, name: string, ok: boolean}[]} | null} gothicMeta meta.json の gothic
 * @returns {{usable: false, base: string}
 *   | {usable: true, char: string, ucs: string, fonts: GothicPrintFont[], preview: GothicPreview | null, kusa: boolean}
 *   | null} 判定データが無ければ null
 */
export function gothicPrint(glyph, gothicMeta) {
  const status = gothicStatus(glyph, gothicMeta);
  if (!status || !glyph.char) return null;
  if (!glyph.impl) return { usable: false, base: String.fromCodePoint(/** @type {number} */ (glyph.char.codePointAt(0))) };
  const has = new Set(glyph.gothic ?? []);
  const available = GOTHIC_PRINT_FONTS.filter((f) => has.has(f.key));
  return {
    usable: true,
    char: keyToChar(glyph.impl),
    ucs: glyph.impl,
    fonts: status.mark === '○' ? available.filter((f) => f.installed) : available,
    preview: GOTHIC_PREVIEW.find((p) => has.has(p.key)) ?? null,
    kusa: status.mark === '△' && Boolean(glyph.radicals?.some(([r]) => r === KUSA_RADICAL)),
  };
}

const DICT_ORDER = ['daikanwa', 'daijigen', 'shinDaijiten', 'daikangorin', 'nihongoKanji'];

/** @typedef {[label: string, value: unknown]} DetailRow 詳細の1行（値が空の行は出さない） */

/**
 * 字形詳細ダイアログ用のセクション構造を生成する。
 * DOM に依存せず、純粋なデータ構造を返す（tests/glyph-info.test.mjs でテスト）。
 *
 * @param {import('../db.js').Glyph} glyph 字形オブジェクト
 * @param {{fonts: {key: string, name: string, ok: boolean}[]} | null} [gothicMeta]
 * @returns {Array<{ id: string, title: string, rows: Array<[string, ...any]> }>}
 */
export function glyphDetailSections(glyph, gothicMeta = null) {
  const gothic = gothicStatus(glyph, gothicMeta);

  // 1. 文字符号・規格
  /** @type {DetailRow[]} */
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
  /** @type {DetailRow[]} */
  const attrRows = [
    ['部首・内画数', glyph.radicals?.map(([r, s]) => `${radicalChar(r)}（${r}）+${s ?? '?'}`).join(' / ')],
    ['総画数', glyph.strokes],
    ['読み', glyph.readings?.join('・')],
    ['漢字施策', glyph.policy],
    ['MJ文字図形バージョン', glyph.version],
    ['備考', glyph.note],
  ];

  // 3. 公的典拠・行政コード（出典）
  /** @type {DetailRow[]} */
  const officialRows = [
    ['戸籍統一文字番号', glyph.koseki],
    ['住基ネット統一文字コード', glyph.juki],
    ['登記統一文字番号', glyph.touki],
    ['入管正字コード', glyph.nyukanSei],
    ['入管外字コード', glyph.nyukanGai],
  ];

  // 4. 漢和辞典の典拠（出典）
  /** @type {DetailRow[]} */
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
  /** @type {DetailRow[]} */
  const shrinkRows = [];
  if (glyph.shrink && Object.keys(glyph.shrink).length > 0) {
    shrinkRows.push(['MJ縮退マップ', glyph.shrink]);
  }

  /** @param {DetailRow[]} rows */
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

