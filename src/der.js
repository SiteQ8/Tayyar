// A small, lenient DER reader. It reads only what Tayyar needs from X.509
// certificates and never allocates more than the slices it returns.

export class DerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DerError';
  }
}

// Reads one tag-length-value element that starts at `offset`.
export function readTLV(buf, offset = 0) {
  if (offset + 2 > buf.length) throw new DerError('truncated header');
  const tag = buf[offset];
  let o = offset + 1;
  if ((tag & 0x1f) === 0x1f) {
    // High tag numbers do not appear in the certificate fields we read,
    // but skipping them correctly keeps the walker aligned.
    let b;
    do {
      if (o >= buf.length) throw new DerError('truncated tag');
      b = buf[o++];
    } while (b & 0x80);
  }
  if (o >= buf.length) throw new DerError('truncated length');
  let len = buf[o++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new DerError('unsupported length form');
    if (o + n > buf.length) throw new DerError('truncated length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[o++];
  }
  const end = o + len;
  if (end > buf.length) throw new DerError('truncated value');
  return { tag, start: o, end, offset };
}

// Returns the direct children of a constructed element.
export function children(buf, node) {
  const out = [];
  let o = node.start;
  while (o < node.end) {
    const child = readTLV(buf, o);
    out.push(child);
    o = child.end;
  }
  return out;
}

export function bytes(buf, node) {
  return buf.subarray(node.start, node.end);
}

const oidCache = new Map();

// Decodes an OBJECT IDENTIFIER into dotted form. Results are cached because
// the same few dozen identifiers repeat in every certificate.
export function oid(buf, node) {
  const key = buf.toString('latin1', node.start, node.end);
  const hit = oidCache.get(key);
  if (hit) return hit;
  const arcs = [];
  let value = 0n;
  for (let i = node.start; i < node.end; i++) {
    const b = buf[i];
    value = (value << 7n) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) {
      if (arcs.length === 0) {
        if (value < 40n) arcs.push(0n, value);
        else if (value < 80n) arcs.push(1n, value - 40n);
        else arcs.push(2n, value - 80n);
      } else {
        arcs.push(value);
      }
      value = 0n;
    }
  }
  const dotted = arcs.join('.');
  if (oidCache.size < 4096) oidCache.set(key, dotted);
  return dotted;
}

// Decodes the string types that appear in distinguished names and in
// general names. Unknown types fall back to Latin-1 so nothing throws.
export function string(buf, node) {
  switch (node.tag) {
    case 0x0c: // UTF8String
      return buf.toString('utf8', node.start, node.end);
    case 0x1e: { // BMPString, UTF-16 big endian
      const slice = Buffer.from(buf.subarray(node.start, node.end));
      if (slice.length % 2 === 0) slice.swap16();
      return slice.toString('utf16le');
    }
    case 0x1c: { // UniversalString, UTF-32 big endian
      let s = '';
      for (let i = node.start; i + 3 < node.end; i += 4) {
        s += String.fromCodePoint(buf.readUInt32BE(i));
      }
      return s;
    }
    default: // PrintableString, IA5String, TeletexString, VisibleString
      return buf.toString('latin1', node.start, node.end);
  }
}

// Converts UTCTime or GeneralizedTime to whole Unix seconds.
export function time(buf, node) {
  const s = buf.toString('latin1', node.start, node.end);
  let year;
  let rest;
  if (node.tag === 0x17) {
    const yy = Number(s.slice(0, 2));
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
    rest = s.slice(2);
  } else if (node.tag === 0x18) {
    year = Number(s.slice(0, 4));
    rest = s.slice(4);
  } else {
    throw new DerError('not a time value');
  }
  const month = Number(rest.slice(0, 2));
  const day = Number(rest.slice(2, 4));
  const hour = Number(rest.slice(4, 6));
  const minute = Number(rest.slice(6, 8));
  const second = /^\d\d$/.test(rest.slice(8, 10)) ? Number(rest.slice(8, 10)) : 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(ms)) throw new DerError('invalid time value');
  return Math.floor(ms / 1000);
}

// Formats an INTEGER the way OpenSSL prints serial numbers: uppercase hex
// with leading zero digits removed.
export function integerHex(buf, node) {
  let hex = buf.toString('hex', node.start, node.end).toUpperCase();
  hex = hex.replace(/^0+/, '');
  return hex === '' ? '0' : hex;
}

export function colonHex(data) {
  const hex = data.toString('hex').toUpperCase();
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    out += (i ? ':' : '') + hex.slice(i, i + 2);
  }
  return out;
}
