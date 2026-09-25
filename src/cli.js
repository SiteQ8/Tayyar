// The command line: `tayyar serve`, `tayyar watch`, `tayyar logs`.

import { parseArgs } from 'node:util';
import { loadLogs, customLog, GOOGLE_LOG_LIST, DEFAULT_STATES } from './loglist.js';
import { Engine, loadState } from './engine.js';
import { StreamServer } from './server.js';
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
  tayyar serve [options]    Serve the stream over WebSocket, with a live viewer page
  tayyar watch [options]    Print certificates in the terminal as they are logged
  tayyar logs  [options]    List the logs Tayyar would read

Serve
  --host <address>          Address to listen on (default 127.0.0.1, or $HOST)
  --port <n>                Port to listen on (default 4000, or $PORT)
  --state <file>            Save each log's position here and resume from it
  --max-clients <n>         WebSocket clients allowed at once (default 1000)
  --max-per-ip <n>          WebSocket clients allowed per address (default 20)
  --trust-proxy             Read client addresses from X-Forwarded-For

Watch
  --match <regex>           Keep certificates with a name matching this (repeatable)
  --keyword <words>         Keep names containing one of these words, comma separated (repeatable)
  --format <name>           text (default), json, full or domains
  --limit <n>               Stop after printing this many certificates
  --duration <seconds>      Stop after this long
  --state <file>            As for serve
  --no-color                Plain text output

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
    state: { type: 'string' },
    'max-clients': { type: 'string' },
    'max-per-ip': { type: 'string' },
    'trust-proxy': { type: 'boolean' },
  },
  watch: {
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
  const logs = await selectLogs(values);
  const port = int({ port: values.port ?? process.env.PORT }, 'port', 4000, 0, 65535);
  const host = values.host || process.env.HOST || '127.0.0.1';
  const positions = await loadState(values.state);
  const engine = new Engine({ watcher: watcherOptions(values), stateFile: values.state });
  engine.on('warning', warner(values));
  const server = new StreamServer(engine, {
    host,
    port,
    maxClients: int(values, 'max-clients', 1000, 1, 100000),
    maxPerIp: int(values, 'max-per-ip', 20, 1, 100000),
    trustProxy: Boolean(values['trust-proxy']),
  });
  const addr = await server.start();
  engine.start(logs, positions);
  const shown = addr.host.includes(':') ? `[${addr.host}]` : addr.host;
  stderr(values, `${VERSION} reading ${describe(logs)}`);
  stderr(values, `viewer and WebSocket stream at http://${shown}:${addr.port}/`);
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
    if (matcher && !hit) return;
    // A slow reader on the other end of a pipe should not grow memory without limit.
    if (process.stdout.writableLength > 16 * 1024 * 1024) {
      dropped += 1;
      return;
    }
    let out;
    if (format === 'json') out = JSON.stringify(liteMessage(cert));
    else if (format === 'full') out = JSON.stringify(fullMessage(cert));
    else if (format === 'domains') out = cert.parsed.all_domains.join('\n');
    else out = textLine(cert, hit, color);
    if (out) process.stdout.write(`${out}\n`);
    printed += 1;
    if (limit && printed >= limit) stop();
  });

  engine.start(logs, positions);
  stderr(values, `${VERSION} reading ${describe(logs)}${matcher ? ', printing matches only' : ''}, Ctrl+C stops`);
  if (duration) setTimeout(stop, duration * 1000).unref();
  onSignals(stop);
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
  try {
    ({ values } = parseArgs({ args: rest, options: { ...COMMON, ...COMMANDS[command] }, strict: true, allowPositionals: false }));
  } catch (err) {
    throw new UsageError(err.message);
  }
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (command === 'serve') await serve(values);
  else if (command === 'watch') await watch(values);
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
