import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, loadState } from '../src/engine.js';
import { StreamServer } from '../src/server.js';
import { customLog } from '../src/loglist.js';
import { parseDataTile } from '../src/leaf.js';
import { startMockLogs, tile, tileMeta, heads, RFC_FIRST, RFC_SIZE } from './mock-logs.js';
import { FIELDS } from './fields.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(check, ms = 10000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for the stream');
    await sleep(20);
  }
}

function client(url) {
  const ws = new WebSocket(url);
  const msgs = [];
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  return { ws, msgs, opened, certs: () => msgs.filter((m) => m.message_type !== 'heartbeat') };
}

let mock;
before(async () => {
  mock = await startMockLogs();
});
after(async () => {
  await mock.close();
});

test('streams both kinds of log to all three channels in the documented format', async () => {
  const engine = new Engine({ watcher: { pollMs: 100, backfill: 6, partialWaitMs: 0, verify: 'off' } });
  const server = new StreamServer(engine, { port: 0, heartbeatMs: 150 });
  const { port } = await server.start();
  const http = `http://127.0.0.1:${port}`;
  const ws = `ws://127.0.0.1:${port}`;
  const lite = client(`${ws}/`);
  const full = client(`${ws}/full-stream`);
  const domains = client(`${ws}/domains-only`);
  await Promise.all([lite.opened, full.opened, domains.opened]);

  engine.start([customLog(`rfc6962:${mock.base}/a/`), customLog(`static:${mock.base}/b/`), customLog(`static:${mock.base}/c/`)]);
  await until(() => [lite, full, domains].every((c) => c.certs().length >= 12) && lite.msgs.some((m) => m.message_type === 'heartbeat'));
  await sleep(400); // duplicates from the second static log would arrive by now

  // Six entries from the RFC 6962 log and six from the static logs; the
  // second static log repeats the first, so its copies are dropped.
  const liteCerts = lite.certs();
  assert.equal(liteCerts.length, 12);
  assert.equal(engine.status().duplicates_dropped, 6);
  const staticFirst = tileMeta.tile_index * 256 + 2;
  const indexes = liteCerts.map((m) => m.data.cert_index).sort((a, b) => a - b);
  assert.deepEqual(indexes, [...Array(6).keys()].map((i) => RFC_FIRST + i).concat([...Array(6).keys()].map((i) => staticFirst + i)));
  assert.deepEqual(new Set(liteCerts.map((m) => m.data.update_type)), new Set(['X509LogEntry', 'PrecertLogEntry']));

  // Every documented field is present.
  for (const m of liteCerts) {
    assert.equal(m.message_type, 'certificate_update');
    for (const k of FIELDS.data) assert.ok(k in m.data, `data.${k}`);
    for (const k of FIELDS.leaf) assert.ok(k in m.data.leaf_cert, `leaf_cert.${k}`);
    for (const k of FIELDS.name) {
      assert.ok(k in m.data.leaf_cert.subject, `subject.${k}`);
      assert.ok(k in m.data.leaf_cert.issuer, `issuer.${k}`);
    }
    assert.equal(typeof m.data.leaf_cert.not_before, 'number');
    assert.match(m.data.leaf_cert.fingerprint, /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
    assert.equal('as_der' in m.data.leaf_cert, false);
    assert.equal('chain' in m.data, false);
  }
  const fromRfc = liteCerts.find((m) => m.data.cert_index === RFC_FIRST);
  assert.equal(fromRfc.data.cert_link, `${mock.base}/a/ct/v1/get-entries?start=${RFC_FIRST}&end=${RFC_FIRST}`);
  assert.equal(fromRfc.data.source.url, `${mock.base}/a/`);

  // The full stream adds the DER bytes and the chain, resolved from /issuer/ for static logs.
  const leaves = parseDataTile(tile);
  for (const m of full.certs()) {
    assert.ok(m.data.leaf_cert.as_der.length > 100);
    assert.ok(Array.isArray(m.data.chain) && m.data.chain.length >= 1);
    const i = m.data.cert_index - tileMeta.tile_index * 256;
    if (i >= 0 && i < 8) assert.equal(m.data.chain.length, leaves[i].chainFingerprints.length);
  }

  // The domains stream carries the same names in the same order.
  assert.deepEqual(domains.certs().map((m) => m.data), liteCerts.map((m) => m.data.leaf_cert.all_domains));
  assert.ok(domains.certs().every((m) => m.message_type === 'dns_entries'));

  // Pages were cut at the mock log's boundary of 4, so it took more than one request.
  assert.ok(mock.requests.filter((r) => r.startsWith('/a/ct/v1/get-entries')).length >= 2);

  // HTTP routes.
  const latest = await (await fetch(`${http}/latest.json`)).json();
  assert.equal(latest.messages.length, 12);
  const seen = latest.messages.map((m) => m.data.seen);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'oldest first');
  const example = await (await fetch(`${http}/example.json`)).json();
  assert.ok(example.data.leaf_cert.as_der && Array.isArray(example.data.chain));
  const stats = await (await fetch(`${http}/stats`)).json();
  assert.equal(stats.published.X509LogEntry + stats.published.PrecertLogEntry, 12);
  assert.equal(stats.clients.lite, 1);
  assert.equal(stats.logs.total, 3);
  assert.equal((await fetch(`${http}/healthz`)).status, 200);
  const page = await fetch(`${http}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /\/app\.js/);
  assert.match((await fetch(`${http}/app.js`)).headers.get('content-type'), /javascript/);
  const head = await fetch(`${http}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.text()).length, 0);
  assert.equal((await fetch(`${http}/stats`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${http}/nope`)).status, 404);
  const refused = new WebSocket(`${ws}/nope`);
  await new Promise((resolve) => {
    refused.onopen = () => assert.fail('an unknown path must not open');
    refused.onerror = resolve;
  });

  for (const c of [lite, full, domains]) c.ws.close();
  await engine.stop();
  await server.stop();
});

test('refuses an unverified tree head in enforce mode and only warns by default', async () => {
  const log = { ...customLog(`static:${mock.base}/d/`), key: heads.static.key, name: 'mock d' };
  for (const verify of ['enforce', 'warn']) {
    const engine = new Engine({ watcher: { pollMs: 100, backfill: 6, partialWaitMs: 0, verify } });
    const warnings = [];
    let published = 0;
    engine.on('warning', (w) => warnings.push(w));
    engine.on('cert', () => { published += 1; });
    engine.start([log]);
    await until(() => engine.watchers[0].stats.signatureFailures >= 1 && (verify === 'enforce' || published >= 6));
    await sleep(300);
    assert.equal(published, verify === 'enforce' ? 0 : 6, verify);
    assert.ok(warnings.some((w) => w.includes('signature')), verify);
    await engine.stop();
  }
});

test('saves positions, resumes from them, and jumps ahead when too far behind', async () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'tayyar-')), 'state.json');
  const logs = [customLog(`rfc6962:${mock.base}/a/`)];

  const first = new Engine({ watcher: { pollMs: 100, backfill: 6 }, stateFile });
  let n1 = 0;
  first.on('cert', () => { n1 += 1; });
  first.start(logs);
  await until(() => n1 === 6);
  await first.stop();
  const positions = await loadState(stateFile);
  assert.equal(positions[logs[0].url], RFC_SIZE);

  const resumed = new Engine({ watcher: { pollMs: 100, backfill: 6 } });
  let n2 = 0;
  resumed.on('cert', () => { n2 += 1; });
  resumed.start(logs, positions);
  await sleep(500);
  assert.equal(n2, 0, 'nothing is read twice after a restart');
  await resumed.stop();

  const behind = new Engine({ watcher: { pollMs: 100, maxLag: 100 } });
  let n3 = 0;
  behind.on('cert', () => { n3 += 1; });
  behind.start(logs, { [logs[0].url]: 0 });
  await until(() => behind.stats.skipped > 0);
  assert.equal(behind.stats.skipped, RFC_SIZE);
  assert.equal(n3, 0);
  await behind.stop();
  assert.deepEqual(await loadState(join(tmpdir(), 'tayyar-no-such-file.json')), {});
});
