#!/usr/bin/env python3
"""× の字形と Adobe-Japan1 IVS の対応を目で確かめた結果（CSV）を、scripts/data/aj1_matches.json に取り込む.

CSV は、IPAmj明朝 の字形と Adobe-Japan1 IVS の字形（Noto Serif JP・Noto Sans JP）を並べた確認ページで書き出したもの。
使う列: 「MJ番号」「判定」（同じ形あり / 同じ形は無い / 保留）「Adobe-Japan1 IVS」（例: "4E0E E0101"、既定の形なら "4E0E（IVS なし）"）。
保留の行は取り込まない。すでにある MJ番号は、CSV の判定で上書きする。
取り込んだ対応が IVD・字形の一覧と合っているかは、scripts/build_variant_db.py が作り直すときに確かめる。

使い方: python scripts/import_aj1_review.py aj1-review.csv [ほかの CSV ...]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MATCHES_PATH = ROOT / "scripts" / "data" / "aj1_matches.json"
COMMENT = (
    "Moji_Joho の IVS でしか区別できない字形（ゴシック×）のうち、Adobe-Japan1 の IVS で同じ形が出せるものの対応（手作業で整備）。"
    "IPAmj明朝 の字形と、Noto Serif JP・Noto Sans JP の Adobe-Japan1 IVS の字形を目で見比べて決めた。"
    "matches: MJ文字図形名 → Adobe-Japan1 の IVS（\"基底_異体字セレクタ\"。既定の形なら \"基底\" だけ）。"
    "noMatch: 見比べて、同じ形が無かった字形。scripts/import_aj1_review.py で確認ページの CSV から取り込む。"
)


def load(path: Path = MATCHES_PATH) -> dict:
    if not path.exists():
        return {"_comment": COMMENT, "matches": {}, "noMatch": []}
    return json.loads(path.read_text(encoding="utf-8"))


def parse_sequence(value: str) -> str:
    """"4E0E E0101" → "4E0E_E0101"、"4E0E（IVS なし）" → "4E0E"."""
    value = value.strip()
    m = re.fullmatch(r"([0-9A-F]{4,6})\s+([0-9A-F]{5})", value)
    if m:
        return f"{m[1]}_{m[2]}"
    m = re.fullmatch(r"([0-9A-F]{4,6})（IVS なし）", value)
    if m:
        return m[1]
    raise ValueError(f"Adobe-Japan1 IVS の形が読めません: {value!r}")


def merge(data: dict, rows: list[dict[str, str]]) -> dict[str, int]:
    """CSV の行を data（aj1_matches.json の中身）に足す. 件数を返す."""
    counts = {"matches": 0, "noMatch": 0, "skipped": 0}
    matches: dict[str, str] = data["matches"]
    no_match = set(data["noMatch"])
    for row in rows:
        mj, judge = row["MJ番号"].strip(), row["判定"].strip()
        if not re.fullmatch(r"MJ\d{6}", mj):
            raise ValueError(f"MJ番号が読めません: {mj!r}")
        if judge == "同じ形あり":
            matches[mj] = parse_sequence(row["Adobe-Japan1 IVS"])
            no_match.discard(mj)
            counts["matches"] += 1
        elif judge == "同じ形は無い":
            matches.pop(mj, None)
            no_match.add(mj)
            counts["noMatch"] += 1
        else:
            counts["skipped"] += 1
    data["matches"] = dict(sorted(matches.items()))
    data["noMatch"] = sorted(no_match)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", type=Path, nargs="+")
    args = parser.parse_args()
    data = load()
    data["_comment"] = COMMENT
    for path in args.csv:
        with path.open(encoding="utf-8-sig", newline="") as f:
            try:
                counts = merge(data, list(csv.DictReader(f)))
            except (KeyError, ValueError) as e:
                sys.exit(f"{path}: {e}")
        print(f"{path.name}: 同じ形あり {counts['matches']}、同じ形は無い {counts['noMatch']}、取り込まない（保留など） {counts['skipped']}")
    MATCHES_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{MATCHES_PATH.relative_to(ROOT)}: 対応 {len(data['matches'])}、同じ形は無い {len(data['noMatch'])}")


if __name__ == "__main__":
    main()
