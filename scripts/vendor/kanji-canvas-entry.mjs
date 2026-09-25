// ブラウザのグローバル前提で書かれた kanji-canvas.js を ESM（ワーカー）から使えるようにする入口。
// esbuild で src/vendor/kanji-canvas.bundle.js にまとめる（npm run build:vendor）。
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {} };
await import('../../src/vendor/kanji-canvas.js');

/** @type {{ momentNormalize: Function, extractFeatures: Function, coarseClassification: Function, fineClassification: Function, refPatterns: any[] }} */
export const KanjiCanvas = globalThis.KanjiCanvas;
