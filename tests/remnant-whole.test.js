const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Customer report, 2026-11-13. A kitchen job of 67 pieces takes four panels
// and fills the fourth less than half. A competing plan held that panel's
// pieces in a 91 cm strip and left the rest of it in one piece, full length;
// ours spread a few pieces across the panel and left the same area in
// scattered rectangles, none of them long enough for a 251 cm part. Sheet
// count and waste were the same in both: what differed was what the workshop
// could still do with the last panel.

function loadBinpacking() {
  return loadTsModule('src/lib/cutting/binpacking.ts');
}

// The customer's cut list, as typed in the atelier: [height, width, quantity].
const CUSTOMER_ROWS = [
  [158.8, 55.8, 2], [251, 55.8, 2], [251, 45, 2], [50.6, 45, 10], [50.4, 44.9, 2], [35, 44.9, 4],
  [50.4, 10, 4], [40, 12, 8], [40.6, 12, 4], [46.4, 14.3, 4], [247.3, 52.2, 2], [104.8, 55.8, 2],
  [44.4, 53.8, 2], [44.4, 52, 1], [52.1, 43.8, 2], [69.8, 32.8, 2], [15, 30.8, 2], [69.8, 14.4, 1],
  [30, 10, 2], [60.4, 10, 1], [139.8, 32.8, 2], [35, 32.8, 2], [31.4, 31, 4],
];
const CUSTOMER_PIECES = CUSTOMER_ROWS.map(([height, width, quantity], index) => ({
  id: `row${index}`, height, width, quantity, material: 'mdf',
}));
const CUSTOMER_PIECE_COUNT = CUSTOMER_ROWS.reduce((sum, row) => sum + row[2], 0);
const CUSTOMER_PIECE_AREA = CUSTOMER_ROWS.reduce((sum, [height, width, quantity]) => sum + (height * width * quantity), 0);
// The customer's panel with the atelier's settings at the time: 3 mm kerf, 1 cm edge margin.
const CUSTOMER_SHEET = { id: 's0', height: 279, width: 206, kerf: 0.3, margin: 1, material: 'mdf', quantity: 1 };

function overlap(a, b, epsilon = 1e-9) {
  return a.x < b.x + b.width - epsilon && a.x + a.width > b.x + epsilon
    && a.y < b.y + b.height - epsilon && a.y + a.height > b.y + epsilon;
}

/** Every piece inside its panel's margins, nothing overlapping, offcuts clear of pieces and of each other. */
function assertSoundPlan(result, sheet) {
  const margin = Math.max(0, sheet.margin || 0);
  for (const panel of result.sheets) {
    for (const piece of panel.pieces) {
      assert.ok(piece.x >= margin - 1e-9 && piece.y >= margin - 1e-9, `piece ${piece.pieceId} is inside the edge margin`);
      assert.ok(piece.x + piece.width <= panel.width - margin + 1e-9, `piece ${piece.pieceId} runs past the usable width`);
      assert.ok(piece.y + piece.height <= panel.height - margin + 1e-9, `piece ${piece.pieceId} runs past the usable height`);
    }
    for (let i = 0; i < panel.pieces.length; i += 1) {
      for (let j = i + 1; j < panel.pieces.length; j += 1) {
        assert.equal(overlap(panel.pieces[i], panel.pieces[j]), false, `pieces ${panel.pieces[i].pieceId} and ${panel.pieces[j].pieceId} overlap on panel ${panel.index}`);
      }
    }
    for (const offcut of panel.offcuts) {
      assert.ok(offcut.x >= margin - 1e-9 && offcut.y >= margin - 1e-9, `offcut ${offcut.id} is inside the edge margin`);
      assert.ok(offcut.x + offcut.width <= panel.width - margin + 1e-9, `offcut ${offcut.id} runs past the usable width`);
      assert.ok(offcut.y + offcut.height <= panel.height - margin + 1e-9, `offcut ${offcut.id} runs past the usable height`);
      for (const piece of panel.pieces) {
        assert.equal(overlap(offcut, piece), false, `offcut ${offcut.id} overlaps piece ${piece.pieceId}`);
      }
    }
    for (let i = 0; i < panel.offcuts.length; i += 1) {
      for (let j = i + 1; j < panel.offcuts.length; j += 1) {
        assert.equal(overlap(panel.offcuts[i], panel.offcuts[j]), false, `offcuts ${panel.offcuts[i].id} and ${panel.offcuts[j].id} overlap`);
      }
    }
  }
}

function largestReusableOffcut(result) {
  return result.offcuts
    .filter((offcut) => offcut.isReusable)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
}

