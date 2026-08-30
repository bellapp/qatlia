const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 4 blocker (1): edge banding cost used to be derived from *requested*
// `pieces[].quantity`, not from what the packer actually placed. That
// over-charges (and, for `singleSheetOnly`/no-matching-stock, silently
// mis-charges) whenever some copies of a piece are left unplaced. Edge cost
// must instead be summed from `finalPlan.placedPieces` — one entry per
// actually-placed expanded unit, each carrying the source piece's `edges`
// config and `originalIndex` — so an unplaced copy never contributes.

function loadBinpacking() {
  return loadTsModule('src/lib/cutting/binpacking.ts');
}

test('edge cost is charged only for placed units when singleSheetOnly leaves some copies unplaced', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 50, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  // 2 requested, each exactly fills the single sheet — only 1 can ever be
  // placed under singleSheetOnly, the second is left unplaced.
  const pieces = [{
    id: 'p1', width: 100, height: 50, quantity: 2, rotatable: false,
    edges: { top: true, color: 'white' },
  }];

  const result = optimizeCutting2D(pieces, [sheet], { singleSheetOnly: true, edgeBanding: true });

  assert.equal(result.placedPieces.length, 1, 'fixture must place exactly one unit for the assertion below to be meaningful');
  assert.equal(result.unplacedPieces.length, 1);
  // 1 placed unit x 1m (top edge = width/100 = 1m) x 8 MAD/m (white preset) = 8 MAD.
  // The old requested-quantity formula would have charged for both units (16 MAD).
  assert.equal(result.costBreakdown.edgeCost, 8);
});

test('edge cost is zero when every copy of a piece is left unplaced (no matching stock)', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 50, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{
    id: 'p1', width: 50, height: 50, quantity: 3, material: 'verre', rotatable: false,
    edges: { top: true, bottom: true, left: true, right: true, color: 'white' },
  }];

  const result = optimizeCutting2D(pieces, [sheet], { considerMaterial: true, edgeBanding: true });

  assert.equal(result.placedPieces.length, 0, 'no verre stock exists, so nothing can be placed');
  assert.equal(result.unplacedPieces.length, 3);
  assert.equal(result.costBreakdown.edgeCost, 0, 'an entirely unplaced piece must cost 0 to band, never a requested-quantity estimate');
});

test('edge cost scales exactly with placed count, not requested quantity, across a partial placement', () => {
  const { optimizeCutting2D } = loadBinpacking();
  // Sheet fits exactly 2 of the 3 requested pieces (each 50x50 on a 100x50 sheet).
  const sheet = { width: 100, height: 50, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{
    id: 'p1', width: 50, height: 50, quantity: 3, rotatable: false,
    edges: { top: true, color: 'white' }, // top edge length = width/100 = 0.5m
  }];

  const result = optimizeCutting2D(pieces, [sheet], { singleSheetOnly: true, edgeBanding: true });

  assert.equal(result.placedPieces.length, 2);
  assert.equal(result.unplacedPieces.length, 1);
  // 2 placed x 0.5m x 8 MAD/m = 8 MAD (not 3 x 0.5 x 8 = 12 MAD for the requested quantity).
  assert.equal(result.costBreakdown.edgeCost, 8);
});

test('edge cost uses the source piece\'s original dimensions, not its as-placed rotated dimensions', () => {
  const { optimizeCutting2D } = loadBinpacking();
  // The piece (width 60 x height 30) only fits this sheet (40 x 70) rotated
  // (rotated width 30 x height 60) — no packing strategy can place it
  // unrotated, so this deterministically proves which dimension the "top"
  // edge length is drawn from.
  const sheet = { width: 40, height: 70, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{
    id: 'p1', width: 60, height: 30, quantity: 1, rotatable: true,
    edges: { top: true, pricePerM: 10 },
  }];

  const result = optimizeCutting2D(pieces, [sheet], { edgeBanding: true });

  assert.equal(result.placedPieces.length, 1);
  assert.equal(result.placedPieces[0].rotated, true, 'fixture must force a rotated placement for this assertion to be meaningful');
  assert.equal(result.placedPieces[0].width, 30, 'as-placed (rotated) width');
  assert.equal(result.placedPieces[0].height, 60, 'as-placed (rotated) height');
  assert.equal(result.placedPieces[0].originalWidth, 60, 'the source piece\'s labeled width, unaffected by rotation');
  // top edge length = originalWidth / 100 = 0.6m, at 10 MAD/m = 6 MAD. Using
  // the rotated width (30cm) instead would wrongly charge 3 MAD.
  assert.equal(result.costBreakdown.edgeCost, 6);
});

test('every PlacedPiece carries edges and originalIndex traceable back to the source piece', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 100, height: 50, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'p1', width: 50, height: 50, quantity: 1, edges: { top: true, color: 'white' } }];

  const result = optimizeCutting2D(pieces, [sheet], {});

  assert.equal(result.placedPieces.length, 1);
  assert.equal(result.placedPieces[0].originalIndex, 0);
  assert.deepEqual(result.placedPieces[0].edges, { top: true, color: 'white' });
});

test('binpacking.ts derives edge cost from finalPlan.placedPieces, not the requested pieces[] with a quantity multiplier', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve('src/lib/cutting/binpacking.ts'), 'utf8');
  assert.doesNotMatch(source, /lengthM\s*\*\s*\(p\.quantity/, 'edge cost must no longer multiply a per-request length by requested quantity');
  assert.match(source, /finalPlan\.placedPieces/, 'edge cost must iterate the actually-placed pieces');
});
