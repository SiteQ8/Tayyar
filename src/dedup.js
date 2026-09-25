// Every certificate is logged in two or three logs, so the same bytes arrive
// several times within seconds or minutes. The first copy is published and
// later copies inside the window are dropped.

export class Dedup {
  constructor({ ttlMs = 15 * 60 * 1000, max = 500000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map(); // key -> first seen time; insertion order is time order
  }

  // Returns true the first time a key is seen inside the window.
  firstSeen(key) {
    const t = this.now();
    this.sweep(t);
    const at = this.map.get(key);
    if (at !== undefined && t - at < this.ttlMs) return false;
    if (at !== undefined) this.map.delete(key);
    this.map.set(key, t);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return true;
  }

  sweep(t = this.now()) {
    for (const [key, at] of this.map) {
      if (t - at < this.ttlMs) break;
      this.map.delete(key);
    }
  }

  get size() {
    return this.map.size;
  }
}
