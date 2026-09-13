/**
 * Self-check for the shared-width band strategy ('band-width-shared').
 *
 * Reproduces the exact production report that motivated it: two 45×180 strips
 * and six 40×45 squares on one 278×208 MDF panel (kerf 0.3, margin 1.0, no
 * grain constraint). The complaint was that the squares were scattered into
 * leftover rectangles instead of being crosscut from the SAME 45 cm band as
 * the strips, costing the operator 13.5 m of saw travel.
 *
 * Run: npx tsx scripts/test-band-shared.ts
 */
import { optimizeCutting2D, GuillotinePacker, type Piece, type Sheet, type OptimizationResult } from '../src/lib/cutting/binpacking';

const BASELINE_CUT_METERS = 13.5;

const SHEET: Sheet = { width: 278, height: 208, kerf: 0.3, margin: 1.0, material: 'mdf', quantity: 1 };
const PIECES: Piece[] = [
  { id: 'strip', name: 'Montant', height: 45, width: 180, quantity: 2, material: 'mdf', rotatable: true },
  { id: 'square', name: 'Tablette', height: 40, width: 45, quantity: 6, material: 'mdf', rotatable: true },
];

function run(): OptimizationResult {
  return optimizeCutting2D(PIECES, [SHEET], {
    kerfWidth: 3,
    grainDirection: false,
    considerMaterial: false,
    optimizationPriority: 'linear_guillotine',
  });
}

// Runs the same case against a subset of the strategy table. The table is the
// module's own array, so restricting it reproduces older behavior exactly with
// nothing else changed; it is always restored afterwards.
function runWithOnlyStrategies(keep: (id: string) => boolean): OptimizationResult {
  const strategies = GuillotinePacker.strategies;
  const saved = [...strategies];
  strategies.splice(0, strategies.length, ...saved.filter((s) => keep(s.id)));
  try {
    return run();
  } finally {
    strategies.splice(0, strategies.length, ...saved);
  }
}

function sawPasses(result: OptimizationResult): number {
  return result.sheets.reduce((sum, sheet) => sum + sheet.cuts.length, 0);
}

function describeBands(result: OptimizationResult, label: string): void {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`);
  for (const sheet of result.sheets) {
    // A "band" here is just the set of pieces sharing a top edge (y) — the
    // pieces one rip frees together.
    const byY = new Map<string, typeof sheet.pieces>();
    for (const piece of sheet.pieces) {
      const key = piece.y.toFixed(2);
      const band = byY.get(key);
      if (band) band.push(piece);
      else byY.set(key, [piece]);
    }
    const bands = Array.from(byY.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
    console.log(`  sheet ${sheet.index} (${sheet.width}×${sheet.height}) — ${bands.length} band(s), waste ${sheet.wasteRate}%`);
    for (const [y, band] of bands) {
      const heights = Array.from(new Set(band.map((p) => p.height)));
      const contents = band
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((p) => `${p.baseName ?? p.name}(${p.width}×${p.height}${p.rotated ? ' ↻' : ''})`)
        .join(' | ');
      console.log(`    y=${String(y).padStart(6)}  height=${heights.join('/')}  ${band.length} piece(s): ${contents}`);
    }
  }
  console.log(`  placed ${result.placedPieces.length}, unplaced ${result.unplacedPieces.length}, waste ${result.wastePercentage}%`);
  console.log(`  total cut length: ${result.totalLinearCutMeters} m over ${sawPasses(result)} saw passes`);
}

// The layout the shop actually got: before this change every scoring tie was
// won by whichever strategy the table listed first, which is 'row-area-first'.
const reported = runWithOnlyStrategies((id) => id === 'row-area-first');
const withoutBands = runWithOnlyStrategies((id) => id !== 'band-width-shared');
const result = run();

describeBands(reported, 'as reported by the shop (old tie winner: row-area-first)');
describeBands(withoutBands, 'free-rect packers only, new tiebreak');
describeBands(result, 'with band-width-shared');

// ── Checks ────────────────────────────────────────────────────────
const failures: string[] = [];

if (result.unplacedPieces.length !== 0) failures.push(`${result.unplacedPieces.length} piece(s) left unplaced`);
if (result.sheets.length !== 1) failures.push(`expected 1 sheet, got ${result.sheets.length}`);

const placed = result.placedPieces;
const strips = placed.filter((p) => p.baseName === 'Montant');
const squares = placed.filter((p) => p.baseName === 'Tablette');
if (strips.length !== 2) failures.push(`expected 2 strips, got ${strips.length}`);
if (squares.length !== 6) failures.push(`expected 6 squares, got ${squares.length}`);

// Every piece must be cut at the shared 45 cm width: either in a strip's own
// band, or in a band of the same height stacked on the same saw lines.
const bandHeights = new Set(placed.map((p) => p.height));
if (!(bandHeights.size === 1 && bandHeights.has(45))) {
  failures.push(`every piece should be cut at the shared 45 cm band height, got heights {${Array.from(bandHeights).join(', ')}}`);
}

const stripRows = new Set(strips.map((p) => p.y.toFixed(2)));
const squaresSharingAStripRow = squares.filter((p) => stripRows.has(p.y.toFixed(2))).length;
if (squaresSharingAStripRow === 0) failures.push('no square shares a band with a strip');

if (!(result.totalLinearCutMeters < BASELINE_CUT_METERS)) {
  failures.push(`cut length ${result.totalLinearCutMeters} m is not below the ${BASELINE_CUT_METERS} m baseline`);
}

console.log('\n── Summary ───────────────────────────────────────────────');
console.log(`  bands: ${new Set(placed.map((p) => p.y.toFixed(2))).size} × 45 cm`);
console.log(`  squares sharing a band with a strip: ${squaresSharingAStripRow}/6`);
console.log(`  cut length: ${reported.totalLinearCutMeters} m as reported (${sawPasses(reported)} passes) → ${result.totalLinearCutMeters} m (${sawPasses(result)} passes), reference ${BASELINE_CUT_METERS} m`);
console.log(`  free-rect packers alone would give ${withoutBands.totalLinearCutMeters} m over ${sawPasses(withoutBands)} passes, with the squares on their own 40 cm lines`);

if (failures.length > 0) {
  console.error('\nFAIL');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nPASS — same-width pieces share their guillotine lines.');
