// Connects the stream to the watchlist: every certificate is remembered for
// search, checked against the watchlist, and turned into an alert when it
// imitates a watched brand. New alerts go to the webhooks, and with
// `resolve` on, their names are looked up in DNS to show whether they are live.

import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Resolver } from 'node:dns/promises';
import { Watchlist } from './watchlist.js';
import { AlertStore } from './alerts.js';
import { History } from './history.js';
import { Notifier } from './notify.js';
import { detectNames } from './detect.js';
import { leafCertObject } from './x509.js';
import { shortLogName, issuerName } from '../web/names.js';

export async function lookup(domain, timeoutMs = 4000) {
  const name = domain.replace(/^\*\./, '');
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  const [a, aaaa] = await Promise.allSettled([resolver.resolve4(name), resolver.resolve6(name)]);
  const v4 = a.status === 'fulfilled' ? a.value : [];
  const v6 = aaaa.status === 'fulfilled' ? aaaa.value : [];
  return { checked_at: new Date().toISOString(), resolves: v4.length + v6.length > 0, a: v4, aaaa: v6 };
}

export class Monitor extends EventEmitter {
  constructor({ dataDir = null, historySize = 500000, hooks = [], minSeverity = 'medium', secret = null, resolve = false, lookupFn = lookup } = {}) {
    super();
    this.dataDir = dataDir;
    this.watchlist = new Watchlist({ file: dataDir ? join(dataDir, 'watchlist.json') : null });
    this.alerts = new AlertStore({ file: dataDir ? join(dataDir, 'alerts.jsonl') : null });
    this.history = new History({ max: historySize });
    this.notifier = new Notifier({ hooks, minSeverity, secret });
    this.resolveNew = resolve;
    this.lookupFn = lookupFn;
    this.checked = 0;
    for (const source of [this.watchlist, this.alerts]) source.on('warning', (m) => this.emit('warning', m));
  }

  async load() {
    if (this.dataDir) await mkdir(this.dataDir, { recursive: true });
    await this.watchlist.load();
    await this.alerts.load();
  }

  attach(engine) {
    engine.on('cert', (cert) => this.onCert(cert));
  }

  onCert(cert) {
    this.history.add(cert);
    const findings = detectNames(cert.parsed.all_domains, this.watchlist.compiled);
    if (!findings.length) return;
    const summary = {
      sha256: cert.fingerprints.sha256,
      update_type: cert.entryType === 1 ? 'PrecertLogEntry' : 'X509LogEntry',
      issuer: issuerName(cert.parsed.issuer),
      not_before: cert.parsed.not_before,
      not_after: cert.parsed.not_after,
      all_domains: cert.parsed.all_domains.slice(0, 100),
      log: shortLogName(cert.log.name),
      log_url: cert.log.url,
      cert_index: cert.index,
      cert_link: cert.link,
      leaf: leafCertObject(cert.der, cert.parsed, cert.fingerprints, false),
    };
    for (const f of findings) {
      const { alert, isNew } = this.alerts.record(f, summary);
      if (!isNew) continue;
      this.notifier.send(alert);
      if (this.resolveNew) this.resolve(alert.id).catch(() => {});
    }
  }

  async resolve(id) {
    const alert = this.alerts.get(id);
    if (!alert) return null;
    let dns;
    try {
      dns = await this.lookupFn(alert.domain);
    } catch (err) {
      dns = { checked_at: new Date().toISOString(), resolves: false, a: [], aaaa: [], error: err.message };
    }
    this.checked += 1;
    return this.alerts.setDns(id, dns);
  }
}
