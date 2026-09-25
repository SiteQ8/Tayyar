// The network face of Tayyar: the interface, the JSON API, four WebSocket
// streams and a few plain routes.
//
//   WebSocket  /               certificate_update messages without DER or chain
//   WebSocket  /full-stream    with the DER bytes and the chain
//   WebSocket  /domains-only   dns_entries messages
//   WebSocket  /alerts         alert and alert_update messages
//   GET        /latest.json    the 25 most recent certificates, oldest first
//   GET        /example.json   the most recent certificate, in full
//   GET        /stats          engine, log and client statistics
//   GET        /healthz        liveness for load balancers
//   *          /api/...        the interface's API (see api.js)
//   GET        /              the interface

import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketHub, encodeFrame, OP_TEXT } from './ws.js';
import { liteMessage, fullMessage, domainsMessage, heartbeatMessage } from './format.js';
import { handleApi } from './api.js';
import { Auth } from './auth.js';
import { Monitor } from './monitor.js';
import { VERSION } from './version.js';

export const CHANNELS = { '/': 'lite', '/full-stream': 'full', '/domains-only': 'domains', '/alerts': 'alerts' };
export const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

// Loads the interface into memory once, keyed by URL path.
export async function webFiles(dir = WEB_DIR) {
  const files = new Map();
  async function walk(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (TYPES[extname(entry.name)]) files.set(`/${relative(dir, p).split(sep).join('/')}`, { body: await readFile(p), type: TYPES[extname(entry.name)] });
    }
  }
  await walk(dir);
  if (files.has('/index.html')) files.set('/', files.get('/index.html'));
  return files;
}

const PAGE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const textFrame = (obj) => encodeFrame(OP_TEXT, Buffer.from(JSON.stringify(obj)));

export class StreamServer {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.opts = { host: '127.0.0.1', port: 4000, heartbeatMs: 30000, latest: 25, ...opts };
    this.monitor = opts.monitor || new Monitor();
    this.auth = opts.auth || new Auth({ token: opts.token || null });
    this.hub = new WebSocketHub({ maxClients: this.opts.maxClients, maxPerIp: this.opts.maxPerIp, trustProxy: this.opts.trustProxy });
    this.recent = [];
    this.files = new Map();
    this.ctx = {
      engine,
      monitor: this.monitor,
      auth: this.auth,
      clientIp: (req) => this.hub.clientIp(req),
      isSecure: (req) => Boolean(req.socket.encrypted) || (this.opts.trustProxy && req.headers['x-forwarded-proto'] === 'https'),
    };
    this.server = http.createServer((req, res) => this.route(req, res));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.server.on('clientError', (err, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      else socket.destroy();
    });
    this.onCert = (cert) => this.publish(cert);
    engine.on('cert', this.onCert);
    this.onAlert = (a) => this.hub.broadcast('alerts', textFrame({ message_type: 'alert', data: a }));
    this.onAlertUpdate = (a) => this.hub.broadcast('alerts', textFrame({ message_type: 'alert_update', data: a }));
    this.monitor.alerts.on('alert', this.onAlert);
    this.monitor.alerts.on('update', this.onAlertUpdate);
  }

  async start() {
    this.files = await webFiles(this.opts.webDir || WEB_DIR);
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.opts.port, this.opts.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.heartbeat = setInterval(() => this.hub.broadcastAll(textFrame(heartbeatMessage())), this.opts.heartbeatMs);
    this.heartbeat.unref();
    return this.address();
  }

  address() {
    const a = this.server.address();
    return a && typeof a === 'object' ? { host: a.address, port: a.port } : null;
  }

  publish(cert) {
    this.recent.push(cert);
    if (this.recent.length > this.opts.latest) this.recent.shift();
    if (this.hub.count('lite')) this.hub.broadcast('lite', textFrame(liteMessage(cert)));
    if (this.hub.count('full')) this.hub.broadcast('full', textFrame(fullMessage(cert)));
    if (this.hub.count('domains')) this.hub.broadcast('domains', textFrame(domainsMessage(cert)));
  }

  upgrade(req, socket, head) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      WebSocketHub.refuse(socket, 400, 'Bad Request');
      return;
    }
    const channel = CHANNELS[pathname];
    if (!channel) {
      WebSocketHub.refuse(socket, 404, 'Not Found');
      return;
    }
    if (!this.auth.allowed(req)) {
      WebSocketHub.refuse(socket, 401, 'Unauthorized');
      return;
    }
    this.hub.handleUpgrade(req, socket, head, channel);
  }

  send(res, req, status, headers, body) {
    res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  json(res, req, status, obj) {
    this.send(res, req, status, JSON_HEADERS, JSON.stringify(obj));
  }

  stats() {
    return {
      version: VERSION,
      clients: {
        lite: this.hub.count('lite'),
        full: this.hub.count('full'),
        domains: this.hub.count('domains'),
        alerts: this.hub.count('alerts'),
        messages_dropped_for_slow_clients: this.hub.dropped,
      },
      ...this.engine.status(),
    };
  }

  route(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      this.send(res, req, 400, { 'content-type': 'text/plain' }, 'Bad Request');
      return;
    }
    const { pathname } = url;
    if (pathname.startsWith('/api/')) {
      handleApi(req, res, this.ctx, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.send(res, req, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }, 'Method Not Allowed');
      return;
    }
    const data = ['/latest.json', '/example.json', '/stats'].includes(pathname);
    if (data && !this.auth.allowed(req)) {
      this.json(res, req, 401, { error: 'Sign in with the access token first.' });
      return;
    }
    switch (pathname) {
      case '/latest.json':
        this.json(res, req, 200, { messages: this.recent.map(liteMessage) });
        return;
      case '/example.json': {
        const last = this.recent[this.recent.length - 1];
        if (!last) this.json(res, req, 503, { error: 'No certificate has arrived yet. Try again in a few seconds.' });
        else this.json(res, req, 200, fullMessage(last));
        return;
      }
      case '/stats':
        this.json(res, req, 200, this.stats());
        return;
      case '/healthz': {
        const s = this.engine.status();
        const ok = s.logs.healthy > 0;
        this.json(res, req, ok ? 200 : 503, { status: ok ? 'ok' : 'degraded', logs_healthy: s.logs.healthy, logs_total: s.logs.total });
        return;
      }
      default: {
        const file = this.files.get(pathname);
        if (!file) {
          this.json(res, req, 404, { error: 'Not found' });
          return;
        }
        const cache = pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=300';
        this.send(res, req, 200, { ...PAGE_HEADERS, 'content-type': file.type, 'cache-control': cache }, file.body);
      }
    }
  }

  async stop() {
    clearInterval(this.heartbeat);
    this.engine.off('cert', this.onCert);
    this.monitor.alerts.off('alert', this.onAlert);
    this.monitor.alerts.off('update', this.onAlertUpdate);
    this.hub.close();
    const closed = new Promise((resolve) => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    await closed;
    await this.monitor.alerts.flush();
  }
}
