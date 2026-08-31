#!/usr/bin/env node
/**
 * QatlIA optimizer benchmark runner.
 *
 * Runs the real `optimizeCutting2D` over every checked-in fixture in
 * `tests/fixtures/benchmarks/` and prints the measurements that back
 * `docs/optimizer-benchmark.md`. Nothing here is transcribed by hand: every
 * number published in the docs is copied from this script's output.
 *
 *   npm run benchmark:optimizer                    # stable JSON on stdout
 *   npm run benchmark:optimizer -- --format=markdown
 *   npm run benchmark:optimizer -- --fixtures-dir=<dir>
 *
 * The output carries no timestamp and iterates fixtures in sorted order, so
 * two runs on the same commit are byte-identical. The process exits 1 if any
 * fixture breaks a geometry invariant or its published threshold, so the
 * benchmark can gate CI rather than merely describe a past run.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');

const { loadTsModule } = require(path.join(PROJECT_ROOT, 'tests/helpers/load-ts-module.js'));
const {
  areaLowerBoundSheets,
  buildOptimizerInput,
  expandedPieceCount,
  loadAllBenchmarkFixtures,
  rotationAllowed,
  sourceRowCount,
  totalPieceAreaCm2,
  usableSheetAreaCm2,
} = require(path.join(PROJECT_ROOT, 'tests/helpers/benchmark-fixtures.js'));

// Every figure in the report is rounded exactly once, here, at these fixed
// precisions — the report states them so a reader can tell a rounded value
// from a raw one.
const ROUNDING = { areaM2Decimals: 4, percentDecimals: 1, lengthMDecimals: 1 };

const GEOMETRY_EPSILON = 1e-9;

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const options = { format: 'json', fixturesDir: undefined };
  for (const arg of argv) {
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
    } else if (arg.startsWith('--fixtures-dir=')) {
      options.fixturesDir = path.resolve(arg.slice('--fixtures-dir='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.format !== 'json' && options.format !== 'markdown') {
    throw new Error(`Unsupported --format=${options.format} (expected "json" or "markdown")`);
  }
  return options;
}

function rectanglesOverlap(a, b) {
  return (
    a.x < b.x + b.width - GEOMETRY_EPSILON &&
    a.x + a.width > b.x + GEOMETRY_EPSILON &&
    a.y < b.y + b.height - GEOMETRY_EPSILON &&
    a.y + a.height > b.y + GEOMETRY_EPSILON
  );
}

/**
 * Independent re-verification of the plan the optimizer returned. The point of
 * a published benchmark is that a reported sheet count is worthless unless the
 * plan is actually cuttable, so this recomputes the invariants from the
 * returned geometry rather than trusting the optimizer's own bookkeeping.
 */
