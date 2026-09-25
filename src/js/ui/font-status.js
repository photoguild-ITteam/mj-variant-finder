// ヘッダーのフォント状態表示と、「IPAmj明朝フォントについて」ダイアログの判定結果。

import { detectFontStatus, WEB_FONT_FAMILY } from '../font-detector.js';
import { $, h } from './dom.js';

const STATUS_LABEL = {
  local: '端末のIPAmj明朝',
  webfont: 'Webフォントで表示中',
  unsupported: 'IVS表示に未対応',
};

export function setupFontStatus() {
  const button = $('#font-status');
  button.addEventListener('click', () => $('#font-dialog').showModal());
  detect().then((status) => {
    button.dataset.state = status.status;
    $('.font-status__label', button).textContent = STATUS_LABEL[status.status];
    $('#font-check').replaceChildren(...checkRows(status));
  });
}

async function detect() {
  try {
    return await detectFontStatus();
  } catch (err) {
    console.warn(err);
    return { local: false, webFontIvs: false, status: 'unsupported' };
  }
}

function checkRows({ local, webFontIvs }) {
  const mark = (ok) => h('span', { class: ok ? 'ok' : 'ng' }, ok ? '✓' : '✕');
  return [
    h('div', { class: 'font-check__row' }, mark(local), `端末の IPAmj明朝: ${local ? '検出しました' : '検出されませんでした'}`),
    h('div', { class: 'font-check__row' }, mark(webFontIvs), `このブラウザでの IVS 表示（${WEB_FONT_FAMILY}）: ${webFontIvs ? '正常' : '字形を描き分けられません'}`),
    h('div', { class: 'font-check__sample' },
      h('span', { class: 'glyph', title: 'U+9089 U+E010F (MJ026190)' }, '邉\u{E010F}'),
      h('span', { class: 'glyph', title: 'U+9089 U+E0119 (MJ026191)' }, '邉\u{E0119}'),
      h('span', { class: 'muted' }, '← 2つの字形が異なって見えれば IVS が表示できています')),
  ];
}
