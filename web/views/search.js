// Search over the recent stream held in the server's memory.

import { $, el, t, p, span, certRow, certFromSearch, openCert } from '../ui.js';
import { api } from '../api.js';

const TYPES = [['all', 'type_all'], ['crt', 'type_filter_crt'], ['pre', 'type_filter_pre']];
let type = 'all';
let timer = null;
let last = null;

function buildTypes() {
  const seg = $('search-type');
  seg.textContent = '';
  for (const [value, key] of TYPES) {
    const b = el('button', { type: 'button', 'aria-pressed': String(type === value), text: t(key) });
    b.addEventListener('click', () => {
      type = value;
      buildTypes();
      run();
    });
    seg.append(b);
  }
}

function render() {
  if (!last) return;
  const q = $('search-q').value.trim();
  const w = last.window;
  $('search-window').textContent = w.certificates ? p('search_window', w.certificates, { span: span(Date.now() / 1000 - w.since) }) : p('search_window', 0);
  const list = $('search-results');
  list.textContent = '';
  if (!q) {
    $('search-empty').textContent = t('search_empty');
    $('search-empty').hidden = false;
    return;
  }
  const needle = q.toLowerCase();
  for (const it of last.items) {
    const show = it.names.find((n) => n.includes(needle)) || null;
    list.append(certRow(certFromSearch(it), { show, onOpen: openCert }));
  }
  $('search-empty').hidden = last.items.length > 0;
  $('search-empty').textContent = t('search_none');
  if (last.items.length) $('search-window').textContent += `  ${p('results', last.items.length)}`;
}

async function run() {
  const q = $('search-q').value.trim();
  try {
    last = await api(`/api/search?${new URLSearchParams({ q, type, limit: q ? '200' : '1' })}`);
    render();
  } catch {
    // Kept as it was.
  }
}

export function init() {
  buildTypes();
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  $('search-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
}

export function relabel() {
  buildTypes();
  render();
}

export function show() {
  run();
  $('search-q').focus();
}
