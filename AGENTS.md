# AGENTS.md

AI のコーディングエージェント（Jules、Antigravity、Claude Code など）向けの作業ルールです。
人向けの手順は [CONTRIBUTING.md](CONTRIBUTING.md)、仕組みは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) にあります。**このファイルは、それらに加えて守ってほしいことだけを書いています。** 依頼者の指示とこのファイルが食い違うときは、依頼者の指示に従い、食い違ったことを PR に書いてください。

このプロジェクトは、IPAmj明朝の異体字（IVS）をブラウザだけで検索・比較する静的 Web ツールです。実行時の依存・ビルド工程・サーバー処理はありません（`index.html` と `src/` を置くだけで動く）。

## ブランチと PR

- **作業ごとに、最新の main から新しいブランチを切る。** 前の作業のブランチ（`debug` など）を使い回さない。
  ```sh
  git fetch origin
  git switch -c fix/<内容> origin/main    # 種類は fix / feat / docs / data / test / chore
  ```
- **1つの PR には1つの話題だけを入れる。** 複数の不具合を頼まれたら、件ごとにコミットを分ける。互いに関係なければ PR も分ける（1件が CI で落ちても、ほかを止めないため）。
- **しないこと**: main への直接の push、force push、PR のマージ、ブランチの削除。これらは人が行う。
- **作業を始める前に、開いている PR を確かめる**（`gh pr list`、または GitHub の画面）。ほかの PR と同じファイルを変える場合は、依頼者に伝える。

## PR を出す前の確認

次を実行し、結果を PR の「確認」欄に書く（テンプレート `.github/pull_request_template.md` のチェック欄を埋める）。**実行しなかった確認は、チェックを付けずに理由を書く。**

```sh
npm ci
npm test                  # Node の単体テスト + Python unittest（生成データの検証）
# 画面・JS を変えたとき（CI と同じ条件）
npx playwright-core install --with-deps chromium
npm run serve &           # http://127.0.0.1:8765/
BROWSER_CHANNEL=chromium npm run test:e2e
```

- e2e はコンソールエラーと CSP 違反も検査する。**失敗したまま PR を出さない。** 原因が自分の変更でないと判断したときは、その根拠を PR に書く。
- 不具合を直したら、**直す前は落ち、直した後は通るテスト**をできるだけ足す（DOM に頼らない部分を関数に切り出してテストする）。
- 手元の環境だけで通るものに注意する。例: 端末に IPAmj明朝 が入っていると `src/fonts/fonts.css` の `local()` が使われ、Web フォント（woff2）を通らない。Windows と Linux ではフォントの描画が1画素ずれることがある（画像検索の比較で実際に起きた）。

## コードの書き方

CONTRIBUTING.md の「開発の手順」に加えて:

- コメント・利用者向けの文言は日本語。コメントの量は周りのコードに合わせる。
- DOM は `h()`（`src/js/ui/dom.js`）で組み立てる。`innerHTML`・`eval`・inline script・`on*` 属性は使わない。
- **CSP（`index.html` の `<meta http-equiv="Content-Security-Policy">`）を緩めない。** 緩める必要があると思ったら、変えずに依頼者に相談する。
- 状態は関数のプロパティ（`fn.cache = ...` など）ではなく、モジュールの変数に置く。
- `await` の後では、待っている間に状況が変わっていないか（新しい検索・別のタブ・ダイアログを閉じた など）を確かめ、古い結果で画面を上書きしない。
- `src/js/db.js`・`src/js/image-search/`・`src/js/handwriting/recognizer.js` は DOM に依存させない（Node でテストしている）。
- 実行時の依存（npm・CDN）を増やさない。開発用の依存（`devDependencies`）を足すときは、PR に理由を書く。

## 生成物とデータ

- `src/data/`（`nicknames.json` を除く）と `src/fonts/` は **生成物**。手で編集せず、`scripts/` を直して作り直す（CONTRIBUTING.md）。
- 作り直しには `data/raw/` の元データ（Git 管理外）が要る。多くは自動でダウンロードされるが、郵便番号データなど手動で置くものもある（docs/ARCHITECTURE.md）。
- **ゴシック体の判定（字形の `gothic`）は、作り直す端末のフォントに依存する**（`scripts/build_variant_db.py` の `GOTHIC_FONTS`。Windows の `C:\Windows\Fonts\NotoSansJP-VF.ttf` と `BIZ-UDGothicR.ttc` など）。フォントが無い環境で作り直すと、判定が変わるか省かれる。
- 作り直したら、**意図した項目以外が変わっていないか**を確かめる（例: JSON を読んで、変わった項目の種類と件数を数える）。`gothic` など関係のない項目が変わっていたら、コミットせずに依頼者に伝える。
- `meta.json`・`names.json` の `generatedAt` は作り直すたびに変わる（これ自体は問題ない）。

## コミット・CHANGELOG

- コミットメッセージと PR の説明は日本語。1行目は短く要点を書き、本文に「なぜ」を書く。Issue を閉じるときは本文に `Closes #番号`。
- 利用者に見える変更は、`CHANGELOG.md` の `[Unreleased]` の「追加」「変更」「修正」「データ」のどれかに1行で書く。
- ほかの PR と `CHANGELOG.md` が衝突したら、**両方の行を残す**（どちらも追記なので、並べれば解消する）。
- **git の `user.name`・`user.email` を変えない。** 環境に設定されたものをそのまま使う。

## 人に確認してから行うこと

次は変更する前に、依頼者に確認する。

- ライセンスに関わるもの: `LICENSE`、`LICENSES.md`、`licenses/`、`src/fonts/LICENSE_IPA_Font_v1.0.txt`、README のライセンス節、画面の「データ出典・ライセンス」。ほかのプロジェクトのコード・データの持ち込み（CC BY-SA 2.1 JP と 3.0 は混ぜられない）。
- 元データの出典・版の変更（`scripts/` の URL、`SOURCES`）。
- `.github/`（ワークフロー・テンプレート）、CSP、`package.json` の scripts。
- ファイルの削除・名前の変更、大きな設計の変更（データの形を変える、ファイルを分ける など）。

## 環境ごとの注意

- **Jules など、クラウドの VM で動くエージェント**: `data/raw/` と手元のゴシック体フォントが無いので、**データ・フォントを作り直す作業はしない**（頼まれたら、スクリプトの修正とテストまでにし、作り直しは手元で行うよう PR に書く）。
- **Antigravity など、手元の PC で動くエージェント**: `data/raw/` とフォントがあるので、データの作り直しができる。画面を変えたときは、ブラウザで操作した結果（スクリーンショット）を PR に添える。スマホ幅（例: 390px）とダークモードも確かめる。
- どちらも、Safari・iPhone での動作は確かめられない。関係する変更（クリップボード、タッチ操作など）では、そのことを PR に書く。
