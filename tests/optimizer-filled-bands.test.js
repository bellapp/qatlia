const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Customer report, 2026-11-15: a carpenter's list of 19 pieces for one
// 206 × 279 panel came out on two panels. The pieces share two dimensions
// (70 and 33), and stacked as four bands running the panel's height
// (70 + 70 + 33 + 33 = 206) they fill a single panel at 97 %. Finding that
// plan takes choosing, for each band, the combination of pieces that fills
// its length best; filling a band longest piece first does not get there.

const CARPENTER_PIECES = [
  [70, 37.2, 2], [70, 45, 2],
  [70, 48, 1], [70, 97, 1], [70, 74, 1],
  [70, 33, 6], [95.2, 33, 2], [72.2, 33, 2], [58.2, 33, 2],
].map(([height, width, quantity], index) => ({
  id: `row${index}`, name: `Row ${index}`, height, width, quantity, material: 'mdf', rotatable: true,
}));
const CARPENTER_PIECE_COUNT = 19;

function assertPlanIsCuttable(result, sheet) {
  const margin = Math.max(0, sheet.margin || 0);
  const kerf = Math.max(0, sheet.kerf || 0);
  for (const planSheet of result.sheets) {
    for (const piece of planSheet.pieces) {
      assert.ok(piece.x >= margin - 1e-9 && piece.y >= margin - 1e-9, `piece ${piece.pieceId} starts inside the margin`);
      assert.ok(piece.x + piece.width <= sheet.width - margin + 1e-9, `piece ${piece.pieceId} runs past the panel's width`);
      assert.ok(piece.y + piece.height <= sheet.height - margin + 1e-9, `piece ${piece.pieceId} runs past the panel's height`);
    }
    for (let i = 0; i < planSheet.pieces.length; i += 1) {
      for (let j = i + 1; j < planSheet.pieces.length; j += 1) {
        const a = planSheet.pieces[i];
        const b = planSheet.pieces[j];
        // Two pieces are a saw pass apart along at least one axis.
        const apartAlongWidth = a.x + a.width + kerf <= b.x + 1e-9 || b.x + b.width + kerf <= a.x + 1e-9;
        const apartAlongHeight = a.y + a.height + kerf <= b.y + 1e-9 || b.y + b.height + kerf <= a.y + 1e-9;
        assert.ok(apartAlongWidth || apartAlongHeight, `pieces ${a.pieceId} and ${b.pieceId} overlap or sit closer than the saw kerf`);
      }
    }
  }
}

function assertPiecesKeepTheirSize(result, pieces) {
  const sizeOf = new Map(pieces.map((piece) => [piece.id, [piece.height, piece.width].sort((a, b) => a - b).join('x')]));
  for (const placed of result.placedPieces) {
    const source = [...sizeOf.keys()].find((id) => String(placed.pieceId).startsWith(id));
    assert.ok(source, `placed piece ${placed.pieceId} comes from the list`);
    assert.equal([placed.height, placed.width].sort((a, b) => a - b).join('x'), sizeOf.get(source), `piece ${placed.pieceId} keeps its size`);
  }
}

test('the carpenter\'s 19 pieces fit one 206 × 279 panel', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 206, height: 279, kerf: 0, margin: 0, material: 'mdf', quantity: 5 };

  const result = optimizeCutting2D(CARPENTER_PIECES, [sheet], { considerMaterial: false, grainDirection: false });

  assert.equal(result.unplacedPieces.length, 0, 'every piece is placed');
  assert.equal(result.placedPieces.length, CARPENTER_PIECE_COUNT);
  assert.equal(result.sheets.length, 1, 'the whole list fits one panel');
  assertPlanIsCuttable(result, sheet);
  assertPiecesKeepTheirSize(result, CARPENTER_PIECES);
});

test('the one-panel plan holds with the panel entered the other way round', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 279, height: 206, kerf: 0, margin: 0, material: 'mdf', quantity: 5 };

  const result = optimizeCutting2D(CARPENTER_PIECES, [sheet], { considerMaterial: false, grainDirection: false });

  assert.equal(result.unplacedPieces.length, 0, 'every piece is placed');
  assert.equal(result.sheets.length, 1, 'the whole list fits one panel');
  assertPlanIsCuttable(result, sheet);
});

test('filled bands leave a saw kerf between pieces and stay inside the margin', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  // The same list on a panel large enough to take the four bands once every
  // saw pass (3 mm) and a 1 cm edge margin are counted.
  const sheet = { width: 209, height: 283.5, kerf: 0.3, margin: 1, material: 'mdf', quantity: 5 };

  const result = optimizeCutting2D(CARPENTER_PIECES, [sheet], { considerMaterial: false, grainDirection: false });

  assert.equal(result.unplacedPieces.length, 0, 'every piece is placed');
  assert.equal(result.sheets.length, 1, 'the whole list fits one panel');
  assertPlanIsCuttable(result, sheet);
});

test('with a 3 mm kerf the four bands no longer fit 206 cm, and the job keeps its two-panel plan', () => {
  const { optimizeCutting2D, GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');
  // 70 + 70 + 33 + 33 and three saw passes make 206.9 cm: one panel is out of
  // reach, so the filled bands save nothing here and must change nothing.
  const sheet = { width: 206, height: 279, kerf: 0.3, margin: 0, material: 'mdf', quantity: 5 };
  const options = { considerMaterial: false, grainDirection: false };

  const result = optimizeCutting2D(CARPENTER_PIECES, [sheet], options);

  assert.equal(result.unplacedPieces.length, 0, 'every piece is placed');
  assert.equal(result.sheets.length, 2);
  assertPlanIsCuttable(result, sheet);

  // The plan is the one the usual strategies give on their own.
  const filledBands = GuillotinePacker.filledBandStrategies;
  const saved = [...filledBands];
  filledBands.splice(0, filledBands.length);
  try {
    const usual = optimizeCutting2D(CARPENTER_PIECES, [sheet], options);
    assert.deepEqual(result.sheets, usual.sheets);
  } finally {
    filledBands.splice(0, filledBands.length, ...saved);
  }
});

test('a grain-locked list is banded without turning a piece', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 206, height: 279, kerf: 0, margin: 0, material: 'mdf', quantity: 5 };
  // The one-panel plan as the carpenter would write it with the grain along
  // the panel's height: widths 70 and 33, nothing to turn.
  const upright = [
    [74, 70, 1], [97, 70, 1], [37.2, 70, 2], [48, 70, 1], [45, 70, 2], [33, 70, 5],
    [95.2, 33, 2], [72.2, 33, 2], [70, 33, 1], [58.2, 33, 2],
  ].map(([height, width, quantity], index) => ({
    id: `row${index}`, name: `Row ${index}`, height, width, quantity, material: 'mdf', rotatable: false,
  }));

  const result = optimizeCutting2D(upright, [sheet], { considerMaterial: false, grainDirection: true });

  assert.equal(result.unplacedPieces.length, 0, 'every piece is placed');
  assert.equal(result.sheets.length, 1, 'the whole list fits one panel');
  assertPlanIsCuttable(result, sheet);
  for (const placed of result.placedPieces) {
    assert.equal(placed.rotated, false, `piece ${placed.pieceId} is not turned against the grain`);
    assert.equal(placed.height, placed.originalHeight);
    assert.equal(placed.width, placed.originalWidth);
  }
});
