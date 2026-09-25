// Signed tree heads. RFC 6962 logs publish them as JSON from get-sth; static
// CT logs publish the same signature inside a signed note called a
// checkpoint. Tayyar checks the log's signature on both, so a tampered or
// spoofed tree size is noticed instead of silently trusted.

import { createHash, createPublicKey, verify } from 'node:crypto';

const NOTE_SIGNATURE_PREFIX = '\u2014 ';
const RFC6962_NOTE_TYPE = 0x05;

export function keyObject(keyB64) {
  return createPublicKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'spki' });
}

export function logIdFromKey(keyB64) {
  return createHash('sha256').update(Buffer.from(keyB64, 'base64')).digest();
}

// The bytes a log signs for a tree head, RFC 6962 section 3.5.
function treeHeadInput(timestamp, treeSize, rootHash) {
  const b = Buffer.alloc(50);
  b[0] = 0; // v1
  b[1] = 1; // tree_hash
  b.writeBigUInt64BE(BigInt(timestamp), 2);
  b.writeBigUInt64BE(BigInt(treeSize), 10);
  rootHash.copy(b, 18);
  return b;
}

// A TLS "digitally-signed" struct: hash algorithm, signature algorithm, length, signature.
function verifyDigitallySigned(key, data, ds) {
  if (ds.length < 4 || ds[0] !== 4) return false; // only SHA-256 is used by CT logs
  const len = ds.readUInt16BE(2);
  if (4 + len > ds.length) return false;
  try {
    return verify('sha256', data, key, ds.subarray(4, 4 + len));
  } catch {
    return false;
  }
}

export function verifySth(sth, keyB64) {
  const root = Buffer.from(sth.sha256_root_hash, 'base64');
  if (root.length !== 32) return false;
  const input = treeHeadInput(sth.timestamp, sth.tree_size, root);
  return verifyDigitallySigned(keyObject(keyB64), input, Buffer.from(sth.tree_head_signature, 'base64'));
}

/** Parses a checkpoint (c2sp.org/tlog-checkpoint). Throws on malformed input. */
export function parseCheckpoint(text) {
  const split = text.indexOf('\n\n');
  if (split < 0) throw new Error('checkpoint has no signature block');
  const lines = text.slice(0, split).split('\n');
  const [origin, sizeLine, rootLine] = lines;
  if (!origin || !/^\d+$/.test(sizeLine || '')) throw new Error('malformed checkpoint header');
  const rootHash = Buffer.from(rootLine || '', 'base64');
  if (rootHash.length !== 32) throw new Error('malformed checkpoint root hash');
  const signatures = [];
  for (const line of text.slice(split + 2).split('\n')) {
    if (!line.startsWith(NOTE_SIGNATURE_PREFIX)) continue;
    const rest = line.slice(NOTE_SIGNATURE_PREFIX.length);
    const space = rest.lastIndexOf(' ');
    if (space < 0) continue;
    signatures.push({ name: rest.slice(0, space), sig: Buffer.from(rest.slice(space + 1), 'base64') });
  }
  return { origin, treeSize: Number(sizeLine), rootHash, extensions: lines.slice(3), signatures };
}

/**
 * Verifies the RFC 6962 note signature on a checkpoint with the log's key.
 * Returns the signed timestamp on success, or null.
 */
export function verifyCheckpoint(cp, keyB64) {
  const logId = logIdFromKey(keyB64);
  const keyId = createHash('sha256')
    .update(Buffer.concat([Buffer.from(`${cp.origin}\n`), Buffer.from([RFC6962_NOTE_TYPE]), logId]))
    .digest()
    .subarray(0, 4);
  const key = keyObject(keyB64);
  for (const s of cp.signatures) {
    if (s.name !== cp.origin || s.sig.length < 12 || !s.sig.subarray(0, 4).equals(keyId)) continue;
    const timestamp = Number(s.sig.readBigUInt64BE(4));
    const input = treeHeadInput(timestamp, cp.treeSize, cp.rootHash);
    if (verifyDigitallySigned(key, input, s.sig.subarray(12))) return timestamp;
  }
  return null;
}
