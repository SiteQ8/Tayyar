import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Watchlist, normalizeItem, WatchlistError } from '../src/watchlist.js';
import { AlertStore, alertsToCsv } from '../src/alerts.js';
import { History } from '../src/history.js';
import { Notifier, parseHook, alertText } from '../src/notify.js';
import { Auth } from '../src/auth.js';
import { Monitor } from '../src/monitor.js';
import { StreamServer } from '../src/server.js';
import { hostFrom } from '../src/api.js';
import { VERSION } from '../src/version.js';

const run = promisify(execFile);
const tmp = () => mkdtemp(join(tmpdir(), 'tayyar-'));
const BIN = fileURLToPath(new URL('../bin/tayyar.js', import.meta.url));

const FINDING = { watch: { id: 'b1', name: 'Example', kind: 'brand' }, domain: 'example-login.test', unicode: null, score: 70, severity: 'medium', reasons: ['keyword', 'lure-word'] };
const CERT = { sha256: 'AB', update_type: 'X509LogEntry', issuer: 'Example CA R1', not_before: 1, not_after: 2, all_domains: ['example-login.test'], log: 'Example2026h2', log_url: 'https://log.example/', cert_index: 7, cert_link: 'https://log.example/ct/v1/get-entries?start=7&end=7' };

test('the watchlist refuses entries it cannot use, and cleans the rest', () => {
  const bad = [
    [{ name: '', domains: 'a.com' }, /name/],
    [{ name: 'X', domains: 'not_a_domain' }, /not a domain/],
    [{ name: 'X', keywords: 'ab' }, /3 to 40/],
    [{ name: 'X' }, /at least one/],
    [{ kind: 'pattern', name: 'X', pattern: '(' }, /regular expression/],
    [{ kind: 'pattern', name: 'X', pattern: 'a', severity: 'urgent' }, /severity/],
    [{ kind: 'other', name: 'X' }, /kind/],
  ];
  for (const [input, message] of bad) {
    assert.throws(() => normalizeItem(input), (err) => err instanceof WatchlistError && message.test(err.message), JSON.stringify(input));
  }
  const item = normalizeItem({ name: ' Example ', domains: 'EXAMPLE.com, *.example.com.', keywords: 'Example' });
  assert.deepEqual([item.name, item.domains, item.keywords, item.enabled], ['Example', ['example.com'], ['example'], true]);
  assert.deepEqual(normalizeItem({ name: 'مثال', domains: 'مثال.test' }).domains, ['xn--mgbh0fb.test']);
});

test('the watchlist saves each change and loads it back', async () => {
  const dir = await tmp();
  const file = join(dir, 'watchlist.json');
  const a = new Watchlist({ file });
  const item = a.add({ name: 'Example', domains: ['example.com'] });
  a.update(item.id, { enabled: false });
  await a.save();
  const b = new Watchlist({ file });
  await b.load();
  assert.deepEqual(b.items.map((i) => [i.id, i.enabled]), [[item.id, false]]);
  assert.equal(b.compiled.size, 0, 'a switched off entry is not checked');
  assert.equal(b.remove(item.id), true);
  assert.equal(b.remove(item.id), false);
  await b.save();
  await rm(dir, { recursive: true });
});

test('alerts repeat instead of piling up, and their history survives a restart', async () => {
  const dir = await tmp();
  const file = join(dir, 'alerts.jsonl');
  const store = new AlertStore({ file });
  const events = [];
  store.on('alert', () => events.push('alert'));
  store.on('update', () => events.push('update'));
  const first = store.record(FINDING, CERT);
  const again = store.record(FINDING, CERT);
  assert.equal(first.isNew, true);
  assert.equal(again.isNew, false);
  assert.equal(again.alert.count, 2);
  store.update(first.alert.id, { status: 'acknowledged', note: 'looking' });
  store.setDns(first.alert.id, { resolves: false, a: [], aaaa: [] });
  assert.throws(() => store.update(first.alert.id, { status: 'maybe' }), /status/);
  await store.flush();
  const reloaded = new AlertStore({ file });
  await reloaded.load();
  const a = reloaded.get(first.alert.id);
  assert.deepEqual([a.count, a.status, a.note, a.dns.resolves], [2, 'acknowledged', 'looking', false]);
  assert.deepEqual(events, ['alert', 'update', 'update', 'update']);
  assert.equal(reloaded.counts().by_status.acknowledged, 1);
  assert.equal(reloaded.list({ status: 'new' }).length, 0);
  assert.equal(reloaded.list({ q: 'example-login' }).length, 1);
  assert.equal(reloaded.list({ severity: 'high' }).length, 0);
  assert.equal(new AlertStore({ repeatWindowMs: 0 }).record(FINDING, CERT).isNew, true);
  await rm(dir, { recursive: true });
});

