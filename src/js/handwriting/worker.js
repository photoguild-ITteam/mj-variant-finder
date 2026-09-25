// 手書き認識のワーカー（画面を止めないよう別スレッドで動かす）。
//   init      : 参照パターン（src/data/handwriting-patterns.json）を読み込む
//   recognize : 筆画（点列）→ 候補の文字
// 認識そのものは recognizer.js。
import { createRecognizer } from './recognizer.js';

/** @type {((strokes: number[][][]) => string[]) | null} */
let recognize = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const res = await fetch(data.url);
      if (!res.ok) throw new Error(`認識データを読み込めません (${res.status})`);
      const json = await res.json();
      recognize = createRecognizer(json.chars);
      self.postMessage({ type: 'ready', count: json.chars.length, source: json.source });
    } else if (data.type === 'recognize') {
      if (!recognize) throw new Error('認識データが読み込まれていません');
      self.postMessage({ type: 'result', id: data.id, candidates: recognize(data.strokes) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err.message ?? err) });
  }
};
