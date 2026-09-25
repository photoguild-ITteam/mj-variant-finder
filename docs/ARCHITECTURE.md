# アーキテクチャ・データパイプライン

`README.md` から分けた、実装の詳細です。

## 構成

| パス | 役割 |
|---|---|
| `index.html` | 画面の骨組み（検索、絞り込み、各種ダイアログ（使い方・詳細・比較・手書き・画像・フォント・ライセンス）、フッターの出典表示） |
| `src/css/style.css` | デザイントークン（藍・金茶・朱）、ダーク/ライト、レスポンシブ |
| `src/js/db.js` | インデックス読み込み、検索（文字・読み・MJ番号・U+/IVS・部首/画数）、シャードの遅延読み込み。DOM 非依存 |
| `src/js/app.js` | 起動と画面遷移（URL `#q=` 連動、検索フォーム、`data-query` を持つ要素のクリック） |
| `src/js/theme-init.js` | 描画前に `data-theme` を確定（保存値、無ければ OS 設定）。CSS は `data-theme` だけを見る |
| `src/js/ui/results.js` | 検索結果の描画（種類ごと: 文字タブ・読み・絞り込み・見つからない） |
| `src/js/ui/char-panel.js` | 1文字分のパネル（概要・字形バリエーション・関連する異体字） |
| `src/js/ui/glyph-card.js` / `glyph-dialog.js` | 字形カードと一覧の道具（絞り込み・違いを色で表示の切り替え）、詳細ダイアログ（コピー形式・画像書き出し・全項目） |
| `src/js/ui/glyph-diff.js` | 違いを色で表示: 字形と、IVS なしの通常の字形を canvas に描いて画素ごとに比べる（この字形だけ=赤、通常の字形だけ=青、共通=薄く）。設定は localStorage に保存 |
| `src/js/ui/glyph-info.js` | 表示ラベルとゴシック体の判定。DOM 非依存（`tests/glyph-info.test.mjs`） |
| `src/js/ui/compare.js` | 比較トレイと比較ダイアログ |
| `src/js/ui/filters.js` | 絞り込みフォームと「よく検索される異体字」 |
| `src/js/config.js` / `src/js/ui/session.js` | 実行時の設定（既定はすべて無効）/ 認証付きサーバーの後ろに置いたときのログイン切れ検知（任意。`config.sessionWatch`） |
| `src/js/ui/feedback.js` / `export-actions.js` | トースト・クリップボード / 画像書き出しの操作 |
| `src/js/ui/handwriting.js` | 手書き入力パネル（枠に書く → 候補 → その字で検索） |
| `src/data/names.json` | 人名・地名の読み辞書（かな検索時に遅延読み込み） |
| `src/data/nicknames.json` | 字の呼び名（はしごだか→髙、たてにし→西 E0102 など）と部首名（さんずい=85 など）。手作業、かな検索時に遅延読み込み。読み検索では、呼び名の完全一致・前方一致と、「部首名＋の＋読み」（やまへんのさき）を解釈する。部首は一覧表の最大4つの部首のどれでも一致とする（`search-index.json` の `extraRadicals`） |
| `src/js/ui/image-search.js` | 画像パネル（貼り付け・読み込み → 1文字を囲む → 候補） |
| `src/js/image-search/` | 画像の前処理（`features.js`）と索引との照合（`matcher.js`） |
| `src/js/handwriting/` | 認識の中核（`recognizer.js`）、指紋（`signature.js`）、別スレッド実行（`worker.js`） |
| `src/js/ui/theme.js` / `font-status.js` / `dom.js` / `context.js` | テーマ切り替え / フォント状態表示 / DOM 組み立て / 共有状態 |
| `src/js/font-detector.js` | 端末の IPAmj明朝の検出と、IVS が描き分けられるかの判定 |
| `src/js/glyph-export.js` | 字形の画像書き出し（透明PNGのコピー/保存、SVGアウトラインの保存）。Canva などへの貼り付け用 |
| `src/vendor/fontkit.js` | SVG 書き出しで woff2 から輪郭を取り出すための fontkit。`npm run build:vendor` で生成し、SVG 保存時にだけ読み込む（[ライセンス](src/vendor/THIRD_PARTY_LICENSES.txt)） |
| `src/fonts/` | Webフォント「MJ Variant Mincho」（IPAmj明朝の派生フォント。[README](src/fonts/README.md)） |

## データパイプライン

元データの新しい版は `scripts/check_updates.py` が配布元のページから調べる（`.github/workflows/check-data-updates.yml` が毎月1日に実行し、新しい版があれば Issue「元データの新しい版が出ています」を立てる。開いたままなら本文を更新する）。

```sh
python scripts/build_variant_db.py          # data/raw/ に元データが無ければ自動ダウンロード
python -m unittest scripts/test_variant_db.py -v
```

Python 3.10 以上、標準ライブラリのみ。

### 入力（`data/raw/`、Git 管理外）

