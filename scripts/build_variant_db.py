#!/usr/bin/env python3
"""IPAmj明朝 異体字検索用データベースのビルドスクリプト.

入力（data/raw/ に配置。無ければ公式配布元から自動ダウンロード）:
  - MJ文字情報一覧表 Ver.006.02 (mji.00602.xlsx)            CC BY-SA 2.1 JP / CITPC
  - MJ縮退マップ Ver.1.2.0 (MJShrinkMap.1.2.0.json)           CC BY-SA 2.1 JP / IPA
  - Unicode IVD 2026-08-03 (IVD_Sequences.2026-08-03.txt)                Unicode License
  - Unihan Database (Unihan.18.0.0.zip, Unihan_Variants.txt のみ使用)  Unicode License
  - ゴシック体の判定に使うフォント（GOTHIC_FONTS。cmap だけを読む）

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
# ゴシック× の字形と、同じ形の Adobe-Japan1 IVS の対応（手作業。scripts/import_aj1_review.py で取り込む）
AJ1_MATCHES_PATH = ROOT / "scripts" / "data" / "aj1_matches.json"
# 既定の形（IVS なし）を選んだ対応で、同じ形と言えるフォント（見比べたのは Noto Serif JP・Noto Sans JP の既定の形）
AJ1_DEFAULT_FONTS = ("noto", "notocjk")
# ゴシック体の異体字（Adobe-Japan1 の IVS で出せる、通常と違う形）の一覧を作るときに、形が同じかどうかを見るフォント
# （同じ字形を指す IVS を 1 つにまとめる。見本の MJ Variant Gothic N もこのフォントから作る）
GOTHIC_IVS_REFERENCE = "notocjk"

# 「ゴシック体で使えるか」の判定に使うフォント（文字の収録状況＝cmap だけを読む）.
# Moji_Joho の IVS に対応したゴシック体は無いため、ゴシック体で出せるのは「実装したUCS」を持つ字形だけ。
#   ok=True のフォントすべてに字があれば ○、欠けていれば △、実装したUCS が無い（IVS でしか区別できない）字形は ×
# ○ の判定には Noto Sans JP（SIL Open Font License）を使い、BIZ UDゴシックは参考として表示する
# （BIZ UDゴシックの字は Noto Sans JP にすべて含まれる）。再配布に制限のある商用フォントは使わない。
# △ の字（一般的なゴシック体に無い字）を印刷で使えるフォントとして、Noto Sans CJK JP（全字の版。基本の漢字・拡張A を受け持つ）と
# 遍黒体 P1（拡張B 以降を受け持つ）も読む。△ の字はこの 2 つのどちらかにすべてある。
# この 2 つは字形の見本用に抜き出して同梱する（scripts/build_gothic_webfont.py。src/fonts/gothic/README.md）。
# 判定はフォントの版で変わるので、使うファイルを sha256 で固定する。Noto Sans JP・BIZ UDゴシックは Windows 11 に入っている版
# （C:\Windows\Fonts の NotoSansJP-VF.ttf・BIZ-UDGothicR.ttc）。Windows 以外では、同じファイルを data/raw/ に置く。
# url のあるフォントは、data/raw/ に無ければ配布元から取得する。
# 別の版で判定し直すときは sha256 を書き換え、変わった字形の件数を PR に書く（AGENTS.md「生成物とデータ」）。
GOTHIC_FONTS = [
    {"key": "noto", "name": "Noto Sans JP", "ok": True,
     "paths": ["data/raw/NotoSansJP-VF.ttf", r"C:\Windows\Fonts\NotoSansJP-VF.ttf"],
     "sha256": "5113756f8a3b5d01b2211025e267c50121e3b36f465b7bbaf3cdaf4c3430bfd0"},  # Version 2.04;241114210129
    {"key": "biz", "name": "BIZ UDゴシック", "ok": False,
     "paths": ["data/raw/BIZ-UDGothicR.ttc", r"C:\Windows\Fonts\BIZ-UDGothicR.ttc"],
     "sha256": "11cf9a40c90bf67fe9de86c9d852c7a8986dcf87fb16d86b510abf118df41673"},  # Version 2.02
    {"key": "notocjk", "name": "Noto Sans CJK JP", "ok": False,
     "paths": ["data/raw/NotoSansCJKjp-Regular.otf"],
     "url": "https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf",
     "sha256": "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5"},  # Version 2.004
    # P2 にも字があるが、MJ の字形の実装したUCS は P1 にすべて入っている（V2.9.5795 で確認）ので読まない
    {"key": "plangothic", "name": "遍黒体", "ok": False,
     "paths": ["data/raw/PlangothicP1-Regular.ttf"],
     "url": "https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project/releases/download/V2.9.5795/PlangothicP1-Regular.ttf",
     "sha256": "550b5d0775b15405946b18f4843df439a51e69508d7e6778d94c1f7a53dc5ad6"},  # V2.9.5795（Version 6.400）
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
            f"ファイルが破損しているか、新しい版に変更されている可能性があります。\n"
            f"新しい版に上げた場合は SOURCES の sha256 を書き換えてください（docs/ARCHITECTURE.md）"
        )


def download(url: str, path: Path, expected_sha: str | None) -> None:
    """url を path に保存する。sha256 が合わなければ保存しない."""
    log(f"download {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "IPAmjWEB-build/1.0"})
    tmp = path.with_suffix(path.suffix + ".part")
    try:
        with urllib.request.urlopen(req, timeout=300) as res, tmp.open("wb") as out:
            while chunk := res.read(65536):
                out.write(chunk)
        if expected_sha:
            verify_sha256(tmp, expected_sha)
        tmp.replace(path)
    except BaseException:
        if tmp.exists():
            tmp.unlink()
        raise


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
        download(src["url"], path, expected_sha)


def read_strict_xlsx(path: Path) -> list[dict[str, str]]:
    """Strict OOXML 形式の xlsx（openpyxl 非対応）を最初のシートだけ読む."""
    ns = "{http://purl.oclc.org/ooxml/spreadsheetml/main}"
    ns_transitional = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    def tag(el: ET.Element, name: str) -> bool:
        return el.tag in (ns + name, ns_transitional + name)

    def text_of(el: ET.Element) -> str:
        pieces: list[str] = []

        def walk(node: ET.Element) -> None:
            if tag(node, "rPh"):
                return
            if tag(node, "t") and node.text:
                pieces.append(node.text)
            for child in node:
                walk(child)

        walk(el)
        return "".join(pieces)

    def col_index(ref: str) -> int:
        n = 0
        for ch in re.match(r"[A-Z]+", ref).group():
            n = n * 26 + ord(ch) - 64
        return n - 1

    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        with z.open("xl/sharedStrings.xml") as s_file:
            for _, el in ET.iterparse(s_file):
                if tag(el, "si"):
                    shared.append(text_of(el))
                    el.clear()

        header: dict[int, str] | None = None
        records: list[dict[str, str]] = []
        with z.open("xl/worksheets/sheet1.xml") as sheet_file:
            for _, el in ET.iterparse(sheet_file):
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


def read_ivd_sequences(path: Path, collection: str) -> set[str]:
    """IVD のうち、collection に登録された IVS（"基底_異体字セレクタ"）."""
    seqs = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        seq, coll, _ = (s.strip() for s in line.split(";"))
        if coll == collection:
            seqs.add(seq.replace(" ", "_"))
    return seqs


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


def find_gothic_fonts(overrides: dict[str, str], offline: bool = True) -> list[tuple[dict, Path]]:
    """GOTHIC_FONTS のフォントを探し、sha256 が固定した版と一致するかを確かめる.

    url のあるフォントは、見つからなければ（offline でなければ）paths の先頭に取得する。
    見つからない・版が違うときは止める（黙って判定が変わったり、省かれたりしないように）。
    """
    found = []
    for spec in GOTHIC_FONTS:
        candidates = [overrides[spec["key"]]] if spec["key"] in overrides else spec["paths"]
        path = next((p for p in map(resolve_path, candidates) if p.exists()), None)
        if path is None and spec.get("url") and spec["key"] not in overrides and not offline:
            path = resolve_path(spec["paths"][0])
            download(spec["url"], path, spec["sha256"])
        if path is None:
            sys.exit(
                f"{spec['name']} が見つかりません（探した場所: {', '.join(candidates)}）。\n"
                f"ゴシック体の判定に使うフォントを data/raw/ に置くか、--gothic-font {spec['key']}=パス で指定してください。\n"
                f"判定を省いて作り直す場合は --no-gothic（字形の gothic が無くなるので、そのデータはコミットしない）"
            )
        actual = sha256_of(path)
        if actual != spec["sha256"]:
            sys.exit(
                f"{spec['name']} の版が、判定に使う版と違います ({path}):\n"
                f"  期待値: {spec['sha256']}\n"
                f"  実際値: {actual}\n"
                f"別の版で判定すると、字形のゴシック体の判定（gothic）が変わります。\n"
                f"新しい版に上げる場合は GOTHIC_FONTS の sha256 を書き換えてください（AGENTS.md「生成物とデータ」）"
            )
        found.append((spec, path))
    return found


def read_gothic_fonts(overrides: dict[str, str], offline: bool = False) -> list[dict]:
    """GOTHIC_FONTS のフォントの cmap を読む."""
    found = find_gothic_fonts(overrides, offline)
    try:
        from fontTools.ttLib import TTCollection, TTFont
    except ImportError:
        sys.exit("ゴシック体の判定には fontTools が必要です（pip install -r scripts/requirements.txt）。判定を省く場合は --no-gothic")
    loaded = []
    for spec, path in found:
        font = TTCollection(str(path), lazy=True).fonts[0] if path.suffix.lower() == ".ttc" else TTFont(str(path), lazy=True)
        version = font["name"].getDebugName(5) or ""
        # IVS（cmap format 14）: Adobe-Japan1 の IVS で別の形が出せるか（aj1_matches.json の対応）を確かめるのに使う
        uvs_names = {f"{base:X}_{vs:X}": name for table in font["cmap"].tables if table.format == 14
                     for vs, entries in table.uvsDict.items() for base, name in entries}
        cmap = font.getBestCmap()
        loaded.append({**spec, "file": path.name, "version": version, "cmap": set(cmap), "uvs": set(uvs_names),
                       # 字形の名前（ゴシック体の異体字をまとめるのに使う。GOTHIC_IVS_REFERENCE のフォントだけ）
                       **({"uvsNames": uvs_names, "cmapNames": cmap} if spec["key"] == GOTHIC_IVS_REFERENCE else {})})
        log(f"  {spec['name']}: {path.name} {version} ({len(loaded[-1]['cmap'])} codepoints)")
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
    ivd_adobe_japan1: set[str]              # Adobe-Japan1 の IVS
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
        ivd_adobe_japan1=read_ivd_sequences(raw / SOURCES["ivd"]["file"], "Adobe-Japan1"),
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


def annotate_aj1(chars: dict[int, dict], fonts: list[dict], aj1_seqs: set[str], review: dict) -> dict[str, int]:
    """ゴシック× の字形に、同じ形の Adobe-Japan1 IVS（glyph["aj1"]）を付ける（scripts/data/aj1_matches.json）.

    同じ形あり: {"seq": "4E0E_E0101", "gothic": [その IVS を持つゴシック体のキー]}。見比べて同じ形が無かった字形: None。
    対応表が字形の一覧・IVD と合わなければ止める（手作業の誤りを黙って載せないように）。
    """
    matches: dict[str, str] = review["matches"]
    no_match = set(review["noMatch"])
    if both := sorted(set(matches) & no_match):
        sys.exit(f"aj1_matches.json: 同じ MJ番号が matches と noMatch の両方にあります: {both}")
    found: set[str] = set()
    for cp, entry in chars.items():
        for g in entry["glyphs"]:
            mj = g["mj"]
            if mj not in matches and mj not in no_match:
                continue
            found.add(mj)
            if "impl" in g or not g.get("ivs"):
                sys.exit(f"aj1_matches.json: {mj} は IVS でしか区別できない字形（ゴシック×）ではありません")
            if mj in no_match:
                g["aj1"] = None
                continue
            seq = matches[mj]
            if int(seq.split("_")[0], 16) != cp:
                sys.exit(f"aj1_matches.json: {mj}（U+{cp:04X}）に、別の字の IVS {seq} が対応しています")
            if "_" in seq:
                if seq not in aj1_seqs:
                    sys.exit(f"aj1_matches.json: {mj} の {seq} は、IVD の Adobe-Japan1 に登録されていません")
                gothic = [f["key"] for f in fonts if seq in f["uvs"]]
            else:
                gothic = [f["key"] for f in fonts if f["key"] in AJ1_DEFAULT_FONTS and cp in f["cmap"]]
            g["aj1"] = {"seq": seq, "gothic": gothic}
    if missing := sorted((set(matches) | no_match) - found):
        sys.exit(f"aj1_matches.json: 字形の一覧に無い MJ番号があります: {missing}")
    return {"matches": len(matches), "noMatch": len(no_match)}


def annotate_gothic_ivs(chars: dict[int, dict], fonts: list[dict], aj1_seqs: set[str]) -> int:
    """字に、ゴシック体の異体字（Adobe-Japan1 の IVS で出せる、通常と違う形）の一覧（entry["gothicIvs"]）を付ける.

    GOTHIC_IVS_REFERENCE のフォントで同じ字形を指す IVS を 1 つにまとめ、通常の字形と同じものは除く。
    要素は {"seqs": [異体字セレクタ], "gothic": [その IVS を持つゴシック体のキー]}。付けた字の数を返す.
    """
    ref = next((f for f in fonts if f["key"] == GOTHIC_IVS_REFERENCE), None)
    if ref is None:
        return 0
    groups: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for seq, name in ref["uvsNames"].items():
        base, vs = seq.split("_")
        cp = int(base, 16)
        # 既定の形と同じもの、Adobe-Japan1 以外（SVS など）、字形の一覧に無い字は除く
        if name is None or name == ref["cmapNames"].get(cp) or seq not in aj1_seqs or cp not in chars:
            continue
        groups[cp][name].append(vs)
    for cp, by_name in groups.items():
        chars[cp]["gothicIvs"] = [
            {"seqs": vss, "gothic": [f["key"] for f in fonts if f"{cp:X}_{vss[0]}" in f["uvs"]]}
            for vss in sorted((sorted(v) for v in by_name.values()), key=lambda v: v[0])
        ]
    return len(groups)


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
        if chars[cp].get("gothicIvs"):
            shard_entry["gothicIvs"] = chars[cp]["gothicIvs"]
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
               aj1_counts: dict[str, int], gothic_ivs_chars: int, shard_count: int, reading_count: int) -> dict:
    all_glyphs = [g for entry in grouped.chars.values() for g in entry["glyphs"]]
    ivd_seqs = set(src.ivd_moji_joho)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {k: {kk: vv for kk, vv in v.items() if kk != "file"} for k, v in SOURCES.items()},
        "fontNote": "IPAmj明朝 Ver.006.01 は MJ文字情報一覧表 Ver.006.01 相当。ivdOnly の IVS はフォントに字形が無い場合があります。",
        "flags": {"jouyou": 1, "jinmei": 2, "hasIVS": FLAG_IVS},
        "relationTypes": RELATION_TYPES,
        "gothic": {
            "note": "Moji_Joho の IVS に対応したゴシック体は無い。IVS でしか区別できない字形は、Moji_Joho の IVS のままではゴシック体で通常の字形になる。"
                    "そのうち、同じ形を Adobe-Japan1 の IVS で出せると確かめた字形には aj1 を付けている（scripts/data/aj1_matches.json）。",
            "fonts": [{k: f[k] for k in ("key", "name", "ok", "file", "version", "sha256")} for f in gothic_fonts],
            "counts": gothic_counts,
            "aj1": aj1_counts,
            "ivsChars": gothic_ivs_chars,  # ゴシック体の異体字（Adobe-Japan1 の IVS で出せる別の形）がある字の数
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


def build(raw: Path, out: Path, offline: bool, gothic_overrides: dict[str, str] | None = None,
          gothic: bool = True) -> dict:
    src = load_sources(raw, offline)
    grouped = group_glyphs(src)
    link_relations(grouped.chars, src.unihan)

    log("read gothic fonts ...")
    if gothic:
        gothic_fonts = read_gothic_fonts(gothic_overrides or {}, offline)
    else:
        log("warning: --no-gothic のため、ゴシック体の判定を省きます（このデータはコミットしない）")
        gothic_fonts = []
    gothic_counts = annotate_gothic(grouped.chars, gothic_fonts)
    aj1_counts = annotate_aj1(grouped.chars, gothic_fonts, src.ivd_adobe_japan1,
                              json.loads(AJ1_MATCHES_PATH.read_text(encoding="utf-8")))
    gothic_ivs_chars = annotate_gothic_ivs(grouped.chars, gothic_fonts, src.ivd_adobe_japan1)

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
    meta = build_meta(src, grouped, gothic_fonts, gothic_counts, aj1_counts, gothic_ivs_chars, len(shards), len(readings))
    write_outputs(out, shards, grouped.no_char, index, meta)
    return meta


def write_outputs(out: Path, shards: dict[str, dict], no_char: list[dict], index: dict, meta: dict) -> None:
    chars_dir = out / "chars"
    chars_dir.mkdir(parents=True, exist_ok=True)
    for old in chars_dir.glob("*.json"):
        old.unlink()
    for name, data in shards.items():
        write_json(chars_dir / f"{name}.json", data, lines=1)                         # 1行 = 1文字
    write_json(chars_dir / "none.json", {"glyphs": [public_glyph(g) for g in no_char]}, lines=2)  # 1行 = 1字形
    write_json(out / "search-index.json", index, lines=2)                            # 1行 = chars・readings などの1項目
    write_json(out / "meta.json", meta, pretty=True)


def json_lines(data, depth: int) -> str:
    """depth 段目までの dict・list を1項目1行にし、その中は詰めて書く JSON.

    1行の minified JSON だと、作り直すたびにファイル全体が1行の差分になり、PR で変化を読めない。
    1項目1行なら、変わった字・読みの行だけが差分になる。改行が増えるだけで、gzip 後の大きさはほぼ変わらない。
    """
    if depth > 0 and isinstance(data, dict) and data:
        return "{\n" + ",\n".join(f"{json.dumps(k, ensure_ascii=False)}:{json_lines(v, depth - 1)}" for k, v in data.items()) + "\n}"
    if depth > 0 and isinstance(data, list) and data:
        return "[\n" + ",\n".join(json_lines(v, depth - 1) for v in data) + "\n]"
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def write_json(path: Path, data, pretty: bool = False, lines: int = 0) -> None:
    """pretty: 字下げして書く（meta.json）。lines: json_lines の段数（0 なら1行に詰める）."""
    text = json.dumps(data, ensure_ascii=False, indent=2) if pretty else json_lines(data, lines)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text + ("\n" if lines else ""))


def gothic_font_arg(value: str) -> tuple[str, str]:
    """--gothic-font の KEY=PATH."""
    key, sep, path = value.partition("=")
    keys = [f["key"] for f in GOTHIC_FONTS]
    if not sep or not path or key not in keys:
        raise argparse.ArgumentTypeError(f"KEY=PATH の形で指定してください（KEY: {', '.join(keys)}）: {value}")
    return key, path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=ROOT / "data" / "raw", help="元データの置き場所")
    parser.add_argument("--out", type=Path, default=ROOT / "src" / "data", help="出力先")
    parser.add_argument("--offline", action="store_true", help="元データが無くてもダウンロードしない")
    parser.add_argument("--gothic-font", action="append", default=[], type=gothic_font_arg, metavar="KEY=PATH",
                        help=f"ゴシック体の判定に使うフォントの場所（KEY: {', '.join(f['key'] for f in GOTHIC_FONTS)}）")
    parser.add_argument("--no-gothic", action="store_true",
                        help="ゴシック体の判定を省く（フォントが無い環境での確認用。出力はコミットしない）")
    args = parser.parse_args()

    meta = build(args.raw, args.out, args.offline, dict(args.gothic_font), gothic=not args.no_gothic)
    log(json.dumps(meta["counts"], ensure_ascii=False, indent=2))
    checks = meta["checks"]
    log(f"IVD にあって一覧表に無い Moji_Joho IVS: {len(checks['ivdMojiJohoMissingInMJ'])}")
    log(f"一覧表にあって IVD に無い IVS: {len(checks['mjIvsNotInIVD'])}")


if __name__ == "__main__":
    main()
