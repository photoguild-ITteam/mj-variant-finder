// 手書き入力パネル: 枠に字を書くと候補を出し、選ぶとその字で検索する。
// 認識は別スレッド（handwriting/worker.js）。データは初回に開いたときだけ読み込む（約5MB / 圧縮1.8MB）。

import { app } from './context.js';
import { $, h, loading } from './dom.js';
import { showSessionExpired } from './session.js';

const WORKER_URL = new URL('../handwriting/worker.js', import.meta.url);
const PATTERNS_URL = new URL('../../data/handwriting-patterns.json', import.meta.url);
const RECOGNIZE_DELAY_MS = 350;
const LINE_WIDTH = 6;

/** @type {Worker | null} */
let worker = null;
let requestId = 0;
let strokes = [];
let timer;

export function setupHandwriting() {
  $('#handwriting-open').addEventListener('click', open);
  $('#hw-clear').addEventListener('click', () => {
    strokes = [];
    redraw();
    showCandidates([]);
    setStatus('枠の中に、なるべく大きく1文字書いてください。');
  });
  $('#hw-undo').addEventListener('click', () => {
    strokes.pop();
    redraw();
    recognizeSoon();
  });
  setupDrawing();
}

function open() {
  $('#handwriting-dialog').showModal();
  resizeCanvas();
  startWorker();
}

// ---------------------------------------------------------------------------- 認識（ワーカー）

function startWorker() {
  if (worker) return;
  setStatus('認識データを読み込んでいます…', true);
  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'ready') {
      setStatus(`枠の中に、なるべく大きく1文字書いてください。（${data.count.toLocaleString()} 字から探します）`);
    } else if (data.type === 'result' && data.id === requestId) {
      showCandidates(data.candidates);
    } else if (data.type === 'error') {
      // 認識データも認証の対象になりうるので、切れていたら案内を出す（sessionWatch が有効なときだけ表示される）
      if (/(401|403)/.test(data.message)) showSessionExpired();
      setStatus(`認識できませんでした: ${data.message}`);
    }
  });
  worker.addEventListener('error', (e) => {
    setStatus(`手書き認識を読み込めませんでした: ${e.message}`);
    worker = null;
  });
  worker.postMessage({ type: 'init', url: PATTERNS_URL.href });
}

function recognizeSoon() {
  clearTimeout(timer);
  if (!strokes.length) {
    showCandidates([]);
    return;
  }
  timer = setTimeout(() => {
    setStatus('認識中…', true);
    requestId += 1;
    worker?.postMessage({ type: 'recognize', id: requestId, strokes });
  }, RECOGNIZE_DELAY_MS);
}

function showCandidates(chars) {
  const list = $('#hw-candidates');
  if (!chars.length) {
    list.replaceChildren();
    if (!strokes.length) setStatus('枠の中に、なるべく大きく1文字書いてください。');
    else setStatus('候補が見つかりませんでした。書き直すか、画数を変えて試してください。');
    return;
  }
  // MJ に無い字（KanjiVG にしかない字）は検索できないので出さない
  const usable = chars.filter((ch) => app.db.resolve(ch.codePointAt(0)));
  list.replaceChildren(...usable.map((ch) => {
    const entry = app.db.entry(app.db.resolve(ch.codePointAt(0)));
    return h('button', {
      class: 'hw-candidate', type: 'button', dataset: { query: ch },
      title: `${ch} で検索（${entry.glyphCount} 字形）`,
      onclick: () => $('#handwriting-dialog').close(),
    }, h('span', { class: 'glyph' }, ch), h('span', { class: 'hw-candidate__count' }, String(entry.glyphCount)));
  }));
  setStatus(usable.length
    ? '似ている順です。目的の字が無ければ、元の字（例: 髙 → 高）を書いて、関連する異体字から選んでください。'
    : '候補が MJ文字情報一覧表にありませんでした。');
}

function setStatus(text, busy = false) {
  $('#hw-status').replaceChildren(busy ? loading(text) : text);
}

// ---------------------------------------------------------------------------- 手書き枠

function context() {
  return $('#hw-canvas').getContext('2d');
}

function resizeCanvas() {
  const canvas = $('#hw-canvas');
  const size = Math.round(canvas.getBoundingClientRect().width);
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== size * ratio) {
    canvas.width = size * ratio;
    canvas.height = size * ratio;
  }
  context().setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}

function setupDrawing() {
  const canvas = $('#hw-canvas');
  let drawing = false;
  const point = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    strokes.push([point(e)]);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    strokes.at(-1).push(point(e));
    redraw();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    // 点を打っただけ（1点）の筆画は認識できないので少しだけ伸ばす
    const last = strokes.at(-1);
    if (last?.length === 1) last.push([last[0][0] + 1, last[0][1] + 1]);
    recognizeSoon();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', finish);
  window.addEventListener('resize', () => {
    if ($('#handwriting-dialog').open) resizeCanvas();
  });
}

function redraw() {
  const canvas = $('#hw-canvas');
  const ctx = context();
  const size = canvas.width / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, size, size);

  // 中心の目安（田の字）
  const style = getComputedStyle(document.documentElement);
  ctx.strokeStyle = style.getPropertyValue('--guide').trim() || 'rgba(185,28,28,.22)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const t of [1 / 2]) {
    ctx.beginPath();
    ctx.moveTo(size * t, 0);
    ctx.lineTo(size * t, size);
    ctx.moveTo(0, size * t);
    ctx.lineTo(size, size * t);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = style.getPropertyValue('--text').trim() || '#000';
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  $('#hw-undo').disabled = strokes.length === 0;
  $('#hw-clear').disabled = strokes.length === 0;
}
