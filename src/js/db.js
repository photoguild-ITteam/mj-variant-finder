// 異体字データベース: search-index.json の読み込み、検索、詳細シャードの遅延読み込み。
// DOM に依存しないので Node からもテストできる。

export const FLAG_JOUYOU = 1;
export const FLAG_JINMEI = 2;
export const FLAG_IVS = 4;

const PRIMARY_RELATIONS = new Set(['jis', 'kokuji582', 'koseki', 'dict', 'analogy', 'compat', 'ivs']);
const RELATION_ORDER = ['koseki', 'kokuji582', 'jis', 'compat', 'ivs', 'dict', 'analogy'];

export const isVariationSelector = (cp) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

/** 異体字セレクタの番号（U+FE00 = VS1、U+E0100 = VS17）. */
export const vsNumber = (cp) => (cp >= 0xe0100 ? cp - 0xe0100 + 17 : cp - 0xfe00 + 1);

export const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

/** インデックスのキー（"9089"）→ 文字 */
export const keyToChar = (key) => String.fromCodePoint(parseInt(key, 16));

/** "9089_E010F" → [0x9089, 0xE010F] */
export const parseSequence = (seq) => seq.split('_').map((h) => parseInt(h, 16));

export const sequenceToString = (seq) => String.fromCodePoint(...parseSequence(seq));

export const toHiragana = (text) =>
  text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

/** 康熙部首番号 → 部首文字（U+2F00 康熙部首ブロック） */
export const radicalChar = (n) => (n >= 1 && n <= 214 ? String.fromCodePoint(0x2f00 + n - 1) : '');

/** 字形のコードポイント列（コピーや表記の元になる）. */
export function glyphCodepoints(glyph) {
  return [...glyph.char].map((ch) => ch.codePointAt(0));
}

export function copyFormats(glyph) {
  const cps = glyphCodepoints(glyph);
  return {
    char: glyph.char,
    mj: glyph.mj,
    unicode: cps.map((cp) => `U+${hex(cp)}`).join(' '),
    html: cps.map((cp) => `&#x${hex(cp)};`).join(''),
    js: cps.map((cp) => `\\u{${hex(cp)}}`).join(''),
  };
}

