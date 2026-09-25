# 変更履歴

このプロジェクトの主な変更を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、版の付け方は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。
元データの版を更新したときは「データ」に書きます。

## [Unreleased]

### 追加

- 字形の一覧に「違いを色で表示」: IVS を付けないときの通常の字形と重ね、違う部分に色を付ける。通常の字形と同じものには「IVSなしと同じ」の印
- 字形の一覧の絞り込み（戸籍・住基・入管・JIS・ゴシック○・IVSあり）
- 見つからないときに、ほかの探し方（手書き・画像・検索の例）を表示

### 修正

- 比較トレイを出したまま最下部までスクロールすると、フッターの文字が隠れていた
- 検索欄の消去ボタン（×）がブラウザ標準の青だった
- スマホで検索中は「よく検索される異体字」を畳み、結果を上に近づける

## [0.1.0] - 2026-09-25

最初の公開版です。

### 機能

- 異体字の検索: 文字・単語、読み（人名・地名の辞書つき）、MJ文字図形名、コードポイント・IVS、部首・画数・漢字施策での絞り込み
- IVS 異体字と、文字コードの違う新旧字体・俗字（MJ縮退マップ・Unihan）の一覧
- ワンクリックコピー（IVS 付きの文字、MJ番号、コードポイント、HTML 数値参照、JS/CSS エスケープ）
- 透明 PNG・SVG アウトラインの書き出し
- IPAmj明朝の派生 Webフォント「MJ Variant Mincho」（`unicode-range` で分割。最初の画面は約7KBの小さなフォントだけで表示）
- 字形の比較（並べる／重ねる）、ゴシック体での収録の判定（Noto Sans JP・BIZ UDゴシック）
- 手書きで探す（KanjiVG・Kanji Canvas）、画像から探す（スクリーンショットの貼り付け）
- ダーク/ライトモード、スマホ表示、URL（`#q=`）での共有

### データ

| データ | 版 |
|---|---|
| MJ文字情報一覧表 | Ver.006.02（58,862 字形、うち IVS 11,390 字形） |
| MJ縮退マップ | Ver.1.2.0 |
| Unicode IVD | 2026-08-03 |
| Unihan | 17.0.0 |
| IPAmj明朝 | Ver.006.01 |
| KanjiVG | r20250816 |
| mecab-ipadic | 2.7.0-20070801 |

[Unreleased]: https://github.com/photoguild-ITteam/mj-variant-finder/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/photoguild-ITteam/mj-variant-finder/releases/tag/v0.1.0
