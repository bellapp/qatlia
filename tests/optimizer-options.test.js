const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 2 (material separation + optimization priority) regression coverage.
//
// These tests exercise `optimizeCutting2D` directly against small, hand-built
// fixtures small enough to reason about by hand, plus the pure scoring policy
// exposed read-only via `GuillotinePacker` for priority-specific assertions
// that would otherwise require contrived full-search fixtures.

function rectanglesOverlap(a, b, epsilon = 1e-9) {
  return (
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.height - epsilon &&
    a.y + a.height > b.y + epsilon
  );
}

function assertPartitionAndUniqueness(result, expectedExpandedCount) {
  assert.equal(result.placedPieces.length + result.unplacedPieces.length, expectedExpandedCount, 'placed + unplaced must equal the expanded piece count');

  const placedIds = result.placedPieces.map((p) => p.pieceId);
  const unplacedIds = result.unplacedPieces.map((p) => p.id);
  assert.equal(new Set(placedIds).size, placedIds.length, 'placed piece IDs must be unique');
  assert.equal(new Set(unplacedIds).size, unplacedIds.length, 'unplaced piece IDs must be unique');
  assert.equal(new Set([...placedIds, ...unplacedIds]).size, expectedExpandedCount, 'placed + unplaced IDs must partition the expanded pieces without collisions');

  const pieceNumbers = result.placedPieces.map((p) => p.pieceNumber);
  assert.equal(new Set(pieceNumbers).size, pieceNumbers.length, 'piece numbers must be unique across the merged result');

  const sheetIndexes = result.sheets.map((s) => s.index);
  assert.equal(new Set(sheetIndexes).size, sheetIndexes.length, 'sheet indexes must be unique across the merged result');
  assert.deepEqual(sheetIndexes, [...sheetIndexes].sort((a, b) => a - b), 'sheet indexes must be stable/sequential');

  const offcutIds = result.offcuts.map((o) => o.id);
  assert.equal(new Set(offcutIds).size, offcutIds.length, 'offcut IDs must be unique across the merged result');

  for (const p of result.placedPieces) {
    assert.equal(p.sheetIndex, result.sheets.find((s) => s.pieces.some((sp) => sp.pieceId === p.pieceId))?.index, 'placedPiece.sheetIndex must match the sheet that actually contains it');
  }

  for (const sheet of result.sheets) {
    for (let i = 0; i < sheet.pieces.length; i += 1) {
      for (let j = i + 1; j < sheet.pieces.length; j += 1) {
        assert.equal(rectanglesOverlap(sheet.pieces[i], sheet.pieces[j]), false, `pieces must not overlap on sheet ${sheet.index}`);
      }
    }
  }
}

// ─── considerMaterial=true: never mix materials on one sheet ──────────────

test('considerMaterial=true never places two different materials on the same SheetResult', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [
    { id: 'mdf1', name: 'MDF', height: 50, width: 50, quantity: 2, material: 'mdf', rotatable: true },
    { id: 'verre1', name: 'Verre', height: 40, width: 40, quantity: 2, material: 'verre', rotatable: true },
  ];
  const sheets = [
    { width: 200, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 2 },
    { width: 150, height: 150, kerf: 0, margin: 0, material: 'verre', quantity: 2 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true });

  assert.ok(result.sheets.length > 0, 'expected at least one sheet to be used');
  for (const sheet of result.sheets) {
    const materialsOnSheet = new Set(sheet.pieces.map((p) => p.material));
    assert.ok(materialsOnSheet.size <= 1, `sheet ${sheet.index} must not mix materials, found ${[...materialsOnSheet].join(',')}`);
  }
  assertPartitionAndUniqueness(result, 4);
});

test('considerMaterial=true leaves pieces unplaced with a customer-safe reason when no compatible stock exists', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [
    { id: 'mdf1', name: 'MDF', height: 50, width: 50, quantity: 1, material: 'mdf', rotatable: true },
    { id: 'chene1', name: 'Chêne', height: 40, width: 40, quantity: 1, material: 'chene', rotatable: true },
  ];
  // Only mdf stock is available; no sheet is compatible with the "chene" pieces.
  const sheets = [
    { width: 200, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 2 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true });

  assert.equal(result.placedPieces.length, 1, 'the mdf piece must still be placed');
  assert.equal(result.unplacedPieces.length, 1, 'the chene piece must be left unplaced');

  const unplaced = result.unplacedPieces[0];
  assert.equal(unplaced.material, 'chene');
  assert.ok(typeof unplaced.unplacedReason === 'string' && unplaced.unplacedReason.length > 0, 'unplaced piece must carry a human-readable reason');
  assert.doesNotMatch(unplaced.unplacedReason, /strateg|beam|guillotine packer|internal/i, 'reason must stay customer-safe, not leak algorithm internals');
  assert.equal(unplaced.unplacedReasonCode, 'no_matching_stock');

  // Existing API consumers only read `.id`/array shape off unplacedPieces; adding
  // fields must not remove or rename the pre-existing ones.
  assert.equal(unplaced.id, 'chene1_0');

  assertPartitionAndUniqueness(result, 2);
});

