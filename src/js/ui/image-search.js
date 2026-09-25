// 画像から字形を探すパネル: 画像を貼り付け／読み込み、1文字を囲むと候補を出す。
// 索引（src/data/image-index.bin、約6MB）は初回に開いたときだけ読み込む。画像は端末の外に出ない。

import { app } from './context.js';
import { $, h, loading } from './dom.js';
import { WEB_FONT_FAMILY } from '../font-detector.js';
import { showSessionExpired } from './session.js';

const INDEX_BIN = new URL('../../data/image-index.bin', import.meta.url);
const INDEX_META = new URL('../../data/image-index.json', import.meta.url);
const PREVIEW_MAX = 420;
const MATCH_DELAY_MS = 200;

let matcherModule = null;
let featuresModule = null;
let index = null;
/** @type {ImageBitmap | null} */
let sourceImage = null;
let sourceCanvas = null;
let selection = null; // 元画像の座標での切り出し範囲
let timer;
let matchToken = 0; // 照合の番号。新しい照合を始めた・画像を替えた・閉じたら、前の照合の結果は捨てる

export function setupImageSearch() {
  $('#image-open').addEventListener('click', () => openDialog());
  $('#image-dialog').addEventListener('close', () => {
    matchToken += 1;
  });
  for (const id of ['#img-file', '#img-file2']) {
    $(id).addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    });
  }
  $('#img-reset').addEventListener('click', () => {
    selection = null;
    drawPreview();
    runMatch();
  });
  setupDropZone();
  setupSelection();

  // 画面のどこで貼り付けても、画像なら取り込む（スクリーンショットをそのまま Ctrl+V）
  document.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    openDialog();
    loadFile(file);
  });
}

function openDialog() {
  const dialog = $('#image-dialog');
  if (!dialog.open) dialog.showModal();
  loadIndex();
}

// ---------------------------------------------------------------------------- 索引の読み込み

async function loadIndex() {
  if (index || loadIndex.pending) return;
  loadIndex.pending = true;
  setStatus('照合データを読み込んでいます…', true);
  try {
    const [module, featModule, metaRes, binRes] = await Promise.all([
      import('../image-search/matcher.js'),
      import('../image-search/features.js'),
      fetch(INDEX_META),
      fetch(INDEX_BIN),
    ]);
    const failed = [metaRes, binRes].find((r) => !r.ok);
    if (failed) throw new Error(`照合データを読み込めません (${failed.status})`);
    matcherModule = module;
    featuresModule = featModule;
    index = module.createIndex(await binRes.arrayBuffer(), await metaRes.json());
    setStatus(sourceImage ? '調べたい1文字をドラッグで囲んでください。' : readyMessage());
    if (sourceImage) runMatch();
  } catch (err) {
    console.error(err);
    if (/\b(401|403)\b/.test(err.message)) showSessionExpired();
    setStatus(`読み込めませんでした: ${err.message}`);
  } finally {
    loadIndex.pending = false;
  }
}

const readyMessage = () => `画像を貼り付け（Ctrl+V）、ドラッグ、または「ファイルを選ぶ」で読み込んでください。${index ? `（${index.records.toLocaleString()} 字形と照合します）` : ''}`;

// ---------------------------------------------------------------------------- 画像の読み込み

function setupDropZone() {
  const zone = $('#img-drop');
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      if (type === 'drop') {
        const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
        if (file) loadFile(file);
      }
    });
  }
}

async function loadFile(file) {
  matchToken += 1;
  try {
    sourceImage = await createImageBitmap(file);
  } catch {
    setStatus('この画像は読み込めませんでした。');
    return;
  }
  sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceImage.width;
  sourceCanvas.height = sourceImage.height;
  sourceCanvas.getContext('2d', { willReadFrequently: true }).drawImage(sourceImage, 0, 0);
  selection = null;
  $('#img-drop').hidden = true;
  $('#img-stage').hidden = false;
  drawPreview();
  setStatus(index ? '調べたい1文字をドラッグで囲んでください。' : '照合データを読み込んでいます…', !index);
  runMatch();
}

// ---------------------------------------------------------------------------- 範囲の選択

function previewScale() {
  return Math.min(1, PREVIEW_MAX / Math.max(sourceImage.width, sourceImage.height));
}

