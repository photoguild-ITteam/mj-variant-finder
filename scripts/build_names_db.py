#!/usr/bin/env python3
"""人名・地名の読み辞書（src/data/names.json）を作る.

  python scripts/build_names_db.py

入力（data/raw/ に置く。どちらも再配布可）:
  - mecab-ipadic_2.7.0-20070801+main.orig.tar.gz  … 姓・名と読み（ipadic ライセンス）
      http://deb.debian.org/debian/pool/main/m/mecab-ipadic/
  - utf_ken_all.zip                                … 市区町村・町域と読み（日本郵便。著作権を主張せず自由に利用可）
      https://www.post.japanpost.jp/zipcode/dl/utf-zip.html
      ※ ブラウザからダウンロードすること（curl などは拒否される）

出力: src/data/names.json
  surnames / given / places … 実在する表記（辞書に載っているもの）
  variants                  … 上記を scripts/data/name_variants.json で置き換えて作った表記
                              （「髙橋」「山﨑」「𠮷田」など。辞書に無いため生成する。実在の確認はしていない）
画面は読み（ひらがな）で引き、検索候補として表示する。
"""

from __future__ import annotations

import codecs
import collections
import csv
import io
import json
import re
import sys
import tarfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IPADIC = ROOT / "data" / "raw" / "mecab-ipadic.tar.gz"
POSTAL = ROOT / "data" / "raw" / "utf_ken_all.zip"
PRESETS = ROOT / "scripts" / "data" / "name_presets.json"
VARIANT_MAP = ROOT / "scripts" / "data" / "name_variants.json"
OUT = ROOT / "src" / "data" / "names.json"

