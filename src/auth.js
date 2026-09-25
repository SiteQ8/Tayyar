// Optional sign-in. With an access token set, every data route, every
// stream and every change needs either the token as a bearer header or a
// session cookie obtained by posting the token. Without a token, Tayyar is
// open to whoever can reach it, which is why it listens on 127.0.0.1 unless
// told otherwise.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'tayyar_session';
const sha = (s) => createHash('sha256').update(String(s)).digest();

export class Auth {
  constructor({ token = null, sessionHours = 12, maxAttempts = 10 } = {}) {
    this.digest = token ? sha(token) : null;
    this.ttlMs = sessionHours * 3600 * 1000;
    this.maxAttempts = maxAttempts;
    this.sessions = new Map();
    this.attempts = new Map();
  }

  get enabled() {
    return this.digest !== null;
  }

  tokenMatches(token) {
    if (!this.digest || typeof token !== 'string' || !token) return false;
    return timingSafeEqual(sha(token), this.digest);
  }

  session(req) {
    const header = req.headers.cookie || '';
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})`).exec(header);
    if (!m) return null;
    const s = this.sessions.get(m[1]);
    if (!s) return null;
    if (Date.now() > s.expires) {
      this.sessions.delete(m[1]);
      return null;
    }
    return s;
  }

  allowed(req) {
    if (!this.enabled) return true;
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ') && this.tokenMatches(h.slice(7))) return true;
    return this.session(req) !== null;
  }

  // Ten wrong tokens a minute from one address, then a pause.
  login(ip, token, secure) {
    if (!this.enabled) return { ok: true, cookie: null };
    const now = Date.now();
    const a = this.attempts.get(ip) || { count: 0, since: now };
    if (now - a.since > 60000) {
      a.count = 0;
      a.since = now;
    }
    if (a.count >= this.maxAttempts) return { ok: false, status: 429, message: 'Too many attempts, wait a minute.' };
    if (!this.tokenMatches(token)) {
      a.count += 1;
      this.attempts.set(ip, a);
      return { ok: false, status: 401, message: 'That token is not right.' };
    }
    this.attempts.delete(ip);
    for (const [id, s] of this.sessions) if (now > s.expires) this.sessions.delete(id);
    const id = randomBytes(32).toString('hex');
    this.sessions.set(id, { expires: now + this.ttlMs });
    return { ok: true, cookie: `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.ttlMs / 1000)}${secure ? '; Secure' : ''}` };
  }

  logout(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})`).exec(req.headers.cookie || '');
    if (m) this.sessions.delete(m[1]);
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}
