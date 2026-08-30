const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

const EPS = 1e-6;

function rectanglesOverlap(a, b, epsilon = EPS) {
  return (
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.height - epsilon &&
    a.y + a.height > b.y + epsilon
  );
}

function rectContains(outer, inner, epsilon = EPS) {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

// The same 16-piece fixture used by tests/optimizer-regression.test.js (dataset 2),
// kept inline here so this file stays self-contained.
function dataset2Pieces() {
  return [
    { id: 'd2_1', name: 'Pièce 1', height: 230, width: 120, quantity: 2, material: 'mdf', rotatable: true },
    { id: 'd2_2', name: 'Pièce 2', height: 118, width: 48, quantity: 1, material: 'mdf', rotatable: true },
    { id: 'd2_3', name: 'Pièce 3', height: 41.8, width: 38, quantity: 7, material: 'mdf', rotatable: true },
    { id: 'd2_4', name: 'Pièce 4', height: 53.1, width: 48, quantity: 4, material: 'mdf', rotatable: true },
    { id: 'd2_5', name: 'Pièce 5', height: 51.3, width: 48, quantity: 2, material: 'mdf', rotatable: true },
  ];
}

const SHEET_208_X_278 = {
  width: 208, height: 278, kerf: 0.3, margin: 1, grainDirection: false, material: 'mdf', quantity: 1,
};
const OPTIONS_208_X_278 = {
  kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
  edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine',
};

function assertOffcutGeometryInvariants(result, sheetDef) {
  const margin = Math.max(0, sheetDef.margin || 0);
  const minX = margin;
  const minY = margin;
  const maxX = sheetDef.width - margin;
  const maxY = sheetDef.height - margin;

  for (const currentSheet of result.sheets) {
    const offcuts = currentSheet.offcuts;

    for (const off of offcuts) {
      assert.ok(off.width > 0, `Offcut ${off.id} must have positive width`);
      assert.ok(off.height > 0, `Offcut ${off.id} must have positive height`);
      assert.ok(off.areaM2 > 0, `Offcut ${off.id} must have positive areaM2`);

      assert.ok(off.x >= minX - EPS, `Offcut ${off.id} must stay within the sheet on X (left)`);
      assert.ok(off.y >= minY - EPS, `Offcut ${off.id} must stay within the sheet on Y (top)`);
      assert.ok(off.x + off.width <= maxX + EPS, `Offcut ${off.id} must stay within the sheet on X (right)`);
      assert.ok(off.y + off.height <= maxY + EPS, `Offcut ${off.id} must stay within the sheet on Y (bottom)`);

      for (const piece of currentSheet.pieces) {
        assert.equal(rectanglesOverlap(off, piece), false, `Offcut ${off.id} must not overlap placed piece ${piece.pieceId}`);
      }
    }

    for (let i = 0; i < offcuts.length; i += 1) {
      for (let j = i + 1; j < offcuts.length; j += 1) {
        assert.equal(rectanglesOverlap(offcuts[i], offcuts[j]), false, `Offcuts ${offcuts[i].id} and ${offcuts[j].id} must not overlap each other`);
        assert.equal(rectContains(offcuts[i], offcuts[j]), false, `Offcut ${offcuts[j].id} must not be a duplicate contained within ${offcuts[i].id}`);
        assert.equal(rectContains(offcuts[j], offcuts[i]), false, `Offcut ${offcuts[i].id} must not be a duplicate contained within ${offcuts[j].id}`);
      }
    }

    const sheetArea = currentSheet.width * currentSheet.height;
    const placedArea = currentSheet.pieces.reduce((sum, p) => sum + p.width * p.height, 0);
    const offcutArea = offcuts.reduce((sum, o) => sum + o.width * o.height, 0);
    assert.ok(placedArea + offcutArea <= sheetArea + EPS, `Sheet ${currentSheet.index}: placed area + offcut area must not exceed sheet area`);
  }
}

test('dataset 2 benchmark produces geometrically valid offcuts', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const result = optimizeCutting2D(dataset2Pieces(), [{ ...SHEET_208_X_278 }], { ...OPTIONS_208_X_278 });

  assert.ok(result.sheets.length > 0, 'Expected at least one sheet');
  const totalOffcuts = result.sheets.reduce((sum, s) => sum + s.offcuts.length, 0);
  assert.ok(totalOffcuts > 0, 'Dataset 2 should leave at least one reported offcut across its sheets');

  assertOffcutGeometryInvariants(result, SHEET_208_X_278);
});

