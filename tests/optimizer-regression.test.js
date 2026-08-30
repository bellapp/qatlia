const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const DATASET_1_CSV_PATH = '/home/ubuntu/.hermes/cache/documents/doc_a22afcceb50c_qatlia_pieces_1787493030653.csv';
const SHEET_208_X_278 = {
  width: 208,
  height: 278,
  kerf: 0.3,
  margin: 1,
  grainDirection: false,
  material: 'mdf',
  quantity: 1,
};
const OPTIONS_208_X_278 = {
  kerfWidth: 3,
  showLabels: true,
  singleSheetOnly: false,
  considerMaterial: false,
  edgeBanding: false,
  grainDirection: false,
  optimizationPriority: 'linear_guillotine',
};

function loadTsModule(filePath) {
  const absolutePath = path.resolve(filePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  });

  const mod = new Module.Module(absolutePath, module);
  mod.filename = absolutePath;
  mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));
  mod._compile(transpiled.outputText, absolutePath);
  return mod.exports;
}

function parseCsvPieceLine(line, index) {
  const columns = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
  assert.ok(columns && columns.length >= 4, `Invalid CSV row ${index + 2}: ${line}`);

  return {
    id: `csv_${index}`,
    name: (columns[4] || '').replace(/^"|"$/g, '') || `Pièce ${index + 1}`,
    height: Number(columns[1]),
    width: Number(columns[2]),
    quantity: Number(columns[3]),
    material: 'mdf',
    rotatable: true,
  };
}

function loadDataset1FromCsv() {
  try {
    const raw = fs.readFileSync(DATASET_1_CSV_PATH, 'utf8').trim();
    const lines = raw.split(/\r?\n/).filter(Boolean);
    assert.ok(lines.length > 1, `Expected CSV data rows in ${DATASET_1_CSV_PATH}`);

    return lines.slice(1).map(parseCsvPieceLine);
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EACCES') {
      throw error;
    }

    const savedRuns = JSON.parse(fs.readFileSync(path.resolve('saved_runs/test_runs.json'), 'utf8'));
    const benchmarkRun = savedRuns.find((run) => run.id === 'run_01_somfy_notes_mdf');

    assert.ok(benchmarkRun, 'Expected the 135-piece benchmark fallback fixture in saved_runs/test_runs.json');
    return benchmarkRun.input.pieces.map((piece) => ({
      ...piece,
      material: piece.material || 'mdf',
      rotatable: piece.rotatable !== false,
    }));
  }
}

function loadDataset1BenchmarkInput() {
  return {
    pieces: loadDataset1FromCsv(),
    sheet: { ...SHEET_208_X_278 },
    options: { ...OPTIONS_208_X_278 },
  };
}

function loadDataset2BenchmarkInput() {
  return {
    pieces: [
      { id: 'd2_1', name: 'Pièce 1', height: 230, width: 120, quantity: 2, material: 'mdf', rotatable: true },
      { id: 'd2_2', name: 'Pièce 2', height: 118, width: 48, quantity: 1, material: 'mdf', rotatable: true },
      { id: 'd2_3', name: 'Pièce 3', height: 41.8, width: 38, quantity: 7, material: 'mdf', rotatable: true },
      { id: 'd2_4', name: 'Pièce 4', height: 53.1, width: 48, quantity: 4, material: 'mdf', rotatable: true },
      { id: 'd2_5', name: 'Pièce 5', height: 51.3, width: 48, quantity: 2, material: 'mdf', rotatable: true },
    ],
    sheet: { ...SHEET_208_X_278 },
    options: { ...OPTIONS_208_X_278 },
  };
}

function rectanglesOverlap(a, b, epsilon = 1e-9) {
  return (
    a.x < b.x + b.width - epsilon &&
    a.x + a.width > b.x + epsilon &&
    a.y < b.y + b.height - epsilon &&
    a.y + a.height > b.y + epsilon
  );
}

