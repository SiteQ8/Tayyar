// The shell: language, sign-in, routing between views, the two WebSocket
// connections, and the alerts badge.

import { LANGS } from './i18n.js';
import { ui, t, p, $, el, toast, initDrawer, closeDrawer, formatNumber } from './ui.js';
import { api } from './api.js';
import * as live from './views/live.js';
import * as alerts from './views/alerts.js';
import * as watchlist from './views/watchlist.js';
import * as search from './views/search.js';
import * as logs from './views/logs.js';

const VIEWS = { live, alerts, watchlist, search, logs };

const app = {
  overview: null,
  newAlerts: 0,
  current: null,
  started: false,
  setNew(n) {
    app.newAlerts = n;
    const badge = $('badge');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : formatNumber(n);
    badge.title = p('alerts_new', n);
  },
  async refreshOverview() {
    try {
      app.overview = await api('/api/overview');
      app.setNew(app.overview.alerts.by_status.new);
      $('logs-count').textContent = p('logs', app.overview.logs.total);
    } catch {
      // The next refresh tries again.
    }
    return app.overview;
  },
};

function pickLang() {
  try {
    const saved = localStorage.getItem('tayyar-lang');
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function renderEndpoints() {
  const ws = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  const codes = { lite: `${ws}/`, full: `${ws}/full-stream`, domains: `${ws}/domains-only`, alerts: `${ws}/alerts` };
  const box = $('endpoints');
  box.textContent = '';
  for (const part of t('endpoints').split(/(\{\w+\})/)) {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m) box.append(el('code', { dir: 'ltr', text: codes[m[1]] }));
    else if (part) box.append(part);
  }
}

function setTitle() {
  document.title = app.current && app.current !== 'live' ? `${t('title')} | ${t(`nav_${app.current}`)}` : t('title');
}

let connState = 'connecting';
function setConn(state) {
  connState = state;
  document.querySelector('.conn').dataset.state = state;
  $('status').textContent = t(`status_${state}`);
}

function applyLang(lang) {
  ui.lang = lang;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
  $('filter').placeholder = t('filter_placeholder');
  $('alert-q').placeholder = t('alerts_search_placeholder');
  $('search-q').placeholder = t('search_placeholder');
  document.querySelector('#test-form input').placeholder = t('test_placeholder');
  const btn = $('lang');
  btn.textContent = t('switch_language');
  btn.lang = lang === 'ar' ? 'en' : 'ar';
  btn.setAttribute('aria-label', t('switch_language_label'));
  $('meter').setAttribute('aria-label', t('meter_label'));
  $('tabs').setAttribute('aria-label', t('title'));
  renderEndpoints();
  app.setNew(app.newAlerts);
  if (app.overview) $('logs-count').textContent = p('logs', app.overview.logs.total);
  setConn(connState);
  setTitle();
  for (const v of Object.values(VIEWS)) v.relabel?.();
}

function connect(path, onMessage, onState) {
  let retry = 1000;
  const open = () => {
    onState?.('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`);
    ws.onopen = () => {
      retry = 1000;
      onState?.('live');
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      onMessage(msg);
    };
    ws.onclose = () => {
      onState?.('retry');
      api('/api/session').then((s) => { if (s.auth && !s.signed_in) showSignin(); }).catch(() => {});
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 30000);
    };
  };
  open();
}

function route() {
  const wanted = (location.hash || '#live').slice(1);
  const view = VIEWS[wanted] ? wanted : 'live';
  for (const [name, mod] of Object.entries(VIEWS)) {
    const on = name === view;
    $(`view-${name}`).hidden = !on;
    if (on && app.current !== name) mod.show?.();
    if (!on && app.current === name) mod.hide?.();
  }
  for (const a of document.querySelectorAll('#tabs a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  app.current = view;
  closeDrawer();
  setTitle();
}

function start() {
  if (app.started) return;
  app.started = true;
  for (const mod of Object.values(VIEWS)) mod.init?.(app);
  connect('/', (msg) => live.onMessage(msg), setConn);
  connect('/alerts', (msg) => {
    if (msg.message_type === 'alert') {
      app.setNew(app.newAlerts + 1);
      if (msg.data.severity === 'high') toast(t('new_alert', { domain: msg.data.unicode || msg.data.domain, name: msg.data.watch.name }));
    }
    alerts.onEvent(msg);
  });
  app.refreshOverview();
  setInterval(() => app.refreshOverview(), 20000);
  window.addEventListener('hashchange', route);
  route();
}

function showSignin() {
  $('signin').hidden = false;
  $('signin-form').elements.token.focus();
}

async function boot() {
  applyLang(pickLang());
  initDrawer();
  $('lang').addEventListener('click', () => {
    const next = ui.lang === 'ar' ? 'en' : 'ar';
    try {
      localStorage.setItem('tayyar-lang', next);
    } catch {
      // Not remembered, still switched.
    }
    applyLang(next);
  });
  $('signout').addEventListener('click', async () => {
    await api('/api/session', { method: 'DELETE' }).catch(() => {});
    location.reload();
  });
  $('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const error = form.querySelector('.form-error');
    error.hidden = true;
    try {
      await api('/api/session', { method: 'POST', body: { token: form.elements.token.value } });
      form.reset();
      $('signin').hidden = true;
      start();
    } catch (err) {
      error.textContent = t(err.status === 429 ? 'signin_wait' : 'signin_wrong');
      error.hidden = false;
    }
  });
  window.addEventListener('tayyar:signin', showSignin);
  let session = { auth: false, signed_in: true };
  try {
    session = await api('/api/session');
  } catch {
    // An old server without sign-in: carry on.
  }
  $('signout').hidden = !session.auth;
  if (session.auth && !session.signed_in) showSignin();
  else start();
}

boot();
