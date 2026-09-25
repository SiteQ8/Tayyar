#!/usr/bin/env node
// Checks that run before every release: syntax, secrets, README links, then
// the test suite. `--offline` skips the link check.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const offline = process.argv.includes('--offline');
const BINARY = new Set(['.bin', '.der', '.png', '.ico']);
const failures = [];

function walk(dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const all = walk();
const text = all.filter((f) => !BINARY.has(extname(f)));

// 1. Every script parses.
for (const f of all.filter((f) => /\.m?js$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) failures.push(`syntax error in ${relative(root, f)}\n${r.stderr}`);
}
console.log('syntax: checked');

// 2. No credentials. The patterns are assembled from pieces so this file
// does not match itself.
const SECRETS = [
  ['GitHub token', new RegExp('gh' + '[pousr]_[A-Za-z0-9]{36}')],
  ['GitHub fine-grained token', new RegExp('github' + '_pat_[A-Za-z0-9_]{60,}')],
  ['AWS access key', new RegExp('AK' + 'IA[0-9A-Z]{16}')],
  ['private key', new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----')],
  ['Slack token', new RegExp('xo' + 'x[abprs]-[A-Za-z0-9-]{10,}')],
  ['Stripe key', new RegExp('s' + 'k_(?:live|test)_[0-9a-zA-Z]{16,}')],
];
for (const f of text) {
  const body = readFileSync(f, 'utf8');
  for (const [label, re] of SECRETS) if (re.test(body)) failures.push(`${label} pattern in ${relative(root, f)}`);
}
console.log(`secrets: scanned ${text.length} files`);

// 3. Every link in the README answers.
if (!offline) {
  // Addresses inside code blocks and inline code are examples to copy, not links.
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const urls = [...new Set(readme.match(/https:\/\/[^\s)`'"<>]+/g) || [])];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'tayyar-preflight' } });
      if (!res.ok) failures.push(`README link answered ${res.status}: ${url}`);
    } catch (err) {
      failures.push(`README link unreachable: ${url} (${err.message})`);
    }
  }
  console.log(`links: checked ${urls.length}`);
}

// 4. The tests.
const tests = readdirSync(join(root, 'test')).filter((n) => n.endsWith('.test.js')).map((n) => join(root, 'test', n));
const t = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (t.status !== 0) failures.push('tests failed');

if (failures.length) {
  console.error(`\npreflight failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\npreflight passed');
