// 左側の検索パネル: 絞り込み（部首・画数・漢字施策・IVSあり）と「よく検索される異体字」。

import { hex, radicalChar } from '../db.js';
import { app } from './context.js';
import { $, h, queryButton } from './dom.js';

const RADICAL_COUNT = 214;
const INPUT_DEBOUNCE_MS = 250;

/** @param {() => void} onChange 条件が変わったとき（app.filters 更新後）に呼ぶ */
export function setupFilters(onChange) {
  const fields = {
    radical: $('#f-radical'),
    strokesMin: $('#f-strokes-min'),
    strokesMax: $('#f-strokes-max'),
    policy: $('#f-policy'),
    ivsOnly: $('#f-ivs'),
  };

  fields.radical.append(...Array.from({ length: RADICAL_COUNT }, (_, i) =>
    h('option', { value: String(i + 1) }, `${i + 1}  ${radicalChar(i + 1)}`)));

  const apply = () => {
    const num = (el) => (el.value ? Number(el.value) : undefined);
    app.filters = {
      radical: num(fields.radical),
      strokesMin: num(fields.strokesMin),
      strokesMax: num(fields.strokesMax),
      policy: fields.policy.value,
      ivsOnly: fields.ivsOnly.checked,
    };
    updateCount();
    onChange();
  };

  let timer;
  const applyLater = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, INPUT_DEBOUNCE_MS);
  };
  [fields.radical, fields.policy, fields.ivsOnly].forEach((el) => el.addEventListener('change', apply));
  [fields.strokesMin, fields.strokesMax].forEach((el) => el.addEventListener('input', applyLater));

  $('#filter-reset').addEventListener('click', () => {
    fields.radical.value = '';
    fields.strokesMin.value = '';
    fields.strokesMax.value = '';
    fields.policy.value = 'all';
    fields.ivsOnly.checked = false;
    apply();
  });
}

function updateCount() {
  const f = app.filters;
  const count = [f.radical, f.strokesMin || f.strokesMax, f.policy !== 'all', f.ivsOnly].filter(Boolean).length;
  const badge = $('#filter-count');
  badge.hidden = count === 0;
  badge.textContent = `${count} 件`;
}

export function renderQuickAccess() {
  $('#quick-access').replaceChildren(...app.db.index.quickAccess.map((ch) => {
    const button = queryButton(ch, ch, 'glyph');
    button.title = `U+${hex(ch.codePointAt(0))}`;
    return button;
  }));
}
