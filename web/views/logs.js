// The logs view: every log with its state, tree size and lag, refreshed
// every five seconds while open.

import { $, el, t, p, formatNumber, relTime } from '../ui.js';
import { shortLogName } from '../names.js';
import { api } from '../api.js';

let timer = null;
let rows = [];

function render() {
  const healthy = rows.filter((w) => w.state === 'ok').length;
  $('logs-summary').textContent = p('logs_healthy', healthy, { total: formatNumber(rows.length) });
  const body = $('logs-table').tBodies[0];
  body.textContent = '';
  const order = { stopped: 0, backoff: 1, starting: 2, ok: 3 };
  for (const w of [...rows].sort((a, b) => order[a.state] - order[b.state] || (b.lag ?? 0) - (a.lag ?? 0))) {
    const state = el('span', { class: 'state', text: t(`state_${w.state}`) });
    state.dataset.state = w.state;
    if (w.lastError) state.title = w.lastError;
    const num = (v) => el('td', { class: 'n', text: v === null || v === undefined ? '' : formatNumber(v) });
    body.append(el('tr', {},
      el('td', { title: w.url }, el('bdi', { text: shortLogName(w.name) })),
      el('td', {}, el('bdi', { text: w.operator || '' })),
      el('td', { text: t(w.kind === 'static' ? 'kind_static' : 'kind_rfc6962') }),
      el('td', {}, state),
      num(w.tree_size),
      num(w.lag),
      num(w.errors),
      num(w.signatureFailures ?? w.badSignatures ?? 0),
      el('td', { text: w.lastSuccess ? relTime(w.lastSuccess / 1000) : t('never') })));
  }
}

async function load() {
  try {
    rows = (await api('/api/logs')).logs;
    render();
  } catch {
    // Kept as it was.
  }
}

export function relabel() {
  if (rows.length) render();
}

export function show() {
  load();
  timer = setInterval(load, 5000);
}

export function hide() {
  clearInterval(timer);
}
