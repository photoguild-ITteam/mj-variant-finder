// 手書きの筆画 → 候補の文字。ワーカー（worker.js）と Node のテストの両方から使う。
//
// 照合は Kanji Canvas（MIT。src/vendor/kanji-canvas.js を無改変で同梱し、ワーカー用に ESM 化したもの）。
// 6702 字すべてと照合すると数秒かかるので、画数と指紋（signature.js）で POOL_SIZE 字まで絞ってから照合する。
// 実際の手書き 123 字での測定: 1位 92% / 上位10 99% / 中央値 0.8 秒（PC）。
import { KanjiCanvas } from '../../vendor/kanji-canvas.bundle.js';
import { signature, signatureDistance } from './signature.js';

export const POOL_SIZE = 600;
const STROKE_MIN_DIFF = -1; // 入力の画数に対して参照が取りうる差（Kanji Canvas 側の許容範囲に合わせる）
const STROKE_MAX_DIFF = 2;

/**
 * @param {[string, number, number[][][], string][]} entries 文字・画数・特徴点・指紋
 * @returns {(strokes: number[][][]) => string[]} 筆画（点列）→ 似ている順の文字
 */
export function createRecognizer(entries) {
  return (strokes) => {
    KanjiCanvas.recordedPattern_input = strokes;
    const input = KanjiCanvas.extractFeatures(KanjiCanvas.momentNormalize('input'), 20);
    if (!input.length) return [];

    const inputSignature = signature(input);
    KanjiCanvas.refPatterns = entries
      .filter(([, count]) => count - input.length >= STROKE_MIN_DIFF && count - input.length <= STROKE_MAX_DIFF)
      .map((entry) => [signatureDistance(inputSignature, entry[3]), entry])
      .sort((a, b) => a[0] - b[0])
      .slice(0, POOL_SIZE)
      .map(([, entry]) => entry);

    const result = KanjiCanvas.fineClassification(input, KanjiCanvas.coarseClassification(input));
    return [...String(result).replace(/\s/g, '')];
  };
}
