const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

test('parsePiecesImport supports optional header, mixed delimiters, decimal comma, quoting and mm heuristic', () => {
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
      { id: 'import_3', name: 'Façade', height: 72, width: 59.7, quantity: 3, material: 'mdf', rotatable: true },
      { id: 'import_4', name: 'Traverse', height: 120, width: 32, quantity: 1, material: 'mdf', rotatable: true },
    ]
  );
  assert.match(result.summary, /4 pièces importées/i);
  assert.match(result.summary, /2 lignes ignorées/i);
});

test('parsePiecesImport preserves legitimate centimetre dimensions up to 500', () => {
  const { parsePiecesImport } = loadTsModule('src/lib/pieces/import-parser.ts');

  const result = parsePiecesImport({
    input: 'Panneau latéral;230;120;2',
    defaultMaterial: 'mdf',
  });

  assert.equal(result.importedPieces.length, 1);
  assert.equal(result.importedPieces[0].height, 230);
  assert.equal(result.importedPieces[0].width, 120);
});

test('parsePiecesImport ignores blank input and preserves stable ids for the same valid row order', () => {
  const { parsePiecesImport } = loadTsModule('src/lib/pieces/import-parser.ts');

  const first = parsePiecesImport({
    input: '\nPorte;198;44;2\n\n',
    defaultMaterial: 'mdf',
  });
  const second = parsePiecesImport({
    input: 'Porte;198;44;2',
    defaultMaterial: 'mdf',
  });

  assert.equal(first.importedPieces.length, 1);
  assert.equal(first.importedPieces[0].id, 'import_1');
  assert.equal(second.importedPieces[0].id, 'import_1');
  assert.match(first.summary, /1 pièce importée/i);
  assert.match(first.summary, /0 ligne ignorée/i);
});
