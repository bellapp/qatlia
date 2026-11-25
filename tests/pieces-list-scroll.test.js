const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Owner report, 2026-11-25: with the pointer on the pieces table the page did
// not scroll, even when the table was short. `overscroll-contain` keeps the
// scroll inside the list: at its top or bottom, and on a list too short to
// scroll, the page must take over.
test('the pieces list hands the scroll over to the page at its ends', () => {
  const tag = read('src/components/PiecesManager.tsx').match(/<div[^>]*data-testid="pieces-list"[^>]*>/);
  assert.ok(tag, 'the list is found');
  assert.match(tag[0], /overflow-y-auto/, 'a long list still scrolls by itself');
  assert.doesNotMatch(tag[0], /overscroll/);
});

// The measures left the middle of the pieces (PR #135): the help of the
// "labels" option must say where they are.
test('the help of the labels option no longer puts the measures in the middle', () => {
  const words = { fr: /au centre|\(H×L\)/, en: /centre|center|\(H×W\)/, ar: /وسطها|الارتفاع × العرض/ };
  for (const [locale, old] of Object.entries(words)) {
    const messages = loadTsModule(path.join(ROOT, `src/i18n/messages/${locale}.ts`))[locale];
    assert.doesNotMatch(messages.options.labels.tooltip, old, locale);
  }
});