test('the customer job leaves the rest of its part-used panel in one piece, full length', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const result = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3 });

  assert.equal(result.sheetsUsed, 4, 'the job still takes four panels');
  assert.equal(result.unplacedPieces.length, 0);
  assert.equal(result.placedPieces.length, CUSTOMER_PIECE_COUNT);
  assertSoundPlan(result, CUSTOMER_SHEET);

  const usableLength = CUSTOMER_SHEET.height - (2 * CUSTOMER_SHEET.margin);
  const remnant = largestReusableOffcut(result);
  assert.ok(remnant, 'the plan leaves a reusable offcut');
  assert.ok(Math.abs(remnant.height - usableLength) < 1e-6, `the largest offcut runs the panel's full usable length (${usableLength} cm), got ${remnant.height}`);
  // Before this pass the largest offcut was 113.4 x 219.7 cm, with the rest of
  // the free area in two more rectangles. 100 cm is what the search reaches on
  // this job with room to spare (103.8 cm), not a figure the customer asked for.
  assert.ok(remnant.width >= 100, `the full-length offcut is at least 100 cm wide, got ${remnant.width}`);
  assert.equal(remnant.sheetIndex, 3, 'the part-used panel comes last, after the three full ones');
  assert.deepEqual(result.sheets.map((sheet) => sheet.index), [0, 1, 2, 3]);
  assert.deepEqual(result.placedPieces.map((piece) => piece.pieceNumber), Array.from({ length: CUSTOMER_PIECE_COUNT }, (_, i) => i + 1), 'pieces are numbered panel by panel');
  for (const panel of result.sheets) {
    for (const item of [...panel.pieces, ...panel.offcuts, ...panel.cuts]) assert.equal(item.sheetIndex, panel.index);
    for (const offcut of panel.offcuts) assert.ok(offcut.id.startsWith(`sheet${panel.index}_offcut_`));
  }
});

test('keeping the offcut whole costs no panel and no material', () => {
  const { optimizeCutting2D } = loadBinpacking();
  for (const optimizationPriority of ['linear_guillotine', 'min_waste', 'min_sheets', 'balanced']) {
    const result = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3, optimizationPriority });
    assert.equal(result.sheetsUsed, 4, `${optimizationPriority}: four panels`);
    assert.equal(result.unplacedPieces.length, 0, `${optimizationPriority}: every piece placed`);
    assert.ok(Math.abs(result.totalAreaUsed - CUSTOMER_PIECE_AREA) < 1e-6, `${optimizationPriority}: the placed area is the pieces' area`);
    assertSoundPlan(result, CUSTOMER_SHEET);
  }
});

test('the cut that frees the offcut is counted, and comes first on its panel', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const result = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3 });
  const remnant = largestReusableOffcut(result);
  const panel = result.sheets[remnant.sheetIndex];

  const usableLength = CUSTOMER_SHEET.height - (2 * CUSTOMER_SHEET.margin);
  assert.deepEqual(
    { axis: panel.cuts[0].axis, lengthCm: panel.cuts[0].lengthCm, id: panel.cuts[0].id },
    { axis: 'vertical', lengthCm: usableLength, id: `sheet${panel.index}_cut_0` },
    'one full-length rip separates the strip from the offcut'
  );
  assert.equal(new Set(panel.cuts.map((cut) => cut.id)).size, panel.cuts.length, 'cut ids stay unique on the panel');

  // The offcut starts one kerf past the furthest piece of its panel.
  const reach = Math.max(...panel.pieces.map((piece) => piece.x + piece.width));
  assert.ok(Math.abs(remnant.x - (reach + CUSTOMER_SHEET.kerf)) < 1e-6, `the offcut starts one kerf after the strip (strip ends at ${reach}, offcut at ${remnant.x})`);

  const cutLengthCm = result.sheets.reduce((sum, sheet) => sum + sheet.cuts.reduce((s, cut) => s + cut.lengthCm, 0), 0);
  assert.equal(result.totalLinearCutMeters, Math.round((cutLengthCm / 100) * 10) / 10);
});

test('the same job always gets the same plan', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const first = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3 });
  const second = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3 });
  assert.deepEqual(second, first);
});

test('a small job on one panel keeps the rest of the panel whole', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { height: 280, width: 200, kerf: 0, margin: 0, material: 'mdf', quantity: 1 };
  // A door, two tops and two squares: 24 200 cm2 on a 56 000 cm2 panel. The
  // first search leaves 140 x 120 cm as its largest offcut; the pieces fit a
  // 120 cm strip, which leaves 80 cm of the panel untouched over its length.
  const pieces = [
    { id: 'door', height: 200, width: 60, quantity: 1 },
    { id: 'top', height: 30, width: 120, quantity: 2 },
    { id: 'square', height: 50, width: 50, quantity: 2 },
  ];
  const result = optimizeCutting2D(pieces, [sheet], {});

  assert.equal(result.sheetsUsed, 1);
  assert.equal(result.unplacedPieces.length, 0);
  assertSoundPlan(result, sheet);
  const remnant = largestReusableOffcut(result);
  assert.equal(remnant.height, 280, 'the offcut runs the panel full length');
  assert.ok(remnant.width >= 80, `80 cm of the panel stays whole, got ${remnant.width} cm`);
});

