#!/usr/bin/env python3
"""build_variant_db.py の出力（src/data/）の整合性テスト.

  python scripts/build_variant_db.py
  python -m unittest scripts/test_variant_db.py -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_variant_db import (  # noqa: E402
    ROOT, SOURCES, build_glyph, jis_level, kata_to_hira, read_ivd, read_strict_xlsx, to_version
)
from build_names_db import make_variants, read_postal  # noqa: E402

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

    def test_verify_sha256(self):
        from scripts.build_variant_db import verify_sha256
        import hashlib
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.txt"
            content = b"hello"
            file_path.write_bytes(content)
            expected = hashlib.sha256(content).hexdigest()
            # correct
            verify_sha256(file_path, expected)
            # incorrect
            with self.assertRaises(SystemExit) as cm:
                verify_sha256(file_path, "wrong_hash")
            self.assertIn("SHA256 不一致", str(cm.exception))
            self.assertIn("docs/ARCHITECTURE.md", str(cm.exception))

    def test_to_version(self):
        cases = {
            "1": 1,
            "1.1000000000000001": 1.1,
            "2": 2,
            "3.1": 3.1,
            "2.2000000000000002": 2.2,
            "4.0999999999999996": 4.1,
            "5.2": 5.2,
            None: None,
            "": None,
            "invalid": None,
        }
        for s, expected in cases.items():
            self.assertEqual(to_version(s), expected, s)


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

    def test_no_null_version_in_glyphs(self):
        for path in (DATA / "chars").glob("*.json"):
            data = load(path)
            entries = data.values() if "glyphs" not in data else [data]
            for entry in entries:
                for g in entry.get("glyphs", []):
                    if "version" in g:
                        self.assertIsNotNone(g["version"], f"null version in {g.get('mj')}")

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


class TestStrictXlsx(unittest.TestCase):
    def test_read_strict_xlsx_features(self):
        """Strict OOXML の読み込み: 共有文字列、浮動小数値、ふりがな(<rPh>)の除外、インライン文字列."""
        shared_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main">
  <si><t>MJ文字図形名</t></si>
  <si><t>総画数(参考)</t></si>
  <si><t>MJ文字図形バージョン</t></si>
  <si><t>備考</t></si>
  <si><t>MJ000001</t></si>
  <si>
    <r><t>実装なし</t></r>
    <rPh sb="0" eb="4"><t>ジッソウナシ</t></rPh>
  </si>
</sst>"""

        sheet_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
      <c r="D1" t="s"><v>3</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>4</v></c>
      <c r="B2"><v>12</v></c>
      <c r="C2"><v>1.1000000000000001</v></c>
      <c r="D2" t="s"><v>5</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>4</v></c>
      <c r="B3"><v>5</v></c>
      <c r="C3"><v>2</v></c>
      <c r="D3" t="inlineStr">
        <is>
          <r><t>インライン</t></r>
          <rPh sb="0" eb="5"><t>インラインルビ</t></rPh>
        </is>
      </c>
    </row>
  </sheetData>
