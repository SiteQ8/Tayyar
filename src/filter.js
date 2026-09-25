// Matches certificate names against keywords and regular expressions.
// Internationalised names are checked both as punycode and as the Unicode
// a person would see, so a keyword in Arabic script finds Arabic names.

import { unicodeDomain } from './x509.js';

/**
 * Builds a matcher. Returns null when there is nothing to match, so callers
 * can skip filtering entirely. The matcher returns the first matching name.
 */
export function buildMatcher({ patterns = [], keywords = [] } = {}) {
  const regexes = patterns.map((p) => new RegExp(p, 'iu'));
  const words = keywords
    .flatMap((k) => String(k).split(','))
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (regexes.length === 0 && words.length === 0) return null;
  return (domains) => {
    for (const d of domains) {
      const forms = d.includes('xn--') ? [d, unicodeDomain(d)] : [d];
      for (const f of forms) {
        const lower = f.toLowerCase();
        if (words.some((w) => lower.includes(w))) return d;
        if (regexes.some((r) => r.test(f))) return d;
      }
    }
    return null;
  };
}