| ファイル | 内容 | ライセンス |
|---|---|---|
| `mji.00602.xlsx` | MJ文字情報一覧表 Ver.006.02（CITPC） | CC BY-SA 2.1 JP |
| `MJShrinkMap.1.2.0.json` | MJ縮退マップ Ver.1.2.0（IPA） | CC BY-SA 2.1 JP |
| `IVD_Sequences.txt` | Unicode IVD 2026-08-03 | Unicode License v3 |
| `Unihan.zip` | Unihan Database 18.0.0（`Unihan_Variants.txt` のみ使用） | Unicode License v3 |

字形カードの「ゴシック○/△/×」は、ビルド時にゴシック体フォントの cmap を読んで判定する（`GOTHIC_FONTS`。SIL Open Font License の Noto Sans JP で ○/△ を判定し、BIZ UDゴシックは参考として表示する（BIZ UDゴシックの字は Noto Sans JP にすべて含まれる）。再配布に制限のある商用フォントは使わない。`--gothic-font noto=path/to/font` で場所を指定でき、フォントが見つからなければ判定を省く。フォント自体は配布しない）。Moji_Joho の IVS に対応したゴシック体は無いため、実装したUCS を持たない字形は ×（IVD 上も Moji_Joho と Adobe-Japan1 の共通シーケンスは 0 件）。

`scripts/data/name_presets.json` は、姓・地名の読みから表記を引くための手作業の辞書。MJ の読みは1文字単位なので、「わたなべ → 渡辺・渡邊・渡邉」のような読み検索はこの辞書で補う。

`src/data/nicknames.json` は、字の呼び名（「はしごだか」「たてにし」等）と部首名（約110種）を定義した手作業の辞書。読み検索での解釈や「部首名＋読み」検索で使用され、`tests/nicknames.test.mjs` で検証する。

### 出力（`src/data/`）

- `meta.json`: 出典、件数、関連種別の説明、IVD との照合結果
- `search-index.json`（約2.2MB）: 起動時に読み込む軽量インデックス
  - `shardBits`: シャード分割のビット幅（既定は 10）
  - `chars`: `{ "8FBA": [[MJ番号…], 総画数, 部首番号, flags] }`。flags は 1=常用、2=人名用、4=IVSあり
  - `aliases`: 互換漢字 → 対応UCS（例: `FA10` → `585A`）
  - `noChar`: UCS を持たない MJ 字形の一覧
  - `readings`: 読み（ひらがなに統一）→ UCS の一覧
  - `extraRadicals`: 一覧表で2つ目以降に定義されている部首情報（部首番号 → UCS の一覧。部首名検索や2つ目以降の部首での絞り込みに使用）
  - `names` / `quickAccess`: 人名・地名プリセット
- `chars/<shard>.json`: UCS 単位の詳細データ。表示するときに必要なシャードだけ読み込む。シャード名は `(コードポイント >> 10)` の16進表記
  - `glyphs[]`: MJ字形ごとの IVS・コピー用文字列・戸籍/住基/入管コード・JIS水準・部首/画数・読み・縮退マップ情報
  - `related[]`: 1ホップ先の関連UCSと関係の種別（`out` はこの字から見た縮退先、`in` は相手から参照されている）
- `chars/none.json`: UCS を持たない MJ 字形

### 注意

- 関連字は MJ縮退マップ（法務省告示・戸籍通達・辞書類）を主な根拠とする。Unihan の関係は中国語圏の簡体字・繁体字の対応を含むため、参考情報として種別を分けてある。
- `ivdOnly` は、MJ文字情報一覧表 Ver.006.02 より後に IVD に登録された IVS。IPAmj明朝に字形が無い場合があるため、コピー用の文字列には使わない。
- 出典表示: 各ファイルのライセンスは [LICENSES.md](../LICENSES.md) を参照。CC BY-SA 2.1 JP と 3.0（KanjiVG）は互いに継承できないため、混ぜずに別のものとして扱う。

## Webフォント

```sh
pip install fonttools brotli
python scripts/build_webfont.py --font path/to/ipamjm.ttf   # 既定は data/raw/ipamjm.ttf
```

IPAmj明朝 Ver.006.01（MD5 を検証）を 1024 コードポイント単位で分割し、79 個の WOFF2（合計約 12MB）にする。ブラウザは `unicode-range` で表示に必要なファイルだけを読み込む。

最初の画面（ロゴ・ようこそ・よく検索される異体字）の字はばらばらのブロックにあり、そのままだと十数ファイル（約3MB）を読む。そこでこれらの字と、IVS 表示の判定（`font-detector.js`）に使う2字形だけを入れた `mjv-preset.woff2`（約7KB、フォント名「MJ Variant Mincho Preset」）を別に作り、最初の画面の字はこのフォントで表示する。判定用の字形もここに入れてあるので、最初の画面では大きなフォントを読まない。入れる字は `search-index.json` の `quickAccess` と `build_webfont.py` の `PRESET_EXTRA`・`PRESET_IVS` で、`tests/fonts.test.mjs` が漏れを検出する（quickAccess を変えたらフォントも作り直す）。検索結果の字形カードは本体のフォントで表示するので、IVS の描き分けには影響しない。IVS の対応表（cmap format 14）を残すため、サブセット時に異体字セレクタも要求に含めている。IPAフォントライセンス v1.0 第3条に従い、改名、ライセンス同梱、オリジナルへの置き換え方法の提示を行っている。

