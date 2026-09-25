// The engine owns the watchers. It removes duplicates across logs, parses
// each new certificate once, and emits it to whoever is listening: the
// WebSocket server, or the command line watcher.

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { Dedup } from './dedup.js';
import { IssuerCache } from './issuers.js';
import { Rfc6962Watcher } from './watch-rfc6962.js';
import { StaticWatcher } from './watch-static.js';
import { parseCertificate, fingerprints } from './x509.js';

export class Engine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.dedup = new Dedup({ ttlMs: opts.dedupTtlMs });
    this.issuers = new IssuerCache();
    this.watchers = [];
    this.startedAt = null;
    this.stats = { certificates: 0, precertificates: 0, duplicates: 0, unreadable: 0, skipped: 0 };
    this.rate = { windowStart: Date.now(), count: 0, perSecond: 0 };
    this.saveTimer = null;
  }

  // `logs` are descriptors from loglist.js. `positions` maps a log URL to the
  // next index to read, as saved by a previous run.
  start(logs, positions = {}) {
    this.startedAt = Date.now();
    for (const log of logs) {
      const opts = {
        ...this.opts.watcher,
        start: positions[log.url],
        issuers: this.issuers,
      };
      const w = log.kind === 'static' ? new StaticWatcher(log, opts) : new Rfc6962Watcher(log, opts);
      w.on('entry', (e) => this.handle(e));
      w.on('warning', (msg) => this.emit('warning', msg));
      w.on('skip', (s) => {
        this.stats.skipped += s.count;
        this.emit('warning', `${s.log.name}: ${s.count} entries behind, jumped to the newest entries`);
      });
      this.watchers.push(w);
      w.start();
    }
    if (this.opts.stateFile) {
      this.saveTimer = setInterval(() => this.saveState().catch((err) => this.emit('warning', `state not saved: ${err.message}`)), 30000);
      this.saveTimer.unref();
    }
  }

  handle(e) {
    const digest = createHash('sha256').update(e.der).digest('latin1');
    if (!this.dedup.firstSeen(digest)) {
      this.stats.duplicates += 1;
      return;
    }
    let parsed;
    try {
      parsed = parseCertificate(e.der);
    } catch {
      this.stats.unreadable += 1;
      return;
    }
    if (e.entryType === 1) this.stats.precertificates += 1;
    else this.stats.certificates += 1;
    this.tick();
    this.emit('cert', {
      log: e.log,
      index: e.index,
      link: e.link,
      timestamp: e.timestamp,
      entryType: e.entryType,
      der: e.der,
      chain: e.chain || [],
      parsed,
      fingerprints: fingerprints(e.der),
      seen: Date.now() / 1000,
    });
  }

  tick() {
    const now = Date.now();
    this.rate.count += 1;
    const elapsed = now - this.rate.windowStart;
    if (elapsed >= 5000) {
      this.rate.perSecond = Math.round((this.rate.count * 1000) / elapsed);
      this.rate.count = 0;
      this.rate.windowStart = now;
    }
  }

  status() {
    const watchers = this.watchers.map((w) => w.status());
    return {
      started_at: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      uptime_seconds: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      certificates_per_second: this.rate.perSecond,
      published: { X509LogEntry: this.stats.certificates, PrecertLogEntry: this.stats.precertificates },
      duplicates_dropped: this.stats.duplicates,
      unreadable_entries: this.stats.unreadable,
      entries_skipped_to_stay_live: this.stats.skipped,
      issuers_cached: this.issuers.certs.size,
      logs: {
        total: watchers.length,
        healthy: watchers.filter((w) => w.state === 'ok').length,
        list: watchers,
      },
    };
  }

  positions() {
    const out = {};
    for (const w of this.watchers) if (w.next !== null) out[w.log.url] = w.next;
    return out;
  }

  async saveState() {
    if (!this.opts.stateFile) return;
    const tmp = `${this.opts.stateFile}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, saved_at: new Date().toISOString(), positions: this.positions() }, null, 2));
    await rename(tmp, this.opts.stateFile);
  }

  async stop() {
    clearInterval(this.saveTimer);
    for (const w of this.watchers) w.stop();
    await this.saveState().catch(() => {});
  }
}

export async function loadState(file) {
  if (!file) return {};
  try {
    const state = JSON.parse(await readFile(file, 'utf8'));
    return state && typeof state.positions === 'object' ? state.positions : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`state file ${file} could not be read: ${err.message}`);
  }
}
