// Alerts raised by the watchlist, with their triage state.
//
// Alerts live in memory and, with a data directory, in alerts.jsonl: one
// line per event (a new alert, a repeat, a status change, a DNS check), so
// nothing is rewritten in place and a crash loses at most one line. The file
// is compacted on start when old events outnumber live alerts.

import { EventEmitter } from 'node:events';
import { readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export const STATUSES = ['new', 'acknowledged', 'resolved', 'false_positive'];
const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

export class AlertStore extends EventEmitter {
  constructor({ file = null, max = 10000, repeatWindowMs = 24 * 3600 * 1000 } = {}) {
    super();
    this.file = file;
    this.max = max;
    this.repeatWindowMs = repeatWindowMs;
    this.byId = new Map();
    this.byKey = new Map();
    this.writing = Promise.resolve();
  }

  static key(alert) {
    return `${alert.watch.id}|${alert.domain}`;
  }

  async load() {
    if (!this.file) return;
    let text;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw new Error(`the alerts file ${this.file} could not be read: ${err.message}`);
    }
    let lines = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      lines += 1;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // a torn last line after a crash
      }
      this.apply(ev);
    }
    if (lines > 1000 && lines > this.byId.size * 2) await this.compact();
  }

  apply(ev) {
    if (ev.type === 'alert') {
      this.put(ev.alert);
      return;
    }
    const a = this.byId.get(ev.id);
    if (!a) return;
    if (ev.type === 'repeat') {
      a.count += 1;
      a.last_seen = ev.at;
    } else if (ev.type === 'status') {
      a.status = ev.status;
      a.note = ev.note ?? a.note;
      a.updated_at = ev.at;
    } else if (ev.type === 'dns') {
      a.dns = ev.dns;
    }
  }

  put(alert) {
    this.byId.set(alert.id, alert);
    this.byKey.set(AlertStore.key(alert), alert);
    if (this.byId.size > this.max) {
      const oldest = this.byId.values().next().value;
      this.byId.delete(oldest.id);
      if (this.byKey.get(AlertStore.key(oldest)) === oldest) this.byKey.delete(AlertStore.key(oldest));
    }
  }

  // The line is written as the event stands now, since the alert object
  // keeps changing while earlier writes are still queued.
  persist(ev) {
    if (!this.file) return;
    const line = `${JSON.stringify(ev)}\n`;
    this.writing = this.writing
      .then(() => appendFile(this.file, line))
      .catch((err) => this.emit('warning', `alert not saved: ${err.message}`));
  }

  async compact() {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, [...this.byId.values()].map((alert) => JSON.stringify({ type: 'alert', alert })).join('\n') + '\n');
    await rename(tmp, this.file);
  }

  // Records a finding. The same name for the same watchlist entry within the
  // repeat window counts as a repeat of the open alert rather than a new one,
  // since a precertificate and its certificate usually arrive minutes apart.
  record(finding, cert) {
    const now = new Date().toISOString();
    const key = `${finding.watch.id}|${finding.domain}`;
    const open = this.byKey.get(key);
    if (open && Date.now() - Date.parse(open.created_at) < this.repeatWindowMs) {
      open.count += 1;
      open.last_seen = now;
      this.persist({ type: 'repeat', id: open.id, at: now });
      this.emit('update', open);
      return { alert: open, isNew: false };
    }
    const alert = {
      id: `a_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`,
      created_at: now,
      last_seen: now,
      updated_at: now,
      count: 1,
      status: 'new',
      note: '',
      severity: finding.severity,
      score: finding.score,
      reasons: finding.reasons,
      domain: finding.domain,
      unicode: finding.unicode,
      watch: finding.watch,
      cert,
      dns: null,
    };
    this.put(alert);
    this.persist({ type: 'alert', alert });
    this.emit('alert', alert);
    return { alert, isNew: true };
  }

  update(id, { status, note }) {
    const a = this.byId.get(id);
    if (!a) return null;
    if (status !== undefined && !STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) throw new Error('a note is text up to 1000 characters');
    const at = new Date().toISOString();
    const ev = { type: 'status', id, status: status ?? a.status, note: note ?? a.note, at };
    this.apply(ev);
    this.persist(ev);
    this.emit('update', a);
    return a;
  }

  setDns(id, dns) {
    const a = this.byId.get(id);
    if (!a) return null;
    const ev = { type: 'dns', id, dns };
    this.apply(ev);
    this.persist(ev);
    this.emit('update', a);
    return a;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  list({ status = 'all', severity = 'all', q = '', limit = 200 } = {}) {
    const needle = String(q).trim().toLowerCase();
    const out = [];
    const all = [...this.byId.values()].reverse();
    for (const a of all) {
      if (status !== 'all' && a.status !== status) continue;
      if (severity !== 'all' && SEVERITY_RANK[a.severity] < SEVERITY_RANK[severity]) continue;
      if (needle && !(`${a.domain} ${a.unicode || ''} ${a.watch.name} ${a.cert.issuer}`.toLowerCase().includes(needle))) continue;
      out.push(a);
      if (out.length >= limit) break;
    }
    return out;
  }

  counts() {
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const bySeverity = { high: 0, medium: 0, low: 0 };
    for (const a of this.byId.values()) {
      byStatus[a.status] += 1;
      if (a.status === 'new') bySeverity[a.severity] += 1;
    }
    return { total: this.byId.size, by_status: byStatus, new_by_severity: bySeverity };
  }

  async flush() {
    await this.writing;
  }
}

const CSV_COLUMNS = ['created_at', 'last_seen', 'count', 'status', 'severity', 'score', 'domain', 'unicode', 'watch', 'reasons', 'issuer', 'log', 'cert_index', 'note'];

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function alertsToCsv(alerts) {
  const rows = alerts.map((a) => [
    a.created_at, a.last_seen, a.count, a.status, a.severity, a.score, a.domain, a.unicode, a.watch.name,
    a.reasons.join(' '), a.cert.issuer, a.cert.log, a.cert.cert_index, a.note,
  ]);
  return [CSV_COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
