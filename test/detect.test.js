import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainToASCII } from 'node:url';
import { fold, foldMap, editDistance, splitDomain, compileWatchlist, detectDomain, detectNames, severityOf } from '../src/detect.js';

// Invented brands on names reserved for examples and tests (RFC 2606).
const WATCH = compileWatchlist([
  { id: 'ex', kind: 'brand', name: 'Example', domains: ['example.com'], keywords: [] },
  { id: 'nahr', kind: 'brand', name: 'Nahr', domains: ['nahr.test'], keywords: [] },
  { id: 'kw', kind: 'brand', name: 'Kuwait', domains: ['gov.kw'], keywords: ['kuwait', 'الكويت'] },
  { id: 'off', kind: 'brand', name: 'Off', domains: ['example.org'], keywords: ['example'], enabled: false },
  { id: 'dot-kw', kind: 'pattern', name: 'Kuwait domains', pattern: '\\.kw$', severity: 'low' },
]);

function finding(domain, id) {
  const f = detectDomain(domain, WATCH).find((x) => x.watch.id === id);
  return f ? [f.score, [...f.reasons].sort()] : null;
}

test('folding maps look-alike letters, marks and Arabic variants to one form', () => {
  assert.equal(fold('ЕXАMPLE'), 'example', 'Cyrillic capitals');
  assert.equal(fold('ｅｘａｍｐｌｅ'), 'example', 'full width letters');
  assert.equal(fold('éxämple'), 'example', 'marks');
  assert.equal(fold('الکويت'), fold('الكويت'), 'Persian kaf');
  assert.equal(fold('الكوىت'), fold('الكويت'), 'dotless yeh');
  assert.equal(fold('مكافأة'), 'مكافاه', 'hamza and teh marbuta');
  assert.equal(fold('تَحْقِيق'), 'تحقيق', 'short vowels');
  assert.equal(fold('٢٠٢٦'), '2026', 'Arabic digits');
});

test('edit distance counts a swap of neighbours as one edit', () => {
  assert.equal(editDistance('nahr', 'nhar'), 1);
  assert.equal(editDistance('example', 'exmaple'), 1);
  assert.equal(editDistance('example', 'exampel'), 1);
  assert.equal(editDistance('example', 'xeampel'), 2);
  assert.equal(editDistance('abc', 'xyz', 1), 2, 'stops early past the limit');
});

test('domains split into subdomains, name and ending, country endings included', () => {
  assert.deepEqual(splitDomain('a.b.example.com.kw'), { name: 'example', suffix: 'com.kw', sub: ['a', 'b'] });
  assert.deepEqual(splitDomain('www.example.co.uk'), { name: 'example', suffix: 'co.uk', sub: ['www'] });
  assert.deepEqual(splitDomain('shop.example.com'), { name: 'example', suffix: 'com', sub: ['shop'] });
  assert.deepEqual(splitDomain('gov.kw'), { name: '', suffix: 'gov.kw', sub: [] }, 'an ending on its own has no name');
});

test('a brand is flagged for each way a name can imitate it', () => {
  assert.deepEqual(finding('example-login.test', 'ex'), [70, ['keyword', 'lure-word']]);
  assert.deepEqual(finding('example.com.verify-pay.test', 'ex'), [100, ['embedded-domain', 'keyword', 'lure-word', 'subdomain']]);
  assert.deepEqual(finding('secure.example.shop.test', 'ex'), [80, ['keyword', 'lure-word', 'subdomain']]);
  assert.deepEqual(finding('example.test', 'ex'), [75, ['keyword', 'tld-swap']]);
  assert.deepEqual(finding(domainToASCII('еxample-pay.test'), 'ex'), [100, ['homoglyph', 'idn', 'lure-word']], 'Cyrillic e');
  assert.deepEqual(finding('examp1e.test', 'ex'), [75, ['swap']]);
  assert.deepEqual(finding('exmaple-support.test', 'ex'), [85, ['lure-word', 'typo']]);
  assert.deepEqual(finding('nhar-pay.test', 'nahr'), [75, ['lure-word', 'typo']], 'a four letter brand with a lure word');
  assert.deepEqual(finding('kuwait-fines.test', 'kw'), [70, ['keyword', 'lure-word']]);
  assert.deepEqual(finding(domainToASCII('الکويت-دفع.test'), 'kw'), [100, ['homoglyph', 'idn', 'lure-word']], 'Persian kaf and an Arabic lure word');
  assert.deepEqual(finding(domainToASCII('الكويت-مخالفات.test'), 'kw'), [75, ['idn', 'keyword', 'lure-word']]);
  const f = detectDomain(domainToASCII('الکويت-دفع.test'), WATCH)[0];
  assert.equal(f.unicode, 'الکويت-دفع.test');
  assert.equal(f.severity, 'high');
});

