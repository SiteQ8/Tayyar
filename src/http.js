// Small fetch wrappers shared by the watchers. Every request carries a
// timeout, a size ceiling and a User-Agent that names the project, which is
// what CT log operators ask of monitors.

import { gunzipSync } from 'node:zlib';
import { VERSION } from './version.js';

export const USER_AGENT = `tayyar/${VERSION} (+https://tayyar.3li.info)`;

export class HttpError extends Error {
  constructor(status, url, retryAfter = null) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryAfter = retryAfter;
  }
  // 429 and 5xx mean "slow down or try again later", not "this is wrong".
  get transient() {
    return this.status === 429 || this.status >= 500;
  }
}

function retryAfterSeconds(res) {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, (at - Date.now()) / 1000);
}

async function request(url, { timeoutMs = 20000, accept = '*/*', signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs} ms: ${url}`)), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept, 'accept-encoding': 'gzip, identity' },
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, url, retryAfterSeconds(res));
    }
    return res;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Reads a body with a hard ceiling so a misbehaving server cannot exhaust memory.
async function readCapped(res, maxBytes, url) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`response larger than ${maxBytes} bytes: ${url}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, accept: 'application/json' });
  const body = await readCapped(res, opts.maxBytes ?? 64 * 1024 * 1024, url);
  return JSON.parse(body.toString('utf8'));
}

export async function getText(url, opts = {}) {
  const res = await request(url, { ...opts, accept: 'text/plain' });
  return (await readCapped(res, opts.maxBytes ?? 1024 * 1024, url)).toString('utf8');
}

export async function getBytes(url, opts = {}) {
  const res = await request(url, { ...opts, accept: 'application/octet-stream' });
  let body = await readCapped(res, opts.maxBytes ?? 32 * 1024 * 1024, url);
  // fetch undoes Content-Encoding: gzip itself. Some object stores serve the
  // gzip bytes without that header, so check the magic number as well.
  if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
    body = gunzipSync(body, { maxOutputLength: opts.maxBytes ?? 32 * 1024 * 1024 });
  }
  return body;
}
