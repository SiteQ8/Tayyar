// The watchlist view: brands and patterns, switched on and off in place,
// edited in the side forms, tested against any name, imported and exported.

import { $, el, t, p, toast, nameNode } from '../ui.js';
import { api } from '../api.js';

let app = null;
let items = [];

const split = (s) => s.split(/[\s,،]+/).map((x) => x.trim()).filter(Boolean);

async function load() {
  try {
    items = (await api('/api/watchlist')).items;
    render();
  } catch {
    // Kept as it was.
  }
  const o = app.overview || (await app.refreshOverview());
  $('not-persisted').hidden = !o || o.persisted;
}

function render() {
  const list = $('watch-list');
  list.textContent = '';
  for (const item of items) list.append(entry(item));
  $('watch-empty').hidden = items.length > 0;
}

function entry(item) {
  const li = el('li', { class: 'watch-item' });
  li.dataset.enabled = String(item.enabled);
  const input = el('input', { type: 'checkbox', checked: item.enabled, 'aria-label': t('watch_toggle', { name: item.name }) });
  input.addEventListener('change', async () => {
    try {
      await api(`/api/watchlist/${item.id}`, { method: 'PATCH', body: { enabled: input.checked } });
      load();
    } catch {
      input.checked = !input.checked;
      toast(t('error_generic'));
    }
  });
  const detail = item.kind === 'brand'
    ? el('span', { class: 'detail' }, [...item.domains, ...item.keywords].map((w) => el('bdi', { dir: 'auto', text: `${w}   ` })))
    : el('span', { class: 'detail' }, el('bdi', { dir: 'ltr', text: item.pattern }), '   ', el('span', { class: 'chip', text: t(`severity_${item.severity}`) }));
  const edit = el('button', { class: 'btn small ghost', type: 'button', text: t('edit') });
  edit.addEventListener('click', () => startEdit(item));
  const del = el('button', { class: 'btn small ghost', type: 'button', text: t('delete') });
  del.addEventListener('click', async () => {
    if (!window.confirm(t('delete_confirm', { name: item.name }))) return;
    try {
      await api(`/api/watchlist/${item.id}`, { method: 'DELETE' });
      toast(t('deleted'));
      load();
    } catch {
      toast(t('error_generic'));
    }
  });
  li.append(
    el('label', { class: 'switch' }, input, el('span')),
    el('div', { class: 'what' },
      el('strong', {}, el('bdi', { text: item.name })),
      el('span', { class: 'kind', text: t(`kind_${item.kind}`) }),
      detail),
    el('div', { class: 'row-actions' }, edit, del));
  return li;
}

function resetForm(form) {
  form.reset();
  delete form.dataset.id;
  form.querySelector('[data-cancel]').hidden = true;
  form.querySelector('.form-error').hidden = true;
  if (form.id === 'brand-form') $('brand-form-title').textContent = t('add_brand');
  else $('pattern-panel').querySelector('summary').textContent = t('add_pattern');
}

function startEdit(item) {
  if (item.kind === 'brand') {
    const f = $('brand-form');
    resetForm(f);
    f.dataset.id = item.id;
    f.elements.name.value = item.name;
    f.elements.domains.value = item.domains.join('\n');
    f.elements.keywords.value = item.keywords.join(', ');
    $('brand-form-title').textContent = t('edit_brand');
    f.querySelector('[data-cancel]').hidden = false;
    f.elements.name.focus();
  } else {
    const f = $('pattern-form');
    resetForm(f);
    $('pattern-panel').open = true;
    f.dataset.id = item.id;
    f.elements.name.value = item.name;
    f.elements.pattern.value = item.pattern;
    f.elements.severity.value = item.severity;
    $('pattern-panel').querySelector('summary').textContent = t('edit_pattern');
    f.querySelector('[data-cancel]').hidden = false;
    f.elements.name.focus();
  }
}

async function submit(form, body) {
  const error = form.querySelector('.form-error');
  error.hidden = true;
  try {
    if (form.dataset.id) await api(`/api/watchlist/${form.dataset.id}`, { method: 'PATCH', body });
    else await api('/api/watchlist', { method: 'POST', body });
    toast(t('saved'));
    resetForm(form);
    load();
  } catch (err) {
    error.textContent = t('form_error', { detail: err.message });
    error.hidden = false;
  }
}

function finding(f) {
  return el('div', { class: 'finding' },
    el('p', {}, el('strong', { text: `${f.score} ` }), t(`severity_${f.severity}`), ' ', t(f.watch.kind === 'pattern' ? 'matches_pattern' : 'looks_like', { name: f.watch.name })),
    el('div', { class: 'chips' }, f.reasons.map((r) => el('span', { class: 'chip', text: t(`reason_${r}`) }))));
}

export function init(a) {
  app = a;
  $('brand-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    submit(e.currentTarget, { kind: 'brand', name: f.name.value, domains: split(f.domains.value), keywords: split(f.keywords.value) });
  });
  $('pattern-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    submit(e.currentTarget, { kind: 'pattern', name: f.name.value, pattern: f.pattern.value, severity: f.severity.value });
  });
  for (const f of [$('brand-form'), $('pattern-form')]) f.querySelector('[data-cancel]').addEventListener('click', () => resetForm(f));
  $('test-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('test-result');
    out.textContent = '';
    try {
      const r = await api('/api/watchlist/test', { method: 'POST', body: { domain: e.currentTarget.elements.domain.value } });
      out.append(el('p', {}, nameNode(r.domain, 'n')));
      if (!r.findings.length) out.append(el('p', { class: 'note', text: t('test_none') }));
      for (const f of r.findings) out.append(finding(f));
    } catch (err) {
      out.append(el('p', { class: 'form-error', text: err.status === 400 ? t('test_invalid') : t('error_generic') }));
    }
  });
  $('export-watch').addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify({ version: 1, items }, null, 2)}\n`], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'tayyar-watchlist.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('import-watch').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) throw new Error('not a list');
      const r = await api('/api/watchlist', { method: 'PUT', body: { items: list } });
      toast(p('imported', r.items.length));
      load();
    } catch {
      toast(t('import_bad'));
    }
  });
}

export function relabel() {
  if (!app) return;
  render();
  for (const f of [$('brand-form'), $('pattern-form')]) if (!f.dataset.id) resetForm(f);
}

export function show() {
  load();
}
