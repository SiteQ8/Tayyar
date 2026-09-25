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

// Folds one character at a time and remembers which character of the
// original each folded character came from, so a match found in the folded
// form can be shown on the name as it is written. Positions count code points.
export function foldMap(text) {
  const chars = [];
  const from = [];
  let i = 0;
  for (const ch of String(text)) {
    for (const c of fold(ch)) {
      chars.push(c);
      from.push(i);
    }
    i += 1;
  }
  return { text: chars.join(''), chars, from };
}

// Undoes the swaps phishing uses, keeping for every output character the
// span of the original it stands for and a record of each swap.
function unswapMap(chars, from) {
  return DIGIT_SWAPS.map((digits) => {
    const out = [];
    const start = [];
    const stop = [];
    const swaps = [];
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i];
      const b = chars[i + 1];
      if ((a === 'r' && b === 'n') || (a === 'v' && b === 'v')) {
        const to = a === 'r' ? 'm' : 'w';
        out.push(to);
        start.push(from[i]);
        stop.push(from[i + 1] + 1);
        swaps.push({ at: from[i], from: a + b, to });
        i += 1;
      } else if (digits[a] !== undefined) {
        out.push(digits[a]);
        start.push(from[i]);
        stop.push(from[i] + 1);
        swaps.push({ at: from[i], from: a, to: digits[a] });
      } else {
        out.push(a);
        start.push(from[i]);
        stop.push(from[i] + 1);
      }
    }
    return { text: out.join(''), start, stop, swaps };
  });
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

const cp = (text, index) => (index < 0 ? -1 : [...text.slice(0, index)].length);

// Keywords of five letters or more match anywhere. Shorter ones must start a
// word, so a three letter brand does not match the middle of random strings.
// Returns where the keyword starts, in code points, or -1.
function keywordFinder(k) {
  if ([...k].length >= 5) return (text) => cp(text, text.indexOf(k));
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'u');
  return (text) => {
    const m = re.exec(text);
    return m ? cp(text, m.index + m[0].length - m[1].length) : -1;
  };
}

const LURES = LURE_WORDS.map((w) => ({ w, length: [...fold(w)].length, find: keywordFinder(fold(w)) }));

const SCRIPTS = [
  [0x0400, 0x052f, 'cyrillic'], [0x0370, 0x03ff, 'greek'], [0x1f00, 0x1fff, 'greek'], [0x0530, 0x058f, 'armenian'],
  [0x0600, 0x06ff, 'arabic_variant'], [0x0750, 0x077f, 'arabic_variant'], [0xfb50, 0xfdff, 'arabic_variant'],
  [0xfe70, 0xfeff, 'arabic_variant'], [0xff00, 0xffef, 'fullwidth'], [0x00c0, 0x024f, 'latin'], [0x0250, 0x02af, 'latin'],
  [0x1e00, 0x1eff, 'latin'],
];

function scriptOf(ch) {
  const code = ch.codePointAt(0);
  const hit = SCRIPTS.find(([lo, hi]) => code >= lo && code <= hi);
  if (!hit) return 'other';
  if (hit[2] !== 'latin') return hit[2];
  return ch.normalize('NFD').length > ch.length ? 'latin_marked' : 'latin_variant';
}

// The characters in a span that folding changed, with what they read as.
function oddChars(text, [from, to]) {
  const out = [];
  [...text].forEach((ch, i) => {
    if (i < from || i >= to) return;
    const as = fold(ch);
    if (as !== ch.toLowerCase()) out.push({ at: i, char: ch, as, code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, script: scriptOf(ch) });
  });
  return out;
}

const spanOf = (folded, at, length) => [folded.from[at], folded.from[at + length - 1] + 1];

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
    const endings = new Map();
    for (const d of domains) {
      const { name, suffix } = splitDomain(d);
      if ([...name].length >= 3) endings.set(name, [...(endings.get(name) || []), suffix]);
    }
    const names = new Set(endings.keys());
    const words = new Set((item.keywords || []).map((k) => fold(k.trim())).filter((k) => [...k].length >= 3));
    for (const n of names) if ([...n].length >= 4) words.add(n);
    brands.push({
      ref,
      domains,
      names,
      endings,
      keywords: [...words].map((k) => ({ k, find: keywordFinder(k) })),
    });
  }
  return { brands, patterns, size: brands.length + patterns.length };
}

