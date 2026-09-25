// Static CT logs name each entry's chain by SHA-256 fingerprint and serve the
// certificates at <prefix>/issuer/<fingerprint>. A few hundred intermediates
// cover the whole web PKI, so each is fetched once and kept.

import { createHash } from 'node:crypto';
import { getBytes } from './http.js';

export class IssuerCache {
  constructor({ max = 4096, retryMs = 5 * 60 * 1000, timeoutMs = 20000 } = {}) {
    this.max = max;
    this.retryMs = retryMs;
    this.timeoutMs = timeoutMs;
    this.certs = new Map(); // fingerprint hex -> DER
    this.failed = new Map(); // fingerprint hex -> time of last failure
    this.pending = new Map(); // fingerprint hex -> promise
    this.fetches = 0;
  }

  get(fp) {
    return this.certs.get(fp) || null;
  }

  async fetchOne(prefix, fp, signal) {
    const lastFail = this.failed.get(fp);
    if (lastFail && Date.now() - lastFail < this.retryMs) return null;
    if (this.pending.has(fp)) return this.pending.get(fp);
    const p = (async () => {
      try {
        this.fetches += 1;
        const der = await getBytes(`${prefix}issuer/${fp}`, { timeoutMs: this.timeoutMs, maxBytes: 64 * 1024, signal });
        if (createHash('sha256').update(der).digest('hex') !== fp) throw new Error('issuer does not match its fingerprint');
        if (this.certs.size >= this.max) this.certs.delete(this.certs.keys().next().value);
        this.certs.set(fp, der);
        this.failed.delete(fp);
        return der;
      } catch {
        this.failed.set(fp, Date.now());
        return null;
      } finally {
        this.pending.delete(fp);
      }
    })();
    this.pending.set(fp, p);
    return p;
  }

  // Makes sure every fingerprint in the list is cached, fetching the missing
  // ones in parallel. Unavailable issuers are simply left out of the chain.
  async ensure(prefix, fingerprints, signal) {
    const missing = [...new Set(fingerprints)].filter((fp) => !this.certs.has(fp));
    await Promise.all(missing.map((fp) => this.fetchOne(prefix, fp, signal)));
  }

  chain(fingerprints) {
    const out = [];
    for (const fp of fingerprints) {
      const der = this.certs.get(fp);
      if (der) out.push(der);
    }
    return out;
  }
}
