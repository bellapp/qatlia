const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 8 remediation — item 1 (PANELS/PIECES GAP): src/lib/quotation-items.ts
// derives the quotation's panel/piece detail lines from the optimizer's own
// result (result.sheets/result.placedPieces) — never from a user-editable
// total, and never fabricating edge-banding detail the optimizer didn't
// actually compute.
//
// Both derive functions return a tagged `{ ok: true, panels/pieces }` or
// `{ ok: false, error, distinctCount, max }` result rather than an array
// directly — a plan that genuinely aggregates to more distinct groups than
// the schema-bounded maximum is never silently truncated (Task 8
// remediation — re-review, item 5).

function loadItems() {
  return loadTsModule('src/lib/quotation-items.ts');
}

function sheet(overrides = {}) {
  return { index: 0, material: 'mdf', width: 280, height: 207, pieces: [], offcuts: [], cuts: [], usedArea: 0, wasteRate: 0, ...overrides };
}

function piece(overrides = {}) {
  return {
    pieceNumber: 1,
    name: 'Panneau',
    sheetIndex: 0,
    originalWidth: 120,
    originalHeight: 60,
    width: 120,
    height: 60,
    x: 0,
    y: 0,
    rotated: false,
    ...overrides,
  };
}

// ─── deriveQuotationPanels ─────────────────────────────────────────────────

