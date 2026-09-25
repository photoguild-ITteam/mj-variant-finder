#!/usr/bin/env python3
"""IPAmj明朝 異体字検索用データベースのビルドスクリプト.

入力（data/raw/ に配置。無ければ公式配布元から自動ダウンロード）:
  - MJ文字情報一覧表 Ver.006.02 (mji.00602.xlsx)            CC BY-SA 2.1 JP / CITPC
  - MJ縮退マップ Ver.1.2.0 (MJShrinkMap.1.2.0.json)           CC BY-SA 2.1 JP / IPA
  - Unicode IVD 2026-08-03 (IVD_Sequences.txt)                Unicode License
  - Unihan Database (Unihan.zip, Unihan_Variants.txt のみ使用)  Unicode License

出力（src/data/）:
  - meta.json          ビルド情報・出典・ライセンス・件数
  - search-index.json  検索用の軽量インデックス（文字 / 互換漢字エイリアス / MJ番号 / 読み / 人名プリセット）
  - chars/<shard>.json UCS単位の詳細データ（MJ字形一覧・縮退情報・関連字）。
                       shard = (コードポイント >> SHARD_BITS) の16進大文字表記

使い方:
  python scripts/build_variant_db.py [--raw data/raw] [--out src/data] [--offline]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARD_BITS = 10

SOURCES = {
    "mji": {
        "file": "mji.00602.xlsx",
        "url": "https://moji.or.jp/wp-content/uploads/2024/01/mji.00602.xlsx",
        "title": "MJ文字情報一覧表 Ver.006.02",
        "publisher": "一般社団法人 文字情報技術促進協議会 (CITPC)",
        "license": "CC BY-SA 2.1 JP",
        "page": "https://moji.or.jp/mojikiban/mjlist/",
        "sha256": "f79075bf006b66c5e57a6df60503c5a01679cabbcea2f124eb3758593cf6fd3f",
    },
    "shrink": {
        "file": "MJShrinkMap.1.2.0.json",
        "url": "https://moji.or.jp/wp-content/mojikiban/oscdl/MJShrinkMap.1.2.0.json",
        "title": "MJ縮退マップ Ver.1.2.0",
        "publisher": "独立行政法人 情報処理推進機構 (IPA) / CITPC",
        "license": "CC BY-SA 2.1 JP",
        "page": "https://moji.or.jp/mojikiban/map/",
        "sha256": "275b57ecd5929edb822c05a7e4326980b7028466384afe323ed7209f48acd8cd",
    },
    "ivd": {
        "file": "IVD_Sequences.2026-08-03.txt",
        "url": "https://www.unicode.org/ivd/data/2026-08-03/IVD_Sequences.txt",
        "title": "Ideographic Variation Database 2026-08-03",
        "publisher": "Unicode, Inc.",
        "license": "Unicode License v3",
        "page": "https://www.unicode.org/ivd/",
        "sha256": "2b466659c2bfde1c52e60bd9fc883ab14dfa5c583df024b80352420265d2cd87",
    },
    "unihan": {
        "file": "Unihan.18.0.0.zip",
        "url": "https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip",
        "title": "Unihan Database (Unicode 18.0.0)",
        "publisher": "Unicode, Inc.",
        "license": "Unicode License v3",
        "page": "https://www.unicode.org/reports/tr38/",
        "sha256": "4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e",
    },
}

# MJ文字情報一覧表の列見出し → 出力キー
MJ_COLUMNS = {
    "MJ文字図形名": "mj",
    "対応するUCS": "ucs",
    "実装したUCS": "impl",
    "実装したMoji_JohoコレクションIVS": "ivs",
    "実装したSVS": "svs",
    "戸籍統一文字番号": "koseki",
    "住基ネット統一文字コード": "juki",
    "入管正字コード": "nyukanSei",
    "入管外字コード": "nyukanGai",
    "漢字施策": "policy",
    "対応する互換漢字": "compat",
    "X0213": "x0213",
    "X0213 包摂区分": "x0213Class",
    "X0212": "x0212",
    "MJ文字図形バージョン": "version",
    "登記統一文字番号(参考)": "touki",
    "総画数(参考)": "strokes",
    "読み(参考)": "readings",
    "大漢和": "daikanwa",
    "日本語漢字辞典": "nihongoKanji",
    "新大字典": "shinDaijiten",
    "大字源": "daijigen",
    "大漢語林": "daikangorin",
    "備考": "note",
}
DICT_KEYS = ("daikanwa", "nihongoKanji", "shinDaijiten", "daijigen", "daikangorin")

# MJ縮退マップのカテゴリ → 関連種別キー
SHRINK_TYPES = {
    "JIS包摂規準・UCS統合規則": "jis",
    "法務省告示582号別表第四": "kokuji582",
    "法務省戸籍法関連通達・通知": "koseki",
    "辞書類等による関連字": "dict",
    "読み・字形による類推": "analogy",
}

# Unihan の異体字フィールド（kSpoofingVariant は字形の紛らわしさで異体字ではないため除外）
UNIHAN_FIELDS = {
    "kSemanticVariant": "unihanSemantic",
    "kSpecializedSemanticVariant": "unihanSpecialized",
    "kZVariant": "unihanZ",
    "kTraditionalVariant": "unihanTraditional",
    "kSimplifiedVariant": "unihanSimplified",
}

POLICY_FLAGS = {"常用漢字": 1, "人名用漢字": 2}
FLAG_IVS = 4

# meta.json の relationTypes（関連種別キー → 画面に出す説明）
RELATION_TYPES = {
    "jis": "JIS包摂規準・UCS統合規則",
    "kokuji582": "法務省告示582号別表第四",
    "koseki": "法務省戸籍法関連通達・通知",
    "dict": "辞書類等による関連字",
    "analogy": "読み・字形による類推",
    "compat": "互換漢字（実装したUCS）",
    "ivs": "別UCSを基底とするIVSで登録された字形",
    **{key: f"Unihan {field}（参考・中国語圏の対応を含む）" for field, key in UNIHAN_FIELDS.items()},
}

PRESETS_PATH = ROOT / "scripts" / "data" / "name_presets.json"

# 「ゴシック体で使えるか」の判定に使うフォント（文字の収録状況＝cmap だけを読む。フォント自体は配布しない）.
# Moji_Joho の IVS に対応したゴシック体は無いため、ゴシック体で出せるのは「実装したUCS」を持つ字形だけ。
#   ok=True のフォントすべてに字があれば ○、欠けていれば △、実装したUCS が無い（IVS でしか区別できない）字形は ×
# 判定に使うのは、誰でも入手・再配布できる SIL Open Font License のフォントだけにする。
# ok=True のフォントすべてに字があれば ○（BIZ UDゴシックの字は Noto Sans JP にすべて含まれるので参考表示）
GOTHIC_FONTS = [
    {"key": "noto", "name": "Noto Sans JP", "ok": True,
     "paths": ["data/raw/NotoSansJP-VF.ttf", r"C:\Windows\Fonts\NotoSansJP-VF.ttf",
               "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]},
    {"key": "biz", "name": "BIZ UDゴシック", "ok": False,
     "paths": ["data/raw/BIZUDGothic-Regular.ttf", r"C:\Windows\Fonts\BIZ-UDGothicR.ttc"]},
]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- 入力

def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def verify_sha256(path: Path, expected: str) -> None:
    actual = sha256_of(path)
    if actual != expected:
        sys.exit(
            f"SHA256 不一致 ({path.name}):\n"
            f"  期待値: {expected}\n"
            f"  実際値: {actual}\n"
            f"ファイルが破損しているか、新しい版に変更されている可能性があります。"
        )


def ensure_sources(raw: Path, offline: bool) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    for src in SOURCES.values():
        path = raw / src["file"]
        expected_sha = src.get("sha256")
        if path.exists():
            if expected_sha:
                verify_sha256(path, expected_sha)
            continue
        if offline:
            sys.exit(f"missing {path} (--offline のためダウンロードしません)")
        log(f"download {src['url']}")
        req = urllib.request.Request(src["url"], headers={"User-Agent": "IPAmjWEB-build/1.0"})
        tmp = path.with_suffix(path.suffix + ".part")
        try:
            with urllib.request.urlopen(req, timeout=300) as res, tmp.open("wb") as out:
                while chunk := res.read(65536):
                    out.write(chunk)
            if expected_sha:
                actual_sha = sha256_of(tmp)
                if actual_sha != expected_sha:
                    if tmp.exists():
                        tmp.unlink()
                    sys.exit(
                        f"SHA256 不一致 ({src['file']}):\n"
                        f"  期待値: {expected_sha}\n"
                        f"  実際値: {actual_sha}\n"
                        f"ダウンロードしたファイルが破損しているか、内容が変更されています。"
                    )
            tmp.replace(path)
        except BaseException:
            if tmp.exists():
                tmp.unlink()
            raise


def read_strict_xlsx(path: Path) -> list[dict[str, str]]:
    """Strict OOXML 形式の xlsx（openpyxl 非対応）を最初のシートだけ読む."""
    ns = "{http://purl.oclc.org/ooxml/spreadsheetml/main}"
    ns_transitional = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    def tag(el: ET.Element, name: str) -> bool:
        return el.tag in (ns + name, ns_transitional + name)

    def text_of(el: ET.Element) -> str:
        return "".join(t.text or "" for t in el.iter() if tag(t, "t"))

    def col_index(ref: str) -> int:
        n = 0
        for ch in re.match(r"[A-Z]+", ref).group():
            n = n * 26 + ord(ch) - 64
        return n - 1

    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        for _, el in ET.iterparse(z.open("xl/sharedStrings.xml")):
            if tag(el, "si"):
                shared.append(text_of(el))
                el.clear()

        header: dict[int, str] | None = None
        records: list[dict[str, str]] = []
        for _, el in ET.iterparse(z.open("xl/worksheets/sheet1.xml")):
            if not tag(el, "row"):
                continue
            cells: dict[int, str] = {}
            for c in el:
                if not tag(c, "c"):
                    continue
                v = next((x for x in c if tag(x, "v")), None)
                if v is not None:
                    value = shared[int(v.text)] if c.get("t") == "s" else (v.text or "")
                else:
                    inline = next((x for x in c if tag(x, "is")), None)
                    value = text_of(inline) if inline is not None else ""
                if value != "":
                    cells[col_index(c.get("r"))] = value
            el.clear()
            if header is None:
                header = cells
            else:
                records.append({header[i]: v for i, v in cells.items() if i in header})
    return records


def read_ivd(path: Path) -> tuple[dict[str, str], dict[str, int]]:
    """Moji_Joho コレクションの IVS → MJ文字図形名 と、コレクション別件数を返す."""
    moji_joho: dict[str, str] = {}
    counts: dict[str, int] = defaultdict(int)
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        seq, collection, ident = (s.strip() for s in line.split(";"))
        counts[collection] += 1
        if collection == "Moji_Joho":
            moji_joho[seq.replace(" ", "_")] = ident
    return moji_joho, dict(counts)


def read_unihan_variants(path: Path) -> dict[int, dict[str, set[int]]]:
    result: dict[int, dict[str, set[int]]] = defaultdict(lambda: defaultdict(set))
    with zipfile.ZipFile(path) as z:
        text = z.read("Unihan_Variants.txt").decode("utf-8")
    for line in text.splitlines():
        if not line.startswith("U+"):
            continue
        cp, field, value = line.split("\t")
        if field not in UNIHAN_FIELDS:
            continue
        for token in value.split():
            target = token.split("<")[0]
            result[parse_ucs(cp)][UNIHAN_FIELDS[field]].add(parse_ucs(target))
    return result


def resolve_path(value: str) -> Path:
    """相対パスはリポジトリ直下から."""
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def read_gothic_fonts(overrides: dict[str, str]) -> list[dict]:
    """GOTHIC_FONTS のうち見つかったフォントの cmap を読む. fontTools が無ければ判定を省く."""
    try:
        from fontTools.ttLib import TTCollection, TTFont
    except ImportError:
        log("warning: fontTools が無いため、ゴシック体の収録判定を省きます（pip install fonttools）")
        return []
    loaded = []
    for spec in GOTHIC_FONTS:
        candidates = [overrides[spec["key"]]] if spec["key"] in overrides else spec["paths"]
        path = next((p for p in map(resolve_path, candidates) if p.exists()), None)
        if path is None:
            log(f"warning: {spec['name']} が見つからないため、ゴシック体の判定から外します（--gothic-font {spec['key']}=パス で指定可）")
            continue
        font = TTCollection(str(path), lazy=True).fonts[0] if path.suffix.lower() == ".ttc" else TTFont(str(path), lazy=True)
        version = font["name"].getDebugName(5) or ""
        loaded.append({**spec, "file": path.name, "version": version, "cmap": set(font.getBestCmap())})
        log(f"  {spec['name']}: {path.name} {version} ({len(loaded[-1]['cmap'])} codepoints)")
    if not any(f["ok"] for f in loaded):
        log("warning: ○ の判定に使うゴシック体が1つも無いため、ゴシック体の収録判定を省きます")
        return []
    return loaded


# --------------------------------------------------------------------------- 変換

def parse_ucs(value: str) -> int:
    return int(value.removeprefix("U+"), 16)


def hex_cp(cp: int) -> str:
    return f"{cp:04X}"


def parse_ivs(value: str) -> tuple[int, int]:
    base, vs = value.split("_")
    return int(base, 16), int(vs, 16)


def ivs_string(value: str) -> str:
    base, vs = parse_ivs(value)
    return chr(base) + chr(vs)


def kata_to_hira(text: str) -> str:
    return "".join(chr(ord(ch) - 0x60) if "ァ" <= ch <= "ヶ" else ch for ch in text)


def jis_level(x0213: str | None) -> str | None:
    """JIS X 0213 面区点 → 水準."""
    if not x0213:
        return None
    plane, row, cell = (int(n) for n in x0213.split("-"))
    if plane == 2:
        return "第4水準"
    if row <= 13:
        return "非漢字"
    if 16 <= row <= 46 or (row == 47 and cell <= 51):
        return "第1水準"
    if 48 <= row <= 83 or (row == 84 and cell <= 6):
        return "第2水準"
    return "第3水準"


def to_int(value: str | None) -> int | None:
    return int(value) if value and value.isdigit() else None


def to_version(value: str | None) -> int | float | None:
    if not value:
        return None
    try:
        f = round(float(value), 4)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None


def build_glyph(rec: dict[str, str], ivd_by_mj: dict[str, list[str]]) -> dict:
    g: dict = {}
    for src_key, key in MJ_COLUMNS.items():
        if rec.get(src_key):
            g[key] = rec[src_key]

    ivs_list = g.pop("ivs", "").split(";") if g.get("ivs") else []
    ivd_only = [s for s in ivd_by_mj.get(g["mj"], []) if s not in ivs_list]
    ivs_list += ivd_only
    if ivs_list:
        g["ivs"] = ivs_list
    if ivd_only:
        g["ivdOnly"] = ivd_only

    for key in ("ucs", "impl", "compat"):
        if key in g:
            g[key] = hex_cp(parse_ucs(g[key]))

    if "ucs" not in g and ivs_list:
        g["ucs"] = hex_cp(parse_ivs(ivs_list[0])[0])

    # コピー用の文字列: 登録済み IVS を優先し、無ければ実装した UCS
    registered = [s for s in ivs_list if s not in ivd_only]
    if registered:
        g["char"] = ivs_string(registered[0])
    elif "impl" in g:
        g["char"] = chr(int(g["impl"], 16))
    elif ivs_list:
        g["char"] = ivs_string(ivs_list[0])

    g["mjNum"] = int(g["mj"][2:])
    if "strokes" in g:
        g["strokes"] = to_int(g["strokes"])
    if "version" in g:
        g["version"] = to_version(g["version"])
    if "readings" in g:
        g["readings"] = [r for r in g["readings"].split("・") if r]
    level = jis_level(g.get("x0213"))
    if level:
        g["jisLevel"] = level

    radicals = []
    for i in range(1, 5):
        rad = to_int(rec.get(f"部首{i}(参考)"))
        if rad:
            radicals.append([rad, to_int(rec.get(f"内画数{i}(参考)"))])
    if radicals:
        g["radicals"] = radicals

    dicts = {k: g.pop(k) for k in DICT_KEYS if k in g}
    if dicts:
        g["dict"] = dicts
    return g


def build_shrink(entry: dict) -> dict:
    out: dict = {}
    for src_key, key in SHRINK_TYPES.items():
        items = []
        for item in entry.get(src_key, []):
            x: dict = {"ucs": hex_cp(parse_ucs(item["UCS"]))}
            if item.get("JIS X 0213"):
                x["x0213"] = item["JIS X 0213"]
            if "表" in item:
                x["table"] = item["表"]
                x["rank"] = item["順位"]
            if "種別" in item:
                x["kind"] = item["種別"]
            if "ホップ数" in item:
                x["hops"] = item["ホップ数"]
            if "付記" in item:
                x["remark"] = item["付記"]
            items.append(x)
        if items:
            out[key] = items
    if entry.get("参考情報"):
        out["info"] = entry["参考情報"]
    return out


def load_name_presets(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


# --------------------------------------------------------------------------- ビルド

@dataclass
class Sources:
    records: list[dict[str, str]]           # MJ文字情報一覧表の行
    ivd_moji_joho: dict[str, str]           # Moji_Joho の IVS → MJ文字図形名
    ivd_counts: dict[str, int]              # IVD のコレクション別件数
    shrink_by_mj: dict[str, dict]           # MJ文字図形名 → MJ縮退マップの項目
    unihan: dict[int, dict[str, set[int]]]  # コードポイント → Unihan の異体字


@dataclass
class Grouped:
    chars: dict[int, dict]  # 対応UCS → {"glyphs": [...], "related": {相手UCS: {"out": set, "in": set}}}
    no_char: list[dict]     # UCS を持たない字形
    ivs_seen: set[str]      # 一覧表と IVD 追加分に現れた IVS


def load_sources(raw: Path, offline: bool) -> Sources:
    ensure_sources(raw, offline)
    log("read MJ文字情報一覧表 ...")
    records = read_strict_xlsx(raw / SOURCES["mji"]["file"])
    log(f"  {len(records)} records")
    log("read IVD ...")
    ivd_moji_joho, ivd_counts = read_ivd(raw / SOURCES["ivd"]["file"])
    log("read MJ縮退マップ ...")
    shrink_raw = json.loads((raw / SOURCES["shrink"]["file"]).read_text(encoding="utf-8"))
    log("read Unihan ...")
    return Sources(
        records=records,
        ivd_moji_joho=ivd_moji_joho,
        ivd_counts=ivd_counts,
        shrink_by_mj={e["MJ文字図形名"]: e for e in shrink_raw["content"]},
        unihan=read_unihan_variants(raw / SOURCES["unihan"]["file"]),
    )


def group_glyphs(src: Sources) -> Grouped:
    """字形（MJ）を作り、対応UCS ごとにまとめる."""
    ivd_by_mj: dict[str, list[str]] = defaultdict(list)
    for seq, mj in src.ivd_moji_joho.items():
        ivd_by_mj[mj].append(seq)

    grouped = Grouped(chars={}, no_char=[], ivs_seen=set())
    for rec in src.records:
        g = build_glyph(rec, ivd_by_mj)
        grouped.ivs_seen.update(g.get("ivs", []))
        shrink = build_shrink(src.shrink_by_mj.get(g["mj"], {}))
        if shrink:
            g["shrink"] = shrink
        if "ucs" in g:
            grouped.chars.setdefault(int(g["ucs"], 16), {"glyphs": [], "related": {}})["glyphs"].append(g)
        else:
            grouped.no_char.append(g)
    return grouped


def link_relations(chars: dict[int, dict], unihan: dict[int, dict[str, set[int]]]) -> None:
    """UCS 間の関連（1ホップ、方向付き）を chars[*]["related"] に入れる. 両方が MJ にある組だけ."""
    def add(src: int, dst: int, kind: str) -> None:
        if src == dst or src not in chars or dst not in chars:
            return
        chars[src]["related"].setdefault(dst, {"out": set(), "in": set()})["out"].add(kind)
        chars[dst]["related"].setdefault(src, {"out": set(), "in": set()})["in"].add(kind)

    for cp, entry in chars.items():
        for g in entry["glyphs"]:
            for kind, items in g.get("shrink", {}).items():
                if kind != "info":
                    for item in items:
                        add(cp, int(item["ucs"], 16), kind)
            if "impl" in g:
                add(cp, int(g["impl"], 16), "compat")
            for seq in g.get("ivs", []):
                add(cp, parse_ivs(seq)[0], "ivs")
        for kind, targets in unihan.get(cp, {}).items():
            for target in targets:
                add(cp, target, kind)


def annotate_gothic(chars: dict[int, dict], fonts: list[dict]) -> dict[str, int]:
    """実装したUCS を持つ字形に、その字があるゴシック体のキー一覧（glyph["gothic"]）を付ける."""
    counts = {"ok": 0, "partial": 0, "ivsOnly": 0}
    if not fonts:
        return counts
    required = [f["key"] for f in fonts if f["ok"]]
    for entry in chars.values():
        for g in entry["glyphs"]:
            if "impl" not in g:
                counts["ivsOnly"] += 1
                continue
            cp = int(g["impl"], 16)
            g["gothic"] = [f["key"] for f in fonts if cp in f["cmap"]]
            counts["ok" if all(k in g["gothic"] for k in required) else "partial"] += 1
    return counts


def public_glyph(g: dict) -> dict:
    """出力用（並べ替えに使う mjNum を除く）."""
    return {k: v for k, v in g.items() if k != "mjNum"}


def build_shards_and_index(chars: dict[int, dict]) -> tuple[dict[str, dict], dict[str, list], dict[str, set[str]], dict[str, list[int]]]:
    """詳細シャード、インデックスの chars、読み → UCS、2つ目以降の部首 を作る.

    一覧表は1字に部首を4つまで持つ（例: 解 は 刀 と 角）。chars には最初の部首だけを入れ、残りは extra_radicals に入れる
    （部首での絞り込みや「つのへんのかい」のような部首名での検索で、どちらの部首でも引けるようにする）。
    """
    shards: dict[str, dict] = defaultdict(dict)
    index_chars: dict[str, list] = {}
    readings: dict[str, set[str]] = defaultdict(set)
    extra_radicals: dict[str, list[int]] = {}
    for cp in sorted(chars):
        key = hex_cp(cp)
        glyphs = sorted(chars[cp]["glyphs"], key=lambda g: g["mjNum"])
        primary = next((g for g in glyphs if g.get("impl") == key), glyphs[0])
        flags = POLICY_FLAGS.get(primary.get("policy"), 0) | (FLAG_IVS if any("ivs" in g for g in glyphs) else 0)
        index_chars[key] = [
            [g["mjNum"] for g in glyphs],
            primary.get("strokes") or 0,
            primary["radicals"][0][0] if primary.get("radicals") else 0,
            flags,
        ]
        others = sorted({r for g in glyphs for r, _ in g.get("radicals", [])} - {index_chars[key][2]})
        if others:
            extra_radicals[key] = others
        for g in glyphs:
            for r in g.get("readings", []):
                readings[kata_to_hira(r)].add(key)

        shard_entry: dict = {"glyphs": [public_glyph(g) for g in glyphs]}
        related = [
            {"ucs": hex_cp(dst), "out": sorted(rel["out"]), "in": sorted(rel["in"])}
            for dst, rel in sorted(chars[cp]["related"].items())
        ]
        if related:
            shard_entry["related"] = related
        shards[f"{cp >> SHARD_BITS:X}"][key] = shard_entry
    return shards, index_chars, readings, extra_radicals


def build_aliases(chars: dict[int, dict]) -> dict[str, str]:
    """互換漢字など「実装したUCS」が対応UCSと異なる文字 → 対応UCS（例: 塚 U+FA10 → 塚 U+585A）."""
    return dict(sorted(
        (g["impl"], hex_cp(cp))
        for cp, entry in chars.items() for g in entry["glyphs"]
        if g.get("impl") and int(g["impl"], 16) != cp and int(g["impl"], 16) not in chars
    ))


def load_checked_presets(known: set[int]) -> dict:
    """人名・地名プリセットを読み、全文字が MJ に収録されているか確かめる."""
    presets = load_name_presets(PRESETS_PATH)
    used = {ch for spellings in presets["names"].values() for word in spellings for ch in word}
    used |= set(presets["quickAccess"])
    missing = sorted(ch for ch in used if ord(ch) not in known)
    if missing:
        sys.exit(f"name_presets.json に MJ 未収録の文字があります: {missing}")
    return presets


def build_meta(src: Sources, grouped: Grouped, gothic_fonts: list[dict], gothic_counts: dict[str, int],
               shard_count: int, reading_count: int) -> dict:
    all_glyphs = [g for entry in grouped.chars.values() for g in entry["glyphs"]]
    ivd_seqs = set(src.ivd_moji_joho)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {k: {kk: vv for kk, vv in v.items() if kk != "file"} for k, v in SOURCES.items()},
        "fontNote": "IPAmj明朝 Ver.006.01 は MJ文字情報一覧表 Ver.006.01 相当。ivdOnly の IVS はフォントに字形が無い場合があります。",
        "flags": {"jouyou": 1, "jinmei": 2, "hasIVS": FLAG_IVS},
        "relationTypes": RELATION_TYPES,
        "gothic": {
            "note": "Moji_Joho の IVS に対応したゴシック体は無い。ゴシック体で出せるのは実装したUCSを持つ字形だけで、IVS でしか区別できない字形は通常の字形になる。",
            "fonts": [{k: f[k] for k in ("key", "name", "ok", "file", "version")} for f in gothic_fonts],
            "counts": gothic_counts,
        } if gothic_fonts else None,
        "counts": {
            "mjGlyphs": len(src.records),
            "ucsChars": len(grouped.chars),
            "glyphsWithIVS": sum(1 for g in all_glyphs if "ivs" in g),
            "ivdOnlySequences": sum(len(g.get("ivdOnly", [])) for g in all_glyphs),
            "noCharGlyphs": len(grouped.no_char),
            "shards": shard_count,
            "readings": reading_count,
            "ivdCollections": src.ivd_counts,
        },
        "checks": {
            "ivdMojiJohoMissingInMJ": sorted(ivd_seqs - grouped.ivs_seen),
            "mjIvsNotInIVD": sorted(grouped.ivs_seen - ivd_seqs),
        },
    }


def build(raw: Path, out: Path, offline: bool, gothic_overrides: dict[str, str] | None = None) -> dict:
    src = load_sources(raw, offline)
    grouped = group_glyphs(src)
    link_relations(grouped.chars, src.unihan)

    log("read gothic fonts ...")
    gothic_fonts = read_gothic_fonts(gothic_overrides or {})
    gothic_counts = annotate_gothic(grouped.chars, gothic_fonts)

    shards, index_chars, readings, extra_radicals = build_shards_and_index(grouped.chars)
    aliases = build_aliases(grouped.chars)
    presets = load_checked_presets(set(grouped.chars) | {int(k, 16) for k in aliases})
    index = {
        "shardBits": SHARD_BITS,
        "chars": index_chars,
        "aliases": aliases,
        "noChar": [g["mjNum"] for g in grouped.no_char],
        "readings": {r: sorted(v) for r, v in sorted(readings.items())},
        "extraRadicals": extra_radicals,
        "names": presets["names"],
        "quickAccess": presets["quickAccess"],
    }
    meta = build_meta(src, grouped, gothic_fonts, gothic_counts, len(shards), len(readings))
    write_outputs(out, shards, grouped.no_char, index, meta)
    return meta


def write_outputs(out: Path, shards: dict[str, dict], no_char: list[dict], index: dict, meta: dict) -> None:
    chars_dir = out / "chars"
    chars_dir.mkdir(parents=True, exist_ok=True)
    for old in chars_dir.glob("*.json"):
        old.unlink()
    for name, data in shards.items():
        write_json(chars_dir / f"{name}.json", data)
    write_json(chars_dir / "none.json", {"glyphs": [public_glyph(g) for g in no_char]})
    write_json(out / "search-index.json", index)
    write_json(out / "meta.json", meta, pretty=True)


def write_json(path: Path, data, pretty: bool = False) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        if pretty:
            json.dump(data, f, ensure_ascii=False, indent=2)
        else:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=ROOT / "data" / "raw", help="元データの置き場所")
    parser.add_argument("--out", type=Path, default=ROOT / "src" / "data", help="出力先")
    parser.add_argument("--offline", action="store_true", help="元データが無くてもダウンロードしない")
    parser.add_argument("--gothic-font", action="append", default=[], metavar="KEY=PATH",
                        help=f"ゴシック体の判定に使うフォントの場所（KEY: {', '.join(f['key'] for f in GOTHIC_FONTS)}）")
    args = parser.parse_args()

    overrides = dict(item.split("=", 1) for item in args.gothic_font)
    meta = build(args.raw, args.out, args.offline, overrides)
    log(json.dumps(meta["counts"], ensure_ascii=False, indent=2))
    checks = meta["checks"]
    log(f"IVD にあって一覧表に無い Moji_Joho IVS: {len(checks['ivdMojiJohoMissingInMJ'])}")
    log(f"一覧表にあって IVD に無い IVS: {len(checks['mjIvsNotInIVD'])}")


if __name__ == "__main__":
    main()
