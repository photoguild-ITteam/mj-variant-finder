// canvas の小さな道具。DOM の canvas を使うが、画面の部品には依存しない（glyph-export.js などからも使う）。

/**
 * canvas の 2D コンテキスト.
 * getContext は null を返すことがある（大きすぎる canvas でメモリを確保できない、別の種類のコンテキストを取得済み など）。
 * そのまま使うと分かりにくい TypeError になるので、理由の分かる例外にする。
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2DSettings} [options]
 * @returns {CanvasRenderingContext2D}
 */
export function context2d(canvas, options) {
  const ctx = canvas.getContext('2d', options);
  if (!ctx) throw new Error(`canvas（${canvas.width}×${canvas.height}）に描画できません。画像が大きすぎる可能性があります`);
  return ctx;
}
