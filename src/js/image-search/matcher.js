// 画像の特徴と索引（src/data/image-index.bin）を照合して、似ている字形を返す。
//   段1: 8x8 濃淡の内積で全 58,843 字形から POOL_SIZE 件に絞る（数十ミリ秒）
//   段2: 16x16 白黒のハミング距離で並べ替え
//   段3: 上位だけ実際のフォントで描き直し、64x64 の画像どうしを（ぼかしてから）比べ直す（呼び出し側が renderGlyph を渡したとき）
import { BOX, GRAY_MESH, binaryFeature, blur, grayFeature, normalizeImage } from './features.js';

const POOL_SIZE = 200;
const GRAY_WEIGHT = 0.6; // 段2 の点数配分（濃淡 : 白黒）
const RERANK = 20;
const HEADER_BYTES = 10;
const GRAY_BYTES = GRAY_MESH * GRAY_MESH;

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, i) => i.toString(2).split('1').length - 1);

/**
 * @param {ArrayBuffer} buffer image-index.bin
 * @param {{records: number, recordBytes: number}} meta image-index.json
 */
export function createIndex(buffer, meta) {
  const { records, recordBytes } = meta;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const binBytes = recordBytes - HEADER_BYTES - GRAY_BYTES;

  // 段1 用に、長さ 1 にそろえた濃淡ベクトルをまとめて持つ
  const gray = new Float32Array(records * GRAY_BYTES);
  for (let i = 0; i < records; i++) {
    const at = i * recordBytes + HEADER_BYTES;
    let sum = 0;
    for (let k = 0; k < GRAY_BYTES; k++) {
      const v = bytes[at + k];
      gray[i * GRAY_BYTES + k] = v;
      sum += v * v;
    }
    const length = Math.sqrt(sum) || 1;
    for (let k = 0; k < GRAY_BYTES; k++) gray[i * GRAY_BYTES + k] /= length;
  }

  const entry = (i) => {
    const at = i * recordBytes;
    const mj = view.getUint32(at, true);
    const base = view.getUint32(at + 4, true);
    const vs = view.getUint16(at + 8, true);
    return {
      mj: `MJ${String(mj).padStart(6, '0')}`,
      char: String.fromCodePoint(base) + (vs ? String.fromCodePoint(vs + 0xe0000) : ''),
    };
  };

  const binaryAt = (i) => bytes.subarray(i * recordBytes + HEADER_BYTES + GRAY_BYTES, (i + 1) * recordBytes);

  return { records, recordBytes, gray, entry, binaryAt, binBytes };
}

/**
 * @param {ReturnType<typeof createIndex>} index
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image 切り出した1文字の画像
 * @param {{limit?: number, renderGlyph?: (char: string) => Promise<Float32Array | null>}} options
 *   renderGlyph: 文字 → BOX*BOX の墨の濃さ（実フォントで描き直したもの）
 */
export async function matchImage(index, image, { limit = 12, renderGlyph } = {}) {
  const norm = normalizeImage(image);
  if (!norm) return [];
  const query = grayFeature(norm);
  const queryBits = binaryFeature(norm);

  // 段1
  const { records, gray } = index;
  const scores = new Float32Array(records);
  for (let i = 0; i < records; i++) {
    const at = i * GRAY_BYTES;
    let dot = 0;
    for (let k = 0; k < GRAY_BYTES; k++) dot += gray[at + k] * query[k];
    scores[i] = dot;
  }
  const pool = topIndices(scores, POOL_SIZE);

  // 段2: 濃淡（段1）と白黒の一致度を合わせて並べ替える
  const ranked = pool
    .map((i) => {
      const binary = 1 - hamming(index.binaryAt(i), queryBits) / (index.binBytes * 8);
      return { i, score: GRAY_WEIGHT * scores[i] + (1 - GRAY_WEIGHT) * binary };
    })
    .sort((a, b) => b.score - a.score);

  const candidates = ranked.slice(0, Math.max(limit, RERANK)).map(({ i, score }) => ({ ...index.entry(i), score }));

  // 段3（任意）
  if (renderGlyph) {
    const scored = await Promise.all(candidates.map(async (candidate) => {
      const rendered = await renderGlyph(candidate.char);
      return { ...candidate, score: rendered ? similarity(norm, rendered) : candidate.score - 1 };
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
  return candidates.slice(0, limit);
}

function topIndices(scores, count) {
  // 上位 count 件（部分選択。全体を並べ替えるより速い）
  const best = [];
  let worst = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (best.length < count) {
      best.push(i);
      if (best.length === count) {
        best.sort((a, b) => scores[b] - scores[a]);
        worst = scores[best[count - 1]];
      }
    } else if (scores[i] > worst) {
      let at = count - 1;
      while (at > 0 && scores[best[at - 1]] < scores[i]) {
        best[at] = best[at - 1];
        at--;
      }
      best[at] = i;
      worst = scores[best[count - 1]];
    }
  }
  return best;
}

function hamming(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += POPCOUNT[a[i] ^ b[i]];
  return total;
}

/**
 * 段3 の似ている度（-1〜1）。段1・段2 と同じくぼかしてから比べる。
 * ぼかさないと、同じ字形でも描いたときの1画素のずれ（環境ごとのアンチエイリアスの違いなど）で大きく下がる
 */
export function similarity(a, b) {
  return correlation(blur(a), blur(b));
}

/** 平均を引いた相関（-1〜1） */
function correlation(a, b) {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= b.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return dot / (Math.sqrt(normA * normB) || 1);
}

export { BOX };