test('considerMaterial=true merges per-material plans without ID collisions across sheets/pieces/offcuts', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [
    { id: 'mdf', name: 'MDF', height: 90, width: 90, quantity: 6, material: 'mdf', rotatable: true },
    { id: 'verre', name: 'Verre', height: 70, width: 70, quantity: 6, material: 'verre', rotatable: true },
  ];
  const sheets = [
    { width: 100, height: 100, kerf: 0.3, margin: 1, material: 'mdf', quantity: 10 },
    { width: 100, height: 100, kerf: 0.3, margin: 1, material: 'verre', quantity: 10 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true });

  assert.equal(result.unplacedPieces.length, 0, 'both materials have compatible stock and should fully place');
  assert.ok(result.sheets.length >= 2, 'expected sheets from both material groups to be present');
  assertPartitionAndUniqueness(result, 12);
});

// ─── considerMaterial=false: preserves current mixed-material behavior ────

test('considerMaterial=false allows compatible mixed-material pieces to share one sheet', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [
    { id: 'mdf1', name: 'MDF', height: 50, width: 50, quantity: 1, material: 'mdf', rotatable: true },
    { id: 'verre1', name: 'Verre', height: 50, width: 50, quantity: 1, material: 'verre', rotatable: true },
  ];
  const sheets = [
    { width: 100, height: 50, kerf: 0, margin: 0, material: 'mdf', quantity: 5 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: false });

  assert.equal(result.unplacedPieces.length, 0, 'both pieces should be placed');
  assert.equal(result.sheets.length, 1, 'both pieces fit together on a single sheet when material mixing is allowed');
  const materialsOnSheet = new Set(result.sheets[0].pieces.map((p) => p.material));
  assert.equal(materialsOnSheet.size, 2, 'the single sheet must contain both materials when considerMaterial is disabled');
  assertPartitionAndUniqueness(result, 2);
});

// ─── Explanation metadata ──────────────────────────────────────────────────

