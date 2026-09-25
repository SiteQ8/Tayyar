// The watchlist: brands to protect and patterns to watch for. It is kept in
// memory, compiled for the detector on every change, and saved to
// watchlist.json when Tayyar runs with a data directory.

import { EventEmitter } from 'node:events';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { compileWatchlist } from './detect.js';

export class WatchlistError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WatchlistError';
  }
}

export const SEVERITIES = ['low', 'medium', 'high'];

function listOf(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value).split(/[\s,]+/).filter(Boolean);
}

const unique = (a) => [...new Set(a)];

// Validates and cleans one entry. `existing` is the stored entry when editing.
export function normalizeItem(input, existing = null) {
  const kind = existing ? existing.kind : (input.kind ?? 'brand');
  if (!['brand', 'pattern'].includes(kind)) throw new WatchlistError('kind must be brand or pattern');
  const name = String(input.name ?? existing?.name ?? '').trim();
  if (!name || name.length > 80) throw new WatchlistError('a name is required, up to 80 characters');
  const now = new Date().toISOString();
  const item = {
    id: existing?.id || `${kind === 'brand' ? 'b' : 'p'}_${randomBytes(6).toString('hex')}`,
    kind,
    name,
    enabled: input.enabled ?? existing?.enabled ?? true,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (typeof item.enabled !== 'boolean') throw new WatchlistError('enabled must be true or false');
  if (kind === 'brand') {
    const domains = listOf(input.domains ?? existing?.domains).map((d) => {
      const ascii = domainToASCII(d.toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''));
      if (!ascii || !ascii.includes('.') || !/^[a-z0-9.-]+$/.test(ascii)) throw new WatchlistError(`not a domain: ${d}`);
      return ascii;
    });
    const keywords = listOf(input.keywords ?? existing?.keywords).map((k) => k.toLowerCase());
    for (const k of keywords) {
      if ([...k].length < 3 || [...k].length > 40) throw new WatchlistError(`keywords need 3 to 40 characters: ${k}`);
    }
    if (!domains.length && !keywords.length) throw new WatchlistError('add at least one domain or keyword');
    if (domains.length > 20 || keywords.length > 20) throw new WatchlistError('up to 20 domains and 20 keywords per brand');
    item.domains = unique(domains);
    item.keywords = unique(keywords);
  } else {
    const pattern = String(input.pattern ?? existing?.pattern ?? '');
    if (!pattern || pattern.length > 300) throw new WatchlistError('a pattern is required, up to 300 characters');
    try {
      new RegExp(pattern, 'iu');
    } catch (err) {
      throw new WatchlistError(`the pattern is not a valid regular expression: ${err.message}`);
    }
    const severity = input.severity ?? existing?.severity ?? 'medium';
    if (!SEVERITIES.includes(severity)) throw new WatchlistError('severity must be low, medium or high');
    item.pattern = pattern;
    item.severity = severity;
  }
  return item;
}

export class Watchlist extends EventEmitter {
  constructor({ file = null } = {}) {
    super();
    this.file = file;
    this.items = [];
    this.compiled = compileWatchlist([]);
    this.saving = Promise.resolve();
  }

  async load() {
    if (!this.file) return;
    let data;
    try {
      data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw new Error(`the watchlist ${this.file} could not be read: ${err.message}`);
    }
    const items = data.items || [];
    // Entries written by hand may have no id yet; save the ones given now so
    // alerts keep pointing at the same entry after a restart.
    this.replace(items, items.some((i) => !i.id));
    await this.saving;
  }

  replace(items, save = true) {
    if (!Array.isArray(items)) throw new WatchlistError('items must be a list');
    if (items.length > 500) throw new WatchlistError('up to 500 entries');
    this.items = items.map((i) => normalizeItem(i, i.id && i.kind ? { ...i } : null));
    this.changed(save);
    return this.items;
  }

  add(input) {
    if (this.items.length >= 500) throw new WatchlistError('up to 500 entries');
    const item = normalizeItem(input);
    this.items.push(item);
    this.changed();
    return item;
  }

  get(id) {
    return this.items.find((i) => i.id === id) || null;
  }

  update(id, patch) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return null;
    this.items[i] = normalizeItem(patch, this.items[i]);
    this.changed();
    return this.items[i];
  }

  remove(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.changed();
    return true;
  }

  changed(save = true) {
    this.compiled = compileWatchlist(this.items);
    this.emit('change');
    if (save) this.save().catch((err) => this.emit('warning', `watchlist not saved: ${err.message}`));
  }

  toJSON() {
    return { version: 1, items: this.items };
  }

  // Saves one at a time, so quick edits never race on the temporary file.
  save() {
    if (!this.file) return Promise.resolve();
    const write = async () => {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(this.toJSON(), null, 2)}\n`);
      await rename(tmp, this.file);
    };
    this.saving = this.saving.then(write, write);
    return this.saving;
  }
}
