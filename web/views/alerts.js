// The alerts view: triage by status, filter by severity and text, export,
// and a details drawer with the reasons, DNS and the certificate.

import { $, el, t, p, tn, formatNumber, nameNode, relTime, openDrawer, closeDrawer, section, dl, toast, certSections, certFromAlert, evidenceBlock } from '../ui.js';
import { api } from '../api.js';

const STATUSES = ['new', 'acknowledged', 'resolved', 'false_positive', 'all'];
const NEXT = { new: ['acknowledged', 'resolved', 'false_positive'], acknowledged: ['resolved', 'false_positive'], resolved: ['new'], false_positive: ['new'] };
const ACTION = { acknowledged: 'action_acknowledge', resolved: 'action_resolve', false_positive: 'action_false_positive', new: 'action_reopen' };

const filters = { status: 'new', severity: 'all', q: '' };
let items = [];
let counts = null;
let app = null;
let visible = false;
let reloadTimer = null;
let queryTimer = null;
let cursor = -1;

function query() {
  return new URLSearchParams(filters).toString();
}

async function load() {
  try {
    const data = await api(`/api/alerts?${query()}&limit=300`);
    items = data.items;
    counts = data.counts;
    app.setNew(counts.by_status.new);
    render();
  } catch {
    // Kept as it was; the next event or visit tries again.
  }
}

function buildControls() {
  const seg = $('alert-status');
  seg.textContent = '';
  seg.setAttribute('aria-label', t('alert_count_label'));
  for (const s of STATUSES) {
    const count = counts ? (s === 'all' ? counts.total : counts.by_status[s]) : null;
    const b = el('button', { type: 'button', 'aria-pressed': String(filters.status === s) }, t(`status_${s}`));
    if (count !== null) b.append(el('span', { class: 'count', text: formatNumber(count) }));
    b.addEventListener('click', () => {
      filters.status = s;
      load();
    });
    seg.append(b);
  }
  const sel = $('alert-severity');
  sel.textContent = '';
  for (const v of ['all', 'high', 'medium', 'low']) sel.append(el('option', { value: v, selected: filters.severity === v, text: t(`severity_${v}`) }));
  $('alert-export').href = `/api/alerts.csv?${query()}`;
}

async function triage(alert, status, note) {
  try {
    const body = note === undefined ? { status } : { status, note };
    const updated = await api(`/api/alerts/${alert.id}`, { method: 'PATCH', body });
    toast(updated.status === 'false_positive' ? t('fp_quiet') : t('status_changed', { status: t(`status_${updated.status}`) }));
    await load();
    return updated;
  } catch {
    toast(t('error_generic'));
    return null;
  }
}

function actions(alert, after) {
  return NEXT[alert.status].map((s) => {
    const b = el('button', { class: 'btn small', type: 'button', text: t(ACTION[s]) });
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await triage(alert, s);
      if (updated && after) after(updated);
    });
    return b;
  });
}

function reasonChips(alert) {
  return el('div', { class: 'chips' }, alert.reasons.map((r) => el('span', { class: 'chip', text: t(`reason_${r}`) })));
}

function row(alert) {
  const li = el('li', { class: 'alert', tabindex: '0' });
  li.dataset.severity = alert.severity;
  li.dataset.status = alert.status;
  const meta = el('div', { class: 'meta' },
    el('span', { text: t(alert.watch.kind === 'pattern' ? 'matches_pattern' : 'looks_like', { name: alert.watch.name }) }),
    el('span', {}, el('bdi', { text: alert.cert.issuer })),
    el('span', { text: t('first_seen', { when: relTime(alert.created_at) }) }),
    alert.count > 1 ? el('span', { text: p('times_seen', alert.count) }) : null,
    filters.status === 'all' ? el('span', { class: `chip status-${alert.status}`, text: t(`status_${alert.status}`) }) : null);
  li.append(
    el('div', { class: 'score' }, el('b', { text: String(alert.score) }), el('span', { text: t(`severity_${alert.severity}`) })),
    el('div', { class: 'what' }, nameNode(alert.domain, 'domain'), meta, reasonChips(alert)),
    el('div', { class: 'actions' }, actions(alert)),
  );
  li.addEventListener('click', () => openAlert(alert));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === li) openAlert(alert);
  });
  return li;
}

