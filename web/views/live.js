// The live view: the stream itself, its figures, the filter, and the
// hourly breakdown by issuer and ending.

import { $, el, t, p, formatNumber, certRow, certFromMessage, openCert } from '../ui.js';
import { toUnicode } from '../punycode.js';
import { api } from '../api.js';

const MAX_ROWS = 150;
const ROWS_PER_SECOND = 12;

const state = { seen: 0, pre: 0, crt: 0, hits: 0, paused: false, matcher: null, perSecond: new Array(60).fill(0), budget: ROWS_PER_SECOND, sampled: false };
let visible = false;
let insightsTimer = null;

function buildMatcher(value) {
  const v = value.trim();
  $('filter-note').hidden = true;
  if (!v) return null;
  try {
    const re = new RegExp(v, 'iu');
    return (d) => re.test(d) || (d.includes('xn--') && re.test(toUnicode(d)));
  } catch {
    $('filter-note').hidden = false;
    const needle = v.toLowerCase();
    return (d) => d.toLowerCase().includes(needle) || (d.includes('xn--') && toUnicode(d).toLowerCase().includes(needle));
  }
}

function setEmpty() {
  const rows = $('stream').children.length;
  const only = $('only').checked;
  const shown = only ? $('stream').querySelectorAll('.row.hit').length : rows;
  $('empty').hidden = shown > 0;
  $('empty').textContent = state.matcher ? t('empty_filtered') : t('empty');
}

function figures() {
  const recent = state.perSecond.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const rate = Math.round(recent);
  $('rate').textContent = formatNumber(rate);
  $('rate-label').textContent = p('rate', rate);
  $('seen').textContent = formatNumber(state.seen);
  $('seen-label').textContent = p('seen', state.seen);
  const total = state.pre + state.crt || 1;
  $('bar-pre').style.width = `${(state.pre / total) * 100}%`;
  $('bar-crt').style.width = `${(state.crt / total) * 100}%`;
  $('pre-legend').textContent = p('pre', state.pre);
  $('crt-legend').textContent = p('crt', state.crt);
  $('hits').textContent = formatNumber(state.hits);
  $('hits-label').textContent = p('hits', state.hits);
  document.querySelector('.figure-hits').dataset.active = String(state.hits > 0);
  const max = Math.max(1, ...state.perSecond);
  $('spark-line').setAttribute('points', state.perSecond.map((v, i) => `${(i / 59) * 120},${30 - (v / max) * 28}`).join(' '));
}

function tick() {
  state.perSecond.push(0);
  state.perSecond.shift();
  $('sampling').hidden = !state.sampled;
  state.sampled = false;
  if (visible) figures();
}

export function onMessage(msg) {
  if (msg.message_type !== 'certificate_update') return;
  const d = msg.data;
  const domains = d.leaf_cert?.all_domains || [];
  state.seen += 1;
  state.perSecond[59] += 1;
  if (d.update_type === 'PrecertLogEntry') state.pre += 1;
  else state.crt += 1;
  const hit = state.matcher ? domains.find(state.matcher) || null : null;
  if (hit) state.hits += 1;
  if (state.paused || !visible) return;
  if (!hit && $('only').checked) return;
  if (!hit) {
    if (state.budget <= 0) {
      state.sampled = true;
      return;
    }
    state.budget -= 1;
  }
  const list = $('stream');
  list.prepend(certRow(certFromMessage(d), { hit, onOpen: openCert }));
  while (list.children.length > MAX_ROWS) list.lastChild.remove();
  $('empty').hidden = true;
}

function bars(listId, items) {
  const list = $(listId);
  list.textContent = '';
  const max = Math.max(1, ...items.map((i) => i.count));
  for (const item of items.slice(0, 6)) {
    const fill = el('span');
    fill.style.width = `${(item.count / max) * 100}%`;
    list.append(el('li', {},
      el('span', { class: 'bar-name', title: item.name }, el('bdi', { text: item.name })),
      el('span', { class: 'bar-count', text: formatNumber(item.count) }),
      el('span', { class: 'bar-fill', 'aria-hidden': 'true' }, fill)));
  }
}

async function insights() {
  try {
    const data = await api('/api/insights');
    bars('top-issuers', data.top_issuers);
    bars('top-endings', data.top_endings.map((e) => ({ ...e, name: `.${e.name}` })));
    $('insights-empty').hidden = data.total > 0;
  } catch {
    // Shown again on the next refresh.
  }
}

export function init() {
  setInterval(tick, 1000);
  // Rows are let through one at a time across the second, so a burst from
  // one log does not fill the whole sample.
  state.budget = 1;
  setInterval(() => { state.budget = 1; }, Math.round(1000 / ROWS_PER_SECOND));
  $('filter').addEventListener('input', (e) => {
    state.matcher = buildMatcher(e.target.value);
    state.hits = 0;
    for (const row of $('stream').children) row.classList.toggle('hit', Boolean(state.matcher && row.domains?.some(state.matcher)));
    figures();
    setEmpty();
  });
  $('only').addEventListener('change', (e) => {
    $('stream').classList.toggle('only-hits', e.target.checked);
    setEmpty();
  });
  $('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('pause').setAttribute('aria-pressed', String(state.paused));
    relabel();
  });
  $('clear').addEventListener('click', () => {
    $('stream').textContent = '';
    setEmpty();
  });
  setEmpty();
  figures();
}

export function relabel() {
  $('pause').textContent = t(state.paused ? 'resume' : 'pause');
  setEmpty();
  figures();
}

export function show() {
  visible = true;
  figures();
  insights();
  insightsTimer = setInterval(insights, 15000);
}

export function hide() {
  visible = false;
  clearInterval(insightsTimer);
}
