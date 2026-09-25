// The JSON API behind the interface. Reads need a session when a token is
// set; changes also need the x-tayyar-request header and a same-origin
// request, which a page on another site cannot produce.

import { domainToASCII } from 'node:url';
import { STATUSES, alertsToCsv } from './alerts.js';
import { WatchlistError } from './watchlist.js';
import { detectDomain } from './detect.js';
import { VERSION } from './version.js';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...HEADERS, ...extra, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'The request body is too large.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new ApiError(400, 'The request body must be a JSON object.');
  }
}

function sameOrigin(req) {
  if (req.headers['x-tayyar-request'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Accepts a bare name or a pasted link and returns the ASCII host.
export function hostFrom(input) {
  let s = String(input || '').trim();
  if (s.includes('://')) {
    try {
      s = new URL(s).hostname;
    } catch {
      return '';
    }
  }
  s = s.replace(/[/?#].*$/, '').replace(/\.$/, '').toLowerCase();
  return domainToASCII(s.replace(/^\*\./, '')) || '';
}

export function overview(ctx) {
  const s = ctx.engine.status();
  const m = ctx.monitor;
  const enabled = m.watchlist.items.filter((i) => i.enabled).length;
  return {
    version: VERSION,
    uptime_seconds: s.uptime_seconds,
    certificates_per_second: s.certificates_per_second,
    published: s.published,
    duplicates_dropped: s.duplicates_dropped,
    logs: { total: s.logs.total, healthy: s.logs.healthy },
    alerts: m.alerts.counts(),
    watchlist: { total: m.watchlist.items.length, enabled },
    history: { certificates: m.history.size },
    webhooks: { count: m.notifier.hooks.length, ...m.notifier.stats },
    persisted: Boolean(m.dataDir),
    auth: ctx.auth.enabled,
  };
}

async function route(req, res, ctx, url) {
  const { pathname, searchParams } = url;
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean);
  const m = ctx.monitor;

  if (pathname === '/api/session') {
    if (method === 'GET') return send(res, 200, { auth: ctx.auth.enabled, signed_in: ctx.auth.allowed(req) });
    if (!sameOrigin(req)) throw new ApiError(403, 'Send the x-tayyar-request header from the same origin.');
    if (method === 'POST') {
      const body = await readJson(req, 4096);
      const r = ctx.auth.login(ctx.clientIp(req), body.token, ctx.isSecure(req));
      if (!r.ok) throw new ApiError(r.status, r.message);
      return send(res, 200, { signed_in: true }, r.cookie ? { 'set-cookie': r.cookie } : {});
    }
    if (method === 'DELETE') return send(res, 200, { signed_in: false }, { 'set-cookie': ctx.auth.logout(req) });
    throw new ApiError(405, 'That method is not allowed here.');
  }

  if (!ctx.auth.allowed(req)) throw new ApiError(401, 'Sign in with the access token first.');
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    throw new ApiError(403, 'Changes need the x-tayyar-request header from the same origin.');
  }

  if (method === 'GET' && pathname === '/api/overview') return send(res, 200, overview(ctx));
  if (method === 'GET' && pathname === '/api/logs') return send(res, 200, { logs: ctx.engine.status().logs.list });
  if (method === 'GET' && pathname === '/api/insights') return send(res, 200, m.history.insights());
  if (method === 'GET' && pathname === '/api/search') {
    const type = ['all', 'pre', 'crt'].includes(searchParams.get('type')) ? searchParams.get('type') : 'all';
    return send(res, 200, m.history.search({ q: searchParams.get('q') || '', type, limit: clamp(searchParams.get('limit'), 1, 1000, 200) }));
  }

  if (parts[1] === 'watchlist') {
    if (parts.length === 2) {
      if (method === 'GET') return send(res, 200, m.watchlist.toJSON());
      if (method === 'POST') return send(res, 201, m.watchlist.add(await readJson(req)));
      if (method === 'PUT') {
        const body = await readJson(req, 2 * 1024 * 1024);
        return send(res, 200, { version: 1, items: m.watchlist.replace(body.items) });
      }
    }
    if (parts.length === 3 && parts[2] === 'test' && method === 'POST') {
      const body = await readJson(req, 4096);
      const domain = hostFrom(body.domain);
      if (!domain) throw new ApiError(400, 'Type a domain name to test.');
      return send(res, 200, { domain, findings: detectDomain(domain, m.watchlist.compiled) });
    }
    if (parts.length === 3) {
      if (method === 'PATCH') {
        const item = m.watchlist.update(parts[2], await readJson(req));
        if (!item) throw new ApiError(404, 'No such watchlist entry.');
        return send(res, 200, item);
      }
      if (method === 'DELETE') {
        if (!m.watchlist.remove(parts[2])) throw new ApiError(404, 'No such watchlist entry.');
        return send(res, 200, { deleted: true });
      }
    }
  }

  if (parts[1] === 'alerts' || pathname === '/api/alerts.csv') {
    const filters = {
      status: [...STATUSES, 'all'].includes(searchParams.get('status')) ? searchParams.get('status') : 'all',
      severity: ['all', 'low', 'medium', 'high'].includes(searchParams.get('severity')) ? searchParams.get('severity') : 'all',
      q: searchParams.get('q') || '',
    };
    if (method === 'GET' && pathname === '/api/alerts') {
      return send(res, 200, { items: m.alerts.list({ ...filters, limit: clamp(searchParams.get('limit'), 1, 1000, 200) }), counts: m.alerts.counts() });
    }
    if (method === 'GET' && pathname === '/api/alerts.csv') {
      const body = alertsToCsv(m.alerts.list({ ...filters, limit: 100000 }));
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="tayyar-alerts-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return undefined;
    }
    if (parts.length === 3 && method === 'PATCH') {
      const body = await readJson(req, 8192);
      let alert;
      try {
        alert = m.alerts.update(parts[2], { status: body.status, note: body.note });
      } catch (err) {
        throw new ApiError(400, err.message);
      }
      if (!alert) throw new ApiError(404, 'No such alert.');
      return send(res, 200, alert);
    }
    if (parts.length === 4 && parts[3] === 'dns' && method === 'POST') {
      const alert = await m.resolve(parts[2]);
      if (!alert) throw new ApiError(404, 'No such alert.');
      return send(res, 200, alert);
    }
  }

  throw new ApiError(404, 'There is no such API route.');
}

export async function handleApi(req, res, ctx, url) {
  try {
    await route(req, res, ctx, url);
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof ApiError) send(res, err.status, { error: err.message });
    else if (err instanceof WatchlistError) send(res, 400, { error: err.message });
    else send(res, 500, { error: 'Something went wrong on the server.' });
  }
}
