// Sends new alerts to webhooks. Each hook gets either the full alert as JSON
// or a short {"text": ...} message, which chat tools with incoming webhooks
// accept. With a secret, every body is signed with HMAC SHA-256 in the
// x-tayyar-signature header so the receiver can check it came from Tayyar.

import { createHmac } from 'node:crypto';
import { USER_AGENT } from './http.js';

const RANK = { low: 1, medium: 2, high: 3 };
const RETRY_MS = [0, 5000, 30000];

export function parseHook(spec) {
  const m = /^(json|text):(.+)$/.exec(spec);
  const format = m ? m[1] : 'json';
  const url = m ? m[2] : spec;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a webhook URL: ${spec}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`a webhook must use http or https: ${spec}`);
  return { format, url: parsed.href };
}

export function alertText(alert) {
  const name = alert.unicode ? `${alert.domain} (${alert.unicode})` : alert.domain;
  return `[${alert.severity}] ${name} looks like ${alert.watch.name}, score ${alert.score} (${alert.reasons.join(', ')}), issued by ${alert.cert.issuer}`;
}

export class Notifier {
  constructor({ hooks = [], minSeverity = 'medium', secret = null, timeoutMs = 10000, retryMs = RETRY_MS } = {}) {
    this.hooks = hooks;
    this.minSeverity = minSeverity;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    this.retryMs = retryMs;
    this.stats = { sent: 0, failed: 0, last_error: null };
  }

  wants(alert) {
    return this.hooks.length > 0 && RANK[alert.severity] >= RANK[this.minSeverity];
  }

  send(alert) {
    if (!this.wants(alert)) return [];
    return this.hooks.map((hook) => this.deliver(hook, alert));
  }

  async deliver(hook, alert) {
    const body = hook.format === 'text' ? JSON.stringify({ text: alertText(alert) }) : JSON.stringify({ event: 'alert', alert });
    const headers = { 'content-type': 'application/json', 'user-agent': USER_AGENT };
    if (this.secret) headers['x-tayyar-signature'] = `sha256=${createHmac('sha256', this.secret).update(body).digest('hex')}`;
    for (const wait of this.retryMs) {
      if (wait) await new Promise((r) => setTimeout(r, wait).unref());
      try {
        const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
        await res.body?.cancel().catch(() => {});
        if (res.ok) {
          this.stats.sent += 1;
          return true;
        }
        this.stats.last_error = `HTTP ${res.status} from ${new URL(hook.url).host}`;
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        this.stats.last_error = `${new URL(hook.url).host}: ${err.message}`;
      }
    }
    this.stats.failed += 1;
    return false;
  }
}
