// The command line: `tayyar serve`, `tayyar watch`, `tayyar logs`.

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLogs, customLog, GOOGLE_LOG_LIST, DEFAULT_STATES } from './loglist.js';
import { Engine, loadState } from './engine.js';
import { StreamServer } from './server.js';
import { Monitor } from './monitor.js';
import { Watchlist } from './watchlist.js';
import { detectNames, detectDomain } from './detect.js';
import { parseHook } from './notify.js';
import { hostFrom } from './api.js';
import { buildMatcher } from './filter.js';
import { liteMessage, fullMessage } from './format.js';
import { unicodeDomain } from './x509.js';
import { getJson, getText } from './http.js';
import { verifySth, parseCheckpoint, verifyCheckpoint } from './sth.js';
import { VERSION } from './version.js';
import { shortLogName, issuerName } from '../web/names.js';

export const HELP = `tayyar ${VERSION}
Live stream of TLS certificates from Certificate Transparency logs.

Usage
  tayyar serve [options]              Run the interface, the API and the streams
  tayyar watch [options]              Print certificates in the terminal as they are logged
  tayyar check [options] <name>...    Test names against a watchlist file
  tayyar logs  [options]              List the logs Tayyar would read

Serve
  --host <address>          Address to listen on (default 127.0.0.1, or $HOST)
  --port <n>                Port to listen on (default 4000, or $PORT)
  --data <dir>              Keep the watchlist, alerts and log positions in this folder
  --token <secret>          Require this access token (or set $TAYYAR_TOKEN)
  --webhook <url>           Post new alerts here, as json:URL or text:URL (repeatable)
  --webhook-min <level>     Lowest severity to post: low, medium (default) or high
  --webhook-secret <s>      Sign webhook bodies with HMAC SHA-256
  --resolve                 Look up the DNS records of every new alert
  --history <n>             Certificates kept for search (default 500000)
  --state <file>            Save each log's position here (default: in --data)
  --max-clients <n>         WebSocket clients allowed at once (default 1000)
  --max-per-ip <n>          WebSocket clients allowed per address (default 20)
  --trust-proxy             Read client addresses from X-Forwarded-For

Watch
  --watchlist <file>        Print certificates that imitate a watched brand
  --match <regex>           Keep certificates with a name matching this (repeatable)
  --keyword <words>         Keep names containing one of these words, comma separated (repeatable)
  --format <name>           text (default), json, full or domains
  --limit <n>               Stop after printing this many certificates
  --duration <seconds>      Stop after this long
  --state <file>            As for serve
  --no-color                Plain text output

Check
  --watchlist <file>        The watchlist to test against (required)
  --json                    Print the findings as JSON

Logs
  --probe                   Read each log's tree size and check its signature
  --json                    Print the list as JSON

Choosing logs, for every command
  --log-list <url|none>     Log list to read (default: Google's list of trusted CT logs)
  --log <kind:url>          Add a log as rfc6962:URL or static:URL (repeatable)
  --only <regex>            Keep only logs whose name or URL matches
  --exclude <regex>         Drop logs whose name or URL matches
  --states <list>           Log states to include (default usable,qualified)
  --backfill <n>            Start this many entries behind the newest (default 0)
  --max-lag <n>             Jump to the newest entries when further behind (default 100000)
  --concurrency <n>         Requests in flight per log while catching up (default 4)
  --verify <mode>           Tree head signatures: warn (default), enforce or off
  --quiet                   No progress messages on stderr

  -h, --help                Show this help
  -v, --version             Show the version
`;

class UsageError extends Error {}

