// Tails an RFC 6962 log: read the signed tree head, then fetch every new
// entry with get-entries.
//
// Logs cap how many entries one get-entries call returns, and most cut the
// answer at a page boundary. Google's logs serve 32 per call, most others
// 256. Requests are therefore aligned to the page size and several pages are
// fetched at once while catching up.
//
// The page size is learned from evidence, not from one answer: a log near its
// tip may return a short page simply because the rest is not ready yet. Only
// when two answers in a row stop at the same power of two does the page size
// shrink. Concurrency grows slowly while requests succeed and halves when the
// log answers 429, so a busy log is never pressed harder than it allows.

import { BaseWatcher } from './watcher.js';
import { getJson, HttpError } from './http.js';
import { parseRfc6962Entry } from './leaf.js';
import { verifySth } from './sth.js';

export class Rfc6962Watcher extends BaseWatcher {
  constructor(log, opts = {}) {
    super(log, opts);
    this.maxPage = opts.batchSize || 256;
    this.pageSize = this.maxPage;
    this.inFlight = this.opts.concurrency;
    this.shortPages = [];
    this.goodRounds = 0;
    this.lastProbe = Date.now();
  }

  // Smaller pages justify more requests in flight, within a hard ceiling.
  get inFlightCap() {
    return Math.min(8, this.opts.concurrency * Math.max(1, Math.floor(this.maxPage / this.pageSize)));
  }

  throttle() {
    this.inFlight = Math.max(1, Math.floor(this.inFlight / 2));
    this.goodRounds = 0;
  }

  async loop() {
    while (this.running) {
      try {
        const sth = await getJson(`${this.log.url}ct/v1/get-sth`, { timeoutMs: this.opts.timeoutMs, signal: this.controller.signal });
        if (!Number.isSafeInteger(sth.tree_size)) throw new Error('get-sth returned no tree_size');
        let trusted = true;
        if (this.log.key && this.opts.verify !== 'off') trusted = this.signatureChecked(verifySth(sth, this.log.key));
        if (trusted) {
          const before = this.next;
          this.position(sth.tree_size);
          await this.catchUp();
          this.succeeded(this.next !== before);
        }
      } catch (err) {
        if (!this.running) break;
        this.failed(err);
      }
      if (this.running) await this.sleep(this.delay);
    }
  }

  windows() {
    const out = [];
    let s = this.next;
    for (let k = 0; k < this.inFlight && s < this.treeSize; k++) {
      const pageEnd = (Math.floor(s / this.pageSize) + 1) * this.pageSize - 1;
      const e = Math.min(pageEnd, this.treeSize - 1);
      out.push({ start: s, end: e });
      s = e + 1;
    }
    return out;
  }

  async fetchWindow(w) {
    const url = `${this.log.url}ct/v1/get-entries?start=${w.start}&end=${w.end}`;
    const body = await getJson(url, { timeoutMs: this.opts.timeoutMs, signal: this.controller.signal });
    if (!Array.isArray(body.entries)) throw new Error('get-entries returned no entries array');
    return body.entries;
  }

  async catchUp() {
    // Now and then, try a larger page again in case the log's limit rose.
    if (this.pageSize < this.maxPage && Date.now() - this.lastProbe > 10 * 60 * 1000) {
      this.pageSize = Math.min(this.maxPage, this.pageSize * 2);
      this.lastProbe = Date.now();
    }
    while (this.running && this.next < this.treeSize) {
      const plan = this.windows();
      const results = await Promise.allSettled(plan.map((w) => this.fetchWindow(w)));
      let advanced = false;
      let limited = false;
      for (let k = 0; k < plan.length; k++) {
        const w = plan[k];
        const r = results[k];
        if (r.status === 'rejected') {
          if (r.reason instanceof HttpError && r.reason.status === 429) limited = true;
          if (!advanced) {
            if (limited) this.throttle();
            throw r.reason;
          }
          break; // keep what arrived in order, retry the rest next round
        }
        const entries = r.value;
        if (entries.length === 0) {
          if (!advanced) throw new Error('get-entries returned an empty page');
          break;
        }
        const asked = w.end - w.start + 1;
        const got = Math.min(entries.length, asked);
        this.publish(w.start, entries.slice(0, got));
        advanced = true;
        this.next = w.start + got;
        if (got < asked) {
          this.learnPage(got);
          break;
        }
      }
      if (limited) {
        this.throttle();
      } else if (++this.goodRounds >= 20 && this.inFlight < this.inFlightCap) {
        this.inFlight += 1;
        this.goodRounds = 0;
      }
    }
  }

  // A short page is evidence of the log's limit only when it repeats.
  learnPage(got) {
    this.shortPages.push(got);
    if (this.shortPages.length > 2) this.shortPages.shift();
    const [a, b] = this.shortPages;
    if (this.shortPages.length === 2 && a === b && a >= 8 && (a & (a - 1)) === 0 && a < this.pageSize) {
      this.pageSize = a;
      this.shortPages = [];
    }
  }

  publish(start, entries) {
    for (let i = 0; i < entries.length; i++) {
      const index = start + i;
      let entry;
      try {
        entry = parseRfc6962Entry(entries[i]);
      } catch (err) {
        this.emit('warning', `${this.log.name}: entry ${index} could not be read: ${err.message}`);
        continue;
      }
      this.stats.processed += 1;
      this.emit('entry', {
        log: this.log,
        index,
        timestamp: entry.timestamp,
        entryType: entry.entryType,
        der: entry.der,
        chain: entry.chain,
        link: `${this.log.url}ct/v1/get-entries?start=${index}&end=${index}`,
      });
    }
  }

  status() {
    return { ...super.status(), page_size: this.pageSize, in_flight: this.inFlight };
  }
}
