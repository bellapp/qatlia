const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

test('furniture templates expose the curated French catalog', () => {
  const { FURNITURE_TEMPLATES } = loadTsModule('src/lib/pieces/templates.ts');

  assert.deepEqual(
    FURNITURE_TEMPLATES.map((template) => template.name),
    ['Meuble TV', 'Bibliothèque', 'Armoire', 'Meuble bas cuisine']
  );
});

test('createFurnitureTemplatePieces returns fresh deterministic pieces per call', () => {
  const { createFurnitureTemplatePieces, FURNITURE_TEMPLATES, PIECE_COLOR_PALETTE } = loadTsModule('src/lib/pieces/templates.ts');

  const firstBatch = createFurnitureTemplatePieces('Meuble TV', 'mdf');
  const secondBatch = createFurnitureTemplatePieces('Meuble TV', 'mdf');

  assert.equal(firstBatch.length >= 5, true);
  assert.equal(secondBatch.length, firstBatch.length);
  assert.notEqual(firstBatch[0], secondBatch[0], 'Each call must return fresh piece objects');
  assert.notEqual(firstBatch[0].edges, secondBatch[0].edges, 'Nested mutable structures must not be shared');

  const tvShelves = firstBatch.filter((piece) => piece.name.includes('Plateau'));
  assert.equal(tvShelves.length >= 2, true);
  assert.equal(tvShelves.every((piece) => piece.height === 45 && piece.width === 160 && piece.quantity === 1), true);

  for (const piece of firstBatch) {
    assert.equal(piece.material, 'mdf');
    assert.equal(piece.rotatable, true);
    assert.equal(typeof piece.color, 'string');
    assert.equal(PIECE_COLOR_PALETTE.includes(piece.color), true);
  }

  assert.equal(firstBatch[0].color, secondBatch[0].color, 'Palette assignment must stay deterministic');
  assert.equal(FURNITURE_TEMPLATES.find((template) => template.name === 'Meuble TV').pieceCount, firstBatch.length);

  firstBatch[0].name = 'Mutation locale';
  firstBatch[0].edges.left = true;
  assert.notEqual(secondBatch[0].name, 'Mutation locale');
  assert.notEqual(secondBatch[0].edges.left, true);
});

test('all catalog templates produce realistic HxL cm dimensions and quantities', () => {
  const { FURNITURE_TEMPLATES, createFurnitureTemplatePieces } = loadTsModule('src/lib/pieces/templates.ts');

  for (const template of FURNITURE_TEMPLATES) {
    const pieces = createFurnitureTemplatePieces(template.name, 'mdf');

    assert.equal(pieces.length, template.pieceCount);
    assert.equal(pieces.every((piece) => piece.height > 20 && piece.height < 260), true, `${template.name} heights must stay in cm`);
    assert.equal(pieces.every((piece) => piece.width > 20 && piece.width < 180), true, `${template.name} widths must stay in cm`);
    assert.equal(pieces.every((piece) => Number.isInteger(piece.quantity) && piece.quantity >= 1 && piece.quantity <= 8), true, `${template.name} quantities must stay realistic`);
  }
});