test('pieces locked by the grain are never turned to narrow the strip', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const result = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3, grainDirection: true });

  assert.equal(result.unplacedPieces.length, 0);
  assertSoundPlan(result, CUSTOMER_SHEET);
  for (const piece of result.placedPieces) {
    assert.equal(piece.rotated, false, `piece ${piece.pieceId} keeps its orientation`);
    assert.equal(piece.height, piece.originalHeight);
    assert.equal(piece.width, piece.originalWidth);
  }
});

test('single-panel mode still uses one panel', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const result = optimizeCutting2D(CUSTOMER_PIECES, [CUSTOMER_SHEET], { kerfWidth: 3, singleSheetOnly: true });

  assert.equal(result.sheetsUsed, 1);
  assert.equal(result.placedPieces.length + result.unplacedPieces.length, CUSTOMER_PIECE_COUNT);
  assertSoundPlan(result, CUSTOMER_SHEET);
});

test('random jobs stay sound and lose no piece, panel or area to the second pass', () => {
  const { optimizeCutting2D, GuillotinePacker } = loadBinpacking();
  const sheet = { height: 278, width: 208, kerf: 0.3, margin: 1, material: 'mdf', quantity: 1 };
  let seed = 20261113;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let job = 0; job < 12; job += 1) {
    const pieces = [];
    const count = 5 + Math.floor(random() * 40);
    for (let i = 0; i < count; i += 1) {
      pieces.push({
        id: `j${job}p${i}`,
        height: Math.round(10 + (random() * 150)),
        width: Math.round(10 + (random() * 70)),
        quantity: 1 + Math.floor(random() * 3),
        rotatable: random() > 0.2,
      });
    }
    const expanded = pieces.reduce((sum, piece) => sum + piece.quantity, 0);
    const area = pieces.reduce((sum, piece) => sum + (piece.height * piece.width * piece.quantity), 0);

    const result = optimizeCutting2D(pieces, [sheet], { kerfWidth: 3 });
    const firstSearchOnly = GuillotinePacker.withoutRemnantPass(() => optimizeCutting2D(pieces, [sheet], { kerfWidth: 3 }));

    assertSoundPlan(result, sheet);
    assert.equal(result.placedPieces.length, expanded, `job ${job}: every piece placed`);
    assert.equal(result.sheetsUsed, firstSearchOnly.sheetsUsed, `job ${job}: same number of panels as the first search`);
    assert.ok(Math.abs(result.totalAreaUsed - area) < 1e-6, `job ${job}: placed area is the pieces' area`);
    assert.equal(result.wastePercentage, firstSearchOnly.wastePercentage, `job ${job}: same waste as the first search`);

    const worth = (plan) => {
      const largest = largestReusableOffcut(plan);
      return largest ? largest.width * largest.height : 0;
    };
    // A full-length offcut may win over a larger one that is not (it counts
    // for a quarter more), so the area can drop by at most that much.
    assert.ok(worth(result) >= worth(firstSearchOnly) / 1.25 - 1e-6, `job ${job}: the largest offcut is not traded for a clearly smaller one`);
  }
});

test('a plan that already keeps a full-length offcut is not rearranged for a few centimetres', () => {
  // Production report behind the shared-width bands (scripts/test-band-shared.ts):
  // two 45 x 180 uprights and six 40 x 45 shelves, all cut on 45 cm saw lines.
  // A narrower strip exists (the shelves stacked beside the uprights) and
  // would leave an offcut 15 cm wider, at the price of the shared saw lines.
  const { optimizeCutting2D } = loadBinpacking();
  const sheet = { width: 278, height: 208, kerf: 0.3, margin: 1, material: 'mdf', quantity: 1 };
  const pieces = [
    { id: 'upright', height: 45, width: 180, quantity: 2, material: 'mdf', rotatable: true },
    { id: 'shelf', height: 40, width: 45, quantity: 6, material: 'mdf', rotatable: true },
  ];
  const result = optimizeCutting2D(pieces, [sheet], { kerfWidth: 3 });

  assert.equal(result.sheetsUsed, 1);
  assert.equal(result.unplacedPieces.length, 0);
  assertSoundPlan(result, sheet);
  assert.deepEqual(Array.from(new Set(result.placedPieces.map((piece) => piece.height))), [45], 'every piece stays on a 45 cm saw line');
});