function assertOptimizationInvariants(result, sheet, expectedExpandedCount) {
  assert.equal(result.placedPieces.length + result.unplacedPieces.length, expectedExpandedCount, 'Every expanded piece must be placed or unplaced exactly once');

  const placedIds = result.placedPieces.map((piece) => piece.pieceId);
  const unplacedIds = result.unplacedPieces.map((piece) => piece.id);
  const allIds = [...placedIds, ...unplacedIds];

  assert.equal(new Set(placedIds).size, placedIds.length, 'Placed piece IDs must be unique');
  assert.equal(new Set(unplacedIds).size, unplacedIds.length, 'Unplaced piece IDs must be unique');
  assert.equal(new Set(allIds).size, expectedExpandedCount, 'Placed and unplaced IDs must partition the expanded pieces');

  const seenPieceNumbers = new Set();
  for (const placed of result.placedPieces) {
    assert.ok(Number.isInteger(placed.pieceNumber) && placed.pieceNumber > 0, `Piece ${placed.pieceId} must have a positive integer piece number`);
    assert.equal(seenPieceNumbers.has(placed.pieceNumber), false, `Piece number ${placed.pieceNumber} must be unique`);
    seenPieceNumbers.add(placed.pieceNumber);

    assert.ok(placed.x >= 0, `Piece ${placed.pieceId} must stay within the sheet on X`);
    assert.ok(placed.y >= 0, `Piece ${placed.pieceId} must stay within the sheet on Y`);
    assert.ok(placed.x + placed.width <= sheet.width + 1e-9, `Piece ${placed.pieceId} exceeds sheet width`);
    assert.ok(placed.y + placed.height <= sheet.height + 1e-9, `Piece ${placed.pieceId} exceeds sheet height`);
  }

  for (const currentSheet of result.sheets) {
    const sheetArea = currentSheet.width * currentSheet.height;
    assert.ok(currentSheet.usedArea <= sheetArea + 1e-9, `Sheet ${currentSheet.index} used area exceeds capacity`);
    assert.ok(currentSheet.wasteRate >= 0 && currentSheet.wasteRate <= 100, `Sheet ${currentSheet.index} waste must stay within 0..100`);

    for (let i = 0; i < currentSheet.pieces.length; i += 1) {
      for (let j = i + 1; j < currentSheet.pieces.length; j += 1) {
        assert.equal(
          rectanglesOverlap(currentSheet.pieces[i], currentSheet.pieces[j]),
          false,
          `Pieces ${currentSheet.pieces[i].pieceId} and ${currentSheet.pieces[j].pieceId} overlap on sheet ${currentSheet.index}`
        );
      }
    }
  }

  assert.ok(result.wastePercentage >= 0 && result.wastePercentage <= 100, 'Overall waste must stay within 0..100');
}

function runBenchmark(benchmarkInput, overrideOptions = {}) {
  const { optimizeCutting2D } = loadTsModule('src/lib/cutting/binpacking.ts');
  const expectedExpandedCount = benchmarkInput.pieces.reduce((sum, piece) => sum + (piece.quantity || 1), 0);
  const result = optimizeCutting2D(benchmarkInput.pieces, [{ ...benchmarkInput.sheet }], {
    ...benchmarkInput.options,
    ...overrideOptions,
  });

  return { result, expectedExpandedCount };
}

test('2D optimizer preserves placement invariants on dataset 1 with the 208x278 benchmark sheet', () => {
  const benchmarkInput = loadDataset1BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput);

  assert.equal(expectedExpandedCount, 135, 'Dataset 1 must expand to 135 pieces');
  assert.ok(result.sheetsUsed > 1, 'Unlimited multi-sheet mode should allocate more than one sheet for dataset 1');
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('singleSheetOnly leaves overflow unplaced on dataset 1 with the 208x278 benchmark sheet', () => {
  const benchmarkInput = loadDataset1BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput, { singleSheetOnly: true });

  assert.ok(result.sheetsUsed <= 1, 'singleSheetOnly must not allocate additional sheets');
  assert.ok(result.unplacedPieces.length > 0, 'singleSheetOnly should leave overflow pieces unplaced for dataset 1');
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('dataset 1 benchmark packs all pieces within 4 sheets or better', () => {
  const benchmarkInput = loadDataset1BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput);

  assert.equal(result.unplacedPieces.length, 0, 'Dataset 1 should place every expanded piece');
  assert.equal(result.placedPieces.length, expectedExpandedCount, 'Dataset 1 should place all expanded pieces');
  assert.ok(result.sheetsUsed <= 4, `Dataset 1 should use at most 4 sheets, received ${result.sheetsUsed}`);
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('dataset 2 benchmark packs all pieces within 2 sheets or better', () => {
  const benchmarkInput = loadDataset2BenchmarkInput();
  const { result, expectedExpandedCount } = runBenchmark(benchmarkInput);

  assert.equal(expectedExpandedCount, 16, 'Dataset 2 must expand to 16 pieces');
  assert.equal(result.unplacedPieces.length, 0, 'Dataset 2 should place every expanded piece');
  assert.equal(result.placedPieces.length, expectedExpandedCount, 'Dataset 2 should place all expanded pieces');
  assert.ok(result.sheetsUsed <= 2, `Dataset 2 should use at most 2 sheets, received ${result.sheetsUsed}`);
  assertOptimizationInvariants(result, benchmarkInput.sheet, expectedExpandedCount);
});

test('optimize API route is wired to optimizeCutting2D', () => {
  const routeSource = fs.readFileSync(path.resolve('src/app/api/optimize/route.ts'), 'utf8');

  assert.match(routeSource, /import\s*\{\s*optimizeCutting2D\b/, 'Route must import optimizeCutting2D');
  assert.match(routeSource, /optimizeCutting2D\s*\(\s*pieces as Piece\[\],\s*\[sheet as Sheet\]/, 'Route must call optimizeCutting2D with a sheet array');
});
