// A short memory of recent certificates for search, and hourly figures.
//
// The search window is a ring of compact entries: names, issuer and log are
// kept as small indexes into shared tables, so half a million certificates
// fit in a few tens of megabytes. Figures for the last hour come from one
// counter per minute, so they cover the whole hour whatever the rate.

import { unicodeDomain } from './x509.js';
import { shortLogName, issuerName } from '../web/names.js';

class Interner {
  constructor(max) {
    this.max = max;
    this.values = [];
    this.index = new Map();
  }
  id(value) {
    let i = this.index.get(value);
    if (i === undefined) {
      if (this.values.length >= this.max) return this.max - 1;
      i = this.values.length;
      this.values.push(value);
      this.index.set(value, i);
    }
    return i;
  }
}

export class History {
  constructor({ max = 500000 } = {}) {
    this.max = max;
    this.next = 0;
    this.size = 0;
    this.seen = new Float64Array(max);
    this.index = new Float64Array(max);
    this.names = new Array(max);
    this.meta = new Uint32Array(max); // issuer << 9 | log << 1 | precert
    this.issuers = new Interner(1 << 20);
    this.logs = new Interner(256);
    this.minutes = [];
  }

  add(cert) {
    const i = this.next;
    this.seen[i] = cert.seen;
    this.index[i] = cert.index;
    this.names[i] = cert.parsed.all_domains.slice(0, 50).join(' ');
    const issuer = this.issuers.id(issuerName(cert.parsed.issuer) || '?');
    const log = this.logs.id(shortLogName(cert.log.name));
    this.meta[i] = (issuer << 9) | (log << 1) | (cert.entryType === 1 ? 1 : 0);
    this.next = (i + 1) % this.max;
    if (this.size < this.max) this.size += 1;
    this.count(cert);
  }

  count(cert) {
    const minute = Math.floor(cert.seen / 60);
    let b = this.minutes[this.minutes.length - 1];
    if (!b || b.minute !== minute) {
      b = { minute, total: 0, pre: 0, issuers: new Map(), endings: new Map() };
      this.minutes.push(b);
      while (this.minutes.length > 61) this.minutes.shift();
    }
    b.total += 1;
    if (cert.entryType === 1) b.pre += 1;
    const org = cert.parsed.issuer.O || cert.parsed.issuer.CN || '?';
    b.issuers.set(org, (b.issuers.get(org) || 0) + 1);
    const first = cert.parsed.all_domains[0];
    if (first) {
      const ending = first.slice(first.lastIndexOf('.') + 1);
      b.endings.set(ending, (b.endings.get(ending) || 0) + 1);
    }
  }

  entry(i) {
    const m = this.meta[i];
    return {
      seen: this.seen[i],
      names: this.names[i].split(' '),
      issuer: this.issuers.values[m >>> 9],
      log: this.logs.values[(m >>> 1) & 0xff],
      precert: (m & 1) === 1,
      cert_index: this.index[i],
    };
  }

  search({ q = '', type = 'all', limit = 200 } = {}) {
    const needle = String(q).trim().toLowerCase();
    const items = [];
    for (let k = 1; k <= this.size && items.length < limit; k++) {
      const i = (this.next - k + this.max) % this.max;
      const pre = (this.meta[i] & 1) === 1;
      if ((type === 'pre' && !pre) || (type === 'crt' && pre)) continue;
      if (needle) {
        const names = this.names[i];
        let hit = names.includes(needle);
        if (!hit && names.includes('xn--')) hit = names.split(' ').some((d) => unicodeDomain(d).toLowerCase().includes(needle));
        if (!hit) hit = this.issuers.values[this.meta[i] >>> 9].toLowerCase().includes(needle);
        if (!hit) continue;
      }
      items.push(this.entry(i));
    }
    const oldest = this.size ? this.seen[(this.next - this.size + this.max) % this.max] : null;
    return { items, window: { certificates: this.size, since: oldest } };
  }

  insights(now = Date.now() / 1000) {
    const current = Math.floor(now / 60);
    const perMinute = new Array(60).fill(0);
    const issuers = new Map();
    const endings = new Map();
    let pre = 0;
    let total = 0;
    for (const b of this.minutes) {
      const age = current - b.minute;
      if (age < 0 || age >= 60) continue;
      perMinute[59 - age] = b.total;
      total += b.total;
      pre += b.pre;
      for (const [k, v] of b.issuers) issuers.set(k, (issuers.get(k) || 0) + v);
      for (const [k, v] of b.endings) endings.set(k, (endings.get(k) || 0) + v);
    }
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
    return { per_minute: perMinute, total, split: { pre, crt: total - pre }, top_issuers: top(issuers), top_endings: top(endings) };
  }
}
