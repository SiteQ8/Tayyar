// Binary parsers for the two ways a CT log hands out entries.
//
// RFC 6962 logs return JSON from get-entries, where `leaf_input` is a
// MerkleTreeLeaf and `extra_data` carries the chain. Static CT logs serve
// "data tiles": 256 TileLeaf records back to back, with the chain given as
// SHA-256 fingerprints that resolve through the log's /issuer/ endpoint.

export const X509_ENTRY = 0;
export const PRECERT_ENTRY = 1;

export class LeafError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LeafError';
  }
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.o = 0;
  }
  need(n) {
    if (this.o + n > this.buf.length) throw new LeafError(`truncated entry at byte ${this.o}`);
  }
  u8() { this.need(1); return this.buf[this.o++]; }
  u16() { this.need(2); const v = this.buf.readUInt16BE(this.o); this.o += 2; return v; }
  u24() { this.need(3); const v = this.buf.readUIntBE(this.o, 3); this.o += 3; return v; }
  u64() { this.need(8); const v = Number(this.buf.readBigUInt64BE(this.o)); this.o += 8; return v; }
  take(n) { this.need(n); const v = this.buf.subarray(this.o, this.o + n); this.o += n; return v; }
  opaque16() { return this.take(this.u16()); }
  opaque24() { return this.take(this.u24()); }
  get done() { return this.o >= this.buf.length; }
}

// TimestampedEntry, RFC 6962 section 3.4. Shared by both formats.
function readTimestampedEntry(r) {
  const timestamp = r.u64();
  const entryType = r.u16();
  const entry = { timestamp, entryType, cert: null, issuerKeyHash: null, tbs: null, extensions: null };
  if (entryType === X509_ENTRY) {
    entry.cert = r.opaque24();
  } else if (entryType === PRECERT_ENTRY) {
    entry.issuerKeyHash = r.take(32);
    entry.tbs = r.opaque24();
  } else {
    throw new LeafError(`unknown entry type ${entryType}`);
  }
  entry.extensions = r.opaque16();
  return entry;
}

function readCertList(r) {
  const list = r.opaque24();
  const inner = new Reader(list);
  const certs = [];
  while (!inner.done) certs.push(inner.opaque24());
  return certs;
}

/**
 * Parses one get-entries item. Returns the certificate DER to publish (the
 * final certificate, or the full precertificate for precert entries) and the
 * DER chain in submission order.
 */
export function parseRfc6962Entry(item) {
  const leafInput = Buffer.from(item.leaf_input, 'base64');
  const extraData = Buffer.from(item.extra_data || '', 'base64');
  const r = new Reader(leafInput);
  const version = r.u8();
  const leafType = r.u8();
  if (version !== 0 || leafType !== 0) throw new LeafError(`unexpected leaf version ${version} type ${leafType}`);
  const entry = readTimestampedEntry(r);
  const x = new Reader(extraData);
  if (entry.entryType === X509_ENTRY) {
    return { timestamp: entry.timestamp, entryType: X509_ENTRY, der: entry.cert, chain: extraData.length ? readCertList(x) : [] };
  }
  const preCertificate = x.opaque24();
  const chain = x.done ? [] : readCertList(x);
  return { timestamp: entry.timestamp, entryType: PRECERT_ENTRY, der: preCertificate, chain };
}

// The leaf_index extension that static CT logs add to every SCT: type 0,
// a 40-bit big-endian index. Used to check a tile holds what we expect.
export function leafIndexFromExtensions(ext) {
  const r = new Reader(ext);
  while (!r.done) {
    const type = r.u8();
    const data = r.opaque16();
    if (type === 0 && data.length === 5) return data.readUIntBE(0, 5);
  }
  return null;
}

/**
 * Parses a static CT data tile into its TileLeaf records.
 * c2sp.org/static-ct-api, "Log entries".
 */
export function parseDataTile(buf) {
  const r = new Reader(buf);
  const leaves = [];
  while (!r.done) {
    const entry = readTimestampedEntry(r);
    let der = entry.cert;
    if (entry.entryType === PRECERT_ENTRY) der = r.opaque24();
    const chainBytes = r.opaque16();
    if (chainBytes.length % 32 !== 0) throw new LeafError('certificate_chain is not a list of fingerprints');
    const chain = [];
    for (let i = 0; i < chainBytes.length; i += 32) chain.push(chainBytes.subarray(i, i + 32).toString('hex'));
    leaves.push({
      timestamp: entry.timestamp,
      entryType: entry.entryType,
      der,
      chainFingerprints: chain,
      leafIndex: leafIndexFromExtensions(entry.extensions),
    });
  }
  return leaves;
}