test('optimizeCutting2D returns customer-safe explanation metadata', () => {
  const { optimizeCutting2D, GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [{ id: 'p1', name: 'P1', height: 50, width: 50, quantity: 4, material: 'mdf', rotatable: true }];
  const sheets = [{ width: 100, height: 100, kerf: 0.3, margin: 1, material: 'mdf', quantity: 2 }];

  const result = optimizeCutting2D(pieces, sheets, { optimizationPriority: 'balanced', considerMaterial: false });

  assert.ok(result.explanation, 'result must include explanation metadata');
  assert.equal(result.explanation.chosenGoal, 'balanced');
  assert.ok(Array.isArray(result.explanation.activeConstraints));
  assert.ok(Number.isInteger(result.explanation.candidatesEvaluated) && result.explanation.candidatesEvaluated > 0);

  const strategyIds = GuillotinePacker.strategies.map((s) => s.id);
  const serialized = JSON.stringify(result.explanation);
  for (const id of strategyIds) {
    assert.doesNotMatch(serialized, new RegExp(id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')), `explanation must not leak internal strategy id "${id}"`);
  }
  assert.doesNotMatch(serialized, /beam|frontier/i, 'explanation must not leak internal search jargon');
});

test('considerMaterial=true sums candidatesEvaluated across matched material groups only', () => {
  const { optimizeCutting2D, GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');
  const strategyCount = GuillotinePacker.strategies.length;

  const pieces = [
    { id: 'mdf1', name: 'MDF', height: 50, width: 50, quantity: 1, material: 'mdf', rotatable: true },
    { id: 'chene1', name: 'Chêne', height: 40, width: 40, quantity: 1, material: 'chene', rotatable: true },
    { id: 'verre1', name: 'Verre', height: 30, width: 30, quantity: 1, material: 'verre', rotatable: true },
  ];
  const sheets = [
    { width: 200, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 },
    { width: 150, height: 150, kerf: 0, margin: 0, material: 'verre', quantity: 1 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true });

  // Only "mdf" and "verre" have matching stock; "chene" is skipped entirely (0 candidates).
  assert.equal(result.explanation.candidatesEvaluated, strategyCount * 2);
});

// ─── Priority scoring policy (pure, deterministic) ─────────────────────────

function planWith({ sheetsCount, unplaced = 0, totalAreaUsed, totalAreaAvailable, placedCount }) {
  return {
    sheets: new Array(sheetsCount).fill(0).map((_, i) => ({ index: i })),
    placedPieces: new Array(placedCount ?? 1).fill(0).map(() => ({ rotated: false })),
    unplacedPieces: new Array(unplaced).fill(0).map((_, i) => ({ id: `u${i}` })),
    totalAreaUsed,
    totalAreaAvailable,
  };
}

test('min_sheets priority ignores waste when sheet counts tie (sheet count is the sole objective beyond feasibility)', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');

  const lowWaste = planWith({ sheetsCount: 1, totalAreaUsed: 90, totalAreaAvailable: 100, placedCount: 2 });
  const highWaste = planWith({ sheetsCount: 1, totalAreaUsed: 10, totalAreaAvailable: 100, placedCount: 2 });

  const first = GuillotinePacker.chooseBetterPlan(lowWaste, highWaste, 'min_sheets');
  const second = GuillotinePacker.chooseBetterPlan(lowWaste, highWaste, 'min_sheets');

  assert.equal(first, lowWaste, 'min_sheets must not prefer the lower-waste plan when sheet counts and placed counts tie');
  assert.equal(second, first, 'plan selection must be deterministic across repeated calls with identical input');
});

test('min_waste priority prefers lower waste among equal feasible sheet counts', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');

  const lowWaste = planWith({ sheetsCount: 1, totalAreaUsed: 90, totalAreaAvailable: 100 });
  const highWaste = planWith({ sheetsCount: 1, totalAreaUsed: 10, totalAreaAvailable: 100 });

  const chosen = GuillotinePacker.chooseBetterPlan(highWaste, lowWaste, 'min_waste');

  assert.equal(chosen, lowWaste, 'min_waste must prefer the plan with lower waste when sheet counts tie');
});

test('min_waste priority still prefers fewer sheets over lower waste percentage', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');

  const fewerSheetsHigherWaste = planWith({ sheetsCount: 1, totalAreaUsed: 10, totalAreaAvailable: 100 });
  const moreSheetsLowerWaste = planWith({ sheetsCount: 2, totalAreaUsed: 190, totalAreaAvailable: 200 });

  const chosen = GuillotinePacker.chooseBetterPlan(moreSheetsLowerWaste, fewerSheetsHigherWaste, 'min_waste');

  assert.equal(chosen, fewerSheetsHigherWaste, 'min_waste must still gate on sheet count before comparing waste percentages');
});

test('linear_guillotine priority matches the historical fewest-sheets/lowest-waste ordering used by the locked benchmarks', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');

  const lowWaste = planWith({ sheetsCount: 1, totalAreaUsed: 90, totalAreaAvailable: 100 });
  const highWaste = planWith({ sheetsCount: 1, totalAreaUsed: 10, totalAreaAvailable: 100 });

  const chosen = GuillotinePacker.chooseBetterPlan(highWaste, lowWaste, 'linear_guillotine');

  assert.equal(chosen, lowWaste);
});

test('balanced priority uses a deterministic composite that still keeps sheet count dominant', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');

  const fewerSheets = planWith({ sheetsCount: 1, totalAreaUsed: 10, totalAreaAvailable: 100 }); // 90% waste
  const moreSheets = planWith({ sheetsCount: 2, totalAreaUsed: 199, totalAreaAvailable: 200 }); // 0.5% waste

  const chosen = GuillotinePacker.chooseBetterPlan(moreSheets, fewerSheets, 'balanced');
  assert.equal(chosen, fewerSheets, 'waste (max 1.0) must never outweigh a whole extra sheet in the composite');

  const a = planWith({ sheetsCount: 1, totalAreaUsed: 95, totalAreaAvailable: 100 });
  const b = planWith({ sheetsCount: 1, totalAreaUsed: 80, totalAreaAvailable: 100 });
  const chosenTie = GuillotinePacker.chooseBetterPlan(b, a, 'balanced');
  assert.equal(chosenTie, a, 'lower waste must win the composite when sheet counts tie');
});

