#!/usr/bin/env python3
"""画像から字形を探すための索引を作る（IPAmj明朝の全字形を画像化して特徴を取り出す）.

  pip install freetype-py pillow numpy
  python scripts/build_image_index.py          # → src/data/image-index.bin / image-index.json

出力（src/data/image-index.bin）は 1 字形 = RECORD_BYTES の固定長レコードを並べたもの:
  u32 MJ番号 / u32 基底コードポイント / u16 異体字セレクタ（0=なし、それ以外は VS - 0xE0000）
  / 8x8 の濃淡 64 バイト（段1: 全字形との内積で絞る）
  / 16x16 の白黒 32 バイト（段2: ハミング距離で並べ替え）
画面側（src/js/image-search/）が同じ前処理で入力画像の特徴を作り、この索引と照合する。
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "data" / "raw" / "ipamjm.ttf"
OUT_BIN = ROOT / "src" / "data" / "image-index.bin"
OUT_META = ROOT / "src" / "data" / "image-index.json"

BOX = 64          # 正規化後の画像サイズ
GRAY_MESH = 8     # 段1 の細かさ
BIN_MESH = 16     # 段2 の細かさ
BIN_THRESHOLD = 0.22
BLUR_RADIUS = 2   # ずれに強くするためのぼかし（画面側と同じ箱ぼかしを2回）
BLUR_PASSES = 2
HEADER_BYTES = 10
RECORD_BYTES = HEADER_BYTES + GRAY_MESH ** 2 + BIN_MESH ** 2 // 8


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_glyphs() -> list[dict]:
    """src/data から字形（MJ番号・文字）を集める."""
    index = json.loads((ROOT / "src" / "data" / "search-index.json").read_text(encoding="utf-8"))
    shard_bits = index["shardBits"]
    glyphs = []
    for shard in sorted({int(key, 16) >> shard_bits for key in index["chars"]}):
        data = json.loads((ROOT / "src" / "data" / "chars" / f"{shard:X}.json").read_text(encoding="utf-8"))
        for entry in data.values():
            for g in entry["glyphs"]:
                if g.get("char"):
                    glyphs.append({"mj": int(g["mj"][2:]), "char": g["char"]})
    return glyphs


def glyph_index_map(font_path: Path) -> dict[str, int]:
    """文字列（1文字 or 基底+異体字セレクタ）→ フォントのグリフ番号."""
    from fontTools.ttLib import TTFont

    tt = TTFont(font_path, lazy=True)
    cmap = tt.getBestCmap()
    order = {name: i for i, name in enumerate(tt.getGlyphOrder())}
    uvs_table = next((t for t in tt["cmap"].tables if t.format == 14), None)
    uvs = {}
    if uvs_table:
        for selector, mappings in uvs_table.uvsDict.items():
            for code, name in mappings:
                if name:
                    uvs[(code, selector)] = name

    def lookup(text: str) -> int | None:
        cps = [ord(c) for c in text]
        name = uvs.get((cps[0], cps[1])) if len(cps) > 1 else None
        name = name or cmap.get(cps[0])
        return order.get(name)

    return lookup


def normalize(bitmap: np.ndarray) -> np.ndarray | None:
    """墨のある範囲を切り出し、縦横比を保ったまま BOX×BOX の中央に収める（0.0-1.0）."""
    from PIL import Image

    ys, xs = np.nonzero(bitmap > 32)
    if len(xs) == 0:
        return None
    crop = bitmap[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    height, width = crop.shape
    scale = (BOX - 4) / max(height, width)
    resized = Image.fromarray(crop).resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.BILINEAR)
    canvas = Image.new("L", (BOX, BOX), 0)
    canvas.paste(resized, ((BOX - resized.width) // 2, (BOX - resized.height) // 2))
    return np.asarray(canvas, dtype=np.float32) / 255.0


def blur(norm: np.ndarray, radius: int = BLUR_RADIUS, passes: int = BLUR_PASSES) -> np.ndarray:
    """箱ぼかし（線が細い字形でも、半マスのずれで別物にならないようにする）."""
    out = norm
    width = radius * 2 + 1
    for _ in range(passes):
        padded = np.pad(out, radius, mode="constant")
        cumsum = np.cumsum(np.cumsum(padded, axis=0), axis=1)
        cumsum = np.pad(cumsum, ((1, 0), (1, 0)), mode="constant")
        size = out.shape[0]
        y0, x0 = np.arange(size)[:, None], np.arange(size)[None, :]
        out = (cumsum[y0 + width, x0 + width] - cumsum[y0, x0 + width]
               - cumsum[y0 + width, x0] + cumsum[y0, x0]) / (width * width)
    return out


def mesh(norm: np.ndarray, size: int) -> np.ndarray:
    step = BOX // size
    return norm.reshape(size, step, size, step).mean(axis=(1, 3))


def features(norm: np.ndarray) -> tuple[bytes, bytes]:
    norm = blur(norm)
    gray = mesh(norm, GRAY_MESH).ravel()
    gray = gray / max(float(np.linalg.norm(gray)), 1e-6)          # 段1 は内積で比べるので長さをそろえる
    gray_bytes = np.clip(gray / max(float(gray.max()), 1e-6) * 255, 0, 255).astype(np.uint8).tobytes()
    bits = np.packbits((mesh(norm, BIN_MESH) > BIN_THRESHOLD).ravel().astype(np.uint8)).tobytes()
    return gray_bytes, bits


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--font", type=Path, default=FONT)
    args = parser.parse_args()
    if not args.font.exists():
        sys.exit(f"{args.font} がありません（IPAmj明朝。README の Webフォントの節を参照）")

    try:
        import freetype
    except ImportError:
        sys.exit("freetype-py が必要です: pip install freetype-py")

    glyphs = load_glyphs()
    log(f"{len(glyphs)} 字形を画像化します …")
    lookup = glyph_index_map(args.font)
    face = freetype.Face(str(args.font))
    face.set_pixel_sizes(0, BOX)

    records = bytearray()
    written = skipped = 0
    for g in glyphs:
        gid = lookup(g["char"])
        if gid is None:
            skipped += 1
            continue
        face.load_glyph(gid, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_TARGET_NORMAL)
        bitmap = face.glyph.bitmap
        if bitmap.width == 0 or bitmap.rows == 0:
            skipped += 1
            continue
        pixels = np.array(bitmap.buffer, dtype=np.uint8).reshape(bitmap.rows, bitmap.pitch)[:, :bitmap.width]
        norm = normalize(pixels)
        if norm is None:
            skipped += 1
            continue
        gray_bytes, bits = features(norm)
        cps = [ord(c) for c in g["char"]]
        records += struct.pack("<IIH", g["mj"], cps[0], (cps[1] - 0xE0000) if len(cps) > 1 else 0) + gray_bytes + bits
        written += 1

    OUT_BIN.write_bytes(records)
    OUT_META.write_text(json.dumps({
        "records": written,
        "recordBytes": RECORD_BYTES,
        "box": BOX,
        "grayMesh": GRAY_MESH,
        "binMesh": BIN_MESH,
        "binThreshold": BIN_THRESHOLD,
        "font": "IPAmj明朝 Ver.006.01",
        "note": "IPAmj明朝の字形を画像化した特徴（scripts/build_image_index.py で生成）。字形そのものではない。",
    }, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    log(f"{written} 字形 → {OUT_BIN} ({len(records) / 1e6:.1f} MB, 1件 {RECORD_BYTES} バイト)"
        + (f" / 画像にできず除外 {skipped}" if skipped else ""))


if __name__ == "__main__":
    main()