export function auditPlan(fixture, result) {
  const expectedExpanded = expandedPieceCount(fixture);
  const placedIds = result.placedPieces.map((piece) => piece.pieceId);
  const unplacedIds = result.unplacedPieces.map((piece) => piece.id);
  const allIds = new Set([...placedIds, ...unplacedIds]);

  const allPiecesAccountedFor =
    result.placedPieces.length + result.unplacedPieces.length === expectedExpanded &&
    new Set(placedIds).size === placedIds.length &&
    new Set(unplacedIds).size === unplacedIds.length &&
    allIds.size === expectedExpanded;

  // `result.placedPieces` is a separate array from `result.sheets[].pieces` in
  // the optimizer's own return shape; nothing upstream forces them to agree.
  // Tie them together explicitly rather than trusting `placedPieces` alone.
  const sheetPieceIds = result.sheets.flatMap((sheet) => sheet.pieces.map((piece) => piece.pieceId));
  const placedPiecesMatchSheets =
    sheetPieceIds.length === placedIds.length && multisetEqual(sheetPieceIds, placedIds);

  const sheetsUsedMatchesSheetCount = result.sheetsUsed === result.sheets.length;

  const sheetIndices = result.sheets.map((sheet) => sheet.index);
  const validSheetIndices =
    new Set(sheetIndices).size === sheetIndices.length &&
    sheetIndices.every((index, position) => index === position) &&
    result.sheets.every((sheet) => sheet.pieces.every((piece) => piece.sheetIndex === sheet.index));

  const margin = Math.max(0, fixture.sheet.margin || 0);
  let everyPieceWithinSheet = true;
  let noOverlappingPieces = true;
  let totalPlacedAreaCm2 = 0;
  let totalGrossSheetAreaCm2 = 0;
  for (const sheet of result.sheets) {
    totalGrossSheetAreaCm2 += sheet.width * sheet.height;
    for (const piece of sheet.pieces) {
      totalPlacedAreaCm2 += piece.width * piece.height;
      if (
        piece.x < margin - GEOMETRY_EPSILON ||
        piece.y < margin - GEOMETRY_EPSILON ||
        piece.x + piece.width > sheet.width - margin + GEOMETRY_EPSILON ||
        piece.y + piece.height > sheet.height - margin + GEOMETRY_EPSILON
      ) {
        everyPieceWithinSheet = false;
      }
    }
    for (let i = 0; i < sheet.pieces.length; i += 1) {
      for (let j = i + 1; j < sheet.pieces.length; j += 1) {
        if (rectanglesOverlap(sheet.pieces[i], sheet.pieces[j])) noOverlappingPieces = false;
      }
    }
  }

  const offcutsWithinBoundsNoOverlap = auditOffcuts(result.sheets, margin);

  // The published utilization/waste figures come straight from the
  // optimizer's own `wastePercentage`. Recompute utilization independently
  // from the returned geometry (placed piece area over gross sheet area of
  // every sheet used) and require the two to agree, so a bookkeeping bug in
  // the optimizer's own waste tally cannot silently reach the published copy.
  const geometryUtilizationPercent =
    totalGrossSheetAreaCm2 > 0 ? (totalPlacedAreaCm2 / totalGrossSheetAreaCm2) * 100 : 0;
  const reportedUtilizationPercent = 100 - result.wastePercentage;
  const utilizationMatchesGeometry = Math.abs(geometryUtilizationPercent - reportedUtilizationPercent) < 0.15;

  return {
    allPiecesAccountedFor,
    placedPiecesMatchSheets,
    sheetsUsedMatchesSheetCount,
    validSheetIndices,
    everyPieceWithinSheet,
    noOverlappingPieces,
    offcutsWithinBoundsNoOverlap,
    utilizationMatchesGeometry,
    withinSheetThreshold: result.sheetsUsed <= fixture.thresholds.maxSheets,
    withinUnplacedThreshold: result.unplacedPieces.length <= fixture.thresholds.maxUnplaced,
    // A published ceiling that sits below the area lower bound would be an
    // impossible target no plan could ever meet; verify it against the
    // derived floor rather than trusting the fixture's own number blindly.
    thresholdAtOrAboveLowerBound: fixture.thresholds.maxSheets >= areaLowerBoundSheets(fixture),
  };
}

/** True when both arrays contain exactly the same elements, counting duplicates. */
function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * Independent re-verification of the offcuts the optimizer returned: each one
 * must sit within its sheet's margin band, none may overlap a placed piece or
 * another offcut on the same sheet, and the placed + offcut area on a sheet
 * may never exceed that sheet's usable (post-margin) area — the only way it
 * could is if two regions overlap or an offcut is fabricated out of thin air.
 */
function auditOffcuts(sheets, margin) {
  for (const sheet of sheets) {
    const usableAreaCm2 = Math.max(0, sheet.width - margin * 2) * Math.max(0, sheet.height - margin * 2);
    let placedAndOffcutAreaCm2 = 0;
    for (const piece of sheet.pieces) placedAndOffcutAreaCm2 += piece.width * piece.height;

    for (const offcut of sheet.offcuts) {
      placedAndOffcutAreaCm2 += offcut.width * offcut.height;

      if (
        offcut.x < margin - GEOMETRY_EPSILON ||
        offcut.y < margin - GEOMETRY_EPSILON ||
        offcut.x + offcut.width > sheet.width - margin + GEOMETRY_EPSILON ||
        offcut.y + offcut.height > sheet.height - margin + GEOMETRY_EPSILON
      ) {
        return false;
      }
      for (const piece of sheet.pieces) {
        if (rectanglesOverlap(offcut, piece)) return false;
      }
    }
    for (let i = 0; i < sheet.offcuts.length; i += 1) {
      for (let j = i + 1; j < sheet.offcuts.length; j += 1) {
        if (rectanglesOverlap(sheet.offcuts[i], sheet.offcuts[j])) return false;
      }
    }
    if (placedAndOffcutAreaCm2 > usableAreaCm2 + GEOMETRY_EPSILON) return false;
  }
  return true;
}

