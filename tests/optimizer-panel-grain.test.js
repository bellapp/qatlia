const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Customer report, 2026-11-25 (voice note from a carpenter): « the first
// measure is always the grain ». On a panel with ramage he found a piece
// turned on the plan. Ticking « Panneau avec ramage » only drew the veining:
// every piece left unset could still be turned against it, and the server
// even dropped the panel's grain from the request.
//
// The rule now: on a grained panel, a piece nobody set keeps its first
// measure (its height) along the panel's grain. A piece the artisan freed
// (grain 'none') may still turn.

const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

const OPTIONS = { considerMaterial: false, grainDirection: false };
// 280 high, 207 wide: the usual Moroccan panel stood up, grain along the 280.
const PANEL = { width: 207, height: 280, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
const GRAINED = { ...PANEL, hasGrain: true, grainOrientation: 'vertical' };
// The same board lying down: grain along its 280 cm width.
const LYING = { width: 280, height: 207, kerf: 0, margin: 0, material: 'mdf', quantity: 1, hasGrain: true, grainOrientation: 'horizontal' };

// 100 × 250: only fits turned (250 along the 280), i.e. against a vertical grain.
const WIDE = { id: 'wide', name: 'Wide', height: 100, width: 250, quantity: 1, material: 'mdf' };

function placed(result, id) {
  return result.placedPieces.find((p) => String(p.pieceId).startsWith(id));
}

test('without grain on the panel, a piece still turns to fit', () => {
  const result = optimizeCutting2D([WIDE], [PANEL], OPTIONS);
  assert.equal(result.unplacedPieces.length, 0);
  const piece = placed(result, 'wide');
  assert.equal(piece.height, 250, 'turned: its 250 runs along the panel height');
});

test('on a grained panel, a piece nobody set keeps its first measure along the grain', () => {
  const result = optimizeCutting2D([WIDE], [GRAINED], OPTIONS);
  assert.equal(result.placedPieces.length, 0, 'turning it would cross the grain, so it does not fit');
  assert.equal(result.unplacedPieces.length, 1);
});

test('on a grained panel, a piece that fits upright is never turned', () => {
  const pieces = [
    { id: 'side', name: 'Side', height: 70, width: 50, quantity: 6, material: 'mdf' },
    { id: 'shelf', name: 'Shelf', height: 40, width: 90, quantity: 4, material: 'mdf' },
  ];
  const result = optimizeCutting2D(pieces, [GRAINED], OPTIONS);
  assert.equal(result.unplacedPieces.length, 0);
  for (const p of result.placedPieces) {
    assert.equal(p.height, p.originalHeight, `${p.pieceId} keeps its first measure along the grain`);
    assert.equal(p.width, p.originalWidth);
  }
});

test('a piece the artisan freed (ramage: none) may still turn on a grained panel', () => {
  const result = optimizeCutting2D([{ ...WIDE, grain: 'none' }], [GRAINED], OPTIONS);
  assert.equal(result.unplacedPieces.length, 0);
  assert.equal(placed(result, 'wide').height, 250);
});

test('a horizontal-grain panel takes the first measure along its width', () => {
  // 100 × 250 on the lying board: the 100 must run along the 280 cm width,
  // so the 250 stands across a 207 cm board: it cannot be placed.
  const lockedOut = optimizeCutting2D([WIDE], [LYING], OPTIONS);
  assert.equal(lockedOut.placedPieces.length, 0);

  // 250 × 100: its 250 lies along the 280 cm width.
  const long = { id: 'long', name: 'Long', height: 250, width: 100, quantity: 1, material: 'mdf' };
  const result = optimizeCutting2D([long], [LYING], OPTIONS);
  assert.equal(result.unplacedPieces.length, 0);
  const piece = placed(result, 'long');
  assert.equal(piece.width, 250, 'the first measure runs along the grain, across the board');
  assert.equal(piece.height, 100);
});

test('a piece set to vertical grain follows a horizontal-grain panel too', () => {
  const long = { id: 'long', name: 'Long', height: 250, width: 100, quantity: 1, material: 'mdf', grain: 'vertical' };
  const result = optimizeCutting2D([long], [LYING], OPTIONS);
  assert.equal(result.unplacedPieces.length, 0, 'it used to stand 250 high on a 207 cm board and fall out');
  assert.equal(placed(result, 'long').width, 250);
});

test('the API keeps the panel grain instead of dropping it', () => {
  const { OptimizeSchema } = loadTsModule('src/lib/cutting/optimize-schema.ts');
  const parsed = OptimizeSchema.parse({
    sheets: [{ width: 207, height: 280, hasGrain: true, grainOrientation: 'horizontal' }],
    pieces: [{ width: 50, height: 70 }],
  });
  assert.equal(parsed.sheets[0].hasGrain, true);
  assert.equal(parsed.sheets[0].grainOrientation, 'horizontal');
});
