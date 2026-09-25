// Punycode decoding (RFC 3492) for the viewer page, so internationalised
// names such as Arabic look-alike domains show in the script a person would
// see in the address bar. Encoding is not needed and not included.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

function adapt(delta, numPoints, firstTime) {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitOf(code) {
  if (code >= 0x30 && code <= 0x39) return code - 22; // 0-9 map to 26-35
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // a-z
  return BASE;
}

// Decodes one label without its "xn--" prefix. Throws on malformed input.
export function decodeLabel(input) {
  const output = [];
  const basic = Math.max(0, input.lastIndexOf('-'));
  for (let j = 0; j < basic; j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new Error('non-basic code point before delimiter');
    output.push(c);
  }
  let i = 0;
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('truncated input');
      const digit = digitOf(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error('invalid digit');
      if (digit > Math.floor((MAX_INT - i) / w)) throw new Error('overflow');
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) throw new Error('overflow');
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    if (Math.floor(i / out) > MAX_INT - n) throw new Error('overflow');
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

// Converts every "xn--" label of a domain. Labels that do not decode are
// left as they are, so a malformed name is shown rather than hidden.
export function toUnicode(domain) {
  return domain
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      try {
        return decodeLabel(label.slice(4).toLowerCase());
      } catch {
        return label;
      }
    })
    .join('.');
}
