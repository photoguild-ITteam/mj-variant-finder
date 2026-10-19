# MJ Variant Gothic N / P（ゴシック体の見本用 Webフォント）

このフォルダの `mjg-*.woff2` は、字形の詳細の「ゴシック体で使う」に出す**見本**のためのフォントです。次の2つのフォントから、必要な字だけを抜き出した**派生フォント**（SIL Open Font License 1.1 の Modified Version）です。

| ファイル | フォント名 | 元のフォント | 入れた字 |
|---|---|---|---|
| `mjg-n-*.woff2` | MJ Variant Gothic N | [Noto Sans CJK JP](https://github.com/notofonts/noto-cjk) 2.004（`NotoSansCJKjp-Regular.otf`、sha256 `68a3fc98…f375b5`） | ゴシック○ の字形と、Noto Sans CJK JP にあるゴシック△ の字形（基本の漢字・拡張A など） |
| `mjg-p-*.woff2` | MJ Variant Gothic P | [遍黒体（Plangothic）](https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project) V2.9.5795 の P1（`PlangothicP1-Regular.ttf`、sha256 `550b5d07…dc5ad6`） | Noto Sans CJK JP に無いゴシック△ の字形（拡張B 以降） |

元のフォントに次の変更を加えています。

- 字形の一覧（`src/data/chars/`）で使う字だけを抜き出し、Unicode のブロック単位で分割した（`unicode-range` で必要なファイルだけを読み込む）
- ゴシック体の異体字（Adobe-Japan1 の IVS で出せる、通常と違う形。字の `gothicIvs`）がある字と、「ゴシックIVS」の字形（字形の `aj1`）を含むファイルにだけ、その字の Adobe-Japan1 IVS の字形と対応表（cmap format 14）を残した
- WOFF2 形式に変換し、ヒンティング・グリフ名・OpenType のレイアウト機能を削除した
- OFL の予約名・商標を使わないよう、フォント名を「MJ Variant Gothic N / P」に変えた

グリフの形には手を加えていません。著作権表示とライセンスの表記（name テーブルの 0・13・14）は残しています。

## ライセンス

[SIL Open Font License 1.1](https://openfontlicense.org/) に従って配布します。この派生フォントを再配布する場合も、同じライセンスが適用されます。

- Noto Sans CJK JP: [OFL-NotoSansCJK.txt](OFL-NotoSansCJK.txt)（© 2014-2021 Adobe）
- 遍黒体: [OFL-Plangothic.txt](OFL-Plangothic.txt)（Copyright (c) 2024 by Fitzgerald P. Köeingsegg）

## 作成方法

```sh
pip install -r scripts/requirements.txt
python scripts/build_variant_db.py        # 元のフォントが data/raw/ に無ければ取得し、字形ごとの gothic を作る
python scripts/build_gothic_webfont.py
```

作成に使ったファイルは [scripts/build_gothic_webfont.py](../../../scripts/build_gothic_webfont.py) だけです。

## 文書・印刷で使うには

このフォルダのフォントは見本用で、字が欠けています。文書や印刷では、元のフォントを配布元から取得して端末にインストールしてください。

- Noto Sans CJK JP: <https://github.com/notofonts/noto-cjk/releases>（日本語の `NotoSansCJKjp-*.otf`、または全言語の `NotoSansCJK-*.ttc`）
- 遍黒体: <https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project/releases>（`PlangothicP1-Regular.ttf` と `PlangothicP2-Regular.ttf`）

Windows に入っている Noto Sans JP は Noto Sans CJK JP の一部の字だけの版なので、ゴシック△ の字はありません。遍黒体は中国大陸の字形を基準にしたフォントで、細部（たとえば艹の画数）が IPAmj明朝 と違うことがあります。