KANJI = re.compile(r"^[々一-鿿\U00020000-\U0003ffff]+$")
MAX_VARIANTS_PER_READING = 10
MAX_SUBSTITUTIONS = 2
SKIP_TOWN = ("以下に掲載がない場合", "（", "次のビルを除く", "その他")
# 地名の接尾語（読みから外しても引けるようにする）
SUFFIXES = {
    "市": ("し",), "区": ("く",), "町": ("ちょう", "まち"), "村": ("むら", "そん"),
    "郡": ("ぐん",), "都": ("と",), "府": ("ふ",), "県": ("けん",),
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def to_hiragana(text: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in text).replace("・", "").strip()


def read_ipadic() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """ipadic の人名辞書から 姓 / 名 を読む."""
    surnames: dict[str, set[str]] = collections.defaultdict(set)
    given: dict[str, set[str]] = collections.defaultdict(set)
    with tarfile.open(IPADIC) as tar:
        member = next(n for n in tar.getnames() if n.endswith("Noun.name.csv"))
        text = codecs.decode(tar.extractfile(member).read(), "euc_jp")
    for row in csv.reader(io.StringIO(text)):
        if len(row) <= 11 or not KANJI.match(row[0]):
            continue
        target = surnames if row[7] == "姓" else given if row[7] == "名" else None
        if target is not None:
            target[to_hiragana(row[11])].add(row[0])
    return surnames, given


def read_postal(variant_chars: set[str]) -> dict[str, set[str]]:
    """郵便番号データから 市区町村（全部）と 町域（異体字を含むものだけ）を読む.

    町域は 85,000 件あり全部入れると 3.5MB になる。このアプリの目的（異体字を調べる）に沿って、
    異体字の置き換え表に出てくる字を含む地名だけを残す。
    """
    places: dict[str, set[str]] = collections.defaultdict(set)
    with zipfile.ZipFile(POSTAL) as zf:
        text = zf.read(zf.namelist()[0]).decode("utf-8", errors="replace")
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 9:
            continue
        for name, kana, always in ((row[7], row[4], True), (row[8], row[5], False)):
            if not name or any(skip in name for skip in SKIP_TOWN) or not re.search(r"[一-鿿]", name):
                continue
            if not always and not any(ch in variant_chars for ch in name):
                continue
            reading = to_hiragana(kana)
            if not reading:
                continue
            places[reading].add(name)
            # 「鹿嶋市＝かしまし」のように接尾語まで読みに入っているので、外した読みでも引けるようにする
            for suffix, kana_suffixes in SUFFIXES.items():
                if name.endswith(suffix) and len(name) > len(suffix):
                    for kana_suffix in kana_suffixes:
                        if reading.endswith(kana_suffix) and len(reading) > len(kana_suffix):
                            places[reading[: -len(kana_suffix)]].add(name)
    return places


def load_presets() -> dict[str, list[str]]:
    data = json.loads(PRESETS.read_text(encoding="utf-8"))
    return data["names"]


def make_variants(words: set[str], mapping: dict[str, list[str]]) -> list[str]:
    """よく使われる異体字に置き換えた表記（最大 MAX_SUBSTITUTIONS 文字まで）."""
    out: list[str] = []
    for word in sorted(words):
        current = {word}
        for _ in range(MAX_SUBSTITUTIONS):
            grown = set()
            for candidate in current:
                for i, ch in enumerate(candidate):
                    for variant in mapping.get(ch, []):
                        grown.add(candidate[:i] + variant + candidate[i + 1:])
            current |= grown
        for candidate in sorted(current):
            if candidate not in words and candidate not in out:
                out.append(candidate)
    return out[:MAX_VARIANTS_PER_READING]


def known_chars() -> set[str]:
    index = json.loads((ROOT / "src" / "data" / "search-index.json").read_text(encoding="utf-8"))
    chars = {chr(int(k, 16)) for k in index["chars"]}
    chars |= {chr(int(k, 16)) for k in index["aliases"]}
    return chars


def main() -> None:
    for path in (IPADIC, POSTAL):
        if not path.exists():
            sys.exit(f"{path} がありません（このスクリプトの説明を参照）")

    mapping = json.loads(VARIANT_MAP.read_text(encoding="utf-8"))["map"]
    available = known_chars()
    missing = sorted({ch for base, variants in mapping.items() for ch in [base, *variants] if ch not in available})
    if missing:
        sys.exit(f"name_variants.json に MJ 未収録の文字があります: {missing}")
    variant_chars = set(mapping) | {v for values in mapping.values() for v in values}

    surnames, given = read_ipadic()
    places = read_postal(variant_chars)
    log(f"ipadic: 姓 {len(surnames)} 読み / 名 {len(given)} 読み、郵便番号データ: 地名 {len(places)} 読み")

    # 手作業のプリセットも「実在する表記」として混ぜる
    for reading, words in load_presets().items():
        surnames[reading].update(words)

    # 置き換えは人名だけ（地名で作ると実在しない地名が大量にできる）
    variants: dict[str, list[str]] = {}
    for reading in set(surnames) | set(given):
        generated = make_variants(surnames.get(reading, set()) | given.get(reading, set()), mapping)
        if generated:
            variants[reading] = generated

    data = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": [
            {"title": "mecab-ipadic 2.7.0-20070801（人名: 姓・名）", "license": "ipadic ライセンス（BSD 系）",
             "page": "https://taku910.github.io/mecab/"},
            {"title": "郵便番号データ（市区町村・町域）", "license": "日本郵便（著作権を主張せず、自由に利用可）",
             "page": "https://www.post.japanpost.jp/zipcode/dl/utf-zip.html"},
            {"title": "異体字の置き換え表・人名プリセット（手作業）", "license": "本リポジトリと同じ",
             "page": "scripts/data/name_variants.json"},
        ],
        "surnames": {k: sorted(v) for k, v in sorted(surnames.items())},
        "given": {k: sorted(v) for k, v in sorted(given.items())},
        "places": {k: sorted(v) for k, v in sorted(places.items())},
        "variants": dict(sorted(variants.items())),
    }
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(text, encoding="utf-8", newline="\n")
    log(f"姓 {len(data['surnames'])} / 名 {len(data['given'])} / 地名 {len(data['places'])} / 置き換え {len(variants)} 読み"
        f" → {OUT} {len(text.encode()) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