test('deriveQuotationPanels aggregates sheets sharing the same material/dimensions into one line with a summed quantity', () => {
  const { deriveQuotationPanels } = loadItems();
  const result = deriveQuotationPanels({
    sheets: [sheet({ index: 0 }), sheet({ index: 1 }), sheet({ index: 2, material: 'chene', width: 250, height: 120 })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.panels.length, 2);
  const mdfLine = result.panels.find((p) => p.material === 'mdf');
  assert.equal(mdfLine.quantity, 2);
  assert.equal(mdfLine.widthCm, 280);
  assert.equal(mdfLine.heightCm, 207);
  const cheneLine = result.panels.find((p) => p.material === 'chene');
  assert.equal(cheneLine.quantity, 1);
});

test('deriveQuotationPanels assigns a stable, unique ref per distinct panel spec', () => {
  const { deriveQuotationPanels } = loadItems();
  const result = deriveQuotationPanels({ sheets: [sheet(), sheet({ index: 1, material: 'chene' })] });
  assert.equal(result.ok, true);
  assert.equal(new Set(result.panels.map((p) => p.ref)).size, result.panels.length);
});

test('deriveQuotationPanels returns an empty array for no sheets', () => {
  const { deriveQuotationPanels } = loadItems();
  const result = deriveQuotationPanels({ sheets: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.panels, []);
});

test('deriveQuotationPanels returns { ok: false } with the exact distinct-group count and max when a plan genuinely exceeds the schema-bounded maximum, rather than truncating', () => {
  const { deriveQuotationPanels, MAX_QUOTATION_PANELS } = loadItems();
  const distinctCount = MAX_QUOTATION_PANELS + 20;
  const sheets = Array.from({ length: distinctCount }, (_, i) => sheet({ index: i, material: `m${i}` }));
  const result = deriveQuotationPanels({ sheets });
  assert.deepEqual(result, { ok: false, error: 'TOO_MANY_PANEL_GROUPS', distinctCount, max: MAX_QUOTATION_PANELS });
});

// ─── deriveQuotationPieces ──────────────────────────────────────────────────

test('deriveQuotationPieces aggregates identical placed pieces (by name/material/original dimensions) with a summed quantity', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({
    placedPieces: [piece({ pieceNumber: 1 }), piece({ pieceNumber: 2 }), piece({ pieceNumber: 3, name: 'Autre', originalWidth: 40, originalHeight: 40 })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.pieces.length, 2);
  const main = result.pieces.find((p) => p.name === 'Panneau');
  assert.equal(main.quantity, 2);
  assert.equal(main.widthCm, 120);
  assert.equal(main.heightCm, 60);
});

test('deriveQuotationPieces never fabricates edge detail when the optimizer result carries none', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({ placedPieces: [piece()] });
  assert.equal(result.ok, true);
  assert.equal(result.pieces[0].edgeBandedSides, undefined);
  assert.equal(result.pieces[0].edgeLengthM, undefined);
});

test('deriveQuotationPieces reports edge-banded sides and a summed edge length in metres, using original (unrotated) dimensions', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({
    placedPieces: [
      piece({ pieceNumber: 1, edges: { top: true, left: true } }),
      piece({ pieceNumber: 2, edges: { top: true, left: true } }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.pieces.length, 1);
  assert.deepEqual(new Set(result.pieces[0].edgeBandedSides), new Set(['top', 'left']));
  // top: originalWidth/100 = 1.2m, left: originalHeight/100 = 0.6m, per piece = 1.8m, x2 quantity = 3.6m
  assert.equal(result.pieces[0].edgeLengthM, 3.6);
});

test('deriveQuotationPieces falls back to the shared unnamed-piece placeholder when the piece has no name', () => {
  const { deriveQuotationPieces, UNNAMED_PIECE_NAME_PLACEHOLDER } = loadItems();
  const result = deriveQuotationPieces({ placedPieces: [piece({ name: undefined })] });
  assert.equal(result.ok, true);
  assert.equal(result.pieces[0].name, UNNAMED_PIECE_NAME_PLACEHOLDER);
});

test('deriveQuotationPieces aggregates multiple identically-unnamed pieces into a single line with a summed quantity, not one line per piece', () => {
  const { deriveQuotationPieces, UNNAMED_PIECE_NAME_PLACEHOLDER } = loadItems();
  const result = deriveQuotationPieces({
    placedPieces: [
      piece({ pieceNumber: 1, name: undefined }),
      piece({ pieceNumber: 2, name: '' }),
      piece({ pieceNumber: 3, name: '   ' }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.pieces.length, 1);
  assert.equal(result.pieces[0].name, UNNAMED_PIECE_NAME_PLACEHOLDER);
  assert.equal(result.pieces[0].quantity, 3);
});

test('deriveQuotationPieces returns an empty array for no placed pieces', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({ placedPieces: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pieces, []);
});

test('deriveQuotationPieces returns { ok: false } with the exact distinct-group count and max when a plan genuinely exceeds the schema-bounded maximum, rather than truncating', () => {
  const { deriveQuotationPieces, MAX_QUOTATION_PIECES } = loadItems();
  const distinctCount = MAX_QUOTATION_PIECES + 50;
  const placedPieces = Array.from({ length: distinctCount }, (_, i) =>
    piece({ pieceNumber: i, name: `Piece${i}`, originalWidth: 10 + i, originalHeight: 10 })
  );
  const result = deriveQuotationPieces({ placedPieces });
  assert.deepEqual(result, { ok: false, error: 'TOO_MANY_PIECE_GROUPS', distinctCount, max: MAX_QUOTATION_PIECES });
});

test('deriveQuotationPieces output validates against QuotationPieceSchema and deriveQuotationPanels output against QuotationPanelSchema', () => {
  const { deriveQuotationPanels, deriveQuotationPieces } = loadItems();
  const { QuotationPanelSchema, QuotationPieceSchema } = loadTsModule('src/lib/quotation.ts');
  const panelsResult = deriveQuotationPanels({ sheets: [sheet()] });
  const piecesResult = deriveQuotationPieces({ placedPieces: [piece({ edges: { top: true } })] });
  assert.equal(panelsResult.ok, true);
  assert.equal(piecesResult.ok, true);
  for (const p of panelsResult.panels) assert.equal(QuotationPanelSchema.safeParse(p).success, true, JSON.stringify(p));
  for (const p of piecesResult.pieces) assert.equal(QuotationPieceSchema.safeParse(p).success, true, JSON.stringify(p));
});

// ─── Clean commercial piece provenance (Task 8 remediation — item 1
// follow-up): a placed piece's internal *display* `name` (possibly carrying
// a "× qty" suffix or a numbered fallback — see
// src/lib/cutting/binpacking.ts's `PlacedPiece.name` doc comment) must never
// leak into a client-facing quotation. `baseName`/`isUnnamed` are the
// authoritative, clean-provenance fields for a *fresh* optimizer result; a
// *legacy* result (no `baseName`/`isUnnamed` at all) falls back to stripping
// just the known "× qty" suffix from `name`. ────────────────────────────────

test('deriveQuotationPieces prefers the clean baseName over the suffixed internal display name', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({
    placedPieces: [
      piece({ name: 'Panneau ×5', baseName: 'Panneau', isUnnamed: false }),
      piece({ name: 'Panneau ×5', baseName: 'Panneau', isUnnamed: false }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.pieces.length, 1);
  assert.equal(result.pieces[0].name, 'Panneau');
  assert.equal(result.pieces[0].quantity, 2);
});

test('deriveQuotationPieces treats isUnnamed:true as unnamed even if a stray baseName is present', () => {
  const { deriveQuotationPieces, UNNAMED_PIECE_NAME_PLACEHOLDER } = loadItems();
  const result = deriveQuotationPieces({
    placedPieces: [piece({ name: 'Pièce 1', baseName: undefined, isUnnamed: true })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.pieces[0].name, UNNAMED_PIECE_NAME_PLACEHOLDER);
});

test('deriveQuotationPieces strips the internal "× qty" suffix from a legacy result (no baseName/isUnnamed at all)', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({
    placedPieces: [
      piece({ name: 'Panneau ×5' }),
      piece({ name: 'Panneau ×5' }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.pieces.length, 1);
  assert.equal(result.pieces[0].name, 'Panneau', 'the "× qty" suffix must never leak into the printed quote');
  assert.equal(result.pieces[0].quantity, 2);
});

test('deriveQuotationPieces never mistakes a legacy numbered fallback for real content it could safely alter (leaves it exactly as typed, since it cannot tell it apart from a real name)', () => {
  const { deriveQuotationPieces } = loadItems();
  const result = deriveQuotationPieces({ placedPieces: [piece({ name: 'Pièce 3' })] });
  assert.equal(result.ok, true);
  assert.equal(result.pieces[0].name, 'Pièce 3');
});

// ─── Integrated: through the real 2D/1D optimizers, not just hand-built
// PlacedPiece fixtures — quantity 5 and unnamed pieces (Task 8 remediation —
// item 1 follow-up). ─────────────────────────────────────────────────────

function loadBinpacking() {
  return loadTsModule('src/lib/cutting/binpacking.ts');
}

test('integrated (2D): a named piece requested with quantity 5 aggregates into a single quotation line named exactly "Panneau" (no × suffix), quantity 5', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const { deriveQuotationPieces } = loadItems();
  const options = {
    kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
    edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine', defaultMaterial: 'mdf',
  };
  const sheets = [{ width: 280, height: 207, kerf: 0.3, material: 'mdf' }];
  const pieces = [{ name: 'Panneau', width: 40, height: 30, quantity: 5 }];
  const result = optimizeCutting2D(pieces, sheets, options);

  const derived = deriveQuotationPieces(result);
  assert.equal(derived.ok, true);
  assert.equal(derived.pieces.length, 1);
  assert.equal(derived.pieces[0].name, 'Panneau');
  assert.equal(derived.pieces[0].quantity, 5);
});

test('integrated (2D): a piece left unnamed aggregates into a single quotation line using the shared unnamed placeholder, quantity summed', () => {
  const { optimizeCutting2D } = loadBinpacking();
  const { deriveQuotationPieces, UNNAMED_PIECE_NAME_PLACEHOLDER } = loadItems();
  const options = {
    kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
    edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine', defaultMaterial: 'mdf',
  };
  const sheets = [{ width: 280, height: 207, kerf: 0.3, material: 'mdf' }];
  const pieces = [{ width: 40, height: 30, quantity: 3 }];
  const result = optimizeCutting2D(pieces, sheets, options);

  const derived = deriveQuotationPieces(result);
  assert.equal(derived.ok, true);
  assert.equal(derived.pieces.length, 1);
  assert.equal(derived.pieces[0].name, UNNAMED_PIECE_NAME_PLACEHOLDER);
  assert.equal(derived.pieces[0].quantity, 3);
});

test('integrated (1D): a named bar piece requested with quantity 5 aggregates into a single quotation line named exactly "Barre A" (no × suffix), quantity 5', () => {
  const { optimizeCutting1D } = loadBinpacking();
  const { deriveQuotationPieces } = loadItems();
  const pieces = [{ name: 'Barre A', width: 50, height: 1, quantity: 5 }];
  const result = optimizeCutting1D(pieces, 300, 3);

  const derived = deriveQuotationPieces(result);
  assert.equal(derived.ok, true);
  assert.equal(derived.pieces.length, 1);
  assert.equal(derived.pieces[0].name, 'Barre A');
  assert.equal(derived.pieces[0].quantity, 5);
});

test('integrated (1D): bar pieces left unnamed aggregate into a single quotation line using the shared unnamed placeholder, quantity summed', () => {
  const { optimizeCutting1D } = loadBinpacking();
  const { deriveQuotationPieces, UNNAMED_PIECE_NAME_PLACEHOLDER } = loadItems();
  const pieces = [{ width: 50, height: 1, quantity: 4 }];
  const result = optimizeCutting1D(pieces, 300, 3);

  const derived = deriveQuotationPieces(result);
  assert.equal(derived.ok, true);
  assert.equal(derived.pieces.length, 1);
  assert.equal(derived.pieces[0].name, UNNAMED_PIECE_NAME_PLACEHOLDER);
  assert.equal(derived.pieces[0].quantity, 4);
});
