// Spots certificate names that imitate a brand on the watchlist.
//
// Every name is folded first: letters from other scripts that look Latin are
// mapped to the Latin letter they imitate, marks are removed, and Arabic
// letters that are written differently but read alike are unified, so the
// Persian kaf and the Arabic kaf compare equal. The folded name is then
// checked for the brand's words, its real domains written inside other
// domains, the same name under a different ending, swapped characters such
// as a zero for an o, and misspellings one or two letters away.

import { unicodeDomain } from './x509.js';

const LOOKALIKES = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
  'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  'һ': 'h', 'ӏ': 'l',
  // Armenian
  'ո': 'n', 'ս': 'u', 'օ': 'o',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't',
  'υ': 'u', 'χ': 'x', 'ω': 'w',
  // Latin letters without a decomposition
  'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ħ': 'h', 'ŀ': 'l', 'ɡ': 'g', 'ɑ': 'a', 'ɩ': 'i', 'ʀ': 'r',
  // Arabic letters that read alike
  'ى': 'ي', 'ی': 'ي', 'ک': 'ك', 'ة': 'ه', 'ە': 'ه', 'ہ': 'ه', 'ھ': 'ه', 'ٱ': 'ا',
};

const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g;
const DIGIT_SWAPS = [
  { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' },
  { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' },
];

// Words that phishing pages pair with a brand, in English and Arabic,
// including the parcel, fine and refund lures common in the Gulf.
export const LURE_WORDS = [
  'login', 'signin', 'secure', 'verify', 'verification', 'update', 'account', 'auth', 'otp', 'pay',
  'payment', 'billing', 'invoice', 'refund', 'wallet', 'bank', 'card', 'reward', 'gift', 'prize',
  'claim', 'confirm', 'unlock', 'support', 'service', 'kyc', 'fines', 'parcel', 'delivery',
  'tracking', 'customs',
  'دخول', 'تسجيل', 'تحقق', 'تأكيد', 'تحديث', 'حساب', 'دفع', 'سداد', 'بطاقة', 'بنك', 'مكافأة',
  'جائزة', 'استرداد', 'مخالفات', 'شحنة', 'طرد', 'بريد',
];

// Second-level labels that sit under a country ending, as in com.kw or gov.uk.
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'mil', 'biz', 'info', 'nic', 'sch', 'ltd', 'plc', 'or', 'ne', 'go', 'gob', 'gouv']);

const PATTERN_SCORES = { low: 45, medium: 65, high: 85 };

export function severityOf(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

export function fold(text) {
  let s = String(text).normalize('NFKC').toLowerCase().normalize('NFD').replace(MARKS, '');
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  let out = '';
  for (const ch of s) out += LOOKALIKES[ch] ?? ch;
  return out;
}

function unswapped(s) {
  const pairs = s.replace(/rn/g, 'm').replace(/vv/g, 'w');
  return DIGIT_SWAPS.map((map) => pairs.replace(/[0-9]/g, (d) => map[d] ?? d));
}

// Optimal string alignment distance, which counts a swap of two neighbouring
// letters as one edit. Stops early once the distance passes `max`.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Splits a domain into the registrable name, its ending, and any subdomains.
export function splitDomain(domain) {
  const labels = domain.split('.');
  const n = labels.length;
  if (n === 2 && labels[1].length === 2 && SECOND_LEVEL.has(labels[0])) return { name: '', suffix: domain, sub: [] };
  if (n >= 3 && labels[n - 1].length === 2 && SECOND_LEVEL.has(labels[n - 2])) {
    return { name: labels[n - 3], suffix: labels.slice(-2).join('.'), sub: labels.slice(0, -3) };
  }
  if (n >= 2) return { name: labels[n - 2], suffix: labels[n - 1], sub: labels.slice(0, -2) };
  return { name: labels[0] || '', suffix: '', sub: [] };
}

// Keywords of five letters or more match anywhere. Shorter ones must start a
// word, so a three letter brand does not match the middle of random strings.
function keywordMatcher(k) {
  if ([...k].length >= 5) return (text) => text.includes(k);
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
  return (text) => re.test(text);
}

const LURES = LURE_WORDS.map((w) => ({ w, test: keywordMatcher(fold(w)) }));

export function compileWatchlist(items = []) {
  const brands = [];
  const patterns = [];
  for (const item of items) {
    if (item.enabled === false) continue;
    const ref = { id: item.id, name: item.name, kind: item.kind };
    if (item.kind === 'pattern') {
      try {
        patterns.push({ ref, re: new RegExp(item.pattern, 'iu'), score: PATTERN_SCORES[item.severity] ?? PATTERN_SCORES.medium });
      } catch {
        // An invalid pattern is refused when it is saved; skip one loaded from an old file.
      }
      continue;
    }
    const domains = (item.domains || []).map((d) => fold(unicodeDomain(d.toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''))));
    const names = new Set(domains.map((d) => splitDomain(d).name).filter((n) => [...n].length >= 3));
    const words = new Set((item.keywords || []).map((k) => fold(k.trim())).filter((k) => [...k].length >= 3));
    for (const n of names) if ([...n].length >= 4) words.add(n);
    brands.push({
      ref,
      domains,
      names,
      keywords: [...words].map((k) => ({ k, test: keywordMatcher(k) })),
    });
  }
  return { brands, patterns, size: brands.length + patterns.length };
}

