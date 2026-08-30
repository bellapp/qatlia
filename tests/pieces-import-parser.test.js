const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// parsePiecesImport() no longer guesses the input unit from magnitude
// (`value > 500 ? value / 10 : value`). The caller must pass an explicit
// `unit: 'cm' | 'mm'`, and every parsed dimension is converted through
// src/lib/units.ts exactly once. Delimiter/decimal parsing and deterministic
// ids are unaffected by the unit boundary.

test('parsePiecesImport with explicit unit "cm" supports optional header, mixed delimiters, decimal comma and quoting, without any mm heuristic', () => {
  const { parsePiecesImport } = loadTsModule('src/lib/pieces/import-parser.ts');

  const result = parsePiecesImport({
    input: [
      'Nom;Hauteur;Largeur;Quantité',
      '"Joue TV";230;45,5;2',
      'Tablette\t380\t300\t1',
      'Façade,720,597,3',
      'Invalide;abc;20;1',
      ';;;;',
      '"Traverse";1200;320;1',
    ].join('\n'),
    unit: 'cm',
    defaultMaterial: 'mdf',
  });

  assert.equal(result.importedPieces.length, 4);
  assert.deepEqual(
    result.importedPieces.map((piece) => ({
      id: piece.id,
      name: piece.name,
      height: piece.height,
      width: piece.width,
      quantity: piece.quantity,
      material: piece.material,
      rotatable: piece.rotatable,
    })),
    [
      { id: 'import_1', name: 'Joue TV', height: 230, width: 45.5, quantity: 2, material: 'mdf', rotatable: true },
      { id: 'import_2', name: 'Tablette', height: 380, width: 300, quantity: 1, material: 'mdf', rotatable: true },
      // No >500 heuristic: with an explicit cm unit, 720 and 597 stay cm.
      { id: 'import_3', name: 'Façade', height: 720, width: 597, quantity: 3, material: 'mdf', rotatable: true },
      { id: 'import_4', name: 'Traverse', height: 1200, width: 320, quantity: 1, material: 'mdf', rotatable: true },
    ]
  );
  assert.match(result.summary, /4 pièces importées/i);
  assert.match(result.summary, /2 lignes ignorées/i);
});

test('parsePiecesImport with explicit unit "mm" always converts every row to cm, regardless of magnitude', () => {
  const { parsePiecesImport } = loadTsModule('src/lib/pieces/import-parser.ts');

  const result = parsePiecesImport({
    input: [
      '"Joue TV";2300;455;2',
      'Petite pièce;80;50;1',
    ].join('\n'),
    unit: 'mm',
    defaultMaterial: 'mdf',
  });

  assert.equal(result.importedPieces.length, 2);
  // 2300 mm -> 230 cm, 455 mm -> 45.5 cm, even though a small mm value like
  // 80 (-> 8 cm) would previously have been left alone by the >500 heuristic.
  assert.equal(result.importedPieces[0].height, 230);
  assert.equal(result.importedPieces[0].width, 45.5);
  assert.equal(result.importedPieces[1].height, 8);
  assert.equal(result.importedPieces[1].width, 5);
});

test('parsePiecesImport preserves legitimate large centimetre dimensions unchanged when unit is explicitly "cm"', () => {
  const { parsePiecesImport } = loadTsModule('src/lib/pieces/import-parser.ts');

  const result = parsePiecesImport({
    input: 'Panneau latéral;230;120;2',
    unit: 'cm',
    defaultMaterial: 'mdf',
  });

  assert.equal(result.importedPieces.length, 1);
  assert.equal(result.importedPieces[0].height, 230);
  assert.equal(result.importedPieces[0].width, 120);

  // A genuinely long 1D bar (600 cm) must never be silently reinterpreted as
  // 60 cm just because it is a "big" number.
  const longBar = parsePiecesImport({
    input: 'Barre longue;600;10;1',
    unit: 'cm',
    defaultMaterial: 'mdf',
  });
  assert.equal(longBar.importedPieces[0].height, 600);
});

test('parsePiecesImport ignores blank input and preserves stable ids for the same valid row order', () => {
  const { parsePiecesImport } = loadTsModule('src/lib/pieces/import-parser.ts');

  const first = parsePiecesImport({
    input: '\nPorte;198;44;2\n\n',
    unit: 'cm',
    defaultMaterial: 'mdf',
  });
  const second = parsePiecesImport({
    input: 'Porte;198;44;2',
    unit: 'cm',
    defaultMaterial: 'mdf',
  });

  assert.equal(first.importedPieces.length, 1);
  assert.equal(first.importedPieces[0].id, 'import_1');
  assert.equal(second.importedPieces[0].id, 'import_1');
  assert.match(first.summary, /1 pièce importée/i);
  assert.match(first.summary, /0 ligne ignorée/i);
});
