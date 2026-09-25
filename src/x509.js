// Turns a DER certificate into the JSON objects Tayyar publishes. Value
// formats follow OpenSSL's text output, so they read the same as `openssl x509`.

import { createHash } from 'node:crypto';
import { domainToUnicode } from 'node:url';
import { readTLV, children, bytes, oid, string, time, integerHex, colonHex, DerError } from './der.js';

const NAME_FIELDS = {
  '2.5.4.6': 'C',
  '2.5.4.8': 'ST',
  '2.5.4.7': 'L',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.3': 'CN',
  '1.2.840.113549.1.9.1': 'emailAddress',
};

const NAME_LABELS = {
  ...NAME_FIELDS,
  '2.5.4.5': 'serialNumber',
  '2.5.4.4': 'SN',
  '2.5.4.42': 'GN',
  '2.5.4.9': 'street',
  '2.5.4.17': 'postalCode',
  '2.5.4.15': 'businessCategory',
  '2.5.4.97': 'organizationIdentifier',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL',
  '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
};

const SIGNATURE_ALGORITHMS = {
  '1.2.840.113549.1.1.5': 'sha1, rsa',
  '1.2.840.113549.1.1.11': 'sha256, rsa',
  '1.2.840.113549.1.1.12': 'sha384, rsa',
  '1.2.840.113549.1.1.13': 'sha512, rsa',
  '1.2.840.113549.1.1.10': 'rsassa-pss',
  '1.2.840.10045.4.1': 'sha1, ecdsa',
  '1.2.840.10045.4.3.2': 'sha256, ecdsa',
  '1.2.840.10045.4.3.3': 'sha384, ecdsa',
  '1.2.840.10045.4.3.4': 'sha512, ecdsa',
  '1.3.101.112': 'ed25519',
  '1.3.101.113': 'ed448',
};

const KEY_USAGE_BITS = [
  'Digital Signature',
  'Non Repudiation',
  'Key Encipherment',
  'Data Encipherment',
  'Key Agreement',
  'Certificate Sign',
  'CRL Sign',
  'Encipher Only',
  'Decipher Only',
];

const EXTENDED_KEY_USAGE = {
  '1.3.6.1.5.5.7.3.1': 'TLS Web server authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS Web client authentication',
  '1.3.6.1.5.5.7.3.3': 'Code signing',
  '1.3.6.1.5.5.7.3.4': 'E-mail Protection',
  '1.3.6.1.5.5.7.3.8': 'Time Stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
  '2.5.29.37.0': 'Any Extended Key Usage',
  '1.3.6.1.4.1.11129.2.4.4': 'Precertificate Signing',
};

const ACCESS_METHODS = {
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA Issuers',
};

const OID_CT_POISON = '1.3.6.1.4.1.11129.2.4.3';
const OID_CT_SCTS = '1.3.6.1.4.1.11129.2.4.2';

function emptyName() {
  return { C: null, CN: null, L: null, O: null, OU: null, ST: null, aggregated: '', emailAddress: null };
}

function parseName(buf, node) {
  const name = emptyName();
  let aggregated = '';
  for (const rdn of children(buf, node)) {
    for (const atv of children(buf, rdn)) {
      const [typeNode, valueNode] = children(buf, atv);
      if (!typeNode || !valueNode) continue;
      const type = oid(buf, typeNode);
      const value = string(buf, valueNode);
      const field = NAME_FIELDS[type];
      if (field && name[field] === null) name[field] = value;
      aggregated += `/${NAME_LABELS[type] || type}=${value}`;
    }
  }
  name.aggregated = aggregated;
  return name;
}

// Printed the way OpenSSL prints them: dotted IPv4, and IPv6 as eight
// uncompressed uppercase groups.
function ipAddress(data) {
  if (data.length === 4) return Array.from(data).join('.');
  if (data.length === 16) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(data.readUInt16BE(i).toString(16).toUpperCase());
    return groups.join(':');
  }
  return colonHex(data);
}

// Reads a SEQUENCE OF GeneralName. Returns the printable entries and the DNS names.
function generalNames(buf, node) {
  const printable = [];
  const dns = [];
  for (const gn of children(buf, node)) {
    const value = bytes(buf, gn);
    switch (gn.tag) {
      case 0x82: {
        const name = value.toString('latin1');
        dns.push(name);
        printable.push(`DNS:${name}`);
        break;
      }
      case 0x87:
        printable.push(`IP Address:${ipAddress(value)}`);
        break;
      case 0x81:
        printable.push(`email:${value.toString('latin1')}`);
        break;
      case 0x86:
        printable.push(`URI:${value.toString('latin1')}`);
        break;
      default:
        break;
    }
  }
  return { printable, dns };
}

