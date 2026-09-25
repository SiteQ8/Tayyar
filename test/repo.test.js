import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';
import { webFiles } from '../src/server.js';
import { FIELDS } from './fields.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const BINARY = new Set(['.bin', '.der', '.png', '.ico']);

function files(dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (!BINARY.has(extname(name))) out.push(p);
  }
  return out;
}

test('package.json, the code and the changelog agree on the version', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, VERSION);
  assert.match(read('CHANGELOG.md'), new RegExp(`## ${VERSION.replace(/\./g, '\\.')} `));
  assert.ok(read(pkg.bin.tayyar).startsWith('#!/usr/bin/env node\n'));
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'Tayyar has no runtime dependencies');
});

test('no file uses an en dash or an em dash', () => {
  for (const f of files()) {
    const text = readFileSync(f, 'utf8');
    const i = text.search(/[\u2013\u2014]/);
    assert.equal(i, -1, `${f.slice(root.length)} has a long dash near: ${text.slice(Math.max(0, i - 30), i + 10)}`);
  }
});

// Tayyar is described on its own terms. The names of other products it must
// not mention are kept as SHA-256 hashes, so the words themselves never
// appear in the repository.
const UNNAMED = new Set([
  '4164eefb6967131369776ebdae16e22a5aa9713ab6d5eeac5b9a2b4b6fd2ff01',
  'b1a4759d6f2ecca205f46492c68d3ea7be318bf04d2dec39c2d28a45802ae3c7',
  'f6da92f871878f0651619d89afdc2c2d09ffd876574ba441b78e5476e1a9f9b8',
  'edcb8c004146015fd39ca283d710b3ab55c719ee2366b068b185f8121282600d',
  'fab3fc2267272c375b5319a588339041452d751938899cde6da3b116ac570fb4',
  '9b97ac5e767e5393cd0eed09a8e51b6f3775eba38f792593ea016e8ba9e996b0',
  '6afd038687a96730d65753ed0d292878e819324ab3470585c4558861126be9a5',
]);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

test('names no other product', () => {
  for (const f of files()) {
    const tokens = new Set(readFileSync(f, 'utf8').toLowerCase().match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) || []);
    for (const token of tokens) {
      for (const word of [token, ...token.split('.')]) {
        assert.ok(!UNNAMED.has(sha256(word)), `${f.slice(root.length)} names a product it should not`);
      }
    }
  }
});

test('the README documents every message field', () => {
  const readme = read('README.md');
  for (const k of FIELDS.data) assert.ok(readme.includes(`data.${k}`), `data.${k}`);
  for (const k of FIELDS.leaf) assert.ok(readme.includes(`data.leaf_cert.${k}`), `data.leaf_cert.${k}`);
  for (const k of FIELDS.name) assert.ok(readme.includes(`\`${k}\``), k);
});

test('the README has an Arabic section first and an English section after it', () => {
  const readme = read('README.md');
  const arabic = readme.indexOf('<div dir="rtl">');
  const english = readme.indexOf('## What it is');
  assert.ok(arabic > 0 && english > arabic);
});

test('Arabic prose in the README ends each sentence with its only full stop', () => {
  const readme = read('README.md');
  const rtl = [...readme.matchAll(/<div dir="rtl">([\s\S]*?)<\/div>/g)].map((m) => m[1]).join('\n');
  let checked = 0;
  for (const line of rtl.split('\n')) {
    const t = line.trim();
    if (!/^[\u0600-\u06FF*]/.test(t)) continue; // headings, tables and code are not prose
    const prose = t
      .replace(/`[^`]*`/g, 'CODE')
      .replace(/https?:\/\/\S+/g, 'URL')
      .replace(/[\w-]+(?:\.[\w-]+)+/g, 'NAME');
    const stops = [...prose.matchAll(/\./g)].map((m) => m.index);
    for (const i of stops) assert.equal(i, prose.length - 1, `full stop mid-sentence: ${t}`);
    assert.ok(prose.endsWith('.') || prose.endsWith(':'), `sentence without an end: ${t}`);
    checked += 1;
  }
  assert.ok(checked >= 6, 'the Arabic section has prose to check');
});

test('every file the interface loads is served, down to the last import', async () => {
  const served = await webFiles();
  const seen = new Set();
  const visit = (route) => {
    if (seen.has(route)) return;
    seen.add(route);
    assert.ok(served.has(route), `${route} is not served`);
    const body = served.get(route).body.toString('utf8');
    for (const m of body.matchAll(/from '(\.{1,2}\/[\w./-]+)'/g)) visit(new URL(m[1], `http://x${route}`).pathname);
  };
  for (const m of served.get('/').body.toString('utf8').matchAll(/(?:src|href)="(\/[\w./-]*)"/g)) visit(m[1]);
  for (const [route, file] of served) {
    if (!route.endsWith('.css')) continue;
    for (const m of file.body.toString('utf8').matchAll(/url\("?([^")]+)"?\)/g)) {
      if (!m[1].startsWith('data:')) assert.ok(served.has(m[1]), `${route} uses ${m[1]}, which is not served`);
    }
  }
  for (const route of ['/app.js', '/app.css', '/favicon.svg', '/ui.js', '/views/live.js', '/views/alerts.js', '/views/watchlist.js']) {
    assert.ok(seen.has(route), `${route} is never loaded`);
  }
});

test('the Arabic typeface ships with its licence, in the interface and on the site', () => {
  for (const dir of ['web/fonts', 'docs/fonts']) {
    assert.match(read(`${dir}/OFL.txt`), /SIL OPEN FONT LICENSE/i);
    for (const f of ['readex-pro-arabic.woff2', 'readex-pro-latin.woff2']) {
      assert.equal(readFileSync(join(root, dir, f)).subarray(0, 4).toString('latin1'), 'wOF2', `${dir}/${f}`);
    }
  }
});

test('the site is complete in both languages and loads nothing from elsewhere', () => {
  const html = read('docs/index.html');
  assert.equal(read('docs/CNAME').trim(), 'tayyar.3li.info');
  const pairs = [...html.matchAll(/<span class="ar" lang="ar">([^<]*)<\/span><span class="en" lang="en">([^<]*)<\/span>/g)];
  const arabic = (html.match(/class="ar" lang="ar"/g) || []).length;
  assert.equal(arabic, (html.match(/class="en" lang="en"/g) || []).length, 'every Arabic text has its English twin');
  assert.equal(arabic, pairs.length, 'every Arabic text sits right before its English twin');
  assert.ok(pairs.length >= 30);
  for (const [, ar, en] of pairs) {
    assert.ok(ar.trim() && en.trim());
    const prose = ar.replace(/[\w-]+(?:\.[\w-]+)+/g, 'NAME');
    for (const m of prose.matchAll(/\./g)) assert.equal(m.index, prose.length - 1, `full stop mid-sentence: ${ar}`);
  }
  for (const m of read('docs/site.css').matchAll(/url\("?([^")]+)"?\)/g)) {
    assert.ok(!/^[a-z]+:/.test(m[1]), `site.css would load ${m[1]} from elsewhere`);
    assert.ok(statSync(join(root, 'docs', m[1])).isFile(), `${m[1]} is missing`);
  }
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const ref = m[1];
    if (/^https:\/\/(github\.com\/SiteQ8\/Tayyar|tayyar\.3li\.info\/)/.test(ref)) continue;
    assert.ok(!/^[a-z]+:/.test(ref), `${ref} would load from elsewhere`);
    assert.ok(statSync(join(root, 'docs', ref)).isFile(), `${ref} is missing`);
  }
});
