// The live viewer. It reads the same WebSocket stream any other client reads,
// counts everything, and draws a sample: the stream can carry more than a
// thousand certificates a second, which no page can show one by one. Every
// certificate that matches the filter is always drawn.

import { plural, text, formatNumber } from './i18n.js';
import { toUnicode } from './punycode.js';
import { shortLogName, issuerName } from './names.js';

const MAX_ROWS = 150;
const SAMPLE_PER_TICK = 5;
const RENDER_MS = 250;
const HISTORY_SECONDS = 60;

const $ = (id) => document.getElementById(id);

const state = {
  lang: initialLang(),
  conn: 'connecting',
  paused: false,
  onlyHits: false,
  matcher: null,
  seen: 0,
  pre: 0,
  crt: 0,
  hits: 0,
  thisSecond: 0,
  history: new Array(HISTORY_SECONDS).fill(0),
  queue: [],
  sampled: false,
  logs: null,
  retry: 0,
};

function initialLang() {
  try {
    const saved = localStorage.getItem('tayyar-lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable; the browser language decides instead.
  }
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function wsBase() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

/* Language */

function applyLang() {
  const lang = state.lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = text(lang, 'title');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = text(lang, el.dataset.t);
  const langButton = $('lang');
  langButton.textContent = text(lang, 'switch_language');
  langButton.lang = lang === 'ar' ? 'en' : 'ar';
  langButton.setAttribute('aria-label', text(lang, 'switch_language_label'));
  $('filter').placeholder = text(lang, 'filter_placeholder');
  syncFilterDirection();
  $('meter').setAttribute('aria-label', text(lang, 'meter_label'));
  $('pause').textContent = text(lang, state.paused ? 'resume' : 'pause');
  setConn(state.conn);
  renderEndpoints();
  updateFigures();
  updateEmpty();
  for (const row of $('stream').children) labelRow(row);
}

function renderEndpoints() {
  const el = $('endpoints');
  el.textContent = '';
  const urls = { lite: `${wsBase()}/`, full: `${wsBase()}/full-stream`, domains: `${wsBase()}/domains-only` };
  for (const part of text(state.lang, 'endpoints').split(/(\{lite\}|\{full\}|\{domains\})/)) {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m) {
      const code = document.createElement('code');
      code.dir = 'ltr';
      code.textContent = urls[m[1]];
      el.append(code);
    } else if (part) {
      el.append(part);
    }
  }
}

/* Connection */

function setConn(s) {
  state.conn = s;
  $('status').textContent = text(state.lang, `status_${s}`);
  document.querySelector('.conn').dataset.state = s;
}

function connect() {
  setConn(state.retry === 0 ? 'connecting' : 'retry');
  let ws;
  try {
    ws = new WebSocket(`${wsBase()}/`);
  } catch {
    reconnectLater();
    return;
  }
  ws.onopen = () => {
    state.retry = 0;
    setConn('live');
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    setConn('retry');
    reconnectLater();
  };
  ws.onerror = () => ws.close();
}

function reconnectLater() {
  const delay = Math.min(30000, 1000 * 2 ** state.retry);
  state.retry += 1;
  setTimeout(connect, delay);
}

async function refreshStats() {
  try {
    const res = await fetch('/stats', { cache: 'no-store' });
    if (!res.ok) return;
    const stats = await res.json();
    state.logs = stats?.logs?.total ?? null;
    updateFigures();
  } catch {
    // The count is a nicety; the stream works without it.
  }
}

/* Filtering */

function buildMatcher(value) {
  const v = value.trim();
  $('filter-note').hidden = true;
  if (!v) return null;
  let test;
  try {
    const re = new RegExp(v, 'iu');
    test = (s) => re.test(s);
  } catch {
    const lower = v.toLowerCase();
    test = (s) => s.toLowerCase().includes(lower);
    $('filter-note').hidden = false;
  }
  return (domains) => {
    for (const d of domains) {
      if (test(d)) return d;
      if (d.includes('xn--')) {
        const u = toUnicode(d);
        if (u !== d && test(u)) return d;
      }
    }
    return null;
  };
}

function syncFilterDirection() {
  const input = $('filter');
  input.dir = input.value ? 'ltr' : document.documentElement.dir;
}

function onFilter() {
  syncFilterDirection();
  state.matcher = buildMatcher($('filter').value);
  state.hits = 0;
  for (const row of $('stream').children) {
    row.classList.toggle('hit', Boolean(state.matcher && state.matcher(row.domains)));
  }
  updateFigures();
  updateEmpty();
}

/* Stream */

function onMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    return;
  }
  if (msg.message_type !== 'certificate_update' || !msg.data || !msg.data.leaf_cert) return;
  const d = msg.data;
  state.seen += 1;
  state.thisSecond += 1;
  if (d.update_type === 'PrecertLogEntry') state.pre += 1;
  else state.crt += 1;
  const hit = state.matcher ? state.matcher(d.leaf_cert.all_domains || []) : null;
  if (hit) state.hits += 1;
  if (state.paused || (state.onlyHits && !hit)) return;
  state.queue.push({ d, hit });
  if (state.queue.length > 2000) state.queue.splice(0, state.queue.length - 2000);
}

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function makeRow({ d, hit }) {
  const row = el('li', hit ? 'row hit' : 'row');
  row.dataset.type = d.update_type === 'PrecertLogEntry' ? 'pre' : 'crt';
  const domains = d.leaf_cert.all_domains || [];
  row.domains = domains;

  const seen = new Date((d.seen || Date.now() / 1000) * 1000);
  const time = el('time', '', seen.toLocaleTimeString('en-GB', { hour12: false }));
  time.dateTime = seen.toISOString();

  const mark = el('span', 'mark');
  mark.setAttribute('role', 'img');

  const name = el('span', 'name');
  const primary = hit || domains[0] || (d.leaf_cert.subject && d.leaf_cert.subject.CN) || '';
  const ascii = el('bdi', '', primary);
  ascii.dir = 'ltr';
  name.append(ascii);
  if (primary.includes('xn--')) {
    const unicode = toUnicode(primary);
    if (unicode !== primary) name.append(el('bdi', 'idn', unicode));
  }
  if (domains.length > 1) {
    const more = el('span', 'more', `+${formatNumber(domains.length - 1)}`);
    more.dir = 'ltr';
    name.append(more);
  }

  const issuerText = issuerName(d.leaf_cert.issuer);
  const issuer = el('span', 'issuer');
  issuer.dir = 'ltr';
  issuer.append(el('bdi', '', issuerText));
  issuer.title = issuerText;

  const sourceName = (d.source && d.source.name) || '';
  const log = el('span', 'log');
  log.dir = 'ltr';
  log.append(el('bdi', '', shortLogName(sourceName)));
  log.title = sourceName;

  row.append(time, mark, name, issuer, log);
  labelRow(row);
  return row;
}