test('aggregate offcuts equal the concatenation of per-sheet offcuts', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const result = optimizeCutting2D(dataset2Pieces(), [{ ...SHEET_208_X_278 }], { ...OPTIONS_208_X_278 });

  const expected = result.sheets.flatMap((s) => s.offcuts);
  assert.deepEqual(result.offcuts, expected);
});

test('a known simple layout returns the expected remnant dimensions', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 100, height: 60, kerf: 0, margin: 0, grainDirection: false, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'full_width', name: 'Full width piece', height: 20, width: 100, quantity: 1, material: 'mdf', rotatable: false }];

  const result = optimizeCutting2D(pieces, [{ ...sheet }], {
    kerfWidth: 0, showLabels: true, singleSheetOnly: true, considerMaterial: false,
    edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine',
  });

  assert.equal(result.sheetsUsed, 1);
  assert.equal(result.placedPieces.length, 1);
  assert.equal(result.sheets[0].offcuts.length, 1, 'Exactly one remnant strip should remain below the full-width piece');

  const remnant = result.sheets[0].offcuts[0];
  assert.equal(remnant.x, 0);
  assert.equal(remnant.y, 20);
  assert.equal(remnant.width, 100);
  assert.equal(remnant.height, 40);
  assert.equal(remnant.areaM2, 0.4, 'areaM2 must be computed from canonical cm dimensions (100cm x 40cm = 0.4m²)');
  assert.equal(remnant.isReusable, true, 'A 100x40cm remnant must classify as reusable under the default thresholds');
});

test('minimum reusable dimensions classify isReusable deterministically via explicit options', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const sheet = { width: 100, height: 60, kerf: 0, margin: 0, grainDirection: false, material: 'mdf', quantity: 1 };
  const pieces = [{ id: 'full_width', name: 'Full width piece', height: 50, width: 100, quantity: 1, material: 'mdf', rotatable: false }];
  const baseOptions = {
    kerfWidth: 0, showLabels: true, singleSheetOnly: true, considerMaterial: false,
    edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine',
  };

  const defaultResult = optimizeCutting2D(pieces, [{ ...sheet }], { ...baseOptions });
  const remnantDefault = defaultResult.sheets[0].offcuts[0];
  assert.equal(remnantDefault.height, 10);
  assert.equal(remnantDefault.isReusable, false, 'A 10cm-deep remnant must not be reusable under the default thresholds');

  const relaxedResult = optimizeCutting2D(pieces, [{ ...sheet }], {
    ...baseOptions, minReusableOffcutWidth: 5, minReusableOffcutHeight: 5,
  });
  const remnantRelaxed = relaxedResult.sheets[0].offcuts[0];
  assert.equal(remnantRelaxed.height, 10);
  assert.equal(remnantRelaxed.isReusable, true, 'The same remnant must classify as reusable once explicit thresholds are relaxed');
});

test('offcut IDs are stable, unique and deterministic across repeated runs', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const run = () => optimizeCutting2D(dataset2Pieces(), [{ ...SHEET_208_X_278 }], { ...OPTIONS_208_X_278 });

  const first = run();
  const second = run();

  assert.deepEqual(first.offcuts, second.offcuts, 'Repeated optimizations of the same input must yield identical offcuts, including IDs and ordering');

  for (const currentSheet of first.sheets) {
    const ids = currentSheet.offcuts.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `Offcut IDs on sheet ${currentSheet.index} must be unique`);
    for (const off of currentSheet.offcuts) {
      assert.ok(typeof off.id === 'string' && off.id.length > 0, 'Every offcut must have a non-empty string id');
      assert.match(off.id, new RegExp(`sheet${currentSheet.index}`), 'Offcut id must reference its sheet index');
    }
  }
});
