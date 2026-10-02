// 画像の書き出し（PNG コピー / PNG 保存 / SVG 保存）の操作と結果表示。
// 書き出し本体（glyph-export.js と fontkit）は初回の操作時にだけ読み込む。

import { errorMessage, glyphMessage, showToast } from './feedback.js';
import { reportError } from './session.js';

const DONE_MESSAGE = {
  copyPng: '画像をコピーしました。Canva などで貼り付けできます',
  downloadPng: 'PNG を保存しました',
  downloadSvg: 'SVG を保存しました',
  copyMultiPng: '連結画像をコピーしました。Canva などで貼り付けできます',
  downloadMultiPng: '連結 PNG を保存しました',
  downloadMultiSvg: '連結 SVG を保存しました',
};

/** @param {'copyPng'|'downloadPng'|'downloadSvg'} action */
export async function exportImage(action, glyph) {
  try {
    const exporter = await import('../glyph-export.js');
    if (action === 'downloadSvg') showToast('SVG を作成しています…');
    await exporter[action](glyph);
    showToast(glyphMessage(glyph.char, ` ${DONE_MESSAGE[action]}`));
  } catch (err) {
    if (reportError(err)) {
      showToast('ログインが切れています。ログインしてから再読み込みしてください');
    } else if (action === 'copyPng') {
      showToast(`${errorMessage(err, '画像をコピーできませんでした')}。詳細画面の「PNGで保存」をお使いください`);
    } else {
      showToast(`保存できませんでした: ${errorMessage(err)}`);
    }
  }
}

/** @param {'copyMultiPng'|'downloadMultiPng'|'downloadMultiSvg'} action */
export async function exportMultiImage(action, glyphs, options) {
  try {
    const exporter = await import('../glyph-export.js');
    if (action === 'downloadMultiSvg') showToast('連結 SVG を作成しています…');
    await exporter[action](glyphs, options);
    const chars = glyphs.map((g) => g.char).join('');
    showToast(glyphMessage(chars, ` ${DONE_MESSAGE[action]}`));
  } catch (err) {
    if (reportError(err)) {
      showToast('ログインが切れています。ログインしてから再読み込みしてください');
    } else if (action === 'copyMultiPng') {
      showToast(`${errorMessage(err, '画像をコピーできませんでした')}。「PNGで保存」をお使いください`);
    } else {
      showToast(`保存できませんでした: ${errorMessage(err)}`);
    }
  }
}
