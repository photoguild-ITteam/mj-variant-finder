// ログイン切れの検知（任意機能）。config.sessionWatch が設定されているときだけ動く。
// 認証付きのサーバーの後ろに置いたときに、データの取得が 401/403 になったら案内を出す。
// 既定（sessionWatch: null）では、バナーも監視も作らず、エラーは通常の失敗として扱う。

import { config } from '../config.js';
import { AuthRequiredError, fetchOk } from '../db.js';
import { $, h } from './dom.js';

const CHECK_INTERVAL_MS = 60_000;
const PROBE_URL = new URL('../../data/meta.json', import.meta.url);
let lastCheck = 0;
let banner = null;

export const isSessionWatchEnabled = () => Boolean(config.sessionWatch);

export function setupSessionWatch() {
  if (!isSessionWatchEnabled()) return;
  const { message, loginUrl, loginLabel = 'ログイン' } = config.sessionWatch;
  banner = h('div', { class: 'session-banner', role: 'alert', hidden: true },
    h('div', { class: 'session-banner__inner' },
      h('span', {}, h('strong', {}, message ?? 'ログインが切れました。'),
        '字形やフォントを読み込めないため、異体字が正しく表示されない場合があります。'),
      h('span', { class: 'session-banner__actions' },
        loginUrl ? h('a', { class: 'button button--small button--primary', href: loginUrl, target: '_blank', rel: 'noopener' }, loginLabel) : null,
        h('button', { class: 'button button--small', type: 'button', onclick: () => location.reload() }, 'ログインしたので再読み込み'))));
  $('.site-header').after(banner);

  const onReturn = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck >= CHECK_INTERVAL_MS) checkSession();
  };
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);
}

/** 保護された小さなファイルを HEAD で確かめる（セッションが切れていれば 401/403） */
async function checkSession() {
  lastCheck = Date.now();
  try {
    await fetchOk(PROBE_URL, { method: 'HEAD', cache: 'no-store' });
    if (banner) banner.hidden = true;
  } catch (err) {
    if (err instanceof AuthRequiredError) showSessionExpired();
  }
}

export function showSessionExpired() {
  if (banner) banner.hidden = false;
}

/**
 * 読み込み失敗を記録し、ログイン切れならバナーを出す.
 * @returns {boolean} ログイン切れとして扱ったか（sessionWatch が無効なら常に false）
 */
export function reportError(err) {
  console.error(err);
  const expired = isSessionWatchEnabled() && err instanceof AuthRequiredError;
  if (expired) showSessionExpired();
  return expired;
}