</worksheet>"""

        with tempfile.TemporaryDirectory() as tmpdir:
            xlsx_path = Path(tmpdir) / "test.xlsx"
            with zipfile.ZipFile(xlsx_path, "w") as z:
                z.writestr("xl/sharedStrings.xml", shared_xml)
                z.writestr("xl/worksheets/sheet1.xml", sheet_xml)

            records = read_strict_xlsx(xlsx_path)
            self.assertEqual(len(records), 2)

            r1 = records[0]
            self.assertEqual(r1["MJ文字図形名"], "MJ000001")
            self.assertEqual(r1["総画数(参考)"], "12")
            self.assertEqual(r1["MJ文字図形バージョン"], "1.1000000000000001")
            # ふりがな（ジッソウナシ）が連結されず「実装なし」だけになること
            self.assertEqual(r1["備考"], "実装なし")

            r2 = records[1]
            self.assertEqual(r2["備考"], "インライン")


class TestBuildGlyph(unittest.TestCase):
    def test_build_glyph_conversion(self):
        """build_glyph による属性変換（画数・バージョン・読み・JIS水準・UCS・IVS・部首・辞書）."""
        rec = {
            "MJ文字図形名": "MJ026190",
            "対応するUCS": "U+9089",
            "実装したUCS": "U+9089",
            "実装したMoji_JohoコレクションIVS": "9089_E010F",
            "対応する互換漢字": "U+FA10",
            "X0213": "1-78-21",
            "MJ文字図形バージョン": "1.1000000000000001",
            "総画数(参考)": "17",
            "読み(参考)": "ヘン・あたり",
            "部首1(参考)": "162",
            "内画数1(参考)": "13",
            "部首2(参考)": "1",
            "内画数2(参考)": "16",
            "大漢和": "38843",
        }
        ivd_by_mj = {"MJ026190": ["9089_E010F", "9089_E0110"]}
        g = build_glyph(rec, ivd_by_mj)

        self.assertEqual(g["mj"], "MJ026190")
        self.assertEqual(g["mjNum"], 26190)
        self.assertEqual(g["ucs"], "9089")
        self.assertEqual(g["impl"], "9089")
        self.assertEqual(g["compat"], "FA10")
        self.assertEqual(g["ivs"], ["9089_E010F", "9089_E0110"])
        self.assertEqual(g["ivdOnly"], ["9089_E0110"])
        self.assertEqual(g["char"], "邉\U000E010F")  # 登録済み IVS を優先
        self.assertEqual(g["strokes"], 17)
        self.assertEqual(g["version"], 1.1)
        self.assertEqual(g["readings"], ["ヘン", "あたり"])
        self.assertEqual(g["jisLevel"], "第2水準")
        self.assertEqual(g["radicals"], [[162, 13], [1, 16]])
        self.assertEqual(g["dict"], {"daikanwa": "38843"})


class TestNamesDbParsers(unittest.TestCase):
    def test_make_variants(self):
        """異体字置き換え表から表記を生成する処理."""
        words = {"高崎", "吉田", "田中"}
        mapping = {"高": ["髙"], "吉": ["𠮷"], "崎": ["﨑", "嵜"]}
        variants = make_variants(words, mapping)

        self.assertIn("髙崎", variants)
        self.assertIn("高﨑", variants)
        self.assertIn("髙﨑", variants)
        self.assertIn("高嵜", variants)
        self.assertIn("髙嵜", variants)
        self.assertIn("𠮷田", variants)
        self.assertNotIn("高崎", variants)
        self.assertNotIn("吉田", variants)
        self.assertNotIn("田中", variants)

    def test_read_postal(self):
        """郵便番号データ（CSV）から市区町村と異体字を含む町域を読み込む処理."""
        csv_content = (
            '"13101","100  ","1000001","トウキョウト","チヨダク","チヨダ","東京都","千代田区","千代田"\n'
            '"13101","101  ","1010061","トウキョウト","チヨダク","カンダミサキチョウ","東京都","千代田区","神田三崎町"\n'
            '"13101","100  ","1000014","トウキョウト","チヨダク","ナガタチョウ","東京都","千代田区","永田町"\n'
            '"13101","100  ","1000000","トウキョウト","チヨダク","イカニケイサイガナイバアイ","東京都","千代田区","以下に掲載がない場合"\n'
            '"08201","314  ","3140000","イバラキケン","カシマシ","","茨城県","鹿嶋市",""\n'
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            postal_zip = Path(tmpdir) / "utf_ken_all.zip"
            with zipfile.ZipFile(postal_zip, "w") as z:
                z.writestr("utf_ken_all.csv", csv_content.encode("utf-8"))

            variant_chars = {"崎"}
            places = read_postal(variant_chars, postal_path=postal_zip)

            # 市区町村: 千代田区（全件入る。接尾語「区」あり・なし両方で引ける）
            self.assertIn("千代田区", places["ちよだく"])
            self.assertIn("千代田区", places["ちよだ"])

            # 市区町村: 鹿嶋市（接尾語「市」あり・なし両方で引ける）
            self.assertIn("鹿嶋市", places["かしまし"])
            self.assertIn("鹿嶋市", places["かしま"])

            # 町域: 神田三崎町（「崎」が variant_chars に含まれるため入る。「町」あり・なし両方）
            self.assertIn("神田三崎町", places["かんだみさきちょう"])
            self.assertIn("神田三崎町", places["かんだみさき"])

            # 町域: 永田町（variant_chars を含まないためスキップ）
            self.assertNotIn("永田町", places.get("ながたちょう", set()))

            # スキップ語句: 以下に掲載がない場合
            self.assertFalse(any("以下に掲載がない場合" in s for s in places.values()))


if __name__ == "__main__":
    unittest.main()
