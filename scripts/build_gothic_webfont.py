#!/usr/bin/env python3
"""字形の詳細に出す「ゴシック体の見本」用に、Noto Sans CJK JP と遍黒体から字を抜き出した WOFF2 Webフォントを作る.

どちらも SIL Open Font License 1.1。抜き出したもの（Modified Version）は同じライセンスで配布し、
予約名・商標（Noto、Source、Plangothic、遍黑 など）を使わない名前に変える:
  - MJ Variant Gothic N … Noto Sans CJK JP 2.004 から（○ の字形と、基本の漢字・拡張A の △ の字形）
  - MJ Variant Gothic P … 遍黒体 P1 V2.9.5795 から（Noto Sans CJK JP に無い △ の字形。拡張B 以降）
ゴシック体の異体字（Adobe-Japan1 の IVS で出せる別の形。字の gothicIvs）がある字と、ゴシック× の字形のうち同じ形を
Adobe-Japan1 の IVS で出せる字（字形の aj1）を含むファイルには、その字の IVS の字形も入れる（cmap format 14 を残す）。
著作権表示とライセンス（name の 0・13・14）はそのまま残し、src/fonts/gothic/ に条文を置く。

入力: data/raw/NotoSansCJKjp-Regular.otf, data/raw/PlangothicP1-Regular.ttf
      （scripts/build_variant_db.py の GOTHIC_FONTS。無ければ build_variant_db.py が取得する）
      src/data/chars/*.json（字形ごとの gothic。どの字をどちらのフォントに入れるかを決める）
出力: src/fonts/gothic/mjg-{n,p}-<先頭コードポイント>.woff2, src/fonts/gothic/gothic.css

依存: pip install -r scripts/requirements.txt（fonttools・brotli）
使い方: python scripts/build_gothic_webfont.py [--out src/fonts/gothic] [--jobs 8]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_variant_db import GOTHIC_FONTS, resolve_path, verify_sha256  # noqa: E402
from build_webfont import VARIATION_SELECTORS, css_range, log, plan_groups, to_ranges  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FACES = {
    # key: GOTHIC_FONTS のキー
    "n": {"key": "notocjk", "family": "MJ Variant Gothic N", "ps": "MJVariantGothicN-Regular",
          "source": "Noto Sans CJK JP 2.004"},
    "p": {"key": "plangothic", "family": "MJ Variant Gothic P", "ps": "MJVariantGothicP-Regular",
          "source": "遍黒体（Plangothic）P1 V2.9.5795"},
}
# 予約名・商標を含む名前は置き換え、要らない名前は捨てる（0 著作権・7 商標・13/14 ライセンスは残す）
DROP_NAME_IDS = {16, 17, 18, 21, 22, 25}


def font_path(key: str) -> Path:
    """GOTHIC_FONTS で固定した版のファイル."""
    spec = next(f for f in GOTHIC_FONTS if f["key"] == key)
    path = next((p for p in map(resolve_path, spec["paths"]) if p.exists()), None)
    if path is None:
        sys.exit(f"{spec['name']} がありません（{spec['paths'][0]}）。先に python scripts/build_variant_db.py を実行すると取得します。")
    verify_sha256(path, spec["sha256"])
    return path


def plan_codepoints() -> tuple[dict[str, list[int]], set[int]]:
    """字形の gothic から、どの字をどちらのフォントに入れるか（Noto Sans CJK JP にあればそちら）と、
    Adobe-Japan1 の IVS の字形も入れる字（ゴシック体の異体字（gothicIvs）がある字と、字形の aj1 が IVS を指す字）."""
    out: dict[str, set[int]] = {"n": set(), "p": set()}
    aj1: set[int] = set()
    for path in sorted((ROOT / "src" / "data" / "chars").glob("*.json")):
        if path.name == "none.json":
            continue
        for key, entry in json.loads(path.read_text(encoding="utf-8")).items():
            if entry.get("gothicIvs"):
                aj1.add(int(key, 16))
            for g in entry["glyphs"]:
                keys = set(g.get("gothic") or [])
                if g.get("aj1") and "_" in g["aj1"]["seq"] and "notocjk" in g["aj1"]["gothic"]:
                    aj1.add(int(g["aj1"]["seq"].split("_")[0], 16))
                if "impl" not in g:
                    continue
                if "notocjk" in keys:
                    out["n"].add(int(g["impl"], 16))
                elif "plangothic" in keys:
                    out["p"].add(int(g["impl"], 16))
    # IVS の字形を入れる字は、通常の字形も Noto Sans CJK JP から入れる（見本を同じフォントで並べる）
    out["n"] |= aj1
    out["p"] -= aj1
    return {k: sorted(v) for k, v in out.items()}, aj1


def rename(font: TTFont, face: dict) -> None:
    table = font["name"]
    overrides = {
        1: face["family"],
        3: f"{face['ps']};web",
        4: face["family"],
        6: face["ps"],
        10: f"{face['source']} の字の一部を抜き出し、WOFF2 にした派生フォント。SIL Open Font License 1.1 に基づき配布。",
    }
    table.names = [n for n in table.names if n.nameID not in DROP_NAME_IDS and n.nameID not in overrides]
    for name_id, value in overrides.items():
        table.setName(value, name_id, 3, 1, 0x409)
    font["post"].formatType = 3.0  # グリフ名を持たせない（サイズ削減）


def build_one(args: tuple[str, str, str, list[int], bool]) -> tuple[str, int]:
    face_key, font_file, out_path, codepoints, with_ivs = args
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = []  # 見本は 1 字ずつ横書きで出すだけ
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.hinting = False
    options.glyph_names = False
    options.drop_tables += ["FFTM"]
    # 作成日時を元のフォントのままにする（作り直しても中身が同じならファイルも同じになる）
    font = TTFont(font_file, lazy=True, recalcTimestamp=False)
    subsetter = subset.Subsetter(options)
    # 異体字セレクタを要求に含めると、入れた字の IVS（cmap format 14）と、その字形が残る
    subsetter.populate(unicodes=codepoints + (VARIATION_SELECTORS if with_ivs else []))
    subsetter.subset(font)
    rename(font, FACES[face_key])
    subset.save_font(font, out_path, options)
    return out_path, os.path.getsize(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=ROOT / "src" / "fonts" / "gothic")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    files = {k: font_path(face["key"]) for k, face in FACES.items()}
    codepoints, aj1 = plan_codepoints()
    jobs = []
    for k, cps in codepoints.items():
        groups = plan_groups(cps)
        log(f"{FACES[k]['family']}: {len(cps)} codepoints → {len(groups)} files")
        jobs += [(k, str(files[k]), str(args.out / f"mjg-{k}-{g[0]:04X}.woff2"), g, k == "n" and bool(aj1 & set(g)))
                 for g in groups]
    log(f"Adobe-Japan1 の IVS を入れる字 {len(aj1)}（{sum(1 for j in jobs if j[4])} files）")

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("mjg-*.woff2"):
        old.unlink()
    total = 0
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for path, size in pool.map(build_one, jobs):
            total += size
            log(f"  {Path(path).name} {size / 1024:.0f} KB")

    faces = [
        "@font-face{"
        f'font-family:"{FACES[k]["family"]}";font-style:normal;font-weight:400;'
        # 見本なので、読み込むまでほかのフォントで代わりに描かない
        "font-display:block;"
        f'src:url("{Path(path).name}") format("woff2");'
        f"unicode-range:{css_range(to_ranges(group))};"
        "}"
        for k, _, path, group, _ in jobs
    ]
    header = (
        "/* MJ Variant Gothic N / P: Noto Sans CJK JP 2.004・遍黒体 V2.9.5795 の派生フォント（SIL Open Font License 1.1）。"
        " scripts/build_gothic_webfont.py で生成。詳細は README.md */\n"
    )
    (args.out / "gothic.css").write_text(header + "\n".join(faces) + "\n", encoding="utf-8", newline="\n")
    log(f"total {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
