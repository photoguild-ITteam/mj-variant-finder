# MJ Variant Finder（IPAmj明朝 異体字検索）

**IPAmj明朝の異体字（IVS）を、フォントを入れなくてもブラウザだけで検索・比較・コピー・画像化できる静的Webツールです。**
サーバー処理も外部APIも不要で、静的ファイルを置くだけで動きます。

> 🌐 **デモ**: https://YOUR-ORG.github.io/mj-variant-finder/

![異体字の一覧](docs/images/01-variants.png)

## 何ができるか

「邉」と「邊」、「髙」と「高」のような**字形の違い**を、コードの違い（Unicode・IVS）ごと確認できます。戸籍・住基・入管など、文字の違いが問題になる業務で、どの字形を使うべきかを調べる用途を想定しています。

- **検索**: 文字・単語（1文字ずつ展開）、読み（ひらがな。人名・地名の辞書つき）、MJ文字図形名（`MJ026190`）、コードポイント（`U+8FBB`、`9089_E010F`、HTML参照）、部首・画数・漢字施策での絞り込み
- **異体字の関係**: 同じ文字コード内の IVS 異体字と、文字コードが異なる新旧字体・俗字（辺・邉・邊 など）を、MJ縮退マップをもとに一覧
- **詳細情報**: MJ文字図形名、IVS、JIS水準、戸籍統一文字番号、住基ネット統一文字コード、入管コード、漢字施策、読み、画数、部首 など
- **ワンクリックコピー**: IVS付きの文字、MJ番号、`U+9089 U+E010F`、HTML数値参照、JS/CSS エスケープ
- **画像・ベクター書き出し**: 透明PNG（クリップボードへコピー可）、SVGアウトライン。IVS やフォントの扱いが不確かなアプリ（Canva など）に、字形を崩さず持ち込めます
- **Webフォント表示**: IPAmj明朝の派生フォント（79ファイル、`unicode-range` で必要な分だけ読み込み）。フォント未導入の環境でも IVS を正しく表示
- **比較**: 複数の字形を並べる／重ねて（赤・青）、細かな差分を確認
- **ゴシック体の判定**: その字形がゴシック体でも使えるか（○/△/×）を表示
- **手書きで探す**: 枠に書いた字から候補を出す（KanjiVG、6,702字）
- **画像から探す**: スクリーンショットを貼り付け、1文字を囲むと、IPAmj明朝の全 58,843 字形と照合（同じ IPAmj明朝の表示なら 1位 90% / 上位10 98%）
- ダーク/ライトモード、スマホ対応、URL（`#q=渡辺`）での共有

| 読み検索 | 字形の詳細 | 比較 |
|---|---|---|
| ![読み検索](docs/images/02-reading.png) | ![字形の詳細](docs/images/03-detail.png) | ![比較](docs/images/04-compare.png) |

## ⚠️ 免責事項

**本ツールは公的機関のデータを機械処理したものであり、字形の同一性・正確性を保証するものではありません。印刷や公的申請への利用は利用者の自己責任で行ってください。**

- 本プロジェクトは、MJ文字情報一覧表・IPAmj明朝の提供元（文字情報技術促進協議会・情報処理推進機構）とは**無関係の非公式のツール**です
- 「異体字に置き換えた表記」（人名・地名の読み検索）は機械的に作ったもので、実在の確認はしていません
- 手書き・画像からの認識は候補を出すもので、結果の正しさは保証しません
- 本ソフトウェアは MIT ライセンスのもと**現状のまま**提供され、サポート（SLA）はありません。**個別の文字の調査・解釈のご相談にはお応えできません**

## 使い方

### オンラインで使う

デモサイトを開くだけです。検索語は URL の `#q=` に入るので、リンクで共有できます。

### ローカルで動かす

```sh
git clone https://github.com/YOUR-ORG/mj-variant-finder.git
cd mj-variant-finder
npm run serve            # = python -m http.server 8765 → http://127.0.0.1:8765/
```

ES Modules と fetch を使うので、`file://` では動きません（HTTPサーバー経由で開いてください）。ビルド済みのデータとフォントを含んでいるので、追加のセットアップは要りません（Python 3 があれば動きます）。

### 自分のサイトに置く

`index.html` と `src/` を、任意の静的ホスティングに置くだけです（GitHub Pages、Netlify、S3 など）。相対パスなので、サブパスに置いても動きます。認証付きのサーバーの後ろに置く場合は、`src/js/config.js` の `sessionWatch` を設定すると、ログイン切れの案内を出せます。

## 開発

```sh
npm install              # 開発用（テスト・ビルド）。実行には不要
npm test                 # 単体テスト（Node）+ データ検証（Python unittest）
npm run test:e2e         # ブラウザテスト（Playwright。要 Chrome、`npm run serve` を起動しておく）
```

データやフォントを作り直す手順、各機能の仕組みは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) にあります。
元データ（MJ文字情報一覧表など）は公式配布元から取得するもので、リポジトリには含めません（`data/raw/`、Git 管理外）。

MJ文字情報や Unicode の改訂があったときは、`npm run build:data` などのスクリプトを再実行して差分をコミットします。

### コントリビューション

Issue・Pull Request を歓迎します（[CONTRIBUTING.md](CONTRIBUTING.md)）。セキュリティ上の問題は [SECURITY.md](SECURITY.md) をご覧ください。

## ライセンス

複合ライセンスです。**ファイルごとのライセンスは [LICENSES.md](LICENSES.md) を参照してください。**

| 対象 | ライセンス |
|---|---|
| プログラム | [MIT](LICENSE) |
| 文字データ（`src/data/`） | CC BY-SA 2.1 JP（MJ由来）／ CC BY-SA 3.0（KanjiVG由来）ほか。由来ごとに異なります |
| 派生Webフォント（`src/fonts/`） | [IPAフォントライセンス v1.0](src/fonts/LICENSE_IPA_Font_v1.0.txt) |

## 出典

- [MJ文字情報一覧表](https://moji.or.jp/mojikiban/mjlist/)・[IPAmj明朝](https://moji.or.jp/mojikiban/font/)（文字情報技術促進協議会）、[MJ縮退マップ](https://moji.or.jp/mojikiban/map/)（情報処理推進機構）
- [Unicode IVD](https://www.unicode.org/ivd/)・[Unihan](https://www.unicode.org/reports/tr38/)（Unicode, Inc.）
- [KanjiVG](https://kanjivg.tagaini.net/)・[Kanji Canvas](https://github.com/asdfjkl/kanjicanvas)（手書き認識）
- [mecab-ipadic](https://taku910.github.io/mecab/)・[郵便番号データ](https://www.post.japanpost.jp/zipcode/dl/utf-zip.html)（人名・地名の読み）

## クレジット

Developed by **YOUR-COMPANY** — https://YOUR-COMPANY.example
