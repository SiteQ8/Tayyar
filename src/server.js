// The network face of Tayyar: three WebSocket streams and a few HTTP routes.
//
//   WebSocket  /               lite certificate_update messages
//   WebSocket  /full-stream    with the DER bytes and the chain
//   WebSocket  /domains-only   dns_entries messages
//   GET        /latest.json    the 25 most recent certificates, oldest first (lite)
//   GET        /example.json   the most recent certificate (full)
//   GET        /stats          engine, log and client statistics
//   GET        /healthz        liveness for load balancers
//   GET        /               the live viewer page

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketHub, encodeFrame, OP_TEXT } from './ws.js';
import { liteMessage, fullMessage, domainsMessage, heartbeatMessage } from './format.js';
import { VERSION } from './version.js';

export const CHANNELS = { '/': 'lite', '/full-stream': 'full', '/domains-only': 'domains' };

export const WEB_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/punycode.js': ['punycode.js', 'text/javascript; charset=utf-8'],
  '/names.js': ['names.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

const PAGE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// The data is public, so any site may read the JSON endpoints.
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

const textFrame = (obj) => encodeFrame(OP_TEXT, Buffer.from(JSON.stringify(obj)));

export class StreamServer {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.opts = { host: '127.0.0.1', port: 4000, heartbeatMs: 30000, latest: 25, ...opts };
    this.hub = new WebSocketHub({
      maxClients: this.opts.maxClients,
      maxPerIp: this.opts.maxPerIp,
      trustProxy: this.opts.trustProxy,
    });
    this.recent = [];
    this.files = new Map();
    this.server = http.createServer((req, res) => this.route(req, res));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.server.on('clientError', (err, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      else socket.destroy();
    });
    this.onCert = (cert) => this.publish(cert);
    engine.on('cert', this.onCert);
  }

  async start() {
    const webDir = this.opts.webDir || new URL('../web/', import.meta.url);
    for (const [route, [file, type]] of Object.entries(WEB_FILES)) {
      this.files.set(route, { body: await readFile(new URL(file, webDir)), type });
    }
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

  // Each message is serialised once per shape, and only for shapes that
  // somebody is listening to.
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
        messages_dropped_for_slow_clients: this.hub.dropped,
      },
      ...this.engine.status(),
    };
  }

  route(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.send(res, req, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }, 'Method Not Allowed');
      return;
    }
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      this.send(res, req, 400, { 'content-type': 'text/plain' }, 'Bad Request');
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
        const cache = pathname === '/' ? 'no-cache' : 'public, max-age=300';
        this.send(res, req, 200, { ...PAGE_HEADERS, 'content-type': file.type, 'cache-control': cache }, file.body);
      }
    }
  }

  async stop() {
    clearInterval(this.heartbeat);
    this.engine.off('cert', this.onCert);
    this.hub.close();
    const closed = new Promise((resolve) => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    await closed;
  }
}
