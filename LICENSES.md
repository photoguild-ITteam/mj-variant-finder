# ライセンス一覧

このリポジトリは、**由来の異なる複数のライセンス**の成果物を含みます。ファイルごとの対応は次のとおりです。
プログラムは MIT ですが、`src/data/` を一括で 1 つのライセンスと見なさないでください。

| 対象 | ライセンス | 由来・出典 |
|---|---|---|
| プログラム（`index.html`, `src/js/`, `src/css/`, `scripts/`, `tests/`） | [MIT](LICENSE) | 本リポジトリ |
| `src/fonts/*.woff2`, `src/fonts/fonts.css` | [IPAフォントライセンス v1.0](src/fonts/LICENSE_IPA_Font_v1.0.txt) | [IPAmj明朝 Ver.006.01](https://moji.or.jp/mojikiban/font/) の派生（名称を「MJ Variant Mincho」に変更。[作成方法](src/fonts/README.md)） |
| `src/data/chars/`, `src/data/search-index.json`, `src/data/meta.json` | **CC BY-SA 2.1 JP** ＋ Unicode License v3 | [MJ文字情報一覧表 Ver.006.02](https://moji.or.jp/mojikiban/mjlist/)、[MJ縮退マップ Ver.1.2.0](https://moji.or.jp/mojikiban/map/)（[CC BY-SA 2.1 JP](https://creativecommons.org/licenses/by-sa/2.1/jp/)）、[Unicode IVD](https://www.unicode.org/ivd/)・[Unihan](https://www.unicode.org/reports/tr38/)（[Unicode License v3](https://www.unicode.org/license.txt)）を加工 |
| `src/data/handwriting-patterns.json` | **CC BY-SA 3.0** | [KanjiVG](https://kanjivg.tagaini.net/) r20250816 の筆画データを加工 |
| `src/data/names.json` | ipadic ライセンス（BSD 系）／日本郵便 | [mecab-ipadic](https://taku910.github.io/mecab/) 2.7.0-20070801（姓・名）、[郵便番号データ](https://www.post.japanpost.jp/zipcode/dl/utf-zip.html)（市区町村・町域。日本郵便は著作権を主張せず自由利用可）、`scripts/data/*.json`（手作業の置き換え表） |
| `src/data/image-index.bin`, `image-index.json` | IPAフォントライセンス v1.0 に従う | IPAmj明朝の字形を画像化した特徴量（字形そのものではない） |
| `src/vendor/kanji-canvas*.js` | [MIT](src/vendor/kanji-canvas.LICENSE.txt) | [Kanji Canvas](https://github.com/asdfjkl/kanjicanvas)（`kanji-canvas.js` は無改変） |
| `src/vendor/fontkit.js` | MIT ほか（[一覧](src/vendor/THIRD_PARTY_LICENSES.txt)） | fontkit と依存パッケージをバンドルしたもの |

## 注意

- **CC BY-SA（継承条件）**: `src/data/` のうち CC BY-SA 由来のファイルを再配布・改変する場合は、**同じ版のライセンス**（2.1 JP のデータは 2.1 JP、KanjiVG 由来は 3.0）または互換のライセンスで提供し、出典・改変の有無を表示してください。2.1 JP と 3.0 は互いに継承できません。**そのため上の表のファイルは混ぜずに、別々のものとして扱ってください。**
- **フォント**: 派生フォントを再配布するときは、IPAフォントライセンス v1.0 第3条（名称に「IPAmj明朝」を含めない、ライセンス本文とオリジナルへの置き換え方法を同梱する 等）に従ってください。
- **MJ文字情報一覧表・IPAmj明朝**の著作権は文字情報技術促進協議会・情報処理推進機構に帰属します。本プロジェクトは両者と無関係の**非公式のツール**です。
