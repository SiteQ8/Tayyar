// Builds the three message shapes Tayyar publishes from one parsed certificate.
//
//   lite     certificate_update without the DER bytes or the chain (the "/" stream)
//   full     certificate_update with as_der and the chain ("/full-stream")
//   domains  dns_entries, only the names ("/domains-only")

import { createHash } from 'node:crypto';
import { leafCertObject, chainCertObject } from './x509.js';

const chainObjects = new Map(); // sha256 digest -> chain entry object
const CHAIN_CACHE_MAX = 4096;

function chainObject(der) {
  const key = createHash('sha256').update(der).digest('latin1');
  let obj = chainObjects.get(key);
  if (!obj) {
    try {
      obj = chainCertObject(der);
    } catch {
      return null;
    }
    if (chainObjects.size >= CHAIN_CACHE_MAX) chainObjects.delete(chainObjects.keys().next().value);
    chainObjects.set(key, obj);
  }
  return obj;
}

function data(cert, full) {
  return {
    update_type: cert.entryType === 1 ? 'PrecertLogEntry' : 'X509LogEntry',
    leaf_cert: leafCertObject(cert.der, cert.parsed, cert.fingerprints, full),
    cert_index: cert.index,
    cert_link: cert.link,
    seen: cert.seen,
    source: { name: cert.log.name, url: cert.log.url },
  };
}

export function liteMessage(cert) {
  return { message_type: 'certificate_update', data: data(cert, false) };
}

export function fullMessage(cert) {
  const d = data(cert, true);
  d.chain = cert.chain.map(chainObject).filter(Boolean);
  return { message_type: 'certificate_update', data: d };
}

export function domainsMessage(cert) {
  return { message_type: 'dns_entries', data: cert.parsed.all_domains };
}

export function heartbeatMessage(now = Date.now()) {
  return { message_type: 'heartbeat', timestamp: now / 1000 };
}
