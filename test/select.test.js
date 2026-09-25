import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { domainToASCII, domainToUnicode } from 'node:url';
import { selectLogs, customLog } from '../src/loglist.js';
import { Dedup } from '../src/dedup.js';
import { buildMatcher } from '../src/filter.js';
import { toUnicode } from '../web/punycode.js';

const list = JSON.parse(readFileSync(new URL('./fixtures/log-list.json', import.meta.url), 'utf8'));
const now = new Date('2026-09-25T12:00:00Z');
const names = (logs) => logs.map((l) => l.name).sort();

test('keeps logs that accept certificates today and drops the rest', () => {
  const logs = selectLogs(list, { now });
  assert.deepEqual(names(logs), [
    "Google 'Argon2026h2' log",
    "Google 'Argon2027h1'",
    "Google 'ParcelYard2026h2' log",
    "Google 'ParcelYard2027h2' log",
    "Let's Encrypt 'Sycamore2026h2'",
    "Let's Encrypt 'Willow2027h1'",
    "Geomys 'Tuscolo2026h2'",
    "Sectigo 'Elephant2026h2'",
  ].sort());
  // Retired (Oak, the placeholder), read-only (Mammoth) and far-future shards are left out.
  for (const gone of ['Oak', 'Mammoth', 'Bogus', 'Tuscolo2028h2']) {
    assert.ok(!logs.some((l) => l.name.includes(gone)), gone);
  }
});

test('reads static logs from their monitoring URL and ends every URL with a slash', () => {
  const logs = selectLogs(list, { now });
  const sycamore = logs.find((l) => l.name.includes('Sycamore'));
  assert.equal(sycamore.kind, 'static');
  assert.equal(sycamore.url, 'https://mon.sycamore.ct.letsencrypt.org/2026h2/');
  const argon = logs.find((l) => l.name.includes('Argon2026h2'));
  assert.equal(argon.kind, 'rfc6962');
  for (const l of logs) assert.ok(l.url.endsWith('/') && l.key && l.logId, l.name);
});

test('narrows the horizon and the states on request', () => {
  const soon = selectLogs(list, { now, horizonDays: 60 });
  assert.ok(!soon.some((l) => /2027/.test(l.name)));
  const readOnly = selectLogs(list, { now, states: ['readonly'] });
  assert.deepEqual(names(readOnly), ["Sectigo 'Mammoth2026h2'"]);
});

test('parses custom logs given on the command line', () => {
  assert.deepEqual(
    { kind: customLog('static:https://log.example/2026').kind, url: customLog('static:https://log.example/2026').url },
    { kind: 'static', url: 'https://log.example/2026/' },
  );
  assert.equal(customLog('https://ct.example/log/').kind, 'rfc6962');
  assert.throws(() => customLog('static:ftp://nope'), /http/);
});

test('drops repeats inside the window and forgets them after it', () => {
  let t = 0;
  const d = new Dedup({ ttlMs: 1000, max: 3, now: () => t });
  assert.equal(d.firstSeen('a'), true);
  assert.equal(d.firstSeen('a'), false);
  t = 1500;
  assert.equal(d.firstSeen('a'), true);
  d.firstSeen('b');
  d.firstSeen('c');
  d.firstSeen('d');
  assert.equal(d.size, 3);
});

test('matches keywords, regular expressions and Arabic script in punycode names', () => {
  assert.equal(buildMatcher({}), null);
  const m = buildMatcher({ keywords: ['shop, login'], patterns: ['\\.kw$'] });
  assert.equal(m(['example.com', 'login-shop.example']), 'login-shop.example');
  assert.equal(m(['ministry.gov.kw']), 'ministry.gov.kw');
  assert.equal(m(['example.com']), null);
  const arabic = buildMatcher({ keywords: ['مثال'] });
  assert.equal(arabic(['xn--mgbh0fb.example']), 'xn--mgbh0fb.example');
  assert.throws(() => buildMatcher({ patterns: ['('] }));
});

test('decodes punycode in the page exactly as Node does', () => {
  const samples = ['مثال.example', 'متجر-الكويت.com', 'www.münchen.de', 'bücher.example', '*.مثال.example', 'plain.example'];
  for (const u of samples) {
    const ascii = u.startsWith('*.') ? `*.${domainToASCII(u.slice(2))}` : domainToASCII(u);
    const expected = u.startsWith('*.') ? `*.${domainToUnicode(ascii.slice(2))}` : domainToUnicode(ascii);
    assert.equal(toUnicode(ascii), expected, u);
  }
  assert.equal(toUnicode('xn--!!!.example'), 'xn--!!!.example');
});
