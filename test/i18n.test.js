import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, PLURALS, plural } from '../web/i18n.js';

const ARABIC = /[\u0600-\u06FF]/;
const DASHES = /[\u2013\u2014]/;
// Latin that may appear inside Arabic text: product names, protocol names,
// placeholders and the filter examples.
const LATIN_ALLOWED = [/\{\w+\}/g, /\bTLS\b/g, /\bWebSocket\b/g, /\bGitHub\b/g, /\bEnglish\b/g, /\bbank\b/g, /\\\\?\.kw\$/g];

function stripAllowed(s) {
  return LATIN_ALLOWED.reduce((acc, re) => acc.replace(re, ''), s);
}

test('every string exists in both languages', () => {
  assert.deepEqual(Object.keys(STRINGS.ar).sort(), Object.keys(STRINGS.en).sort());
  for (const lang of ['ar', 'en']) {
    for (const [key, value] of Object.entries(STRINGS[lang])) assert.ok(value.trim(), `${lang}.${key} is empty`);
  }
});

test('placeholders survive translation', () => {
  for (const [key, en] of Object.entries(STRINGS.en)) {
    const holes = en.match(/\{\w+\}/g) || [];
    for (const h of holes) assert.ok(STRINGS.ar[key].includes(h), `ar.${key} lost ${h}`);
  }
});

test('Arabic text is Arabic, and English text is English', () => {
  for (const [key, ar] of Object.entries(STRINGS.ar)) {
    if (key === 'switch_language') continue; // names the other language on purpose
    assert.match(ar, ARABIC, `ar.${key} has no Arabic`);
    assert.doesNotMatch(stripAllowed(ar), /[A-Za-z]/, `ar.${key} has stray Latin: ${ar}`);
  }
  for (const [key, en] of Object.entries(STRINGS.en)) {
    if (key === 'switch_language') continue;
    assert.doesNotMatch(en, ARABIC, `en.${key} has Arabic`);
  }
});

test('Arabic sentences end with the only full stop, joined by conjunctions', () => {
  for (const [key, ar] of Object.entries(STRINGS.ar)) {
    const prose = ar.replace(/\\\\?\.kw\$/g, '');
    const stops = [...prose.matchAll(/\./g)].map((m) => m.index);
    for (const i of stops) assert.equal(i, prose.length - 1, `ar.${key} has a full stop mid-sentence: ${ar}`);
  }
});

test('no string uses an en dash or an em dash', () => {
  for (const lang of ['ar', 'en']) {
    for (const [key, value] of Object.entries(STRINGS[lang])) assert.doesNotMatch(value, DASHES, `${lang}.${key}`);
    for (const [key, forms] of Object.entries(PLURALS)) {
      for (const form of Object.values(forms[lang])) assert.doesNotMatch(form, DASHES, `${lang}.${key}`);
    }
  }
});

test('counted phrases have every plural form', () => {
  for (const [key, forms] of Object.entries(PLURALS)) {
    assert.deepEqual(Object.keys(forms.ar).sort(), ['few', 'many', 'one', 'other', 'two', 'zero'], key);
    assert.deepEqual(Object.keys(forms.en).sort(), ['one', 'other'], key);
    if (forms.en.other.includes('{n}')) {
      for (const cat of ['few', 'many', 'other']) assert.ok(forms.ar[cat].includes('{n}'), `${key}.${cat} drops the number`);
    }
  }
});

test('Arabic nouns agree with their numbers', () => {
  assert.equal(plural('ar', 'pre', 1), 'شهادة مسبقة واحدة');
  assert.equal(plural('ar', 'pre', 2), 'شهادتان مسبقتان');
  assert.equal(plural('ar', 'pre', 3), '3 شهادات مسبقة');
  assert.equal(plural('ar', 'pre', 11), '11 شهادةً مسبقة');
  assert.equal(plural('ar', 'pre', 100), '100 شهادة مسبقة');
  assert.equal(plural('ar', 'pre', 103), '103 شهادات مسبقة');
  assert.equal(plural('ar', 'logs', 49), 'يقرأ 49 سجلاً');
  assert.equal(plural('ar', 'logs', 2), 'يقرأ سجلين');
  assert.equal(plural('en', 'logs', 1), 'Reading 1 log');
  assert.equal(plural('en', 'pre', 2400), '2,400 precertificates');
});

test('every text slot in the page has a string', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-t="(\w+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 5);
  for (const k of keys) assert.ok(k in STRINGS.en && k in STRINGS.ar, `missing string ${k}`);
});
