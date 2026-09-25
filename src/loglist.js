// Chooses which Certificate Transparency logs to tail, from Google's public
// list of trusted CT logs. The list names both RFC 6962 logs ("logs") and
// static CT logs ("tiled_logs").

import { getJson } from './http.js';

export const GOOGLE_LOG_LIST = 'https://www.gstatic.com/ct/log_list/v3/log_list.json';

// "usable" and "qualified" logs accept new certificates. "readonly",
// "retired" and "rejected" logs no longer grow, so tailing them yields nothing.
export const DEFAULT_STATES = ['usable', 'qualified'];

// A log shard only accepts certificates that expire inside its temporal
// interval. Certificates issued today cannot expire more than a few hundred
// days out, so shards that start later than this receive nothing yet.
export const DEFAULT_HORIZON_DAYS = 400;

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function stateOf(log) {
  return Object.keys(log.state || {})[0] || 'unknown';
}

/**
 * Picks logs from a v3 log list object.
 * Returns plain descriptors that the watchers understand.
 */
export function selectLogs(list, { now = new Date(), states = DEFAULT_STATES, horizonDays = DEFAULT_HORIZON_DAYS } = {}) {
  const horizon = now.getTime() + horizonDays * 86400000;
  const out = [];
  const seen = new Set();
  for (const operator of list.operators || []) {
    const groups = [
      ['rfc6962', operator.logs || []],
      ['static', operator.tiled_logs || []],
    ];
    for (const [kind, logs] of groups) {
      for (const log of logs) {
        const state = stateOf(log);
        if (!states.includes(state)) continue;
        const interval = log.temporal_interval;
        if (interval) {
          const start = Date.parse(interval.start_inclusive);
          const end = Date.parse(interval.end_exclusive);
          if (end <= now.getTime() || start > horizon) continue;
        }
        const url = kind === 'static' ? log.monitoring_url : log.url;
        if (!url || seen.has(log.log_id)) continue;
        seen.add(log.log_id);
        out.push({
          kind,
          name: log.description || url,
          operator: operator.name,
          url: withSlash(url),
          submissionUrl: log.submission_url ? withSlash(log.submission_url) : withSlash(url),
          logId: log.log_id,
          key: log.key,
          mmd: log.mmd,
          state,
          interval: interval ? { start: interval.start_inclusive, end: interval.end_exclusive } : null,
        });
      }
    }
  }
  return out;
}

export async function loadLogs(opts = {}) {
  const list = await getJson(opts.url || GOOGLE_LOG_LIST, { timeoutMs: 30000 });
  return selectLogs(list, opts);
}

/**
 * Parses a custom log given on the command line as "rfc6962:URL" or
 * "static:URL". A bare URL is treated as RFC 6962.
 */
export function customLog(spec) {
  const m = /^(rfc6962|static):(.+)$/.exec(spec);
  const kind = m ? m[1] : 'rfc6962';
  const url = withSlash(m ? m[2] : spec);
  if (!/^https?:\/\//.test(url)) throw new Error(`log URL must start with http:// or https:// (got ${spec})`);
  return {
    kind,
    name: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    operator: 'custom',
    url,
    submissionUrl: url,
    logId: null,
    key: null,
    mmd: null,
    state: 'custom',
    interval: null,
  };
}
