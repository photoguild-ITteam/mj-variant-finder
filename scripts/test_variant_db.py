#!/usr/bin/env python3
"""build_variant_db.py の出力（src/data/）の整合性テスト.

  python scripts/build_variant_db.py
  python -m unittest scripts/test_variant_db.py -v
"""

from __future__ import annotations

import json
import sys
import unittest
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_variant_db import ROOT, SOURCES, jis_level, kata_to_hira, read_ivd  # noqa: E402

DATA = ROOT / "src" / "data"
RAW = ROOT / "data" / "raw"


@lru_cache(maxsize=None)
def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def index() -> dict:
    return load(DATA / "search-index.json")


def resolve(ch: str) -> str:
    key = f"{ord(ch):04X}"
    return index()["aliases"].get(key, key)


def detail(ch: str) -> dict:
    key = resolve(ch)
    shard = int(key, 16) >> index()["shardBits"]
    return load(DATA / "chars" / f"{shard:X}.json")[key]


def related(ch: str) -> set[str]:
    return {r["ucs"] for r in detail(ch).get("related", [])}


class TestUnits(unittest.TestCase):
    def test_jis_level(self):
        cases = {
            "1-42-53": "第1水準",  # 辺
            "1-47-51": "第1水準",
            "1-47-52": "第3水準",
            "1-78-21": "第2水準",  # 邉
            "1-84-06": "第2水準",
            "1-84-07": "第3水準",
            "1-14-01": "第3水準",
            "2-01-01": "第4水準",
            "1-01-25": "非漢字",  # 々
            None: None,
        }
        for code, level in cases.items():
            self.assertEqual(jis_level(code), level, code)

    def test_kata_to_hira(self):
        self.assertEqual(kata_to_hira("ヘン・あたり"), "へん・あたり")


@unittest.skipUnless((DATA / "search-index.json").exists(), "src/data が未生成")
class TestDatabase(unittest.TestCase):
    def test_build_checks_clean(self):
        checks = load(DATA / "meta.json")["checks"]
        self.assertEqual(checks["ivdMojiJohoMissingInMJ"], [])
        self.assertEqual(checks["mjIvsNotInIVD"], [])

    def test_counts(self):
        counts = load(DATA / "meta.json")["counts"]
        self.assertGreater(counts["mjGlyphs"], 58000)
        self.assertGreater(counts["glyphsWithIVS"], 11000)

    def test_mj026190_is_ivs_of_9089(self):
        glyph = next(g for g in detail("邉")["glyphs"] if g["mj"] == "MJ026190")
        self.assertEqual(glyph["ivs"], ["9089_E010F"])
        self.assertEqual(glyph["char"], "邉\U000E010F")
        self.assertEqual(glyph["jisLevel"], "第2水準")
        self.assertEqual(glyph["koseki"], "445000")

    def test_watanabe_family(self):
        self.assertTrue({"9089", "908A"} <= related("辺"))
        self.assertTrue({"8FBA", "908A"} <= related("邉"))
        self.assertGreater(len([g for g in detail("邉")["glyphs"] if "ivs" in g]), 10)

    def test_saito_family(self):
        self.assertIn("9F4B", related("斎"))  # 斎 ↔ 齋
        self.assertIn("6589", related("齊"))  # 齊 ↔ 斉

    def test_taka_and_yoshi(self):
        self.assertIn("9AD8", related("髙"))
        self.assertIn("5409", related("𠮷"))

    def test_chars_with_ivs(self):
        flags_ivs = load(DATA / "meta.json")["flags"]["hasIVS"]
        for ch in "辻葛辺邉邊斎齋":
            self.assertTrue(index()["chars"][resolve(ch)][3] & flags_ivs, ch)

    def test_gothic_coverage(self):
        gothic = load(DATA / "meta.json")["gothic"]
        if gothic is None:
            self.skipTest("ゴシック体のフォントが無い環境でビルドされた")
        counts = gothic["counts"]
        self.assertEqual(sum(counts.values()), load(DATA / "meta.json")["counts"]["mjGlyphs"] - len(index()["noChar"]))
        glyphs = {g["mj"]: g for g in detail("邉")["glyphs"]}
        self.assertIn("noto", glyphs["MJ026190"]["gothic"])  # 実装したUCS U+9089 → ゴシック体にある
        self.assertNotIn("gothic", glyphs["MJ026191"])                        # IVS のみ → 判定対象外（×）
        ext_b = next(g for g in detail("\U00020000")["glyphs"] if g["mj"] == "MJ030312")
        self.assertEqual(ext_b["gothic"], [])                                  # Noto Sans JP・BIZ UDゴシックに字が無い（△）
        for ch in "髙𠮷﨑":                                                     # 人名でよく使う字は ○
            g = next(x for x in detail(ch)["glyphs"] if x.get("impl") == f"{ord(ch):04X}")
            self.assertIn("noto", g["gothic"], ch)

    def test_compat_alias(self):
        self.assertEqual(resolve("塚"), "585A")  # 互換漢字 U+FA10 → 塚 U+585A
        self.assertIn("MJ030194", {g["mj"] for g in detail("塚")["glyphs"]})

    def test_readings(self):
        readings = index()["readings"]
        self.assertIn("8FBA", readings["へん"])
        self.assertTrue({"658E", "9F4B"} <= set(readings["さい"]))
        self.assertIn("8FBB", readings["つじ"])

    def test_name_presets(self):
        names = index()["names"]
        self.assertEqual(set(names["さいとう"]), {"斉藤", "斎藤", "齊藤", "齋藤"})
        self.assertIn("渡邉", names["わたなべ"])
        for spellings in names.values():
            for word in spellings:
                for ch in word:
                    self.assertIn(resolve(ch), index()["chars"], ch)

    def test_index_and_shards_agree(self):
        idx = index()
        seen_mj: set[int] = set()
        for key, (mjs, *_rest) in idx["chars"].items():
            entry = load(DATA / "chars" / f"{int(key, 16) >> idx['shardBits']:X}.json")[key]
            self.assertEqual([int(g["mj"][2:]) for g in entry["glyphs"]], mjs, key)
            self.assertFalse(seen_mj & set(mjs), key)
            seen_mj.update(mjs)
        self.assertEqual(len(seen_mj) + len(idx["noChar"]), load(DATA / "meta.json")["counts"]["mjGlyphs"])

    @unittest.skipUnless((RAW / SOURCES["ivd"]["file"]).exists(), "IVD 元データが無い")
    def test_every_ivs_is_registered_moji_joho(self):
        registered, _ = read_ivd(RAW / SOURCES["ivd"]["file"])
        for path in (DATA / "chars").glob("*.json"):
            data = load(path)
            entries = data.values() if "glyphs" not in data else [data]
            for entry in entries:
                for g in entry["glyphs"]:
                    for seq in g.get("ivs", []):
                        vs = int(seq.split("_")[1], 16)
                        self.assertTrue(0xE0100 <= vs <= 0xE01EF, seq)
                        self.assertEqual(registered.get(seq), g["mj"], seq)


if __name__ == "__main__":
    unittest.main()