export const COMMON = {
  'log-list': { type: 'string' },
  log: { type: 'string', multiple: true },
  only: { type: 'string' },
  exclude: { type: 'string' },
  states: { type: 'string' },
  backfill: { type: 'string' },
  'max-lag': { type: 'string' },
  concurrency: { type: 'string' },
  verify: { type: 'string' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export const COMMANDS = {
  serve: {
    host: { type: 'string' },
    port: { type: 'string' },
    data: { type: 'string' },
    token: { type: 'string' },
    webhook: { type: 'string', multiple: true },
    'webhook-min': { type: 'string' },
    'webhook-secret': { type: 'string' },
    resolve: { type: 'boolean' },
    history: { type: 'string' },
    state: { type: 'string' },
    'max-clients': { type: 'string' },
    'max-per-ip': { type: 'string' },
    'trust-proxy': { type: 'boolean' },
  },
  watch: {
    watchlist: { type: 'string' },
    match: { type: 'string', multiple: true },
    keyword: { type: 'string', multiple: true },
    format: { type: 'string' },
    limit: { type: 'string' },
    duration: { type: 'string' },
    state: { type: 'string' },
    'no-color': { type: 'boolean' },
  },
  logs: {
    probe: { type: 'boolean' },
    json: { type: 'boolean' },
  },
  check: {
    watchlist: { type: 'string' },
    json: { type: 'boolean' },
  },
};

function int(values, name, fallback, min, max) {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
  return n;
}

function regex(values, name) {
  if (values[name] === undefined) return null;
  try {
    return new RegExp(values[name], 'i');
  } catch (err) {
    throw new UsageError(`--${name} is not a valid regular expression: ${err.message}`);
  }
}

function stderr(values, msg) {
  if (!values.quiet) process.stderr.write(`tayyar: ${msg}\n`);
}

// The same warning from a struggling log would otherwise repeat every poll.
function warner(values) {
  const last = new Map();
  return (msg) => {
    const now = Date.now();
    if (now - (last.get(msg) || 0) < 5 * 60 * 1000) return;
    last.set(msg, now);
    stderr(values, `warning: ${msg}`);
  };
}

function watcherOptions(values) {
  const verify = values.verify ?? 'warn';
  if (!['warn', 'enforce', 'off'].includes(verify)) throw new UsageError('--verify must be warn, enforce or off');
  return {
    backfill: int(values, 'backfill', 0, 0, 10000000),
    maxLag: int(values, 'max-lag', 100000, 1, 1000000000),
    concurrency: int(values, 'concurrency', 4, 1, 16),
    verify,
  };
}

async function selectLogs(values) {
  const only = regex(values, 'only');
  const exclude = regex(values, 'exclude');
  const states = values.states ? values.states.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_STATES;
  const listUrl = values['log-list'] || GOOGLE_LOG_LIST;
  let logs = [];
  if (listUrl !== 'none') {
    try {
      logs = await loadLogs({ url: listUrl, states });
    } catch (err) {
      throw new Error(`the log list at ${listUrl} could not be read: ${err.message}`);
    }
  }
  for (const spec of values.log || []) {
    try {
      logs.push(customLog(spec));
    } catch (err) {
      throw new UsageError(err.message);
    }
  }
  if (only) logs = logs.filter((l) => only.test(l.name) || only.test(l.url));
  if (exclude) logs = logs.filter((l) => !(exclude.test(l.name) || exclude.test(l.url)));
  if (logs.length === 0) throw new UsageError('no logs selected, check --only, --exclude, --states and --log');
  return logs;
}

function describe(logs) {
  const rfc = logs.filter((l) => l.kind === 'rfc6962').length;
  return `${logs.length} logs (${rfc} RFC 6962, ${logs.length - rfc} static CT)`;
}

function onSignals(stop) {
  let count = 0;
  const handler = () => {
    count += 1;
    if (count > 1) process.exit(130);
    stop();
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

async function serve(values) {
  const port = int({ port: values.port ?? process.env.PORT }, 'port', 4000, 0, 65535);
  const host = values.host || process.env.HOST || '127.0.0.1';
  const minSeverity = values['webhook-min'] ?? 'medium';
  if (!['low', 'medium', 'high'].includes(minSeverity)) throw new UsageError('--webhook-min must be low, medium or high');
  let hooks;
  try {
    hooks = (values.webhook || []).map(parseHook);
  } catch (err) {
    throw new UsageError(err.message);
  }
  const token = values.token || process.env.TAYYAR_TOKEN || null;
  if (token !== null && token.length < 12) throw new UsageError('the access token needs at least 12 characters');
  const logs = await selectLogs(values);
  const stateFile = values.state || (values.data ? join(values.data, 'state.json') : undefined);
  const monitor = new Monitor({
    dataDir: values.data || null,
    historySize: int(values, 'history', 500000, 1000, 10000000),
    hooks,
    minSeverity,
    secret: values['webhook-secret'] || null,
    resolve: Boolean(values.resolve),
  });
  monitor.on('warning', warner(values));
  await monitor.load();
  const positions = await loadState(stateFile);
  const engine = new Engine({ watcher: watcherOptions(values), stateFile });
  engine.on('warning', warner(values));
  monitor.attach(engine);
  const server = new StreamServer(engine, {
    host,
    port,
    monitor,
    token,
    maxClients: int(values, 'max-clients', 1000, 1, 100000),
    maxPerIp: int(values, 'max-per-ip', 20, 1, 100000),
    trustProxy: Boolean(values['trust-proxy']),
  });
  const addr = await server.start();
  engine.start(logs, positions);
  const shown = addr.host.includes(':') ? `[${addr.host}]` : addr.host;
  stderr(values, `${VERSION} reading ${describe(logs)}`);
  stderr(values, `interface and streams at http://${shown}:${addr.port}/`);
  if (!values.data) stderr(values, 'the watchlist and alerts live in memory only, add --data <dir> to keep them');
  if (!token && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    stderr(values, 'warning: anyone who can reach this address can change the watchlist, set --token or TAYYAR_TOKEN');
  }
  onSignals(async () => {
    stderr(values, 'stopping');
    await engine.stop();
    await server.stop();
    process.exit(0);
  });
}

const ANSI = { dim: '\x1b[2m', bold: '\x1b[1m', amber: '\x1b[33m', aqua: '\x1b[36m', reset: '\x1b[0m' };

export function textLine(cert, hit, color = false) {
  const paint = (code, s) => (color ? `${code}${s}${ANSI.reset}` : s);
  const time = new Date(cert.seen * 1000).toTimeString().slice(0, 8);
  const kind = cert.entryType === 1 ? paint(ANSI.amber, 'pre') : paint(ANSI.aqua, 'crt');
  const domains = cert.parsed.all_domains;
  const primary = hit || domains[0] || cert.parsed.subject.CN || '(no name)';
  const unicode = unicodeDomain(primary);
  const name = unicode !== primary ? `${primary} (${unicode})` : primary;
  const more = domains.length > 1 ? ` +${domains.length - 1}` : '';
  const issuer = issuerName(cert.parsed.issuer);
  return `${paint(ANSI.dim, time)}  ${kind}  ${paint(ANSI.bold, name)}${more}  ${paint(ANSI.dim, `${issuer}  ${shortLogName(cert.log.name)}`)}`;
}

async function watch(values) {
  const format = values.format || 'text';
  if (!['text', 'json', 'full', 'domains'].includes(format)) throw new UsageError('--format must be text, json, full or domains');
  let matcher;
  try {
    matcher = buildMatcher({ patterns: values.match || [], keywords: values.keyword || [] });
  } catch (err) {
    throw new UsageError(`--match is not a valid regular expression: ${err.message}`);
  }
  const limit = int(values, 'limit', 0, 0, Number.MAX_SAFE_INTEGER);
  const duration = int(values, 'duration', 0, 0, 31536000);
  const watchlist = values.watchlist ? readWatchlist(values.watchlist) : null;
  const logs = await selectLogs(values);
  const positions = await loadState(values.state);
  const color = format === 'text' && process.stdout.isTTY && !values['no-color'] && !process.env.NO_COLOR;
  const engine = new Engine({ watcher: watcherOptions(values), stateFile: values.state });
  engine.on('warning', warner(values));

  let read = 0;
  let printed = 0;
  let dropped = 0;
  let stopping = false;
  const started = Date.now();

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await engine.stop();
    const secs = Math.round((Date.now() - started) / 1000);
    const matched = matcher ? `, ${printed} matched` : '';
    const lost = dropped ? `, ${dropped} lines dropped because the output could not keep up` : '';
    stderr(values, `read ${read} certificates in ${secs}s${matched}${lost}`);
    process.stdout.write('', () => process.exit(0));
  };

  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') {
      values.quiet = true;
      stop();
    }
  });

  engine.on('cert', (cert) => {
    if (stopping) return;
    read += 1;
    const hit = matcher ? matcher(cert.parsed.all_domains) : null;
    const findings = watchlist ? detectNames(cert.parsed.all_domains, watchlist.compiled) : [];
    if ((matcher || watchlist) && !hit && !findings.length) return;
    // A slow reader on the other end of a pipe should not grow memory without limit.
    if (process.stdout.writableLength > 16 * 1024 * 1024) {
      dropped += 1;
      return;
    }
    let out;
    if (format === 'json') out = JSON.stringify(findings.length ? { ...liteMessage(cert), findings } : liteMessage(cert));
    else if (format === 'full') out = JSON.stringify(findings.length ? { ...fullMessage(cert), findings } : fullMessage(cert));
    else if (format === 'domains') out = cert.parsed.all_domains.join('\n');
    else out = findings.length ? findings.map((f) => findingLine(f, cert, color)).join('\n') : textLine(cert, hit, color);
    if (out) process.stdout.write(`${out}\n`);
    printed += 1;
    if (limit && printed >= limit) stop();
  });

  engine.start(logs, positions);
  stderr(values, `${VERSION} reading ${describe(logs)}${matcher ? ', printing matches only' : ''}, Ctrl+C stops`);
  if (duration) setTimeout(stop, duration * 1000).unref();
  onSignals(stop);
}