test('optimizeCutting2D result is deterministic across repeated runs for every supported priority', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const pieces = [
    { id: 'a', name: 'A', height: 40, width: 60, quantity: 5, material: 'mdf', rotatable: true },
    { id: 'b', name: 'B', height: 30, width: 30, quantity: 3, material: 'mdf', rotatable: true },
  ];
  const sheets = [{ width: 150, height: 150, kerf: 0.3, margin: 1, material: 'mdf', quantity: 3 }];

  for (const priority of ['linear_guillotine', 'min_waste', 'min_sheets', 'balanced']) {
    const first = optimizeCutting2D(pieces, sheets, { optimizationPriority: priority });
    const second = optimizeCutting2D(pieces, sheets, { optimizationPriority: priority });
    assert.deepEqual(second, first, `optimizeCutting2D must be deterministic for priority "${priority}"`);
  }
});

// ─── UI/API option surface must match the supported priority set exactly ──

// ─── Global single-sheet semantics under considerMaterial=true ────────────
//
// With considerMaterial=true AND singleSheetOnly=true, `singleSheetOnly` must
// be a *global* budget (at most one sheet across the whole merged result),
// not a per-material-group budget. Each material group is evaluated
// independently in single-sheet mode against its own matching stock; the one
// candidate group that places the most pieces wins the single global sheet,
// and every piece from every other material group is explicitly marked
// unplaced (never silently dropped) with the customer-safe
// `single_sheet_material_limit` reason code.

test('considerMaterial=true + singleSheetOnly=true uses at most one sheet globally and never drops other materials', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  // mdf group: 2 pieces of 30x30 (1800 total) fit on the mdf sheet.
  // chene group: 1 piece of 90x90 (8100) fits on the chene sheet with far
  // lower waste, but places fewer pieces — the mdf group must still win
  // because "most pieces placed" gates before any waste/priority scoring.
  const pieces = [
    { id: 'mdf', name: 'MDF', height: 30, width: 30, quantity: 2, material: 'mdf', rotatable: true },
    { id: 'chene', name: 'Chêne', height: 90, width: 90, quantity: 1, material: 'chene', rotatable: true },
  ];
  const sheets = [
    { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 5 },
    { width: 100, height: 100, kerf: 0, margin: 0, material: 'chene', quantity: 5 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true, singleSheetOnly: true });

  assert.ok(result.sheetsUsed <= 1, 'singleSheetOnly must cap the merged result to at most one sheet globally, not one per material');
  assert.equal(result.sheets.length, result.sheetsUsed);

  assert.equal(result.placedPieces.length, 2, 'the winning group (mdf, 2 pieces) must be fully placed');
  for (const placed of result.placedPieces) {
    assert.equal(placed.material, 'mdf', 'only the winning material group may occupy the single global sheet');
  }

  assert.equal(result.unplacedPieces.length, 1, 'the losing group (chêne) must be explicitly unplaced, not dropped');
  const losingPiece = result.unplacedPieces[0];
  assert.equal(losingPiece.material, 'chene');
  assert.equal(losingPiece.unplacedReasonCode, 'single_sheet_material_limit');
  assert.ok(typeof losingPiece.unplacedReason === 'string' && losingPiece.unplacedReason.length > 0);
  assert.doesNotMatch(losingPiece.unplacedReason, /chene|chêne/i, 'reason must not interpolate the raw material name');

  assert.equal(result.placedPieces.length + result.unplacedPieces.length, 3, 'every expanded piece must remain exactly once in placed or unplaced');
  const placedIds = result.placedPieces.map((p) => p.pieceId);
  const unplacedIds = result.unplacedPieces.map((p) => p.id);
  assert.equal(new Set([...placedIds, ...unplacedIds]).size, 3, 'placed + unplaced IDs must partition the expanded pieces without collisions');

  assert.ok(result.explanation.activeConstraints.includes('single_sheet_only'), 'explanation may report single_sheet_only since sheetsUsed <= 1');
});

test('considerMaterial=true + singleSheetOnly=true breaks ties between equally-placed groups using optimizationPriority scoring', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  // Both groups place exactly 1 piece each on their own 100x100 sheet, so the
  // "most pieces placed" gate ties. The tie must then be broken deterministically
  // by the active optimizationPriority scoring (linear_guillotine here prefers
  // lower waste): mdf (60x60, less waste) must beat verre (40x40, more waste).
  const pieces = [
    { id: 'mdf', name: 'MDF', height: 60, width: 60, quantity: 1, material: 'mdf', rotatable: true },
    { id: 'verre', name: 'Verre', height: 40, width: 40, quantity: 1, material: 'verre', rotatable: true },
  ];
  const sheets = [
    { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 },
    { width: 100, height: 100, kerf: 0, margin: 0, material: 'verre', quantity: 1 },
  ];

  const result = optimizeCutting2D(pieces, sheets, {
    considerMaterial: true,
    singleSheetOnly: true,
    optimizationPriority: 'linear_guillotine',
  });

  assert.ok(result.sheetsUsed <= 1);
  assert.equal(result.placedPieces.length, 1);
  assert.equal(result.placedPieces[0].material, 'mdf', 'lower-waste mdf group must win the tie under linear_guillotine scoring');
  assert.equal(result.unplacedPieces.length, 1);
  assert.equal(result.unplacedPieces[0].material, 'verre');
  assert.equal(result.unplacedPieces[0].unplacedReasonCode, 'single_sheet_material_limit');
});