## 人名・地名の読み辞書

```sh
npm run build:names   # data/raw/ の2ファイルから src/data/names.json を作る
```

読み（ひらがな）から、姓・名・地名の表記を引く。約2MB（gzip 0.5MB）で、**かな検索をした時だけ**読み込む。

| 区分 | 件数 | 出典 |
|---|---|---|
| 姓 | 9,097 読み | [mecab-ipadic](https://taku910.github.io/mecab/) `Noun.name.csv`（ipadic ライセンス。`data/raw/mecab-ipadic.tar.gz`） |
| 名 | 6,324 読み | 同上 |
| 地名 | 29,940 読み | [郵便番号データ](https://www.post.japanpost.jp/zipcode/dl/utf-zip.html)（日本郵便。著作権を主張せず自由に利用可） |
| 異体字に置き換えた表記 | 3,397 読み | 上記の姓・名を [`scripts/data/name_variants.json`](scripts/data/name_variants.json) で置き換えて生成 |

- 辞書には「髙橋」「山﨑」「𠮷田」のような異体字の表記がほとんど無いため、**よく使われる異体字48組の置き換え表**で補う（生成した表記は「実在の確認はしていません」と明示して表示）
- 地名は、市区町村（全部）と、置き換え表の字を含む町域のみ。全町域を入れると 3.5MB 増えるうえ、異体字とは関係のない地名が大半のため
- 「鹿嶋市＝かしまし」のように読みに接尾語が付くので、接尾語を外した読み（かしま）でも引けるようにしている
- 郵便番号データは**ブラウザでダウンロードする**（curl などは拒否される）。`data/raw/utf_ken_all.zip` に置く

## 画像から探す

```sh
pip install freetype-py pillow numpy
npm run build:imageindex    # IPAmj明朝の全字形を画像化 → src/data/image-index.bin
```

スクリーンショットや写真を貼り付け、1文字をドラッグで囲むと、字形を照合して候補を出す。索引（6.2MB）は画像パネルを開いたときだけ読み込み、画像は端末の外に出ない。

- **索引**: IPAmj明朝の全 58,843 字形を 64x64 に描画し、8x8 の濃淡（段1・内積）と 16x16 の白黒（段2・ハミング距離）にしたもの。1 字形 106 バイト
- **照合**: 段1 で 200 件に絞り、段2 で並べ替え、上位 20 件は実際のフォントで描き直して比べ直す（段3）。1 回 50〜200ms
- **精度**（Python で測定。同条件の再現は `scripts/build_image_index.py` と同じ前処理）: IPAmj明朝の表示を撮ったもの 1位 90% / 上位10 98%、MS明朝 84%/100%、游明朝 63%/100%、游ゴシック 63%/84%、メイリオ 47%/79%
- **OCR と違う点**: 文字だけでなく **どの MJ 字形（IVS の違い）か**まで当てられる。逆に、写真の手書き文字や低解像度（1文字 20px 以下）、ゴシック体は苦手
- 前処理（`src/js/image-search/features.js`）は `scripts/build_image_index.py` と同じにすること（ぼかし・切り出し・マス目の取り方）

## 手書き認識

```sh
npm run build:handwriting   # KanjiVG を data/raw/ に取得して src/data/handwriting-patterns.json を作る
npm run build:vendor        # 照合ライブラリ（Kanji Canvas）をワーカー用に ESM 化
```

枠に書いた筆画から候補の文字を出す。認識は別スレッド（Web Worker）で動き、データ（約5MB、gzip 1.8MB）は手書きパネルを開いたときだけ読み込む。

- **筆画データ**: [KanjiVG](https://kanjivg.tagaini.net/) r20250816（CC BY-SA 3.0）の 6,702 字。MJ の異体字そのもの（髙・𠮷・﨑・德・槗）は含まれないので、元の字（高・吉・崎・徳・橋）を書いて、結果の「関連する異体字」からたどる
- **照合**: [Kanji Canvas](https://github.com/asdfjkl/kanjicanvas)（MIT）。`src/vendor/kanji-canvas.js` を無改変で同梱し、`npm run build:vendor` でワーカー用に ESM 化する。付属の参照パターン（2,213字）は使わない
- **絞り込み**: 6,702 字すべてと照合すると 2.2 秒かかるため、画数と 8×8 の「墨の量」（`signature.js`）で 600 字に絞ってから照合する
- **精度**（Kanji Canvas 付属の実手書き 123 字で測定）: 1位 92% / 上位10 99% / 認識 0.8 秒（PC）。書き順・画数が多少違っても認識する