test('a false positive stays quiet for its watchlist entry, and evidence is kept', () => {
  const store = new AlertStore({ repeatWindowMs: 0 });
  const evidence = [{ reason: 'keyword', word: 'example', at: [0, 7] }];
  const { alert } = store.record({ ...FINDING, evidence }, CERT);
  assert.deepEqual(alert.evidence, evidence);
  store.update(alert.id, { status: 'false_positive' });
  const again = store.record(FINDING, CERT);
  assert.deepEqual([again.isNew, again.alert.id, again.alert.count], [false, alert.id, 2]);
  store.update(alert.id, { status: 'resolved' });
  assert.equal(store.record(FINDING, CERT).isNew, true, 'a resolved name alerts again once the repeat window has passed');
});

test('the CSV export quotes fields and defuses spreadsheet formulas', () => {
  const alert = {
    created_at: 'x', last_seen: 'y', count: 1, status: 'new', severity: 'high', score: 90, domain: '=cmd.example', unicode: null,
    watch: { name: 'A, "B"' }, reasons: ['keyword'], cert: { issuer: '@evil', log: 'L', cert_index: 3 }, note: 'line\nbreak',
  };
  const csv = alertsToCsv([alert]);
  assert.ok(csv.startsWith('created_at,last_seen,count,status,severity,score,domain'));
  assert.ok(csv.includes(",'=cmd.example,"));
  assert.ok(csv.includes(',"A, ""B""",'));
  assert.ok(csv.includes(",'@evil,"));
  assert.ok(csv.includes('"line\nbreak"'));
});

const fakeCert = (i, domains, pre = false) => ({
  seen: 1700000000 + i,
  index: i,
  entryType: pre ? 1 : 0,
  parsed: { all_domains: domains, issuer: { O: 'Example Org', CN: 'Example CA R1' } },
  log: { name: 'Example Log 2026h2' },
});

test('search finds recent names, and the hourly figures cover every certificate', () => {
  const h = new History({ max: 3 });
  h.add(fakeCert(1, ['old.example.com']));
  h.add(fakeCert(2, ['shop.example.com', 'www.shop.example.com']));
  h.add(fakeCert(3, ['xn--mgbh0fb.test'], true));
  h.add(fakeCert(4, ['news.example.org']));
  assert.equal(h.size, 3);
  assert.deepEqual(h.search({ q: 'old' }).items, [], 'the oldest has left the ring');
  assert.deepEqual(h.search({ q: 'SHOP' }).items.map((i) => i.cert_index), [2]);
  assert.deepEqual(h.search({ q: 'مثال' }).items.map((i) => i.cert_index), [3], 'searches the Unicode form too');
  assert.deepEqual(h.search({ type: 'pre' }).items.map((i) => i.cert_index), [3]);
  assert.deepEqual(h.search({}).items.map((i) => i.cert_index), [4, 3, 2]);
  assert.equal(h.search({ q: 'example org' }).items.length, 0);
  const s = h.insights(1700000010);
  assert.equal(s.total, 4);
  assert.deepEqual(s.split, { pre: 1, crt: 3 });
  assert.deepEqual(s.top_endings[0], { name: 'com', count: 2 });
  assert.deepEqual(s.top_issuers[0], { name: 'Example Org', count: 4 });
  assert.equal(s.per_minute.length, 60);
});