function readWatchlist(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UsageError(`the watchlist ${file} could not be read: ${err.message}`);
  }
  const list = new Watchlist();
  try {
    list.replace(Array.isArray(data) ? data : data.items || [], false);
  } catch (err) {
    throw new UsageError(`the watchlist ${file} is not valid: ${err.message}`);
  }
  if (!list.compiled.size) throw new UsageError(`the watchlist ${file} has no enabled entries`);
  return list;
}

const LEVEL_COLOR = { high: '\x1b[31m', medium: '\x1b[33m', low: '\x1b[2m' };

export function findingLine(f, cert, color = false) {
  const paint = (code, s) => (color ? `${code}${s}${ANSI.reset}` : s);
  const time = cert ? new Date(cert.seen * 1000).toTimeString().slice(0, 8) : '';
  const name = f.unicode ? `${f.domain} (${f.unicode})` : f.domain;
  const level = paint(LEVEL_COLOR[f.severity], `${f.severity} ${f.score}`);
  const tail = cert ? paint(ANSI.dim, `  ${issuerName(cert.parsed.issuer)}  ${shortLogName(cert.log.name)}`) : '';
  return `${time ? `${paint(ANSI.dim, time)}  ` : ''}${level}  ${paint(ANSI.bold, name)}  looks like ${f.watch.name}  (${f.reasons.join(', ')})${tail}`;
}

