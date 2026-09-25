#!/usr/bin/env python3
"""IPAmj明朝 (ipamjm.ttf) から、unicode-range 分割の WOFF2 Webフォントを作る.

IPAフォントライセンス v1.0 第3条1項に従い:
  - 派生フォントの名称に「IPAmj明朝 / IPAmjMincho」を含めない（"MJ Variant Mincho" に改名）
  - ライセンス本文とオリジナルへの置き換え方法（src/fonts/README.md）を同梱する
  - 作成手順（このスクリプト）を公開する

入力: data/raw/ipamjm.ttf（IPAmj明朝 Ver.006.01。窓の杜から取得: https://moji.or.jp/mojikiban/font/）
出力: src/fonts/mjv-<先頭コードポイント>.woff2, src/fonts/fonts.css

依存: pip install fonttools brotli
使い方: python scripts/build_webfont.py [--font data/raw/ipamjm.ttf] [--out src/fonts] [--jobs 8]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_MD5 = "beee256d4ffec4c40493805a4d7e5cdd"  # IPAmj明朝 Ver.006.01 公式掲載値
FAMILY = "MJ Variant Mincho"
PS_NAME = "MJVariantMincho-Regular"
FILE_PREFIX = "mjv"
BLOCK_BITS = 10          # データのシャードと同じ 1024 コードポイント単位で区切る
MIN_GLYPHS = 400         # これより小さいブロックは隣と結合する
VARIATION_SELECTORS = [*range(0xFE00, 0xFE10), *range(0xE0100, 0xE01F0)]

NAME_OVERRIDES = {
    1: FAMILY,
    3: f"{PS_NAME};006.01-web",
    4: FAMILY,
    6: PS_NAME,
    10: "IPAmj明朝 Ver.006.01 を unicode-range 分割・WOFF2 化した派生フォント。IPAフォントライセンス v1.0 に基づき配布。",
}
DROP_NAME_IDS = {16, 17, 18, 21, 22}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def plan_groups(codepoints: list[int]) -> list[list[int]]:
    blocks: dict[int, list[int]] = {}
    for cp in sorted(codepoints):
        blocks.setdefault(cp >> BLOCK_BITS, []).append(cp)
    groups: list[list[int]] = []
    current: list[int] = []
    for key in sorted(blocks):
        current += blocks[key]
        if len(current) >= MIN_GLYPHS:
            groups.append(current)
            current = []
    if current:
        if groups and len(current) < MIN_GLYPHS // 2:
            groups[-1] += current
        else:
            groups.append(current)
    return groups


def to_ranges(codepoints: list[int]) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for cp in codepoints:
        if ranges and cp == ranges[-1][1] + 1:
            ranges[-1] = (ranges[-1][0], cp)
        else:
            ranges.append((cp, cp))
    return ranges


def css_range(ranges: list[tuple[int, int]]) -> str:
    return ",".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in ranges)


def rename(font: TTFont) -> None:
    table = font["name"]
    table.names = [n for n in table.names if n.nameID not in DROP_NAME_IDS and n.nameID not in NAME_OVERRIDES]
    for name_id, value in NAME_OVERRIDES.items():
        table.setName(value, name_id, 3, 1, 0x409)
    font["post"].formatType = 3.0  # グリフ名を持たせない（サイズ削減）


def build_one(args: tuple[str, str, list[int]]) -> tuple[str, int]:
    font_path, out_path, codepoints = args
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.hinting = False
    options.glyph_names = False
    font = TTFont(font_path, lazy=True)
    subsetter = subset.Subsetter(options)
    # 異体字セレクタを要求に含めないと cmap format 14（IVS/SVS の対応表）が捨てられる
    subsetter.populate(unicodes=codepoints + VARIATION_SELECTORS)
    subsetter.subset(font)
    rename(font)
    subset.save_font(font, out_path, options)
    return out_path, os.path.getsize(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--font", type=Path, default=ROOT / "data" / "raw" / "ipamjm.ttf")
    parser.add_argument("--out", type=Path, default=ROOT / "src" / "fonts")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    if not args.font.exists():
        sys.exit(f"{args.font} がありません。https://moji.or.jp/mojikiban/font/ から IPAmj明朝 を取得して配置してください。")
    md5 = hashlib.md5(args.font.read_bytes()).hexdigest()
    if md5 != EXPECTED_MD5:
        log(f"warning: MD5 {md5} が IPAmj明朝 Ver.006.01 の公式値と異なります")

    font = TTFont(args.font, lazy=True)
    codepoints = [cp for cp in font.getBestCmap() if cp not in VARIATION_SELECTORS]
    font.close()
    groups = plan_groups(codepoints)
    log(f"{len(codepoints)} codepoints → {len(groups)} files")

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob(f"{FILE_PREFIX}-*.woff2"):
        old.unlink()
    jobs = [(str(args.font), str(args.out / f"{FILE_PREFIX}-{g[0]:04X}.woff2"), g) for g in groups]

    total = 0
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for path, size in pool.map(build_one, jobs):
            total += size
            log(f"  {Path(path).name} {size / 1024:.0f} KB")

    faces = []
    for _, path, group in jobs:
        faces.append(
            "@font-face{"
            f'font-family:"{FAMILY}";font-style:normal;font-weight:400;font-display:swap;'
            # 端末に IPAmj明朝 があればダウンロードせずそちらを使う
            f'src:local("IPAmjMincho"),local("IPAmj明朝"),url("{Path(path).name}") format("woff2");'
            f"unicode-range:{css_range(to_ranges(group))};"
            "}"
        )
    header = (
        f"/* {FAMILY}: IPAmj明朝 Ver.006.01 の派生フォント（IPAフォントライセンス v1.0）。"
        " scripts/build_webfont.py で生成。詳細は README.md */\n"
    )
    (args.out / "fonts.css").write_text(header + "\n".join(faces) + "\n", encoding="utf-8", newline="\n")
    # SVG 書き出し（src/js/glyph-export.js）が、文字 → woff2 ファイルを引くための対応表
    font_map = [[g[0], g[-1], Path(path).name] for _, path, g in jobs]
    (args.out / "fonts-map.json").write_text(json.dumps(font_map, separators=(",", ":")), encoding="utf-8", newline="\n")
    log(f"total {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