function drawPreview() {
  const canvas = $('#img-canvas');
  const scale = previewScale();
  canvas.width = Math.round(sourceImage.width * scale);
  canvas.height = Math.round(sourceImage.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  if (!selection) return;
  // 選んだ範囲の外を暗くする
  ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
  const { x, y, width, height } = scaleRect(selection, scale);
  ctx.fillRect(0, 0, canvas.width, y);
  ctx.fillRect(0, y + height, canvas.width, canvas.height - y - height);
  ctx.fillRect(0, y, x, height);
  ctx.fillRect(x + width, y, canvas.width - x - width, height);
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}

const scaleRect = (rect, scale) => ({
  x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale,
});

function setupSelection() {
  const canvas = $('#img-canvas');
  let start = null;
  const at = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scale = previewScale();
    const cssScaleX = rect.width ? canvas.width / rect.width : 1;
    const cssScaleY = rect.height ? canvas.height / rect.height : 1;
    return [
      (e.clientX - rect.left) * cssScaleX / scale,
      (e.clientY - rect.top) * cssScaleY / scale,
    ];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!sourceImage) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    start = at(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!start) return;
    const [x, y] = at(e);
    selection = {
      x: Math.max(0, Math.min(start[0], x)),
      y: Math.max(0, Math.min(start[1], y)),
      width: Math.min(sourceImage.width, Math.abs(x - start[0])),
      height: Math.min(sourceImage.height, Math.abs(y - start[1])),
    };
    drawPreview();
  });
  const finish = () => {
    if (!start) return;
    start = null;
    if (selection && (selection.width < 8 || selection.height < 8)) selection = null; // 誤クリックは全体に戻す
    drawPreview();
    runMatch();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

// ---------------------------------------------------------------------------- 照合

function runMatch() {
  clearTimeout(timer);
  if (!index || !sourceImage) return;
  timer = setTimeout(async () => {
    matchToken += 1;
    const currentToken = matchToken;
    setStatus('照合中…', true);
    const region = selection ?? { x: 0, y: 0, width: sourceImage.width, height: sourceImage.height };
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(Math.round(region.x), Math.round(region.y),
      Math.max(1, Math.round(region.width)), Math.max(1, Math.round(region.height)));
    try {
      const started = performance.now();
      const candidates = await matcherModule.matchImage(index, image, { limit: 12, renderGlyph });
      if (matchToken !== currentToken) return;
      showCandidates(candidates, Math.round(performance.now() - started));
    } catch (err) {
      if (matchToken !== currentToken) return;
      console.error(err);
      setStatus(`照合できませんでした: ${err.message}`);
    }
  }, MATCH_DELAY_MS);
}

/** 候補を実際のフォントで描き直して、入力画像と比べ直すための下請け */
async function renderGlyph(char) {
  const size = matcherModule.BOX;
  // 並行して実行されるため、呼び出しごとに個別の canvas で描画する
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const font = `${size * 1.4}px "${WEB_FONT_FAMILY}", serif`;
  try {
    await document.fonts.load(font, char);
  } catch { /* フォントが無くても描いてみる */ }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, canvas.width / 2, canvas.height / 2);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { normalizeImage } = featuresModule ?? await import('../image-search/features.js');
  return normalizeImage(imageData);
}

function showCandidates(candidates, ms) {
  const usable = candidates.filter((c) => app.db.resolve(c.char.codePointAt(0)));
  $('#img-candidates').replaceChildren(...usable.map((c) => h('button', {
    class: 'hw-candidate', type: 'button', dataset: { query: c.char },
    title: `${c.mj}（似ている度 ${(c.score * 100).toFixed(0)}%）`,
    onclick: () => $('#image-dialog').close(),
  }, h('span', { class: 'glyph' }, c.char), h('span', { class: 'hw-candidate__count' }, c.mj.replace('MJ', '')))));
  setStatus(usable.length
    ? `似ている順です（${ms}ms）。1文字だけを囲むと精度が上がります。`
    : '候補が見つかりませんでした。1文字だけを囲んでみてください。');
}

function setStatus(text, busy = false) {
  $('#img-status').replaceChildren(busy ? loading(text) : text);
}