function labelRow(row) {
  const label = text(state.lang, row.dataset.type === 'pre' ? 'type_pre' : 'type_crt');
  const mark = row.querySelector('.mark');
  mark.setAttribute('aria-label', label);
  mark.title = label;
  const more = row.querySelector('.more');
  if (more) more.title = plural(state.lang, 'more', row.domains.length - 1);
}

function renderTick() {
  if (state.queue.length === 0) return;
  const items = state.queue;
  state.queue = [];
  if (document.hidden) {
    // Nobody is looking: keep only the matches for when the tab returns.
    state.queue = items.filter((x) => x.hit).slice(-100);
    return;
  }
  const rest = items.filter((x) => !x.hit);
  const sample = new Set(rest.slice(-SAMPLE_PER_TICK));
  if (rest.length > sample.size && !state.onlyHits) state.sampled = true;
  const chosen = items.filter((x) => x.hit || sample.has(x)).slice(-60);
  const frag = document.createDocumentFragment();
  for (let i = chosen.length - 1; i >= 0; i--) frag.append(makeRow(chosen[i]));
  const list = $('stream');
  list.prepend(frag);
  while (list.children.length > MAX_ROWS) list.lastElementChild.remove();
  $('sampling').hidden = !state.sampled;
  updateEmpty();
}

function updateEmpty() {
  const list = $('stream');
  const visible = state.onlyHits ? list.querySelectorAll('.row.hit').length : list.children.length;
  const empty = $('empty');
  empty.hidden = visible > 0;
  empty.textContent = text(state.lang, state.matcher && state.onlyHits ? 'empty_filtered' : 'empty');
}

/* Figures */

function currentRate() {
  const recent = state.history.slice(-5);
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

function updateFigures() {
  const lang = state.lang;
  const rate = currentRate();
  $('rate').textContent = formatNumber(rate);
  $('rate-label').textContent = plural(lang, 'rate', rate);
  $('seen').textContent = formatNumber(state.seen);
  $('seen-label').textContent = plural(lang, 'seen', state.seen);
  $('hits').textContent = formatNumber(state.hits);
  $('hits-label').textContent = plural(lang, 'hits', state.hits);
  document.querySelector('.figure-hits').dataset.active = String(state.hits > 0);
  const total = state.pre + state.crt;
  const preShare = total ? (state.pre / total) * 100 : 50;
  $('bar-pre').style.width = `${preShare}%`;
  $('bar-crt').style.width = `${100 - preShare}%`;
  $('pre-legend').textContent = plural(lang, 'pre', state.pre);
  $('crt-legend').textContent = plural(lang, 'crt', state.crt);
  $('logs-count').textContent = state.logs === null ? '' : plural(lang, 'logs', state.logs);
}

function drawSpark() {
  const max = Math.max(1, ...state.history);
  const step = 120 / (HISTORY_SECONDS - 1);
  const points = state.history.map((v, i) => `${(i * step).toFixed(1)},${(29 - (v / max) * 27).toFixed(1)}`);
  $('spark-line').setAttribute('points', points.join(' '));
}

function secondTick() {
  state.history.push(state.thisSecond);
  state.history.shift();
  state.thisSecond = 0;
  updateFigures();
  drawSpark();
}

/* Controls */

function wire() {
  let debounce;
  $('filter').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(onFilter, 200);
  });
  $('only').addEventListener('change', (e) => {
    state.onlyHits = e.target.checked;
    $('stream').classList.toggle('only-hits', state.onlyHits);
    updateEmpty();
  });
  $('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    if (state.paused) state.queue = [];
    $('pause').setAttribute('aria-pressed', String(state.paused));
    $('pause').textContent = text(state.lang, state.paused ? 'resume' : 'pause');
  });
  $('clear').addEventListener('click', () => {
    $('stream').textContent = '';
    state.sampled = false;
    $('sampling').hidden = true;
    updateEmpty();
  });
  $('lang').addEventListener('click', () => {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    try {
      localStorage.setItem('tayyar-lang', state.lang);
    } catch {
      // Without storage the choice lasts until the page closes.
    }
    applyLang();
  });
}

wire();
applyLang();
connect();
refreshStats();
setInterval(renderTick, RENDER_MS);
setInterval(secondTick, 1000);
setInterval(refreshStats, 20000);