// Checks one name against the compiled watchlist. Returns every finding,
// each with its reasons and the evidence for them: where in the name each
// match sits, which characters were look-alikes, what was swapped or
// misspelled. Positions count code points of the name as displayed.
export function detectDomain(domain, compiled) {
  const raw = String(domain).toLowerCase().replace(/^\*\./, '');
  const unicode = unicodeDomain(raw);
  const shown = unicode !== raw ? unicode : null;
  const findings = [];
  if (!compiled.size) return findings;
  const folded = foldMap(unicode);
  const plain = folded.text;
  const direct = unicode.toLowerCase();
  const parts = splitDomain(plain);
  const pieces = [...parts.sub, parts.name].flatMap((l) => [l, ...l.split('-')]).filter((p) => [...p].length >= 3);
  const lures = LURES.map((l) => ({ ...l, at: l.find(plain) })).filter((l) => l.at >= 0);
  const lureEvidence = lures.length ? { reason: 'lure-word', words: lures.map((l) => l.w), at: lures.map((l) => spanOf(folded, l.at, l.length)) } : null;
  let variants = null;

  for (const b of compiled.brands) {
    if (b.domains.some((d) => plain === d || plain.endsWith(`.${d}`))) continue; // the brand's own names
    const evidence = new Map();
    let score = 0;
    const bump = (reason, value, detail) => {
      if (!evidence.has(reason)) evidence.set(reason, { reason, ...detail });
      score = Math.max(score, value);
    };
    for (const d of b.domains) {
      if (!d.includes('.')) continue;
      const at = cp(plain, plain.indexOf(d));
      if (at >= 0) {
        bump('embedded-domain', 90, { domain: d, form: 'dots', at: spanOf(folded, at, [...d].length) });
        continue;
      }
      const written = d.replace(/\./g, '-');
      const dashed = cp(plain, plain.indexOf(written));
      if (dashed >= 0) bump('embedded-domain', 85, { domain: d, form: 'hyphens', written, at: spanOf(folded, dashed, [...written].length) });
    }
    if (b.names.has(parts.name)) bump('tld-swap', 75, { name: parts.name, ending: parts.suffix, real: b.endings.get(parts.name) });
    for (const { k, find } of b.keywords) {
      const length = [...k].length;
      const at = find(plain);
      if (at >= 0) {
        const span = spanOf(folded, at, length);
        if (find(direct) < 0) {
          bump('homoglyph', 85, { word: k, at: span, chars: oddChars(unicode, span) });
        } else {
          let s = 55;
          const label = find(parts.name) < 0 ? parts.sub.find((l) => find(l) >= 0) : undefined;
          if (label !== undefined) {
            if (!evidence.has('subdomain')) evidence.set('subdomain', { reason: 'subdomain', label });
            s += 10;
          }
          bump('keyword', s, { word: k, at: span });
        }
        continue;
      }
      variants ??= unswapMap(folded.chars, folded.from);
      let swapped = null;
      for (const v of variants) {
        const i = find(v.text);
        if (i >= 0) {
          swapped = { v, span: [v.start[i], v.stop[i + length - 1]] };
          break;
        }
      }
      if (swapped) {
        const { v, span } = swapped;
        bump('swap', 75, { word: k, at: span, swaps: v.swaps.filter((w) => w.at >= span[0] && w.at < span[1]) });
        continue;
      }
      // A misspelling needs a piece at least as long as the brand minus one
      // letter. A four letter brand also needs a lure word and the same first
      // letter, since every short word is one edit away from another one.
      if (length >= 5 || (length === 4 && lures.length)) {
        const max = length >= 8 ? 2 : 1;
        for (const piece of pieces) {
          const size = [...piece].length;
          if (size < Math.max(4, length - 1)) continue;
          if (length === 4 && piece[0] !== k[0]) continue;
          const distance = editDistance(piece, k, max);
          if (distance > 0 && distance <= max) {
            const where = cp(plain, plain.indexOf(piece));
            bump('typo', distance === 1 ? (length >= 5 ? 70 : 60) : 55, { word: k, piece, distance, at: where >= 0 ? spanOf(folded, where, size) : null });
            break;
          }
        }
      }
    }
    if (!evidence.size) continue;
    if (lureEvidence) {
      evidence.set('lure-word', lureEvidence);
      score += 15;
    }
    if (raw.includes('xn--')) {
      evidence.set('idn', { reason: 'idn', ascii: raw });
      score += 5;
    }
    score = Math.min(100, score);
    const list = [...evidence.values()];
    findings.push({ watch: b.ref, domain, unicode: shown, score, severity: severityOf(score), reasons: list.map((e) => e.reason), evidence: list });
  }
  for (const p of compiled.patterns) {
    let on = 'ascii';
    let m = p.re.exec(raw);
    if (!m && shown) {
      on = 'unicode';
      m = p.re.exec(shown);
    }
    if (!m) continue;
    const text = on === 'ascii' ? raw : shown;
    findings.push({
      watch: p.ref, domain, unicode: shown, score: p.score, severity: severityOf(p.score), reasons: ['pattern'],
      evidence: [{ reason: 'pattern', pattern: p.re.source, on, at: [cp(text, m.index), cp(text, m.index + m[0].length)] }],
    });
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