function base64url(data) {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseExtensions(buf, extsNode) {
  const extensions = {};
  const info = { dns: [], isCA: false, precert: false };
  const seq = readTLV(buf, extsNode.start);
  for (const ext of children(buf, seq)) {
    const parts = children(buf, ext);
    if (parts.length < 2) continue;
    const id = oid(buf, parts[0]);
    const valueNode = parts[parts.length - 1];
    try {
      decodeExtension(buf, id, valueNode, extensions, info);
    } catch (err) {
      if (!(err instanceof DerError)) throw err;
      // A malformed extension should not hide the rest of the certificate.
    }
  }
  return { extensions, ...info };
}

function decodeExtension(buf, id, valueNode, extensions, info) {
  switch (id) {
    case '2.5.29.15': { // keyUsage
      const bits = readTLV(buf, valueNode.start);
      const data = bytes(buf, bits).subarray(1);
      const names = [];
      KEY_USAGE_BITS.forEach((label, i) => {
        const byte = data[i >> 3];
        if (byte !== undefined && (byte & (0x80 >> (i & 7)))) names.push(label);
      });
      extensions.keyUsage = names.join(', ');
      break;
    }
    case '2.5.29.37': { // extendedKeyUsage
      const seq = readTLV(buf, valueNode.start);
      extensions.extendedKeyUsage = children(buf, seq)
        .map((n) => { const o = oid(buf, n); return EXTENDED_KEY_USAGE[o] || o; })
        .join(', ');
      break;
    }
    case '2.5.29.19': { // basicConstraints
      const seq = readTLV(buf, valueNode.start);
      let ca = false;
      let pathlen = null;
      for (const n of children(buf, seq)) {
        if (n.tag === 0x01) ca = buf[n.start] !== 0;
        if (n.tag === 0x02) pathlen = parseInt(buf.toString('hex', n.start, n.end), 16);
      }
      info.isCA = ca;
      extensions.basicConstraints = `CA:${ca ? 'TRUE' : 'FALSE'}${pathlen !== null ? `, pathlen:${pathlen}` : ''}`;
      break;
    }
    case '2.5.29.14': { // subjectKeyIdentifier
      const ski = readTLV(buf, valueNode.start);
      extensions.subjectKeyIdentifier = colonHex(bytes(buf, ski));
      break;
    }
    case '2.5.29.35': { // authorityKeyIdentifier
      const seq = readTLV(buf, valueNode.start);
      const keyId = children(buf, seq).find((n) => n.tag === 0x80);
      if (keyId) extensions.authorityKeyIdentifier = `keyid:${colonHex(bytes(buf, keyId))}\n`;
      break;
    }
    case '1.3.6.1.5.5.7.1.1': { // authorityInfoAccess
      const seq = readTLV(buf, valueNode.start);
      let text = '';
      for (const ad of children(buf, seq)) {
        const [method, location] = children(buf, ad);
        if (!method || !location) continue;
        const label = ACCESS_METHODS[oid(buf, method)] || oid(buf, method);
        if (location.tag === 0x86) text += `${label} - URI:${bytes(buf, location).toString('latin1')}\n`;
      }
      extensions.authorityInfoAccess = text;
      break;
    }
    case '2.5.29.17': { // subjectAltName
      const seq = readTLV(buf, valueNode.start);
      const { printable, dns } = generalNames(buf, seq);
      extensions.subjectAltName = printable.join(', ');
      info.dns.push(...dns);
      break;
    }
    case '2.5.29.32': { // certificatePolicies
      const seq = readTLV(buf, valueNode.start);
      extensions.certificatePolicies = children(buf, seq)
        .map((pi) => `Policy: ${oid(buf, children(buf, pi)[0])}`)
        .join('\n');
      break;
    }
    case '2.5.29.31': { // cRLDistributionPoints
      const seq = readTLV(buf, valueNode.start);
      const lines = [];
      for (const dp of children(buf, seq)) {
        const dpName = children(buf, dp).find((n) => n.tag === 0xa0);
        if (!dpName) continue;
        const fullName = children(buf, dpName).find((n) => n.tag === 0xa0);
        if (!fullName) continue;
        const { printable } = generalNames(buf, fullName);
        lines.push(`Full Name:\n ${printable.join('\n ')}`);
      }
      extensions.crlDistributionPoints = lines.join('\n');
      break;
    }
    case OID_CT_SCTS:
      extensions.ctlSignedCertificateTimestamp = base64url(bytes(buf, valueNode));
      break;
    case OID_CT_POISON:
      extensions.ctlPoisonByte = true;
      info.precert = true;
      break;
    default:
      break;
  }
}

const HOSTNAME = /^[^\s/]+\.[^\s/]+$/;

// Collects the names a certificate covers: the subject CN when it looks like a
// host name, then every DNS entry in the SAN, without duplicates.
function collectDomains(cn, dns) {
  const out = [];
  const seen = new Set();
  const add = (d) => {
    if (!d || d.length > 253 || seen.has(d)) return;
    seen.add(d);
    out.push(d);
  };
  if (cn && HOSTNAME.test(cn)) add(cn);
  for (const d of dns) add(d);
  return out;
}

/**
 * Parses a DER certificate (or precertificate) into a plain object.
 * Throws DerError when the outer structure cannot be read.
 */
export function parseCertificate(der) {
  const cert = readTLV(der, 0);
  const [tbs, sigAlg] = children(der, cert);
  if (!tbs || !sigAlg) throw new DerError('not a certificate');
  const f = children(der, tbs);
  let i = 0;
  if (f[i] && f[i].tag === 0xa0) i++;
  const serial = f[i++];
  i++; // inner signature algorithm, repeated below from the outer field
  const issuer = f[i++];
  const validity = f[i++];
  const subject = f[i++];
  if (!serial || !issuer || !validity || !subject) throw new DerError('incomplete TBSCertificate');
  let extsNode = null;
  for (; i < f.length; i++) if (f[i].tag === 0xa3) extsNode = f[i];

  const [notBefore, notAfter] = children(der, validity);
  const sigOid = oid(der, children(der, sigAlg)[0]);
  const subjectName = parseName(der, subject);
  const issuerName = parseName(der, issuer);
  const ext = extsNode ? parseExtensions(der, extsNode) : { extensions: {}, dns: [], isCA: false, precert: false };

  return {
    subject: subjectName,
    issuer: issuerName,
    extensions: ext.extensions,
    not_before: time(der, notBefore),
    not_after: time(der, notAfter),
    serial_number: integerHex(der, serial),
    signature_algorithm: SIGNATURE_ALGORITHMS[sigOid] || sigOid,
    is_ca: ext.isCA,
    is_precert: ext.precert,
    all_domains: collectDomains(subjectName.CN, ext.dns),
  };
}

export function fingerprints(der) {
  return {
    sha1: colonHex(createHash('sha1').update(der).digest()),
    sha256: colonHex(createHash('sha256').update(der).digest()),
  };
}

/**
 * Builds the `leaf_cert` object. `full` adds the DER encoding, which only the
 * /full-stream endpoint carries.
 */
export function leafCertObject(der, parsed = parseCertificate(der), fp = fingerprints(der), full = false) {
  const out = {
    all_domains: parsed.all_domains,
    extensions: parsed.extensions,
    fingerprint: fp.sha1,
    sha1: fp.sha1,
    sha256: fp.sha256,
    issuer: parsed.issuer,
    not_after: parsed.not_after,
    not_before: parsed.not_before,
    serial_number: parsed.serial_number,
    signature_algorithm: parsed.signature_algorithm,
    subject: parsed.subject,
    is_ca: parsed.is_ca,
  };
  if (full) out.as_der = der.toString('base64');
  return out;
}

// Chain entries carry the same fields as the leaf, without the domain list.
export function chainCertObject(der) {
  const parsed = parseCertificate(der);
  const fp = fingerprints(der);
  return {
    subject: parsed.subject,
    issuer: parsed.issuer,
    extensions: parsed.extensions,
    not_before: parsed.not_before,
    not_after: parsed.not_after,
    serial_number: parsed.serial_number,
    fingerprint: fp.sha1,
    sha256: fp.sha256,
    signature_algorithm: parsed.signature_algorithm,
    is_ca: parsed.is_ca,
    as_der: der.toString('base64'),
  };
}

// Internationalised names arrive as punycode. The Unicode form is what a
// person sees in the address bar, so filters check both.
export function unicodeDomain(domain) {
  if (!domain.includes('xn--')) return domain;
  const wildcard = domain.startsWith('*.');
  const bare = wildcard ? domain.slice(2) : domain;
  const decoded = domainToUnicode(bare);
  if (!decoded) return domain;
  return wildcard ? `*.${decoded}` : decoded;
}
