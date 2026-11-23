const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The account page lists every credit movement. After a few weeks the list
// pushed "Mon entreprise" far below the fold (user report, 2026-11-23), so
// only the latest movements show until the artisan asks for the rest.

const { ledgerPreview, LEDGER_PREVIEW_COUNT } = loadTsModule('src/lib/credit-ledger-preview.ts');

const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: `tx${i}` }));

test('the preview shows the five latest movements', () => {
  assert.equal(LEDGER_PREVIEW_COUNT, 5);
  const { shown, hidden } = ledgerPreview(rows(12), false);
  assert.deepEqual(shown.map((r) => r.id), ['tx0', 'tx1', 'tx2', 'tx3', 'tx4']);
  assert.equal(hidden, 7);
});

test('the expanded list shows every movement and hides none', () => {
  const { shown, hidden } = ledgerPreview(rows(12), true);
  assert.equal(shown.length, 12);
  assert.equal(hidden, 0);
});

test('a short ledger has nothing to hide', () => {
  for (const count of [0, 3, 5]) {
    const { shown, hidden } = ledgerPreview(rows(count), false);
    assert.equal(shown.length, count);
    assert.equal(hidden, 0);
  }
});

test('the account page renders the preview, not the whole ledger', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app/(site)/account/page.tsx'), 'utf8');
  assert.match(source, /ledgerPreview\(/);
  assert.doesNotMatch(source, /\btxs\.map\(/, 'the full ledger must not be rendered directly');
  assert.match(source, /accountPage\.ledgerShowAll/);
  assert.match(source, /accountPage\.ledgerShowLess/);
  assert.match(source, /aria-expanded/);
});