test('webhooks are signed, retried after a server error, and filtered by severity', async () => {
  const got = [];
  let failures = 1;
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(failures-- > 0 ? 500 : 204);
      res.end();
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${receiver.address().port}/hook`;
  const notifier = new Notifier({ hooks: [parseHook(url), parseHook(`text:${url}`)], secret: 'k', retryMs: [0, 10] });
  const alert = { ...FINDING, id: 'a1', cert: CERT };
  assert.deepEqual(notifier.send({ ...alert, severity: 'low' }), [], 'below the lowest severity to post');
  assert.deepEqual(await Promise.all(notifier.send(alert)), [true, true]);
  assert.equal(got.length, 3, 'one failed attempt, then two deliveries');
  for (const g of got) assert.equal(g.headers['x-tayyar-signature'], `sha256=${createHmac('sha256', 'k').update(g.body).digest('hex')}`);
  const bodies = got.map((g) => JSON.parse(g.body));
  assert.ok(bodies.some((b) => b.event === 'alert' && b.alert.domain === 'example-login.test'));
  assert.ok(bodies.some((b) => b.text === alertText(alert)));
  assert.equal(notifier.stats.sent, 2);
  assert.throws(() => parseHook('ftp://example.com/'), /http or https/);
  assert.throws(() => parseHook('nothing'), /not a webhook URL/);
  receiver.close();
});

test('sign-in checks the token, limits attempts and issues a strict cookie', () => {
  const auth = new Auth({ token: 'correct horse battery', maxAttempts: 2 });
  assert.equal(auth.login('192.0.2.1', 'wrong').status, 401);
  assert.equal(auth.login('192.0.2.1', 'wrong').status, 401);
  assert.equal(auth.login('192.0.2.1', 'correct horse battery').status, 429, 'paused after too many attempts');
  const ok = auth.login('192.0.2.2', 'correct horse battery', true);
  assert.equal(ok.ok, true);
  assert.match(ok.cookie, /^tayyar_session=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
  const cookie = ok.cookie.split(';')[0];
  assert.equal(auth.allowed({ headers: { cookie } }), true);
  assert.equal(auth.allowed({ headers: { authorization: 'Bearer correct horse battery' } }), true);
  assert.equal(auth.allowed({ headers: { authorization: 'Bearer wrong' } }), false);
  assert.equal(auth.allowed({ headers: {} }), false);
  auth.logout({ headers: { cookie } });
  assert.equal(auth.allowed({ headers: { cookie } }), false);
  assert.equal(new Auth().allowed({ headers: {} }), true, 'open when no token is set');
});

test('pasted links and wildcards become plain host names', () => {
  assert.equal(hostFrom('https://EXAMPLE.com/path?q=1'), 'example.com');
  assert.equal(hostFrom('*.example.com.'), 'example.com');
  assert.equal(hostFrom('مثال.test'), 'xn--mgbh0fb.test');
  assert.equal(hostFrom('not a domain'), '');
});

function fakeEngine() {
  const engine = new EventEmitter();
  engine.status = () => ({
    uptime_seconds: 1,
    certificates_per_second: 0,
    published: { X509LogEntry: 0, PrecertLogEntry: 0 },
    duplicates_dropped: 0,
    logs: { total: 1, healthy: 1, list: [{ name: 'Example Log', state: 'ok' }] },
  });
  return engine;
}

async function call(base, path, { method = 'GET', body, cookie, header = true, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (header && method !== 'GET') headers['x-tayyar-request'] = '1';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

function upgrade(port, path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path, headers });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

test('the API needs a session, refuses changes from other sites, and runs the watchlist and alerts', async () => {
  const dir = await tmp();
  const monitor = new Monitor({ dataDir: dir, lookupFn: async () => ({ checked_at: 'now', resolves: true, a: ['192.0.2.1'], aaaa: [] }) });
  await monitor.load();
  const server = new StreamServer(fakeEngine(), { port: 0, monitor, token: 'a long enough token' });
  const { port } = await server.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.deepEqual((await call(base, '/api/session')).json, { auth: true, signed_in: false });
    assert.equal((await call(base, '/api/overview')).status, 401);
    assert.equal((await call(base, '/stats')).status, 401);
    assert.equal((await call(base, '/')).status, 200, 'the page loads, to show the sign-in form');
    assert.equal(await upgrade(port, '/alerts'), 401);
    assert.equal((await call(base, '/api/session', { method: 'POST', body: { token: 'a long enough token' }, header: false })).status, 403);
    assert.equal((await call(base, '/api/session', { method: 'POST', body: { token: 'x'.repeat(8000) } })).status, 413);
    assert.equal((await call(base, '/api/session', { method: 'POST', body: { token: 'nope' } })).status, 401);
    const login = await call(base, '/api/session', { method: 'POST', body: { token: 'a long enough token' } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal(await upgrade(port, '/alerts', cookie), 101);

    const brand = { name: 'Example', domains: 'example.com' };
    assert.equal((await call(base, '/api/watchlist', { method: 'POST', body: brand, cookie, origin: 'https://elsewhere.example' })).status, 403);
    assert.equal((await call(base, '/api/watchlist', { method: 'POST', body: brand, cookie, header: false })).status, 403);
    const added = await call(base, '/api/watchlist', { method: 'POST', body: brand, cookie, origin: base });
    assert.equal(added.status, 201);
    assert.equal((await call(base, '/api/watchlist', { method: 'POST', body: { name: 'Bad', domains: 'nope' }, cookie })).status, 400);
    assert.equal((await call(base, '/api/watchlist', { method: 'POST', body: '[1]', cookie })).status, 400);
    const toggled = await call(base, `/api/watchlist/${added.json.id}`, { method: 'PATCH', body: { enabled: false }, cookie });
    assert.equal(toggled.json.enabled, false);
    await call(base, `/api/watchlist/${added.json.id}`, { method: 'PATCH', body: { enabled: true }, cookie });
    const tested = await call(base, '/api/watchlist/test', { method: 'POST', body: { domain: 'https://example.com.verify-pay.test/login' }, cookie });
    assert.equal(tested.json.domain, 'example.com.verify-pay.test');
    assert.equal(tested.json.findings[0].severity, 'high');
    assert.equal((await call(base, '/api/watchlist/test', { method: 'POST', body: { domain: 'not a name' }, cookie })).status, 400);

    const { alert } = monitor.alerts.record(FINDING, CERT);
    const list = await call(base, '/api/alerts?status=new', { cookie });
    assert.equal(list.json.items[0].id, alert.id);
    assert.equal(list.json.counts.by_status.new, 1);
    const patched = await call(base, `/api/alerts/${alert.id}`, { method: 'PATCH', body: { status: 'resolved', note: 'taken down' }, cookie });
    assert.deepEqual([patched.json.status, patched.json.note], ['resolved', 'taken down']);
    assert.equal((await call(base, `/api/alerts/${alert.id}`, { method: 'PATCH', body: { status: 'gone' }, cookie })).status, 400);
    assert.equal((await call(base, '/api/alerts/a_missing', { method: 'PATCH', body: { status: 'new' }, cookie })).status, 404);
    const dns = await call(base, `/api/alerts/${alert.id}/dns`, { method: 'POST', cookie });
    assert.deepEqual(dns.json.dns.a, ['192.0.2.1']);
    const csv = await call(base, '/api/alerts.csv?status=all', { cookie });
    assert.match(csv.headers.get('content-disposition'), /^attachment; filename="tayyar-alerts-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.match(csv.text, /example-login\.test/);
    assert.equal((await call(base, '/api/nothing', { cookie })).status, 404);
    const overview = await call(base, '/api/overview', { cookie });
    assert.deepEqual([overview.json.watchlist.total, overview.json.persisted, overview.json.auth], [1, true, true]);
    const pipe = overview.json.pipeline;
    assert.deepEqual([pipe.logs.total, pipe.watching, pipe.webhooks.configured], [1, 1, 0]);
    for (const k of ['entries', 'copies', 'certificates', 'names', 'findings', 'alerts', 'repeats']) assert.equal(typeof pipe[k], 'number', k);
    assert.equal((await call(base, '/metrics')).status, 401);
    const metrics = await call(base, '/metrics', { cookie });
    assert.match(metrics.headers.get('content-type'), /^text\/plain; version=0\.0\.4/);
    for (const line of [`tayyar_info{version="${VERSION}"} 1`, '# TYPE tayyar_certificates_total counter', 'tayyar_certificates_total{type="precertificate"} 0', 'tayyar_alerts{status="resolved"} 1', 'tayyar_websocket_clients{channel="alerts"} 0']) {
      assert.ok(metrics.text.split('\n').includes(line), line);
    }
    for (const line of metrics.text.trim().split('\n')) assert.match(line, /^(# (HELP|TYPE) \w+ .+|\w+(\{(\w+="(?:[^"\\]|\\.)*",?)+\})? -?[\d.]+(e[+-]?\d+)?)$/, line);
    assert.equal((await call(base, '/api/logs', { cookie })).json.logs[0].name, 'Example Log');
    const out = await call(base, '/api/session', { method: 'DELETE', cookie });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call(base, '/api/overview', { cookie })).status, 401);
  } finally {
    await server.stop();
    await rm(dir, { recursive: true });
  }
});

test('check tests names against a watchlist file', async () => {
  const dir = await tmp();
  const file = join(dir, 'watchlist.json');
  await writeFile(file, JSON.stringify({ items: [{ name: 'Example', domains: ['example.com'] }] }));
  const { stdout } = await run(process.execPath, [BIN, 'check', '--watchlist', file, 'example-login.test', 'shop.test']);
  assert.match(stdout, /medium 70 {2}example-login\.test {2}looks like Example {2}\(keyword, lure-word\)/);
  assert.match(stdout, /shop\.test {2}no match/);
  const json = JSON.parse((await run(process.execPath, [BIN, 'check', '--json', '--watchlist', file, 'https://example.test/login'])).stdout);
  assert.equal(json[0].domain, 'example.test');
  assert.deepEqual(json[0].findings[0].reasons, ['tld-swap', 'keyword']);
  await assert.rejects(run(process.execPath, [BIN, 'check', 'example.test']), /needs --watchlist/);
  await rm(dir, { recursive: true });
});