function render() {
  buildControls();
  const list = $('alert-list');
  list.textContent = '';
  for (const a of items) list.append(row(a));
  if (cursor >= items.length) cursor = items.length - 1;
  markCursor(false);
  const kbd = (k) => el('kbd', { text: k });
  $('alert-keys').replaceChildren(...tn('alert_keys', { j: kbd('j'), k: kbd('k'), enter: kbd('Enter'), a: kbd('a'), r: kbd('r'), f: kbd('f'), slash: kbd('/') }));
  const none = items.length === 0;
  $('alerts-empty').hidden = !none;
  const filtered = filters.status !== 'new' || filters.severity !== 'all' || filters.q;
  $('alerts-empty-text').textContent = t(counts && counts.total > 0 && filtered ? 'alerts_empty_filtered' : 'alerts_empty');
  $('alerts-go').hidden = Boolean(counts && counts.total > 0);
}

function dnsSection(alert, refresh) {
  const box = el('div');
  const d = alert.dns;
  if (!d) box.append(el('p', { class: 'note', text: t('dns_not_checked') }));
  else if (!d.resolves) box.append(el('p', { text: t('dns_none') }), el('p', { class: 'note', text: relTime(d.checked_at) }));
  else {
    box.append(
      el('p', {}, t('dns_resolves', { addresses: '' }), ...[...d.a, ...d.aaaa].map((ip) => el('span', { class: 'mono', dir: 'ltr', text: `${ip} ` }))),
      el('p', { class: 'note', text: relTime(d.checked_at) }));
  }
  const b = el('button', { class: 'btn small', type: 'button', text: t('dns_check') });
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      refresh(await api(`/api/alerts/${alert.id}/dns`, { method: 'POST' }));
    } catch {
      toast(t('error_generic'));
      b.disabled = false;
    }
  });
  box.append(b);
  return section(t('details_dns'), box);
}

function openAlert(alert) {
  const refresh = (updated) => openAlert(updated);
  const note = el('textarea', { rows: '2', maxlength: '1000' });
  note.value = alert.note || '';
  const save = el('button', { class: 'btn small', type: 'button', text: t('details_note_save') });
  save.addEventListener('click', async () => {
    const updated = await triage(alert, alert.status, note.value);
    if (updated) refresh(updated);
  });
  openDrawer(alert.unicode || alert.domain, [
    section(t('details_why'),
      dl([
        [t('score'), `${alert.score} (${t(`severity_${alert.severity}`)})`],
        [t(`kind_${alert.watch.kind}`), el('bdi', { text: alert.watch.name })],
      ]),
      ...evidenceBlock(alert)),
    section(t('details_triage'),
      el('p', {}, el('span', { class: `chip status-${alert.status}`, text: t(`status_${alert.status}`) }), ' ', p('times_seen', alert.count)),
      el('div', { class: 'row-actions' }, actions(alert, refresh)),
      el('label', { class: 'field' }, el('span', { text: t('details_note') }), note),
      save),
    dnsSection(alert, refresh),
    ...certSections(certFromAlert(alert)),
  ]);
}

function markCursor(scroll = true) {
  const rows = [...$('alert-list').children];
  rows.forEach((r, i) => r.classList.toggle('current', i === cursor));
  if (scroll && rows[cursor]) rows[cursor].scrollIntoView({ block: 'nearest' });
}

// Keys for working through alerts without the mouse.
function onKey(e) {
  if (!visible || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !$('drawer').hidden) return;
  const active = document.activeElement;
  if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
    if (e.key === 'Escape') active.blur();
    return;
  }
  const act = (status) => {
    const a = items[cursor];
    if (a && NEXT[a.status].includes(status)) triage(a, status);
  };
  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      cursor = Math.min(items.length - 1, cursor + 1);
      markCursor();
      break;
    case 'k':
    case 'ArrowUp':
      cursor = Math.max(0, cursor - 1);
      markCursor();
      break;
    case 'Enter':
    case 'o':
      if (!items[cursor] || (active && active.closest && active.closest('#alert-list'))) return;
      openAlert(items[cursor]);
      break;
    case 'a':
      act('acknowledged');
      break;
    case 'r':
      act('resolved');
      break;
    case 'f':
      act('false_positive');
      break;
    case 'u':
      act('new');
      break;
    case '/':
      $('alert-q').focus();
      break;
    default:
      return;
  }
  e.preventDefault();
}

export function onEvent() {
  if (!visible) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 700);
}

export function init(a) {
  app = a;
  $('alert-severity').addEventListener('change', (e) => {
    filters.severity = e.target.value;
    load();
  });
  $('alert-q').addEventListener('input', (e) => {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      filters.q = e.target.value.trim();
      load();
    }, 300);
  });
  buildControls();
  document.addEventListener('keydown', onKey);
}

export function relabel() {
  if (app) render();
}

export function show() {
  visible = true;
  load();
}

export function hide() {
  visible = false;
  closeDrawer();
}