// Checks one name against the compiled watchlist. Returns every finding.
export function detectDomain(domain, compiled) {
  const raw = String(domain).toLowerCase().replace(/^\*\./, '');
  const unicode = unicodeDomain(raw);
  const shown = unicode !== raw ? unicode : null;
  const findings = [];
  if (!compiled.size) return findings;
  const plain = fold(unicode);
  const direct = unicode.toLowerCase();
  const parts = splitDomain(plain);
  const pieces = [...parts.sub, parts.name].flatMap((l) => [l, ...l.split('-')]).filter((p) => [...p].length >= 3);
  const lure = LURES.some((l) => l.test(plain));

  for (const b of compiled.brands) {
    if (b.domains.some((d) => plain === d || plain.endsWith(`.${d}`))) continue; // the brand's own names
    const reasons = new Set();
    let score = 0;
    const bump = (reason, value) => {
      reasons.add(reason);
      score = Math.max(score, value);
    };
    for (const d of b.domains) if (d.includes('.') && plain.includes(d)) bump('embedded-domain', 90);
    if (b.names.has(parts.name)) bump('tld-swap', 75);
    for (const { k, test } of b.keywords) {
      if (test(plain)) {
        if (!test(direct)) {
          bump('homoglyph', 85);
        } else {
          let s = 55;
          if (!test(parts.name) && parts.sub.some((l) => test(l))) {
            reasons.add('subdomain');
            s += 10;
          }
          bump('keyword', s);
        }
        continue;
      }
      if (unswapped(plain).some((v) => test(v))) {
        bump('swap', 75);
        continue;
      }
      // A misspelling needs a piece at least as long as the brand minus one
      // letter. A four letter brand also needs a lure word and the same first
      // letter, since every short word is one edit away from another one.
      const len = [...k].length;
      if (len >= 5 || (len === 4 && lure)) {
        const max = len >= 8 ? 2 : 1;
        for (const piece of pieces) {
          if ([...piece].length < Math.max(4, len - 1)) continue;
          if (len === 4 && piece[0] !== k[0]) continue;
          const dist = editDistance(piece, k, max);
          if (dist > 0 && dist <= max) {
            bump('typo', dist === 1 ? (len >= 5 ? 70 : 60) : 55);
            break;
          }
        }
      }
    }
    if (!reasons.size) continue;
    if (lure) {
      reasons.add('lure-word');
      score += 15;
    }
    if (raw.includes('xn--')) {
      reasons.add('idn');
      score += 5;
    }
    score = Math.min(100, score);
    findings.push({ watch: b.ref, domain, unicode: shown, score, severity: severityOf(score), reasons: [...reasons] });
  }
  for (const p of compiled.patterns) {
    if (p.re.test(raw) || (shown && p.re.test(shown))) {
      findings.push({ watch: p.ref, domain, unicode: shown, score: p.score, severity: severityOf(p.score), reasons: ['pattern'] });
    }
  }
  return findings;
}

// Checks every name on a certificate and keeps the strongest finding for
// each watchlist entry, strongest first.
export function detectNames(domains, compiled) {
  if (!compiled.size) return [];
  const best = new Map();
  for (const d of domains) {
    for (const f of detectDomain(d, compiled)) {
      const prev = best.get(f.watch.id);
      if (!prev || f.score > prev.score) best.set(f.watch.id, f);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