export function measureFixture(optimizeCutting2D, fixture) {
  const input = buildOptimizerInput(fixture);
  const result = optimizeCutting2D(input.pieces, input.sheets, input.options);

  // wastePercent and utilizationPercent are each rounded exactly once, here,
  // directly from the optimizer's raw (unrounded) result.wastePercentage.
  // Deriving utilizationPercent from the already-rounded wastePercent instead
  // of the raw value would double-round: e.g. a raw waste of 16.25 rounds to
  // 16.3, and 100 - 16.3 rounds to 83.7, but the honest figure — rounding
  // 100 - 16.25 directly — is 83.8. Only the raw value may feed either round.
  const wastePercent = round(result.wastePercentage, ROUNDING.percentDecimals);
  const utilizationPercent = round(100 - result.wastePercentage, ROUNDING.percentDecimals);

  return {
    id: fixture.id,
    version: fixture.version,
    label: fixture.label,
    source: {
      origin: fixture.source.origin,
      capturedAt: fixture.source.capturedAt,
      note: fixture.source.note,
    },
    input: {
      sheetHeightCm: fixture.sheet.height,
      sheetWidthCm: fixture.sheet.width,
      kerfCm: fixture.sheet.kerf,
      marginCm: fixture.sheet.margin,
      rotationAllowed: rotationAllowed(fixture),
      materialSeparation: fixture.options.considerMaterial,
      grainLocked: fixture.options.grainDirection || fixture.sheet.grainDirection,
      objective: fixture.options.optimizationPriority,
      sourceRows: sourceRowCount(fixture),
      expandedPieces: expandedPieceCount(fixture),
      totalPieceAreaM2: round(totalPieceAreaCm2(fixture) / 10000, ROUNDING.areaM2Decimals),
    },
    lowerBound: {
      sheets: areaLowerBoundSheets(fixture),
      usableSheetAreaM2: round(usableSheetAreaCm2(fixture.sheet) / 10000, ROUNDING.areaM2Decimals),
      basis:
        'ceil(total piece area / usable inner rectangle of one sheet), where the usable inner rectangle is the sheet minus the edge margin on all four sides',
      excludes: [
        'kerf consumed by every saw pass',
        'the guillotine (edge-to-edge) cutting constraint',
        'rectangle packing loss — pieces are treated as if they could be poured in as a liquid',
      ],
      note: 'Optimistic floor only. It is not an achievable plan and must never be published as the optimum.',
    },
    result: {
      sheetsUsed: result.sheetsUsed,
      placedPieces: result.placedPieces.length,
      unplacedPieces: result.unplacedPieces.length,
      utilizationPercent,
      wastePercent,
      utilizationBasis:
        'placed piece area divided by the gross area of every sheet the plan used (the edge margin counts as sheet area, not as usable area)',
      totalLinearCutMeters: round(result.totalLinearCutMeters, ROUNDING.lengthMDecimals),
      candidatesEvaluated: result.explanation.candidatesEvaluated,
      activeConstraints: result.explanation.activeConstraints,
      chosenGoal: result.explanation.chosenGoal,
    },
    thresholds: { ...fixture.thresholds },
    checks: auditPlan(fixture, result),
  };
}

export function collectFailures(entry) {
  const failures = [];
  const messages = {
    allPiecesAccountedFor: 'placed and unplaced pieces do not partition the expanded piece list exactly once',
    placedPiecesMatchSheets: 'placedPieces does not match the pieces actually laid out on result.sheets',
    sheetsUsedMatchesSheetCount: 'sheetsUsed disagrees with the number of sheets in the plan',
    validSheetIndices: 'sheet indices are missing, duplicated, or disagree with a piece placed on them',
    everyPieceWithinSheet: 'at least one placed piece falls outside its sheet margin',
    noOverlappingPieces: 'at least two placed pieces overlap',
    offcutsWithinBoundsNoOverlap: 'at least one offcut falls outside its margin, overlaps a piece or another offcut, or the sheet area does not add up',
    utilizationMatchesGeometry: "the reported utilization disagrees with utilization computed independently from the plan's own geometry",
    withinSheetThreshold: `plan used ${entry.result.sheetsUsed} sheets, above the published ceiling of ${entry.thresholds.maxSheets}`,
    withinUnplacedThreshold: `plan left ${entry.result.unplacedPieces} pieces unplaced, above the published ceiling of ${entry.thresholds.maxUnplaced}`,
    thresholdAtOrAboveLowerBound: `published ceiling of ${entry.thresholds.maxSheets} sheets is below the area lower bound of ${entry.lowerBound.sheets}`,
  };
  for (const [check, passed] of Object.entries(entry.checks)) {
    if (passed) continue;
    if (!(check in messages)) {
      throw new Error(`benchmark runner: auditPlan returned unknown check "${check}" with no failure message defined for it`);
    }
    failures.push({ fixture: entry.id, check, message: messages[check] });
  }
  return failures;
}

