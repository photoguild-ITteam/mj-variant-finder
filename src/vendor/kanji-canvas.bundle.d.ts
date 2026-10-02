// src/vendor/kanji-canvas.bundle.js（Kanji Canvas を ESM 化したもの。npm run build:vendor で生成）の型.
// 同梱ライブラリは型検査の対象にしないので、recognizer.js から使う部分だけを宣言する（JS 本体の隣に置くと、tsc はこちらを読む）。

/** 筆画（点列）: [ストローク][x 列・y 列][座標] */
type Strokes = number[][][];

export declare const KanjiCanvas: {
  recordedPattern_input: Strokes;
  /** 照合する参照パターン: [文字, 画数, 特徴点, ...]（後ろに独自の項目があってもよい） */
  refPatterns: readonly (readonly [string, number, Strokes, ...unknown[]])[];
  momentNormalize(id: string): Strokes;
  extractFeatures(pattern: Strokes, interval: number): Strokes;
  coarseClassification(input: Strokes): [string, number, Strokes][];
  fineClassification(input: Strokes, candidates: [string, number, Strokes][]): string;
};
