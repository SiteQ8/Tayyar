// Pieces shared by every view: the current language, text lookup, element
// helpers, times and dates, the toast, the details drawer, and certificate rows.

import { text, plural as pluralText, pluralTemplate, formatNumber } from './i18n.js';
import { toUnicode } from './punycode.js';
import { shortLogName, issuerName } from './names.js';

export const ui = { lang: 'en' };
export const t = (key, vars) => text(ui.lang, key, vars);
export const p = (key, n, vars) => pluralText(ui.lang, key, n, vars);
export { formatNumber };
export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

// A domain in left-to-right order, with its Unicode form when it differs.
export function nameNode(domain, className = 'name') {
  const wrap = el('span', { class: className });
  wrap.append(el('bdi', { dir: 'ltr', text: domain }));
  if (domain.includes('xn--')) {
    const u = toUnicode(domain);
    if (u !== domain) wrap.append(el('bdi', { class: 'idn', text: u }));
  }
  return wrap;
}

const locale = () => (ui.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB');

export function relTime(when) {
  const ms = typeof when === 'number' ? when * 1000 : Date.parse(when);
  const secs = Math.round((ms - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(secs);
  if (abs < 60) return rtf.format(secs, 'second');
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
  return rtf.format(Math.round(secs / 86400), 'day');
}

export function date(seconds) {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(seconds * 1000));
}

// A length of time in words, such as 5 minutes, with Arabic agreement from Intl.
export function span(seconds) {
  const s = Math.max(1, Math.round(seconds));
  const [value, unit] = s < 90 ? [s, 'second'] : s < 5400 ? [Math.round(s / 60), 'minute'] : [Math.round(s / 3600), 'hour'];
  return new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

export function clock(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString('en-GB', { hour12: false });
}

let toastTimer;
export function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 3200);
}

/* Drawer */

let lastFocus = null;
let onDrawerClose = null;

export function openDrawer(title, sections, onClose = null) {
  lastFocus = document.activeElement;
  onDrawerClose = onClose;
  const heading = $('drawer-title');
  heading.textContent = '';
  heading.append(el('bdi', { dir: 'ltr', text: title }));
  const body = $('drawer-body');
  body.textContent = '';
  body.append(...sections.filter(Boolean));
  $('drawer').hidden = false;
  $('scrim').hidden = false;
  $('drawer-close').focus();
}

export function closeDrawer() {
  if ($('drawer').hidden) return;
  $('drawer').hidden = true;
  $('scrim').hidden = true;
  if (onDrawerClose) onDrawerClose();
  onDrawerClose = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

export function initDrawer() {
  $('drawer-close').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if ($('drawer').hidden) return;
    if (e.key === 'Escape') closeDrawer();
    if (e.key === 'Tab') {
      const items = [...$('drawer').querySelectorAll('button, a[href], input, textarea, select')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

export function section(heading, ...kids) {
  return el('section', {}, el('h3', { text: heading }), ...kids);
}

export function dl(pairs) {
  const list = el('dl');
  for (const [k, v] of pairs) {
    if (v === null || v === undefined || v === '') continue;
    list.append(el('dt', { text: k }), el('dd', {}, v));
  }
  return list;
}

export function copyButton(value) {
  const b = el('button', { class: 'btn small', type: 'button', text: t('copy') });
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      b.textContent = t('copied');
      setTimeout(() => { b.textContent = t('copy'); }, 1500);
    } catch {
      toast(t('error_generic'));
    }
  });
  return b;
}

/* Certificates */

// One shape for a certificate, whether it came from the stream, an alert or search.
export function certFromMessage(d) {
  const leaf = d.leaf_cert || {};
  return {
    domains: leaf.all_domains || [],
    pre: d.update_type === 'PrecertLogEntry',
    issuer: issuerName(leaf.issuer),
    notBefore: leaf.not_before,
    notAfter: leaf.not_after,
    serial: leaf.serial_number,
    sha256: leaf.sha256,
    usage: [leaf.extensions?.keyUsage, leaf.extensions?.extendedKeyUsage].filter(Boolean).join(', '),
    log: shortLogName(d.source?.name || ''),
    index: d.cert_index,
    link: d.cert_link,
    seen: d.seen,
  };
}

export function certFromAlert(a) {
  const c = a.cert || {};
  const leaf = c.leaf || {};
  return {
    domains: c.all_domains || [],
    pre: c.update_type === 'PrecertLogEntry',
    issuer: c.issuer,
    notBefore: c.not_before,
    notAfter: c.not_after,
    serial: leaf.serial_number,
    sha256: c.sha256,
    usage: [leaf.extensions?.keyUsage, leaf.extensions?.extendedKeyUsage].filter(Boolean).join(', '),
    log: c.log,
    index: c.cert_index,
    link: c.cert_link,
    seen: Date.parse(a.created_at) / 1000,
  };
}

export function certFromSearch(it) {
  return { domains: it.names, pre: it.precert, issuer: it.issuer, log: it.log, index: it.cert_index, seen: it.seen };
}

// `hit` marks a row that matched the live filter; `show` only picks which
// name leads, as search does with the name that contains the query.
export function certRow(cert, { hit = null, show = null, onOpen } = {}) {
  const row = el('li', { class: hit ? 'row hit' : 'row', tabindex: '0' });
  row.dataset.type = cert.pre ? 'pre' : 'crt';
  row.domains = cert.domains;
  const label = t(cert.pre ? 'type_pre' : 'type_crt');
  const name = nameNode(hit || show || cert.domains[0] || '');
  if (cert.domains.length > 1) {
    name.append(el('span', { class: 'more', dir: 'ltr', title: p('more', cert.domains.length - 1), text: `+${formatNumber(cert.domains.length - 1)}` }));
  }
  row.append(
    el('time', { datetime: new Date((cert.seen || 0) * 1000).toISOString(), text: clock(cert.seen || 0) }),
    el('span', { class: 'mark', role: 'img', 'aria-label': label, title: label }),
    name,
    el('span', { class: 'issuer', dir: 'ltr', title: cert.issuer }, el('bdi', { text: cert.issuer || '' })),
    el('span', { class: 'log', dir: 'ltr', title: cert.log }, el('bdi', { text: cert.log || '' })),
  );
  if (onOpen) {
    row.addEventListener('click', () => onOpen(cert));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onOpen(cert);
    });
  }
  return row;
}

