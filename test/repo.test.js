import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';
import { WEB_FILES } from '../src/server.js';
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

test('every module the page imports is served', () => {
  const app = read('web/app.js');
  const imports = [...app.matchAll(/from '\.\/([\w.-]+)'/g)].map((m) => `/${m[1]}`);
  assert.ok(imports.length >= 3);
  for (const route of ['/app.js', '/app.css', '/favicon.svg', ...imports]) assert.ok(route in WEB_FILES, `${route} is not served`);
  for (const [, [file]] of Object.entries(WEB_FILES)) assert.ok(statSync(join(root, 'web', file)).isFile(), file);
});
