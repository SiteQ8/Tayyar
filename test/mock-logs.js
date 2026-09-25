// Serves recorded CT data over HTTP so the end-to-end tests run offline.
//
//   /a/  an RFC 6962 log holding the six Argon entries at indices 1000 to
//        1005. Like real logs it stops each answer at a page boundary, here
//        every 4 entries, so paging is exercised.
//   /b/ and /c/  two static CT logs serving the same partial data tile, so
//        cross-log deduplication is exercised.
//   /d/  a static log whose checkpoint signature is wrong.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { tilePath } from '../src/tiles.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

export const argon = JSON.parse(readFileSync(fixture('argon-entries.json'), 'utf8')).entries;
export const tile = readFileSync(fixture('sycamore-tile-8.bin'));
export const tileMeta = JSON.parse(readFileSync(fixture('sycamore-tile-8.json'), 'utf8'));
export const heads = JSON.parse(readFileSync(fixture('tree-heads.json'), 'utf8'));

export const RFC_FIRST = 1000;
export const RFC_SIZE = RFC_FIRST + argon.length;
export const STATIC_SIZE = tileMeta.tile_index * 256 + 8;
const PAGE = 4;

function checkpoint(origin) {
  const root = Buffer.alloc(32, 7).toString('base64');
  return `${origin}\n${STATIC_SIZE}\n${root}\n\n\u2014 ${origin} AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n`;
}

export function startMockLogs() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    requests.push(url.pathname + url.search);
    const [, log, ...rest] = url.pathname.split('/');
    const path = rest.join('/');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (log === 'a') {
      if (path === 'ct/v1/get-sth') {
        return send(200, JSON.stringify({ tree_size: RFC_SIZE, timestamp: Date.now(), sha256_root_hash: Buffer.alloc(32).toString('base64'), tree_head_signature: 'BAMAAA==' }));
      }
      if (path === 'ct/v1/get-entries') {
        const start = Number(url.searchParams.get('start'));
        const end = Math.min(Number(url.searchParams.get('end')), RFC_SIZE - 1, (Math.floor(start / PAGE) + 1) * PAGE - 1);
        if (!(start >= RFC_FIRST) || end < start) return send(400, '{"error":"out of range"}');
        return send(200, JSON.stringify({ entries: argon.slice(start - RFC_FIRST, end - RFC_FIRST + 1) }));
      }
    }
    if (['b', 'c', 'd'].includes(log)) {
      if (path === 'checkpoint') return send(200, checkpoint(`mock/${log}`), 'text/plain; charset=utf-8');
      if (path === `tile/data/${tilePath(tileMeta.tile_index)}.p/8`) return send(200, tile, 'application/octet-stream');
      if (path.startsWith('issuer/')) {
        const der = tileMeta.issuers[path.slice('issuer/'.length)];
        if (der) return send(200, Buffer.from(der, 'base64'), 'application/pkix-cert');
      }
    }
    send(404, '{"error":"not found"}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) });
    });
  });
}