export function certSections(cert) {
  const names = el('ul', { class: 'names' }, cert.domains.map((d) => el('li', {}, nameNode(d, 'n'))));
  const validity = cert.notBefore
    ? `${t('details_valid_range', { from: date(cert.notBefore), to: date(cert.notAfter) })} (${relTime(cert.notAfter)})`
    : null;
  const fingerprint = cert.sha256 ? el('span', {}, el('span', { class: 'mono', dir: 'ltr', text: cert.sha256 }), ' ', copyButton(cert.sha256)) : null;
  const entry = cert.link ? el('a', { href: cert.link, target: '_blank', rel: 'noopener noreferrer', text: t('details_open_entry') }) : null;
  return [
    section(t('details_names'), names),
    section(t('details_certificate'), dl([
      [t('details_type'), t(cert.pre ? 'type_pre' : 'type_crt')],
      [t('details_issuer'), cert.issuer ? el('bdi', { text: cert.issuer }) : null],
      [t('details_valid'), validity],
      [t('details_serial'), cert.serial ? el('span', { class: 'mono', dir: 'ltr', text: cert.serial }) : null],
      [t('details_fingerprint'), fingerprint],
      [t('details_usage'), cert.usage || null],
    ])),
    section(t('details_log'), dl([
      [t('col_log'), cert.log ? el('bdi', { text: cert.log }) : null],
      ['#', cert.index !== undefined ? el('span', { class: 'mono', text: String(cert.index) }) : null],
      ['', entry],
    ])),
  ];
}

/* Evidence */

// Placeholders that hold a domain or code stay left to right inside Arabic text.
const LTR = new Set(['domain', 'written', 'name', 'ending', 'real', 'label', 'ascii', 'pattern', 'code']);

// Fills a template with nodes: strings become isolated values, nodes go in as they are.
export function nodes(template, vars = {}) {
  return template.split(/(\{\w+\})/).filter(Boolean).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m || !(m[1] in vars)) return document.createTextNode(part);
    const v = vars[m[1]];
    if (v instanceof Node) return v;
    return el('bdi', { class: 'ev-val', dir: LTR.has(m[1]) ? 'ltr' : 'auto', text: String(v) });
  });
}

export const tn = (key, vars) => nodes(t(key, undefined), vars);
export const pn = (key, n, vars) => nodes(pluralTemplate(ui.lang, key, n), { ...vars, n: document.createTextNode(formatNumber(n)) });

const MARKED = new Set(['keyword', 'embedded-domain', 'typo', 'swap', 'homoglyph']);

