// Behaviour shared by both watcher types: the polling rhythm, backoff on
// errors, and the status each watcher reports to /stats.

import { EventEmitter } from 'node:events';
import { HttpError } from './http.js';

export const WATCHER_DEFAULTS = {
  pollMs: 5000, // how often to ask a busy log for its tree size
  idlePollMaxMs: 60000, // ceiling when a log has not grown for a while
  backfill: 0, // entries to read behind the tip on first start
  maxLag: 100000, // beyond this many entries behind, jump to the tip
  concurrency: 4, // requests in flight per log while catching up
  verify: 'warn', // tree head signatures: "warn", "enforce" or "off"
  timeoutMs: 20000,
};

export class BaseWatcher extends EventEmitter {
  constructor(log, opts = {}) {
    super();
    this.log = log;
    this.opts = { ...WATCHER_DEFAULTS, ...opts };
    this.next = Number.isSafeInteger(opts.start) ? opts.start : null;
    this.treeSize = null;
    this.running = false;
    this.pollMs = this.opts.pollMs;
    this.errorBackoffMs = 0;
    this.controller = new AbortController();
    this.timer = null;
    this.wake = null;
    this.stats = {
      state: 'starting',
      processed: 0,
      skipped: 0,
      errors: 0,
      signatureFailures: 0,
      lastSuccess: null,
      lastError: null,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop().catch((err) => {
      this.stats.state = 'stopped';
      this.stats.lastError = String(err?.message || err);
      this.emit('warning', `${this.log.name}: watcher stopped: ${this.stats.lastError}`);
    });
  }

  stop() {
    this.running = false;
    this.controller.abort(new Error('stopped'));
    clearTimeout(this.timer);
    if (this.wake) this.wake();
  }

  sleep(ms) {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(resolve, ms);
    });
  }

  // Sets the starting point on first contact, and jumps to the tip when the
  // log has run too far ahead to catch up in real time.
  position(treeSize) {
    this.treeSize = treeSize;
    if (this.next === null || this.next > treeSize) {
      this.next = Math.max(0, treeSize - this.opts.backfill);
    }
    const lag = treeSize - this.next;
    if (lag > this.opts.maxLag) {
      this.stats.skipped += lag;
      this.emit('skip', { log: this.log, from: this.next, to: treeSize, count: lag });
      this.next = treeSize;
    }
  }

  signatureChecked(ok) {
    if (ok) return true;
    this.stats.signatureFailures += 1;
    this.emit('warning', `${this.log.name}: tree head signature did not verify`);
    return this.opts.verify !== 'enforce';
  }

  succeeded(grew) {
    this.stats.state = 'ok';
    this.stats.lastSuccess = Date.now();
    this.errorBackoffMs = 0;
    // Busy logs are polled at the base rate. Quiet logs are polled less
    // often, up to the ceiling, and snap back as soon as they grow.
    this.pollMs = grew ? this.opts.pollMs : Math.min(this.opts.idlePollMaxMs, Math.round(this.pollMs * 1.5));
  }

  failed(err) {
    this.stats.errors += 1;
    this.stats.lastError = String(err?.message || err);
    const transient = !(err instanceof HttpError) || err.transient;
    const base = transient ? 2000 : 30000;
    const retryAfter = err instanceof HttpError && err.retryAfter ? err.retryAfter * 1000 : 0;
    this.errorBackoffMs = Math.min(120000, Math.max(retryAfter, this.errorBackoffMs ? this.errorBackoffMs * 2 : base));
    this.stats.state = 'backoff';
  }

  get delay() {
    return this.errorBackoffMs || this.pollMs;
  }

  status() {
    return {
      name: this.log.name,
      operator: this.log.operator,
      kind: this.log.kind,
      url: this.log.url,
      tree_size: this.treeSize,
      next_index: this.next,
      lag: this.treeSize !== null && this.next !== null ? this.treeSize - this.next : null,
      ...this.stats,
    };
  }
}