export const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/;
const NAME_GROUP_LIMIT = 4; // 1 種別あたりに出す読みの数（完全一致 + 前方一致）
const MJ_CODE = /^mj\s*0*(\d{1,6})$/i;
const CODE_TOKEN = /(?:u\+|0x|&#x)?([0-9a-f]{4,6})(?:;)?(?:_([0-9a-f]{4,5}))?|&#(\d{4,7});/gi;
const CODE_QUERY = /^(?:\s*(?:(?:u\+|0x|&#x)?[0-9a-f]{4,6};?(?:_[0-9a-f]{4,5})?|&#\d{4,7};)[\s,]*)+$/i;

export class VariantDB {
  /**
   * @param {object} index search-index.json
   * @param {object} meta meta.json
   * @param {(url: URL) => Promise<any>} fetchJson
   * @param {URL} baseUrl src/data/ の URL
   */
  constructor(index, meta, fetchJson, baseUrl) {
    this.index = index;
    this.meta = meta;
    this.fetchJson = fetchJson;
    this.baseUrl = baseUrl;
    this.shards = new Map();
    this._mjToKey = null;
    this._readingKeys = Object.keys(index.readings);
    this._nameKeys = Object.keys(index.names);
    /** names.json（姓・名・地名・異体字の置き換え）。ensureNames() で読み込む */
    this.names = null;
    this._namesPromise = null;
    /** nicknames.json（はしごだか などの呼び名と部首名）。ensureNicknames() で読み込む */
    this.nicknames = null;
    this._nicknamesPromise = null;
    this._radicalNames = [];
  }

  static async load(baseUrl = new URL('../data/', import.meta.url), fetchJson = defaultFetchJson) {
    const [index, meta] = await Promise.all([
      fetchJson(new URL('search-index.json', baseUrl)),
      fetchJson(new URL('meta.json', baseUrl)),
    ]);
    return new VariantDB(index, meta, fetchJson, baseUrl);
  }

  // ------------------------------------------------------------------ 参照

  /** コードポイント → インデックスのキー（互換漢字は対応UCSへ）. 未収録なら null */
  resolve(cp) {
    const key = hex(cp);
    if (this.index.chars[key]) return key;
    const alias = this.index.aliases[key];
    return alias && this.index.chars[alias] ? alias : null;
  }

  entry(key) {
    const row = this.index.chars[key];
    if (!row) return null;
    const [mjs, strokes, radical, flags] = row;
    return {
      key,
      char: keyToChar(key),
      mjs,
      glyphCount: mjs.length,
      strokes,
      radical,
      flags,
      jouyou: Boolean(flags & FLAG_JOUYOU),
      jinmei: Boolean(flags & FLAG_JINMEI),
      hasIVS: Boolean(flags & FLAG_IVS),
    };
  }

  findMJ(num) {
    if (!this._mjToKey) {
      this._mjToKey = new Map();
      for (const [key, [mjs]] of Object.entries(this.index.chars)) {
        for (const n of mjs) this._mjToKey.set(n, key);
      }
      for (const n of this.index.noChar) this._mjToKey.set(n, null);
    }
    return this._mjToKey.has(num) ? { key: this._mjToKey.get(num) } : null;
  }

  shardName(key) {
    return (parseInt(key, 16) >> this.index.shardBits).toString(16).toUpperCase();
  }

  async loadShard(name) {
    if (!this.shards.has(name)) {
      const promise = this.fetchJson(new URL(`chars/${name}.json`, this.baseUrl));
      promise.catch(() => this.shards.delete(name));
      this.shards.set(name, promise);
    }
    return this.shards.get(name);
  }

  /** @returns {Promise<{glyphs: object[], related?: object[]}>} */
  async detail(key) {
    const shard = await this.loadShard(this.shardName(key));
    return shard[key];
  }

  async noCharGlyph(num) {
    const data = await this.loadShard('none');
    return data.glyphs.find((g) => g.mj === formatMJ(num)) ?? null;
  }

  /** 関連字を「MJ縮退マップ等に基づく関連」と「Unihan のみ（参考）」に分けて返す. */
  async related(key) {
    const detail = await this.detail(key);
    const primary = [];
    const reference = [];
    for (const rel of detail.related ?? []) {
      const kinds = [...new Set([...rel.out, ...rel.in])];
      const item = {
        key: rel.ucs,
        char: keyToChar(rel.ucs),
        out: rel.out,
        in: rel.in,
        kinds: kinds.sort((a, b) => relationRank(a) - relationRank(b)),
        entry: this.entry(rel.ucs),
      };
      (kinds.some((k) => PRIMARY_RELATIONS.has(k)) ? primary : reference).push(item);
    }
    // 常用・人名用 → BMP（入力しやすい）→ 字形数の多い順 → 関係の種別 → コードポイント
    const score = (r) => {
      const flags = r.entry?.flags ?? 0;
      return (flags & (FLAG_JOUYOU | FLAG_JINMEI) ? 0 : 2) + (parseInt(r.key, 16) < 0x10000 ? 0 : 1);
    };
    const byRank = (a, b) => score(a) - score(b)
      || (b.entry?.glyphCount ?? 0) - (a.entry?.glyphCount ?? 0)
      || relationRank(a.kinds[0]) - relationRank(b.kinds[0])
      || parseInt(a.key, 16) - parseInt(b.key, 16);
    return { primary: primary.sort(byRank), reference: reference.sort(byRank) };
  }

  /**
   * 人名・地名の辞書（src/data/names.json、約1.7MB）を読み込む.
   * 読み検索のときだけ必要なので、最初のかな検索で呼ぶ。失敗しても検索自体は続けられる。
   */
  async ensureNames() {
    this._namesPromise ??= this.fetchJson(new URL('names.json', this.baseUrl))
      .then((data) => { this.names = data; return data; })
      .catch((err) => { this._namesPromise = null; throw err; });
    return this._namesPromise;
  }

  /**
   * 字の呼び名と部首名の辞書（src/data/nicknames.json、数KB）を読み込む. 読み検索のときだけ必要.
   */
  async ensureNicknames() {
    this._nicknamesPromise ??= this.fetchJson(new URL('nicknames.json', this.baseUrl))
      .then((data) => {
        this.nicknames = data;
        // 長い名前から試す（「ぎょうにんべん」を「にんべん」より先に）
        this._radicalNames = data.radicals
          .flatMap((r) => r.names.map((name) => ({ name, radicals: [r.radical].flat() })))
          .sort((a, b) => b.name.length - a.name.length);
        return data;
      })
      .catch((err) => { this._nicknamesPromise = null; throw err; });
    return this._nicknamesPromise;
  }

  /** 字の部首（一覧表は1字に部首を4つまで持つ。最初のものが chars に、残りが extraRadicals にある） */
  radicalsOf(key) {
    return [this.index.chars[key][2], ...(this.index.extraRadicals?.[key] ?? [])];
  }

  relationLabel(kind) {
    return this.meta.relationTypes[kind] ?? kind;
  }

  // ------------------------------------------------------------------ 検索

  /**
   * @param {string} rawQuery
   * @param {{strokesMin?: number, strokesMax?: number, radical?: number, ivsOnly?: boolean, policy?: string}} filters
   */
  search(rawQuery, filters = {}) {
    // NFKC 正規化はしない（互換漢字や IVS が別の文字に置き換わってしまうため）
    const query = rawQuery.trim();
    const hasFilter = isFilterActive(filters);

    if (!query) {
      if (!hasFilter) return { type: 'empty' };
      const keys = Object.keys(this.index.chars).filter((k) => this.matchesFilter(k, filters));
      return { type: 'filter', candidates: this.rank(keys), total: keys.length };
    }

    const mj = query.match(MJ_CODE);
    if (mj) {
      const num = Number(mj[1]);
      const found = this.findMJ(num);
      if (!found) return { type: 'notfound', query, reason: `${formatMJ(num)} は MJ文字情報一覧表にありません。` };
      if (!found.key) return { type: 'nochar', query, mj: num };
      return { type: 'code', query, chars: [{ key: found.key, focus: { mj: formatMJ(num) } }] };
    }

    if (CODE_QUERY.test(query)) return this.searchCodes(query);

    if (KANA_ONLY.test(query)) return this.searchReading(query, filters);

    return this.searchText(query);
  }

  searchText(query) {
    const chars = [];
    const seen = new Map();
    const unknown = [];
    const cps = [...query].map((ch) => ch.codePointAt(0));
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (isVariationSelector(cp) || /\s/u.test(String.fromCodePoint(cp))) continue;
      const next = cps[i + 1];
      const seq = next && isVariationSelector(next) ? `${hex(cp)}_${hex(next)}` : null;
      const key = this.resolve(cp);
      if (!key) {
        unknown.push(String.fromCodePoint(cp));
        continue;
      }
      if (seen.has(key)) {
        if (seq && !seen.get(key).focus) seen.get(key).focus = { ivs: seq };
        continue;
      }
      const item = { key, focus: seq ? { ivs: seq } : cp !== parseInt(key, 16) ? { impl: hex(cp) } : null };
      seen.set(key, item);
      chars.push(item);
    }
    if (!chars.length) {
      return { type: 'notfound', query, reason: `「${unknown.join('')}」は MJ文字情報一覧表に収録されていません。` };
    }
    return { type: 'text', query, chars, unknown };
  }

  searchCodes(query) {
    const chars = [];
    const selectors = [];
    let last = null;
    for (const m of query.matchAll(CODE_TOKEN)) {
      const cp = m[3] ? Number(m[3]) : parseInt(m[1], 16);
      const vs = m[2] ? parseInt(m[2], 16) : null;
      if (isVariationSelector(cp)) {
        if (last && !last.focus) last.focus = { ivs: `${last.key}_${hex(cp)}` };
        else if (!last) selectors.push(cp);
        continue;
      }
      const key = this.resolve(cp);
      if (!key) continue;
      last = { key, focus: vs ? { ivs: `${hex(cp)}_${hex(vs)}` } : null };
      chars.push(last);
    }
    if (!chars.length && selectors.length) {
      return {
        type: 'notfound',
        query,
        reason: `U+${hex(selectors[0])} は異体字セレクタ（VS${vsNumber(selectors[0])}）です。単体では文字が決まらないため、基底文字と組み合わせて入力してください（例: U+9089 U+${hex(selectors[0])}）。`,
      };
    }
    if (!chars.length) return { type: 'notfound', query, reason: 'このコードポイントの文字は MJ文字情報一覧表に収録されていません。' };
    return { type: 'code', query, chars };
  }

  searchReading(query, filters) {
    const reading = toHiragana(query).replace(/ー/g, '');
    const names = this.nameGroups(reading);

    const exact = new Set(this.index.readings[reading] ?? []);
    const prefix = new Set();
    if (reading.length >= 1) {
      for (const r of this._readingKeys) {
        if (r !== reading && r.startsWith(reading)) {
          for (const k of this.index.readings[r]) if (!exact.has(k)) prefix.add(k);
        }
      }
    }
    const filtered = (keys) => [...keys].filter((k) => this.matchesFilter(k, filters));
    const exactKeys = this.rank(filtered(exact));
    const prefixKeys = this.rank(filtered(prefix));
    const candidates = [...exactKeys, ...prefixKeys];
    const nicknames = this.nicknameMatches(reading);
    // 「やまへんのさき」のような部首名つきの言い方（読みそのものに一致する字があるときは試さない）
    const byRadical = exact.size ? null : this.radicalReading(reading, filters);
    if (!candidates.length && !names.length && !nicknames.length && !byRadical) {
      return { type: 'notfound', query, reason: `読み「${reading}」に一致する文字が見つかりません。` };
    }
    return { type: 'reading', query, reading, names, nicknames, byRadical, candidates, exactCount: exactKeys.length, total: candidates.length };
  }

  /**
   * 呼び名（はしごだか など）に一致する字. 完全一致を先に、2文字以上なら前方一致も.
   * @returns {{name: string, note: string, exact: boolean, targets: {query: string, char: string, mj?: string}[]}[]}
   */
  nicknameMatches(reading) {
    if (!this.nicknames) return [];
    const found = [];
    for (const entry of this.nicknames.nicknames) {
      const name = entry.names.find((n) => n === reading) ?? (reading.length >= 2 ? entry.names.find((n) => n.startsWith(reading)) : null);
      if (!name) continue;
      const targets = entry.targets.map((code, i) => {
        const char = code.split('_').map((c) => String.fromCodePoint(parseInt(c, 16))).join('');
        // IVS 付きは字形を指すので、コードで検索してその字形を強調する
        return { query: code.includes('_') ? code : char, char, mj: entry.mj?.[i] };
      });
      found.push({ name, note: entry.note, targets, exact: name === reading });
    }
    return found.sort((a, b) => Number(b.exact) - Number(a.exact));
  }

  /**
   * 「〇〇へんの〇〇」（部首名＋の＋読み）に一致する字.
   * @returns {{radicalName: string, reading: string, keys: string[]} | null}
   */
  radicalReading(reading, filters) {
    for (const { name, radicals } of this._radicalNames) {
      if (!reading.startsWith(`${name}の`)) continue;
      const rest = reading.slice(name.length + 1);
      const keys = (this.index.readings[rest] ?? [])
        .filter((k) => this.radicalsOf(k).some((r) => radicals.includes(r)) && this.matchesFilter(k, filters));
      if (keys.length) return { radicalName: name, reading: rest, keys: this.rank(keys) };
    }
    return null;
  }

  /**
   * 読みに一致する人名・地名の表記。names.json があればそれを使い、無ければ手作業のプリセットだけを返す。
   * @returns {{kind: string, reading: string, words: string[]}[]}
   */
  nameGroups(reading) {
    const sources = this.names
      ? [['姓', this.names.surnames], ['名', this.names.given], ['地名', this.names.places], ['異体字での表記', this.names.variants]]
      : [['姓・地名', this.index.names]];
    const groups = [];
    for (const [kind, map] of sources) {
      // 完全一致を先に、前方一致は読みの短い順（「わたなべ」に対する「わたなべまちひるの」より「わたなべどおり」を優先）
      const readings = Object.keys(map)
        .filter((k) => k === reading || (reading.length >= 2 && k.startsWith(reading)))
        .sort((a, b) => (a === reading ? -1 : b === reading ? 1 : a.length - b.length || a.localeCompare(b, 'ja')))
        .slice(0, NAME_GROUP_LIMIT);
      for (const key of readings) groups.push({ kind, reading: key, words: map[key] });
    }
    return groups;
  }

  matchesFilter(key, { strokesMin, strokesMax, radical, ivsOnly, policy } = {}) {
    const [, strokes, , flags] = this.index.chars[key];
    if (strokesMin && strokes < strokesMin) return false;
    if (strokesMax && strokes > strokesMax) return false;
    if (radical && !this.radicalsOf(key).includes(radical)) return false;
    if (ivsOnly && !(flags & FLAG_IVS)) return false;
    if (policy === 'jouyou' && !(flags & FLAG_JOUYOU)) return false;
    if (policy === 'jinmei' && !(flags & FLAG_JINMEI)) return false;
    if (policy === 'hyougai' && flags & (FLAG_JOUYOU | FLAG_JINMEI)) return false;
    return true;
  }

  /** 常用 → 人名用 → IVSあり → 画数 → コードポイント の順に並べる. */
  rank(keys) {
    const score = (k) => {
      const [, , , flags] = this.index.chars[k];
      return (flags & FLAG_JOUYOU ? 0 : flags & FLAG_JINMEI ? 1 : 2) * 2 + (flags & FLAG_IVS ? 0 : 1);
    };
    return keys.sort((a, b) => {
      return score(a) - score(b) || this.index.chars[a][1] - this.index.chars[b][1] || parseInt(a, 16) - parseInt(b, 16);
    });
  }
}

export function isFilterActive(filters = {}) {
  return Boolean(filters.strokesMin || filters.strokesMax || filters.radical || filters.ivsOnly || (filters.policy && filters.policy !== 'all'));
}

export const formatMJ = (num) => `MJ${String(num).padStart(6, '0')}`;

function relationRank(kind) {
  const i = RELATION_ORDER.indexOf(kind);
  return i === -1 ? RELATION_ORDER.length : i;
}

/** 配信側でログインが必要（401/403）と言われたとき。config.sessionWatch を設定した場合だけ、画面で案内する */
export class AuthRequiredError extends Error {
  constructor(url) {
    super('ログインの有効期限が切れたか、ログインしていません');
    this.name = 'AuthRequiredError';
    this.url = String(url);
  }
}

export async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (res.status === 401 || res.status === 403) throw new AuthRequiredError(url);
  if (!res.ok) throw new Error(`${url} の読み込みに失敗しました (${res.status})`);
  return res;
}

async function defaultFetchJson(url) {
  return (await fetchOk(url)).json();
}
