// The logs view: every log with its state, tree size and lag, refreshed
// every five seconds while open.

import { $, el, t, p, formatNumber, relTime } from '../ui.js';
import { shortLogName } from '../names.js';
import { api } from '../api.js';

let timer = null;
let rows = [];
let pipeline = null;

// The way from the logs to the alerts, one stage at a time, with what each
// stage has counted since the server started.
function renderPipeline() {
  const box = $('pipe');
  if (!pipeline || !box) return;
  const stage = (key, value, note) => el('li', { class: 'stage' },
    el('span', { class: 'num' }, el('bdi', { dir: 'ltr', text: value })),
    el('span', { class: 'label', text: t(`pipe_${key}`) }),
    el('span', { class: 'explain', text: note || t(`pipe_${key}_why`) }));
  const n = formatNumber;
  box.replaceChildren(
    stage('logs', `${n(pipeline.logs.healthy)} / ${n(pipeline.logs.total)}`),
    stage('entries', n(pipeline.entries)),
    stage('copies', n(pipeline.copies)),
    stage('certs', n(pipeline.certificates)),
    stage('names', n(pipeline.names), pipeline.watching ? null : t('pipe_names_idle')),
    stage('alerts', n(pipeline.alerts)),
    stage('hooks', n(pipeline.webhooks.sent), pipeline.webhooks.configured ? null : t('pipe_hooks_none')));
}

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
    const [logs, overview] = await Promise.all([api('/api/logs'), api('/api/overview')]);
    rows = logs.logs;
    pipeline = overview.pipeline;
    render();
    renderPipeline();
  } catch {
    // Kept as it was.
  }
}

export function relabel() {
  if (rows.length) render();
  renderPipeline();
}

export function show() {
  load();
  timer = setInterval(load, 5000);
}

export function hide() {
  clearInterval(timer);
}