// Draws a name with its evidence marked: the part that names the brand, the
// look-alike characters inside it, and lure words.
export function nameRibbon(name, evidence = [], asciiShown = true) {
  const chars = [...name];
  const marks = chars.map(() => new Set());
  const mark = (range, c) => {
    if (!range) return;
    for (let i = range[0]; i < range[1] && i < chars.length; i++) marks[i].add(c);
  };
  for (const e of evidence) {
    if (MARKED.has(e.reason)) mark(e.at, 'ev-brand');
    if (e.reason === 'homoglyph') for (const c of e.chars || []) mark([c.at, c.at + 1], 'ev-odd');
    if (e.reason === 'swap') for (const s of e.swaps || []) mark([s.at, s.at + [...s.from].length], 'ev-odd');
    if (e.reason === 'lure-word') for (const r of e.at || []) mark(r, 'ev-lure');
    if (e.reason === 'pattern' && (e.on === 'ascii') === asciiShown) mark(e.at, 'ev-brand');
  }
  for (let i = 1; i < chars.length; i++) if (/\p{M}/u.test(chars[i])) marks[i] = marks[i - 1];
  const out = el('bdi', { class: 'ribbon', dir: 'ltr' });
  let run = '';
  let key = '';
  const flush = () => {
    if (run) out.append(key ? el('span', { class: key, text: run }) : document.createTextNode(run));
    run = '';
  };
  chars.forEach((ch, i) => {
    const k = [...marks[i]].sort().join(' ');
    if (k !== key) {
      flush();
      key = k;
    }
    run += ch;
  });
  flush();
  return out;
}

function evidenceLines(e) {
  const line = (...kids) => el('p', { class: 'ev-line' }, ...kids);
  const words = (list) => {
    const f = document.createDocumentFragment();
    list.forEach((w, i) => {
      if (i) f.append(ui.lang === 'ar' ? '، ' : ', ');
      f.append(el('bdi', { class: 'ev-val', dir: 'auto', text: w }));
    });
    return f;
  };
  switch (e.reason) {
    case 'embedded-domain':
      return [line(...(e.form === 'hyphens' ? tn('ev_embedded_hyphens', { domain: e.domain, written: e.written }) : tn('ev_embedded', { domain: e.domain })))];
    case 'tld-swap':
      return [line(...tn('ev_tld_swap', { name: e.name, ending: `.${e.ending}`, real: (e.real || []).map((r) => `.${r}`).join(' ') }))];
    case 'keyword':
      return [line(...tn('ev_keyword', { word: e.word }))];
    case 'subdomain':
      return [line(...tn('ev_subdomain', { label: e.label }))];
    case 'homoglyph':
      return (e.chars || []).map((c) => line(...tn('ev_char', { char: c.char, code: c.code, script: document.createTextNode(t(`script_${c.script}`)), as: c.as })));
    case 'swap':
      return (e.swaps || []).map((s) => line(...tn('ev_swap', { from: s.from, to: s.to })));
    case 'typo':
      return [line(...pn('ev_typo', e.distance, { piece: e.piece, word: e.word }))];
    case 'lure-word':
      return [line(...tn('ev_lure', { words: words(e.words || []) }))];
    case 'idn':
      return [line(...tn('ev_idn', { ascii: e.ascii }))];
    case 'pattern':
      return [line(...tn('ev_pattern', { pattern: e.pattern }))];
    default:
      return [];
  }
}

// The name drawn with its marks, a legend for the marks used, and every
// reason with its explanation and the evidence behind it.
export function evidenceBlock(f) {
  const name = (f.unicode || String(f.domain).replace(/^\*\./, '')).toLowerCase();
  const ribbon = nameRibbon(name, f.evidence || [], !f.unicode);
  const used = ['ev-brand', 'ev-odd', 'ev-lure'].filter((c) => ribbon.querySelector(`.${c.replace(' ', '.')}`) || ribbon.querySelector(`[class~="${c}"]`));
  const legend = used.length ? el('p', { class: 'ev-legend' }, used.map((c) => el('span', { class: `l-${c.slice(3)}`, text: t(`legend_${c.slice(3)}`) }))) : null;
  const list = f.evidence || f.reasons.map((reason) => ({ reason }));
  return [
    el('div', { class: 'ev-name' }, ribbon),
    legend,
    el('ul', { class: 'why' }, list.map((e) => el('li', {}, el('b', { text: t(`reason_${e.reason}`) }), el('span', { text: t(`reason_${e.reason}_why`) }), ...evidenceLines(e)))),
  ];
}

export function openCert(cert) {
  openDrawer(cert.domains[0] || '', certSections(cert));
}
