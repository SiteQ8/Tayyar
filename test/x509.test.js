import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { parseCertificate, leafCertObject, chainCertObject, fingerprints, unicodeDomain } from '../src/x509.js';
import { DerError } from '../src/der.js';
import { parseDataTile } from '../src/leaf.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const synthetic = readFileSync(fixture('synthetic.der'));

test('reads every field of a certificate with known extensions', () => {
  const p = parseCertificate(synthetic);
  assert.equal(p.serial_number, 'A1B2C3D4E5F60718');
  assert.equal(p.signature_algorithm, 'sha256, ecdsa');
  assert.equal(p.subject.C, 'KW');
  assert.equal(p.subject.ST, 'Al Asimah');
  assert.equal(p.subject.L, 'Kuwait City');
  assert.equal(p.subject.O, 'Tayyar Test');
  assert.equal(p.subject.OU, 'Fixtures');
  assert.equal(p.subject.CN, 'xn--mgbh0fb.example');
  assert.equal(p.subject.emailAddress, 'fixtures@example.com');
  assert.equal(
    p.subject.aggregated,
    '/C=KW/ST=Al Asimah/L=Kuwait City/O=Tayyar Test/OU=Fixtures/CN=xn--mgbh0fb.example/emailAddress=fixtures@example.com',
  );
  assert.deepEqual(p.issuer, p.subject);
  assert.equal(p.extensions.basicConstraints, 'CA:TRUE, pathlen:0');
  assert.equal(p.extensions.keyUsage, 'Digital Signature, Certificate Sign, CRL Sign');
  assert.equal(p.extensions.extendedKeyUsage, 'TLS Web server authentication, TLS Web client authentication');
  assert.equal(
    p.extensions.subjectAltName,
    'DNS:xn--mgbh0fb.example, DNS:*.tayyar.example, IP Address:192.0.2.7, IP Address:2001:DB8:0:0:0:0:0:1, email:ops@example.com, URI:https://tayyar.example/',
  );
  assert.equal(p.extensions.authorityInfoAccess, 'OCSP - URI:http://ocsp.tayyar.example\nCA Issuers - URI:http://ca.tayyar.example/ca.crt\n');
  assert.equal(p.extensions.crlDistributionPoints, 'Full Name:\n URI:http://crl.tayyar.example/ca.crl');
  assert.equal(p.extensions.certificatePolicies, 'Policy: 2.23.140.1.2.1\nPolicy: 1.3.6.1.4.1.99999.1');
  assert.match(p.extensions.subjectKeyIdentifier, /^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
  assert.equal(p.is_ca, true);
  assert.equal(p.is_precert, false);
  assert.deepEqual(p.all_domains, ['xn--mgbh0fb.example', '*.tayyar.example']);
});

test('agrees with Node on real certificates and precertificates from a CT log', () => {
  const leaves = parseDataTile(readFileSync(fixture('sycamore-tile-8.bin')));
  assert.equal(leaves.length, 8);
  for (const leaf of leaves) {
    const ours = parseCertificate(leaf.der);
    const node = new X509Certificate(leaf.der);
    const sanDns = (node.subjectAltName || '').split(', ').filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4));
    for (const d of sanDns) assert.ok(ours.all_domains.includes(d), `missing ${d}`);
    assert.equal(ours.serial_number, node.serialNumber.replace(/^0+/, ''));
    assert.equal(ours.not_after, Math.floor(Date.parse(node.validTo) / 1000));
    assert.equal(ours.not_before, Math.floor(Date.parse(node.validFrom) / 1000));
    assert.equal(ours.is_precert, leaf.entryType === 1);
    assert.equal(ours.extensions.ctlPoisonByte === true, leaf.entryType === 1);
    assert.equal(fingerprints(leaf.der).sha1, node.fingerprint);
    assert.equal(fingerprints(leaf.der).sha256, node.fingerprint256);
  }
});

test('carries the DER bytes only on the full stream', () => {
  const lite = leafCertObject(synthetic);
  const full = leafCertObject(synthetic, undefined, undefined, true);
  assert.equal('as_der' in lite, false);
  assert.equal(full.as_der, synthetic.toString('base64'));
  assert.equal(full.fingerprint, full.sha1);
  const chain = chainCertObject(synthetic);
  assert.equal(chain.as_der, synthetic.toString('base64'));
  assert.equal('all_domains' in chain, false);
});

test('shows internationalised names in Unicode, keeping a leading wildcard', () => {
  assert.equal(unicodeDomain('xn--mgbh0fb.example'), 'مثال.example');
  assert.equal(unicodeDomain('*.xn--mgbh0fb.example'), '*.مثال.example');
  assert.equal(unicodeDomain('plain.example'), 'plain.example');
});

test('reports damaged input as a DER error instead of crashing', () => {
  assert.throws(() => parseCertificate(synthetic.subarray(0, 40)), DerError);
  assert.throws(() => parseCertificate(Buffer.from([0x30, 0x00])), DerError);
  assert.throws(() => parseCertificate(Buffer.alloc(0)), DerError);
});
