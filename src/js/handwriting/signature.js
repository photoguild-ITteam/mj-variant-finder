// 字形の「指紋」: 特徴点を GRID×GRID に落とし、各マスの墨の量を 0-15 で表す。
// 総当たり照合は重いので、まずこの指紋で候補を数百字に絞る。
// scripts/build_handwriting_db.mjs（データ作成）と画面の両方から使う。

export const GRID = 8;
export const SPAN = 256; // Kanji Canvas のモーメント正規化後の座標系

/**
 * @param {number[][][]} pattern 筆画ごとの特徴点 [[[x, y], ...], ...]
 * @returns {string} GRID*GRID 桁の16進文字列
 */
export function signature(pattern) {
  const cells = new Float64Array(GRID * GRID);
  for (const stroke of pattern) {
    for (let i = 1; i < stroke.length; i++) {
      const [x0, y0] = stroke[i - 1];
      const [x1, y1] = stroke[i];
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 8));
      for (let s = 0; s <= steps; s++) {
        const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((x0 + ((x1 - x0) * s) / steps) / SPAN) * GRID)));
        const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((y0 + ((y1 - y0) * s) / steps) / SPAN) * GRID)));
        cells[gy * GRID + gx] += 1;
      }
    }
  }
  const max = Math.max(1, ...cells);
  return Array.from(cells, (v) => Math.round((v / max) * 15).toString(16)).join('');
}

/** 指紋どうしの距離（小さいほど似ている） */
export function signatureDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i++) distance += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16));
  return distance;
}