test('the brand itself, and ordinary names, raise nothing', () => {
  const quiet = [
    'example.com', 'www.example.com', 'nahr.test', 'pay.nahr.test', 'moi.gov.kw', 'www.gov.pl', 'shop.test',
    'mynahrwork.test', // a word under five letters must start a word
    'nhar.test', // a four letter brand's misspelling needs a lure word
    'bahr-account.test', // and the same first letter
    'ahr-pay.test', // and a piece no shorter than the brand minus one letter
  ];
  for (const d of quiet) assert.deepEqual(detectDomain(d, WATCH).filter((x) => x.watch.kind === 'brand'), [], d);
});

test('patterns match whatever the brands allow', () => {
  assert.deepEqual(finding('store.kw', 'dot-kw'), [45, ['pattern']]);
  assert.deepEqual(finding('nahr.kw', 'dot-kw'), [45, ['pattern']]);
});

test('a certificate keeps the strongest finding per watchlist entry', () => {
  const found = detectNames(['shop.test', 'example-login.test', 'example.com.verify-pay.test'], WATCH);
  assert.equal(found.length, 1);
  assert.equal(found[0].score, 100);
  assert.equal(found[0].domain, 'example.com.verify-pay.test');
  assert.deepEqual(detectNames(['example-login.test'], compileWatchlist([])), []);
});

test('folding keeps track of where each character came from', () => {
  assert.deepEqual(foldMap('ﬁx'), { text: 'fix', chars: ['f', 'i', 'x'], from: [0, 0, 1] });
  assert.deepEqual(foldMap('е1').from, [0, 1]);
});

test('every finding carries evidence placed on the name as it is written', () => {
  const evidence = (d, id) => Object.fromEntries(detectDomain(d, WATCH).find((x) => x.watch.id === id).evidence.map((e) => [e.reason, e]));
  const cyrillic = evidence(domainToASCII('еxample-pay.test'), 'ex');
  assert.deepEqual(cyrillic.homoglyph.at, [0, 7]);
  assert.deepEqual(cyrillic.homoglyph.chars, [{ at: 0, char: 'е', as: 'e', code: 'U+0435', script: 'cyrillic' }]);
  assert.deepEqual(cyrillic['lure-word'], { reason: 'lure-word', words: ['pay'], at: [[8, 11]] });
  assert.equal(cyrillic.idn.ascii, domainToASCII('еxample-pay.test'));
  const kaf = evidence(domainToASCII('الکويت-دفع.test'), 'kw');
  assert.deepEqual(kaf.homoglyph.chars.map((c) => [c.at, c.char, c.as, c.code, c.script]), [[2, 'ک', 'ك', 'U+06A9', 'arabic_variant']]);
  assert.deepEqual(kaf['lure-word'].words, ['دفع']);
  assert.deepEqual(evidence('examp1e.test', 'ex').swap.swaps, [{ at: 5, from: '1', to: 'l' }]);
  const rn = evidence('exarnple.test', 'ex').swap;
  assert.deepEqual([rn.at, rn.swaps], [[0, 8], [{ at: 3, from: 'rn', to: 'm' }]], 'two written letters for one');
  assert.deepEqual(evidence('exmaple-support.test', 'ex').typo, { reason: 'typo', word: 'example', piece: 'exmaple', distance: 1, at: [0, 7] });
  assert.deepEqual(evidence('example.test', 'ex')['tld-swap'], { reason: 'tld-swap', name: 'example', ending: 'test', real: ['com'] });
  assert.deepEqual(evidence('secure.example.shop.test', 'ex').subdomain, { reason: 'subdomain', label: 'example' });
  assert.deepEqual(evidence('store.kw', 'dot-kw').pattern, { reason: 'pattern', pattern: '\\.kw$', on: 'ascii', at: [5, 8] });
});

test('the real domain written with hyphens for dots counts as written inside', () => {
  assert.deepEqual(finding('example-com-login.test', 'ex'), [100, ['embedded-domain', 'keyword', 'lure-word']]);
  const e = detectDomain('example-com.test', WATCH).find((x) => x.watch.id === 'ex');
  assert.equal(e.score, 85);
  assert.deepEqual(e.evidence[0], { reason: 'embedded-domain', domain: 'example.com', form: 'hyphens', written: 'example-com', at: [0, 11] });
});

test('severity follows the score', () => {
  assert.deepEqual([100, 80, 79, 60, 59, 0].map(severityOf), ['high', 'high', 'medium', 'medium', 'low', 'low']);
});
