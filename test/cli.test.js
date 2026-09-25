import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HELP, COMMON, COMMANDS, textLine } from '../src/cli.js';
import { VERSION } from '../src/version.js';
import { startMockLogs } from './mock-logs.js';

const bin = fileURLToPath(new URL('../bin/tayyar.js', import.meta.url));

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

let mock;
before(async () => {
  mock = await startMockLogs();
});
after(async () => {
  await mock.close();
});

test('prints its version and help', async () => {
  assert.deepEqual(await run(['--version']), { code: 0, stdout: `${VERSION}\n`, stderr: '' });
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /tayyar serve/);
});

test('documents every option it accepts', () => {
  const options = [...Object.keys(COMMON), ...Object.values(COMMANDS).flatMap((o) => Object.keys(o))];
  for (const name of options) assert.ok(HELP.includes(`--${name}`), `--${name} is missing from --help`);
});

test('exits with 2 on a usage mistake and explains it', async () => {
  const unknownOption = await run(['watch', '--bogus']);
  assert.equal(unknownOption.code, 2);
  assert.match(unknownOption.stderr, /bogus/);
  const unknownCommand = await run(['nope']);
  assert.equal(unknownCommand.code, 2);
  const noLogs = await run(['logs', '--log-list', 'none']);
  assert.equal(noLogs.code, 2);
  assert.match(noLogs.stderr, /no logs selected/);
  const badNumber = await run(['watch', '--log-list', 'none', '--log', `rfc6962:${mock.base}/a/`, '--limit', 'many']);
  assert.equal(badNumber.code, 2);
});

test('lists custom logs as JSON', async () => {
  const r = await run(['logs', '--log-list', 'none', '--log', 'static:https://log.example/2026', '--json', '--quiet']);
  assert.equal(r.code, 0);
  const [log] = JSON.parse(r.stdout);
  assert.equal(log.kind, 'static');
  assert.equal(log.url, 'https://log.example/2026/');
});

test('watches a log, filters, and stops at the limit', async () => {
  const names = await run(['watch', '--log-list', 'none', '--log', `rfc6962:${mock.base}/a/`, '--backfill', '6', '--limit', '4', '--format', 'domains', '--quiet']);
  assert.equal(names.code, 0);
  assert.ok(names.stdout.trim().split('\n').length >= 4);
  const json = await run(['watch', '--log-list', 'none', '--log', `rfc6962:${mock.base}/a/`, '--backfill', '6', '--match', '.', '--limit', '2', '--format', 'json', '--quiet']);
  assert.equal(json.code, 0);
  const lines = json.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((m) => m.message_type === 'certificate_update'));
});

test('prints one readable line per certificate', () => {
  const cert = {
    seen: Date.UTC(2026, 8, 25, 9, 30, 0) / 1000,
    entryType: 1,
    parsed: { all_domains: ['xn--mgbh0fb.example', 'b.example'], subject: { CN: null }, issuer: { O: "Let's Encrypt", CN: 'YE2' } },
    log: { name: "Let's Encrypt 'Sycamore2026h2'" },
  };
  assert.match(textLine(cert, null, false), /^\d\d:\d\d:\d\d {2}pre {2}xn--mgbh0fb\.example \(مثال\.example\) \+1 {2}Let's Encrypt YE2 {2}Sycamore2026h2$/);
});