export function toMarkdown(report) {
  const lines = [];
  lines.push('| Fixture | Version | Source rows | Pieces | Piece area (m²) | Area lower bound (sheets) | Sheets used | Placed / unplaced | Utilization | Waste | Candidates | Goal |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const entry of report.fixtures) {
    lines.push(
      `| \`${entry.id}\` | ${entry.version} | ${entry.input.sourceRows} | ${entry.input.expandedPieces} | ${entry.input.totalPieceAreaM2} | ${entry.lowerBound.sheets} | ${entry.result.sheetsUsed} | ${entry.result.placedPieces} / ${entry.result.unplacedPieces} | ${entry.result.utilizationPercent} % | ${entry.result.wastePercent} % | ${entry.result.candidatesEvaluated} | ${entry.result.chosenGoal} |`
    );
  }
  lines.push('');
  lines.push('| Fixture | Sheet H×W (cm) | Kerf (cm) | Margin (cm) | Rotation | Material separation | Grain locked | Active constraints |');
  lines.push('| --- | --- | ---: | ---: | --- | --- | --- | --- |');
  for (const entry of report.fixtures) {
    const constraints = entry.result.activeConstraints.length ? entry.result.activeConstraints.join(', ') : 'none';
    lines.push(
      `| \`${entry.id}\` | ${entry.input.sheetHeightCm} × ${entry.input.sheetWidthCm} | ${entry.input.kerfCm} | ${entry.input.marginCm} | ${entry.input.rotationAllowed ? 'allowed' : 'locked'} | ${entry.input.materialSeparation ? 'on' : 'off'} | ${entry.input.grainLocked ? 'yes' : 'no'} | ${constraints} |`
    );
  }
  lines.push('');
  lines.push('### Reading the results');
  lines.push('');
  for (const entry of report.fixtures) {
    const placedText =
      entry.result.unplacedPieces === 0
        ? 'all placed'
        : `${entry.result.placedPieces} placed, ${entry.result.unplacedPieces} unplaced`;
    const meetsLowerBound = entry.result.sheetsUsed === entry.lowerBound.sheets;
    const lowerBoundNote = meetsLowerBound
      ? ` The area lower bound for this instance is also ${entry.lowerBound.sheets}, so ${entry.lowerBound.sheets} is the minimum sheet count any optimizer could achieve here: the pieces do not fit into fewer sheets even ignoring kerf and packing loss entirely.`
      : ` The area lower bound for this instance is ${entry.lowerBound.sheets}, so this plan does not prove minimal sheet count for it.`;
    lines.push(
      `* \`${entry.id}\` — ${entry.input.sourceRows} source rows, **${entry.input.expandedPieces} pieces**, ${placedText}, on **${entry.result.sheetsUsed} sheets** at **${entry.result.utilizationPercent} %** utilization.${lowerBoundNote}`
    );
  }
  lines.push('');
  const allMeetLowerBound = report.fixtures.every((entry) => entry.result.sheetsUsed === entry.lowerBound.sheets);
  lines.push(
    allMeetLowerBound
      ? 'Every measured instance above happens to meet its area lower bound. That proves minimal sheet count **for these instances only**, and says nothing about optimality in general — QatlIA does not claim global optimality for any other input.'
      : 'Meeting the area lower bound proves minimal sheet count **for that instance only**, and says nothing about optimality in general — QatlIA does not claim global optimality for any other input.'
  );
  if (report.failures.length > 0) {
    lines.push('');
    lines.push('**Failures**');
    for (const failure of report.failures) {
      lines.push(`- \`${failure.fixture}\` — ${failure.check}: ${failure.message}`);
    }
  }
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { optimizeCutting2D } = loadTsModule(path.join(PROJECT_ROOT, 'src/lib/cutting/binpacking.ts'));

  const fixtures = loadAllBenchmarkFixtures(options.fixturesDir);
  const entries = fixtures.map((fixture) => measureFixture(optimizeCutting2D, fixture));
  const failures = entries.flatMap(collectFailures);

  const report = { schemaVersion: 1, rounding: ROUNDING, fixtures: entries, failures };

  process.stdout.write(options.format === 'markdown' ? `${toMarkdown(report)}\n` : `${JSON.stringify(report, null, 2)}\n`);

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`benchmark failure: ${failure.fixture}: ${failure.check}: ${failure.message}\n`);
    }
    process.exitCode = 1;
  }
}

// Only run when invoked as a script (`node scripts/benchmark-optimizer.mjs`),
// not when the pure functions above are imported by a test for unit testing
// against a controlled/mutated result.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
