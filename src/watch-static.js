// Tails a static CT log (c2sp.org/static-ct-api): read the signed checkpoint,
// then fetch the data tiles that hold the new entries.
//
// Tiles are immutable and cached by CDNs, which makes these logs cheap to
// read. The spec asks tailing clients to prefer full tiles, so the trailing
// partial tile is fetched only after it has stayed partial for a while.

import { BaseWatcher } from './watcher.js';
import { getText, getBytes, HttpError } from './http.js';
import { parseDataTile } from './leaf.js';
import { dataTileUrl, planTiles, TILE_WIDTH } from './tiles.js';
import { parseCheckpoint, verifyCheckpoint } from './sth.js';
import { IssuerCache } from './issuers.js';

export const STATIC_DEFAULTS = {
  pollMs: 3000,
  partialWaitMs: 15000,
};

export class StaticWatcher extends BaseWatcher {
  constructor(log, opts = {}) {
    super(log, { ...STATIC_DEFAULTS, ...opts });
    this.issuers = opts.issuers || new IssuerCache();
    this.partialTile = null;
    this.partialSince = 0;
    this.tiles = 0;
  }

  async loop() {
    while (this.running) {
      try {
        const text = await getText(`${this.log.url}checkpoint`, { timeoutMs: this.opts.timeoutMs, signal: this.controller.signal });
        const cp = parseCheckpoint(text);
        let trusted = true;
        if (this.log.key && this.opts.verify !== 'off') trusted = this.signatureChecked(verifyCheckpoint(cp, this.log.key) !== null);
        if (trusted) {
          const before = this.next;
          this.position(cp.treeSize);
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

  wantPartial(now = Date.now()) {
    const tail = this.treeSize % TILE_WIDTH;
    if (tail === 0 || this.next >= this.treeSize) return false;
    const tile = Math.floor(this.treeSize / TILE_WIDTH);
    if (this.partialTile !== tile) {
      this.partialTile = tile;
      this.partialSince = now;
    }
    return now - this.partialSince >= this.opts.partialWaitMs;
  }

  async fetchTile(t) {
    const buf = await getBytes(dataTileUrl(this.log.url, t.n, t.width), { timeoutMs: this.opts.timeoutMs, signal: this.controller.signal });
    const leaves = parseDataTile(buf);
    if (leaves.length !== t.width) throw new Error(`tile ${t.n} holds ${leaves.length} entries, expected ${t.width}`);
    const first = leaves[0].leafIndex;
    if (first !== null && first !== t.n * TILE_WIDTH) throw new Error(`tile ${t.n} starts at index ${first}`);
    return leaves;
  }

  async catchUp() {
    const plan = planTiles(this.next, this.treeSize, this.wantPartial());
    for (let i = 0; i < plan.length && this.running; i += this.opts.concurrency) {
      const batch = plan.slice(i, i + this.opts.concurrency);
      const results = await Promise.allSettled(batch.map((t) => this.fetchTile(t)));
      for (let k = 0; k < batch.length; k++) {
        const t = batch[k];
        const r = results[k];
        if (r.status === 'rejected') {
          // A partial tile can vanish once its full tile exists. That is not
          // an error: the next checkpoint will cover the full tile.
          if (t.width < TILE_WIDTH && r.reason instanceof HttpError && r.reason.status === 404) return;
          throw r.reason;
        }
        await this.publish(t, r.value);
        this.next = t.n * TILE_WIDTH + t.width;
        this.tiles += 1;
      }
    }
  }

  async publish(t, leaves) {
    const wanted = leaves.slice(t.skip);
    await this.issuers.ensure(this.log.url, wanted.flatMap((l) => l.chainFingerprints), this.controller.signal);
    const link = dataTileUrl(this.log.url, t.n, t.width);
    for (let i = 0; i < wanted.length; i++) {
      const leaf = wanted[i];
      this.stats.processed += 1;
      this.emit('entry', {
        log: this.log,
        index: t.n * TILE_WIDTH + t.skip + i,
        timestamp: leaf.timestamp,
        entryType: leaf.entryType,
        der: leaf.der,
        chain: this.issuers.chain(leaf.chainFingerprints),
        link,
      });
    }
  }

  status() {
    return { ...super.status(), tiles_read: this.tiles };
  }
}