async function check(values, names) {
  if (!values.watchlist) throw new UsageError('check needs --watchlist <file>');
  if (!names.length) throw new UsageError('give one or more names to check');
  const list = readWatchlist(values.watchlist);
  const results = names.map((n) => {
    const domain = hostFrom(n);
    return { input: n, domain, findings: domain ? detectDomain(domain, list.compiled) : [] };
  });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  for (const r of results) {
    if (!r.findings.length) process.stdout.write(`${r.domain || r.input}  no match\n`);
    for (const f of r.findings) process.stdout.write(`${findingLine(f, null, color)}\n`);
  }
}

async function probe(log) {
  try {
    if (log.kind === 'static') {
      const cp = parseCheckpoint(await getText(`${log.url}checkpoint`, { timeoutMs: 15000 }));
      log.tree_size = cp.treeSize;
      log.signature = log.key ? (verifyCheckpoint(cp, log.key) !== null ? 'valid' : 'invalid') : 'no key';
    } else {
      const sth = await getJson(`${log.url}ct/v1/get-sth`, { timeoutMs: 15000 });
      log.tree_size = sth.tree_size;
      log.signature = log.key ? (verifySth(sth, log.key) ? 'valid' : 'invalid') : 'no key';
    }
  } catch (err) {
    log.error = err.message;
  }
}

async function listLogs(values) {
  const logs = await selectLogs(values);
  if (values.probe) await Promise.all(logs.map(probe));
  if (values.json) {
    process.stdout.write(`${JSON.stringify(logs, null, 2)}\n`);
    return;
  }
  const rows = logs.map((l) => [
    l.kind,
    l.state,
    shortLogName(l.name),
    ...(values.probe ? [l.error ? 'unreachable' : String(l.tree_size), l.error ? '' : l.signature] : []),
    l.url,
  ]);
  const head = ['kind', 'state', 'log', ...(values.probe ? ['tree size', 'signature'] : []), 'url'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
  process.stdout.write(`${line(head)}\n${rows.map(line).join('\n')}\n`);
  stderr(values, describe(logs));
  if (values.probe && logs.some((l) => l.error || l.signature === 'invalid')) process.exitCode = 1;
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (command === '-v' || command === '--version' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!COMMANDS[command]) throw new UsageError(`unknown command "${command}", try tayyar --help`);
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args: rest, options: { ...COMMON, ...COMMANDS[command] }, strict: true, allowPositionals: command === 'check' }));
  } catch (err) {
    throw new UsageError(err.message);
  }
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (command === 'serve') await serve(values);
  else if (command === 'watch') await watch(values);
  else if (command === 'check') await check(values, positionals);
  else await listLogs(values);
}

// Runs the command line and turns failures into exit codes: 2 for a usage
// mistake, 1 for anything else.
export function run(argv) {
  main(argv).catch((err) => {
    process.stderr.write(`tayyar: ${err.message}\n`);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
}
