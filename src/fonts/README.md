# MJ Variant Mincho（Webフォント）

このフォルダの `mjv-*.woff2` は、**IPAmj明朝 Ver.006.01**（`ipamjm.ttf`、MD5 `BEEE256D4FFEC4C40493805A4D7E5CDD`）から作った**派生フォント**です。ブラウザ表示用に、次の変更を加えています。

- Unicode ブロック単位で分割（`unicode-range` で必要なファイルだけを読み込む）
- 最初の画面に出る字だけを入れた小さなフォント `mjv-preset.woff2`（フォント名「MJ Variant Mincho Preset」）も作る
- WOFF2 形式に変換し、ヒンティングとグリフ名を削除
- IPAフォントライセンス v1.0 第3条1項(4) に従い、フォント名を「MJ Variant Mincho」に変更

グリフの形状、IVS / SVS の対応表（cmap format 14）、OpenType レイアウト機能には手を加えていません。

## ライセンス

[IPAフォントライセンス v1.0](LICENSE_IPA_Font_v1.0.txt) に従って配布します。この派生フォントを再配布する場合も、同じライセンスが適用されます。

## 作成方法（第3条1項(1)）

```sh
pip install fonttools brotli
python scripts/build_webfont.py --font path/to/ipamjm.ttf
```

作成に使ったファイルは [scripts/build_webfont.py](../../scripts/build_webfont.py) だけです。ほかに中間ファイルはありません。

## オリジナルへの置き換え方法（第3条1項(2)）

1. 文字情報技術促進協議会の配布ページ <https://moji.or.jp/mojikiban/font/> で IPAフォントライセンスを確認し、IPAmj明朝 Ver.006.01 をダウンロードします（配布は窓の杜から）。
2. **端末にインストールする場合**: `ipamjm.ttf` をOSにインストールします。`fonts.css` は `local("IPAmjMincho")` を先に参照するので、ブラウザは派生フォントをダウンロードせず、オリジナルを使います。
3. **サーバーで配信する場合**: `fonts.css` の `@font-face` をすべて次の2つに置き換え、`ipamjm.ttf` を同じフォルダに置きます。

   ```css
   @font-face { font-family: "MJ Variant Mincho"; src: url("ipamjm.ttf") format("truetype"); }
   @font-face { font-family: "MJ Variant Mincho Preset"; src: url("ipamjm.ttf") format("truetype"); }
   ```

Word や Excel などほかのアプリに IVS 付きの文字を貼り付けて正しく表示するには、その端末に IPAmj明朝をインストールする必要があります。
