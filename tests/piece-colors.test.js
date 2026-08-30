const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

test('optimizeCutting2D preserves per-piece colors on placed and unplaced pieces', () => {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');

  const result = optimizeCutting2D(
    [
      { id: 'p_red', name: 'Rouge', height: 80, width: 40, quantity: 1, material: 'mdf', rotatable: true, color: '#BE123C' },
      { id: 'p_blue', name: 'Bleu', height: 300, width: 300, quantity: 1, material: 'mdf', rotatable: true, color: '#1D4ED8' },
    ],
    [{ width: 120, height: 120, kerf: 0.3, margin: 1, grainDirection: false, material: 'mdf', quantity: 1 }],
    { kerfWidth: 3, showLabels: true, singleSheetOnly: true, considerMaterial: false, edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine' }
  );

  const placed = result.placedPieces.find((piece) => piece.pieceId === 'p_red_0');
  const unplaced = result.unplacedPieces.find((piece) => piece.id === 'p_blue_0');

  assert.equal(placed?.color, '#BE123C');
  assert.equal(unplaced?.color, '#1D4ED8');
});

test('optimize API schema accepts only optional six-digit hex piece colors', () => {
  const schemaSource = fs.readFileSync(path.resolve('src/lib/cutting/optimize-schema.ts'), 'utf8');

  assert.match(schemaSource, /color:\s*z\.string\(\)\.regex\(\/\^#\[0-9A-Fa-f\]\{6\}\$\//, 'Optimize API input schema must constrain optional piece colors to #RRGGBB');
  assert.match(schemaSource, /color:[^\n]+\.optional\(\)/, 'Optimize API piece color must remain optional');
});
