import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseDataTile, parseRfc6962Entry, leafIndexFromExtensions, LeafError, X509_ENTRY, PRECERT_ENTRY } from '../src/leaf.js';
import { tilePath, dataTileUrl, planTiles } from '../src/tiles.js';
import { verifySth, parseCheckpoint, verifyCheckpoint } from '../src/sth.js';
import { parseCertificate } from '../src/x509.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const tile = readFileSync(fixture('sycamore-tile-8.bin'));
const tileMeta = JSON.parse(readFileSync(fixture('sycamore-tile-8.json'), 'utf8'));
const argon = JSON.parse(readFileSync(fixture('argon-entries.json'), 'utf8'));
const heads = JSON.parse(readFileSync(fixture('tree-heads.json'), 'utf8'));

test('splits a static CT data tile into its entries', () => {
  const leaves = parseDataTile(tile);
  assert.deepEqual(leaves.map((l) => l.entryType), tileMeta.types);
  leaves.forEach((leaf, i) => {
    assert.equal(leaf.leafIndex, tileMeta.tile_index * 256 + i);
    assert.ok(leaf.timestamp > Date.parse('2026-01-01'));
    assert.ok(leaf.chainFingerprints.length >= 1);
    for (const fp of leaf.chainFingerprints) {
      const der = Buffer.from(tileMeta.issuers[fp], 'base64');
      assert.equal(createHash('sha256').update(der).digest('hex'), fp);
    }
    assert.equal(parseCertificate(leaf.der).is_precert, leaf.entryType === PRECERT_ENTRY);
  });
});

test('rejects a truncated tile', () => {
  assert.throws(() => parseDataTile(tile.subarray(0, tile.length - 10)), LeafError);
});

test('reads get-entries items for both entry types', () => {
  const types = new Set();
  for (const item of argon.entries) {
    const e = parseRfc6962Entry(item);
    types.add(e.entryType);
    assert.ok(e.chain.length >= 1, 'chain present');
    const p = parseCertificate(e.der);
    assert.equal(p.is_precert, e.entryType === PRECERT_ENTRY);
    assert.ok(p.all_domains.length >= 1);
    for (const c of e.chain) assert.equal(parseCertificate(c).is_ca, true);
  }
  assert.deepEqual([...types].sort(), [X509_ENTRY, PRECERT_ENTRY]);
});

test('finds the leaf index extension', () => {
  assert.equal(leafIndexFromExtensions(Buffer.from('000005003999d800', 'hex')), 0x3999d800);
  assert.equal(leafIndexFromExtensions(Buffer.alloc(0)), null);
});

test('encodes tile indexes as the spec shows', () => {
  assert.equal(tilePath(0), '000');
  assert.equal(tilePath(999), '999');
  assert.equal(tilePath(1000), 'x001/000');
  assert.equal(tilePath(1234067), 'x001/x234/067');
  assert.equal(dataTileUrl('https://log.example/', 5), 'https://log.example/tile/data/005');
  assert.equal(dataTileUrl('https://log.example/', 5, 17), 'https://log.example/tile/data/005.p/17');
  assert.throws(() => tilePath(-1), RangeError);
});

test('plans full tiles, and the partial tail only when asked', () => {
  // The spec's example: a tree of 70,000 has 273 full tiles and a partial of 112.
  const full = planTiles(0, 70000, false);
  assert.equal(full.length, 273);
  const withTail = planTiles(0, 70000, true);
  assert.equal(withTail.length, 274);
  assert.deepEqual(withTail.at(-1), { n: 273, width: 112, skip: 0 });
  assert.deepEqual(planTiles(69900, 70000, true), [{ n: 273, width: 112, skip: 12 }]);
  assert.deepEqual(planTiles(256 + 10, 512, false), [{ n: 1, width: 256, skip: 10 }]);
  assert.deepEqual(planTiles(500, 500, true), []);
});

test('verifies an RFC 6962 signed tree head and notices tampering', () => {
  const { sth, key } = heads.rfc6962;
  assert.equal(verifySth(sth, key), true);
  assert.equal(verifySth({ ...sth, tree_size: sth.tree_size + 1 }, key), false);
  assert.equal(verifySth(sth, heads.static.key), false);
});

test('verifies a static CT checkpoint and notices tampering', () => {
  const { checkpoint, key } = heads.static;
  const cp = parseCheckpoint(checkpoint);
  assert.ok(cp.treeSize > 0);
  assert.equal(cp.origin, 'log.sycamore.ct.letsencrypt.org/2026h2');
  assert.ok(verifyCheckpoint(cp, key) > Date.parse('2026-01-01'));
  assert.equal(verifyCheckpoint({ ...cp, treeSize: cp.treeSize + 1 }, key), null);
  assert.equal(verifyCheckpoint(cp, heads.rfc6962.key), null);
  assert.throws(() => parseCheckpoint('origin\nnot a number\n'), /checkpoint/);
});
