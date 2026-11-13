const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// User request, 2026-11-13: a new job starts with no saw kerf and no edge
// margin, and the artisan sets both. Until then the atelier applied 3 mm of
// kerf and a 1 cm margin on every edge of the panel, and the margin had no
// setting at all.

function loadBinpacking() {
  return loadTsModule('src/lib/cutting/binpacking.ts');
}

function readSource(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('a new job starts with no saw kerf and no edge margin', () => {
  const { OPTIONS_DEFAULTS, DEFAULT_STOCK_SHEET } = loadBinpacking();

  assert.equal(OPTIONS_DEFAULTS.kerfWidth, 0);
  assert.equal(DEFAULT_STOCK_SHEET.kerf, 0);
  assert.equal(DEFAULT_STOCK_SHEET.margin, 0);
});

test('with the defaults, a piece the size of the panel fits on it', () => {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = loadBinpacking();
  const pieces = [{ id: 'whole', height: DEFAULT_STOCK_SHEET.height, width: DEFAULT_STOCK_SHEET.width, quantity: 1 }];

  const result = optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS);

  assert.equal(result.unplacedPieces.length, 0);
  assert.equal(result.sheetsUsed, 1);
  assert.deepEqual(
    { x: result.placedPieces[0].x, y: result.placedPieces[0].y },
    { x: 0, y: 0 },
    'the piece starts at the edge of the panel'
  );
});

test('pieces that fill the panel width exactly fit side by side', () => {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = loadBinpacking();
  // Four 52 cm columns make the 208 cm width with nothing to spare: any kerf
  // or margin would push the fourth onto a second panel.
  const pieces = [{ id: 'column', height: 278, width: 52, quantity: 4, rotatable: false }];

  const result = optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS);

  assert.equal(result.sheetsUsed, 1);
  assert.equal(result.unplacedPieces.length, 0);
});

test('the atelier starts from the shared default panel', () => {
  const page = readSource('src/app/(site)/atelier/page.tsx');

  assert.match(page, /const DEFAULT_SHEETS: Sheet\[\] = \[DEFAULT_STOCK_SHEET\];/);
  assert.doesNotMatch(page, /kerf:\s*0\.3/, 'no hard-coded 3 mm kerf is left in the atelier');
  assert.doesNotMatch(page, /margin:\s*1(\.0)?\b/, 'no hard-coded 1 cm margin is left in the atelier');
});

test('the edge margin has a setting, kept on the panel in cm', () => {
  const page = readSource('src/app/(site)/atelier/page.tsx');
  const panel = readSource('src/components/OptionsPanel.tsx');

  assert.match(panel, /options\.margin\.title/);
  assert.match(panel, /onEdgeMarginChange\(/);
  assert.match(page, /margin: marginMm \/ 10/, 'the setting is in mm, the panel keeps cm');
  assert.match(page, /onEdgeMarginChange=\{handleEdgeMarginChange\}/);
});

test('a job saved with a margin keeps it when it is opened again', () => {
  // The setting shows the panel's own margin, so a project saved while the
  // margin was 1 cm reads 10 mm and is laid out as before.
  const page = readSource('src/app/(site)/atelier/page.tsx');
  assert.match(page, /edgeMarginMm=\{Math\.round\(\(activeSheet\.margin \?\? 0\) \* 100\) \/ 10\}/);
});
