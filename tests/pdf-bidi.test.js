const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// pdf-bidi.ts used to also own a hand-rolled visual-reorder algorithm
// (`toVisualOrder`) for shaped Arabic text; that is gone (see the module's
// doc comment for why -- it produced a genuine double-shaping ligature
// corruption bug that jsPDF's own bidi/shaping pipeline, driven correctly,
// does not have -- see pdf-fonts.ts's `arabicBidiOptions`/
// `drawContentAwareText` and tests/pdf-artifact.test.js for the empirical
// proof). All that remains here is the content-detection helper used to gate
// Arabic-specific handling on a string's actual content.

function load() {
  return loadTsModule('src/lib/exports/pdf-bidi.ts');
}

test('containsArabicScript is true for a string with Arabic letters', () => {
  const { containsArabicScript } = load();
  assert.equal(containsArabicScript('قطع'), true);
  assert.equal(containsArabicScript('العملة: MAD'), true);
});

test('containsArabicScript is true for a string mixing Arabic with Latin/digits/punctuation', () => {
  const { containsArabicScript } = load();
  assert.equal(containsArabicScript('قطعة 200.00 MAD'), true);
  assert.equal(containsArabicScript('الأبعاد (cm)'), true);
});

test('containsArabicScript recognises already-shaped Arabic presentation-form glyphs too', () => {
  const { containsArabicScript } = load();
  // U+FE8D..U+FE94 etc. are presentation forms (what jsPDF's own
  // processArabic() shaping produces) -- a shaped word must still be
  // detected as Arabic content, e.g. when re-checking a raw cell value that
  // could already have been shaped upstream.
  assert.equal(containsArabicScript('ﺍﻟﻣ'), true);
});

test('containsArabicScript is false for plain Latin/digit/punctuation text', () => {
  const { containsArabicScript } = load();
  assert.equal(containsArabicScript('Sous-total du débit: 200.00 MAD'), false);
  assert.equal(containsArabicScript('208.5 × 120.0 cm'), false);
  assert.equal(containsArabicScript(''), false);
});

test('pdf-bidi.ts exports no custom UAX#9 reordering implementation', () => {
  const mod = load();
  assert.equal(mod.toVisualOrder, undefined, 'the hand-rolled visual reorder must be gone, not just unused');
  assert.deepEqual(Object.keys(mod), ['containsArabicScript']);
});