test('considerMaterial=true + singleSheetOnly=true still reports no_matching_stock for materials with zero compatible stock', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const pieces = [
    { id: 'mdf', name: 'MDF', height: 30, width: 30, quantity: 1, material: 'mdf', rotatable: true },
    { id: 'chene', name: 'Chêne', height: 20, width: 20, quantity: 1, material: 'chene', rotatable: true },
  ];
  // Only mdf stock exists; chene has zero matching stock, distinct from a
  // material that lost the single-sheet contest against another group.
  const sheets = [
    { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true, singleSheetOnly: true });

  assert.equal(result.placedPieces.length, 1);
  assert.equal(result.unplacedPieces.length, 1);
  assert.equal(result.unplacedPieces[0].material, 'chene');
  assert.equal(result.unplacedPieces[0].unplacedReasonCode, 'no_matching_stock', 'a material with zero compatible stock keeps its original reason code, not single_sheet_material_limit');
});

// ─── unplacedReason must never reflect raw/attacker-controlled material text ─

test('unplacedReason is a fixed customer-safe sentence and never reflects a malicious/very long material string', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const maliciousMaterial = '<script>alert(1)</script>' + 'x'.repeat(5000);
  const pieces = [
    { id: 'evil', name: 'Evil', height: 40, width: 40, quantity: 1, material: maliciousMaterial, rotatable: true },
  ];
  const sheets = [
    { width: 100, height: 100, kerf: 0, margin: 0, material: 'mdf', quantity: 1 },
  ];

  const result = optimizeCutting2D(pieces, sheets, { considerMaterial: true });

  assert.equal(result.unplacedPieces.length, 1);
  const unplaced = result.unplacedPieces[0];
  assert.equal(unplaced.unplacedReasonCode, 'no_matching_stock');
  assert.ok(unplaced.unplacedReason.length < 500, 'unplacedReason must stay a short fixed sentence, not grow with attacker input');
  assert.doesNotMatch(unplaced.unplacedReason, /<script>|xxxxx/i, 'unplacedReason must never interpolate raw/attacker-controlled material text');
  // The raw material is still available, untouched, as a separate typed field.
  assert.equal(unplaced.material, maliciousMaterial);
});

test('OptionsPanel select renders exactly the four supported optimizationPriority values', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { OPTIMIZATION_PRIORITY_VALUES } = loadTsModule('src/lib/cutting/binpacking.ts');

  const source = fs.readFileSync(path.resolve('src/components/OptionsPanel.tsx'), 'utf8');

  // The select must be driven by the shared constant (single source of truth
  // with the API schema), not a hand-maintained list of literal <option> tags
  // that could silently drift from what the optimizer actually supports.
  assert.match(source, /import\s*\{[^}]*OPTIMIZATION_PRIORITY_VALUES[^}]*\}\s*from\s*['"]@\/lib\/cutting\/binpacking['"]/, 'OptionsPanel must import OPTIMIZATION_PRIORITY_VALUES from the optimizer module');
  assert.match(source, /OPTIMIZATION_PRIORITY_VALUES\.map\(/, 'the priority <select> must render by mapping over OPTIMIZATION_PRIORITY_VALUES');

  // Any label lookup table keyed by priority must cover exactly the same set,
  // so it cannot omit a value or carry a stale/extra one.
  const labelsBlock = source.match(/Record<OptimizationPriority,\s*string>\s*=\s*\{([^}]*)\}/);
  assert.ok(labelsBlock, 'expected an exhaustive Record<OptimizationPriority, string> label lookup');
  const labelKeys = [...labelsBlock[1].matchAll(/^\s*([a-zA-Z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(new Set(labelKeys), new Set(OPTIMIZATION_PRIORITY_VALUES), 'the label lookup keys must match the supported optimizationPriority values exactly');
});
