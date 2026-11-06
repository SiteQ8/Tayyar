// The logs view: every log with its state, tree size and lag, refreshed
// every five seconds while open.

import { $, el, t, p, formatNumber, relTime, skeletonBar, reducedMotion, showFailure, clearFailure, relabelFailure } from '../ui.js';
import { shortLogName } from '../names.js';
import { api } from '../api.js';

const STAGES = ['logs', 'entries', 'copies', 'certs', 'names', 'alerts', 'hooks'];

let timer = null;
let rows = [];
let loaded = false;
let failed = false;
let pipeline = null;
// How it works plays its stages in order once, the first time it is seen.
let explained = false;

function stage(key, value, note) {
  return el('li', { class: 'stage' },
    el('span', { class: 'num' }, value === null ? skeletonBar('sk-2', 'figure-sk') : el('bdi', { dir: 'ltr', text: value })),
    el('span', { class: 'label', text: t(`pipe_${key}`) }),
    el('span', { class: 'explain', text: note || t(`pipe_${key}_why`) }));
}

// The way from the logs to the alerts, one stage at a time, with what each
// stage has counted since the server started.
function renderPipeline() {
  const box = $('pipe');
  if (!box) return;
  if (!pipeline) {
    if (failed) {
      // Nothing has loaded yet: the stages without figures, under the error line.
      box.removeAttribute('aria-busy');
      box.replaceChildren(...STAGES.map((key) => stage(key, '\u00a0')));
      return;
    }
    box.setAttribute('aria-busy', 'true');
    box.replaceChildren(...STAGES.map((key) => stage(key, null)));
    return;
  }
  box.removeAttribute('aria-busy');
  const n = formatNumber;
  box.replaceChildren(
    stage('logs', `${n(pipeline.logs.healthy)} / ${n(pipeline.logs.total)}`),
    stage('entries', n(pipeline.entries)),
    stage('copies', n(pipeline.copies)),
    stage('certs', n(pipeline.certificates)),
    stage('names', n(pipeline.names), pipeline.watching ? null : t('pipe_names_idle')),
    stage('alerts', n(pipeline.alerts)),
    stage('hooks', n(pipeline.webhooks.sent), pipeline.webhooks.configured ? null : t('pipe_hooks_none')));
  if (!explained) {
    explained = true;
    if (!reducedMotion()) {
      [...box.children].forEach((item, i) => {
        item.style.setProperty('--i', String(i));
        item.classList.add('reveal');
      });
    }
  }
}

function skeletonTable() {
  const body = $('logs-table').tBodies[0];
  body.setAttribute('aria-busy', 'true');
  body.replaceChildren(...[0, 1, 2, 3].map(() => el('tr', { 'aria-hidden': 'true' },
    el('td', {}, skeletonBar('sk-3')), el('td', {}, skeletonBar('sk-2')), el('td', {}, skeletonBar('sk-2')), el('td', {}, skeletonBar('sk-1')),
    el('td', { class: 'n' }, skeletonBar('sk-2')), el('td', { class: 'n' }, skeletonBar('sk-1')), el('td', { class: 'n' }, skeletonBar('sk-1')),
    el('td', { class: 'n' }, skeletonBar('sk-1')), el('td', {}, skeletonBar('sk-2')))));
}

function render() {
  const healthy = rows.filter((w) => w.state === 'ok').length;
  $('logs-summary').textContent = p('logs_healthy', healthy, { total: formatNumber(rows.length) });
  const body = $('logs-table').tBodies[0];
  body.removeAttribute('aria-busy');
  body.textContent = '';
  const order = { stopped: 0, backoff: 1, starting: 2, ok: 3 };
  for (const w of [...rows].sort((a, b) => order[a.state] - order[b.state] || (b.lag ?? 0) - (a.lag ?? 0))) {
    const state = el('span', { class: 'state', text: t(`state_${w.state}`) });
    state.dataset.state = w.state;
    if (w.lastError) state.title = w.lastError;
    // On narrow screens each figure carries its column's name, read from data-label.
    const num = (key, v) => el('td', { class: 'n', 'data-label': t(key), text: v === null || v === undefined ? '' : formatNumber(v) });
    body.append(el('tr', {},
      el('td', { title: w.url }, el('bdi', { text: shortLogName(w.name) })),
      el('td', {}, el('bdi', { text: w.operator || '' })),
      el('td', { text: t(w.kind === 'static' ? 'kind_static' : 'kind_rfc6962') }),
      el('td', {}, state),
      num('col_tree', w.tree_size),
      num('col_lag', w.lag),
      num('col_errors', w.errors),
      num('col_signature', w.signatureFailures ?? w.badSignatures ?? 0),
      el('td', { 'data-label': t('col_success'), text: w.lastSuccess ? relTime(w.lastSuccess / 1000) : t('never') })));
  }
}

async function load() {
  try {
    const [logs, overview] = await Promise.all([api('/api/logs'), api('/api/overview')]);
    rows = logs.logs;
    pipeline = overview.pipeline;
    loaded = true;
    failed = false;
    clearFailure($('logs-error'));
    render();
    renderPipeline();
  } catch {
    // The figures on screen stay, with a way to try again; the timer also retries.
    showFailure($('logs-error'), load);
    if (!loaded) {
      failed = true;
      const body = $('logs-table').tBodies[0];
      body.removeAttribute('aria-busy');
      body.textContent = '';
      renderPipeline();
    }
  }
}

export function relabel() {
  if (rows.length) render();
  renderPipeline();
  relabelFailure($('logs-error'));
}

export function show() {
  if (!loaded) {
    renderPipeline();
    // Loading bars only before anything was tried; after a failure the error line stays alone.
    if (!failed) skeletonTable();
  }
  load();
  timer = setInterval(load, 5000);
}

export function hide() {
  clearInterval(timer);
}
