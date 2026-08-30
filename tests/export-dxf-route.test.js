const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// DXF contract (documented in src/app/api/export-dxf/route.ts): geometry
// coordinates (POLYLINE/VERTEX) are always canonical centimetres, for CNC/
// laser machine compatibility — they must never be rescaled by `displayUnit`.
// `displayUnit` is optional metadata (defaults to cm) that only changes how
// the human-readable piece label text states dimensions; it is preserved in
// the schema but never converts geometry.

function baseBody(overrides = {}) {
  return {
    projectName: 'QatlIA_CNC_Plan',
    sheet: { width: 600, height: 100 },
    placedPieces: [
      { pieceNumber: 1, name: 'A', sheetIndex: 0, x: 10, y: 20, width: 50, height: 30 },
    ],
    ...overrides,
  };
}

function makeRequest(body) {
  return new Request('http://localhost/api/export-dxf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('DxfSchema accepts an optional displayUnit, defaulting to cm', () => {
  const { DxfSchema } = loadTsModule('src/lib/exports/dxf-schema.ts');

  const withoutUnit = DxfSchema.safeParse(baseBody());
  const withMm = DxfSchema.safeParse(baseBody({ displayUnit: 'mm' }));
  const withGarbage = DxfSchema.safeParse(baseBody({ displayUnit: 'inch' }));

  assert.equal(withoutUnit.success, true);
  assert.equal(withoutUnit.data.displayUnit, 'cm', 'displayUnit must default to cm when omitted');
  assert.equal(withMm.success, true);
  assert.equal(withMm.data.displayUnit, 'mm');
  assert.equal(withGarbage.success, false, 'an unrecognized displayUnit must be rejected, not silently accepted');
});

test('a 600cm sheet produces DXF geometry coordinates of exactly 600, never rescaled', async () => {
  const { POST } = loadTsModule('src/app/api/export-dxf/route.ts');
  const res = await POST(makeRequest(baseBody({ displayUnit: 'mm' })));
  assert.equal(res.status, 200);
  const dxf = await res.text();

  // POLYLINE sheet-contour vertex at (600, 0) must appear literally: geometry
  // stays canonical cm even when displayUnit is 'mm'.
  assert.match(dxf, /10\n600\n20\n0\n/, 'sheet width vertex must remain the canonical 600, not rescaled to mm');
});

test('geometry is identical between displayUnit "cm" and "mm" requests for the same piece', async () => {
  const { POST } = loadTsModule('src/app/api/export-dxf/route.ts');
  const body = baseBody();

  const dxfCm = await (await POST(makeRequest({ ...body, displayUnit: 'cm' }))).text();
  const dxfMm = await (await POST(makeRequest({ ...body, displayUnit: 'mm' }))).text();

  const stripLabels = (text) => text.replace(/1\n#1 \([^\n]*\)\n/, '');
  assert.equal(stripLabels(dxfCm), stripLabels(dxfMm), 'geometry entities must be byte-identical regardless of displayUnit');
});

test('the piece label text states the selected display values and unit without converting geometry', async () => {
  const { POST } = loadTsModule('src/app/api/export-dxf/route.ts');
  const res = await POST(makeRequest({
    ...baseBody(),
    displayUnit: 'mm',
    placedPieces: [{ pieceNumber: 7, name: 'A', sheetIndex: 0, x: 0, y: 0, width: 50, height: 30 }],
  }));
  const dxf = await res.text();

  assert.match(dxf, /#7 \(500\.0x300\.0 mm\)/, 'label must show the mm-converted display values with a unit suffix');
  // The rectangle geometry for this piece must still be canonical (width=50, not 500).
  assert.match(dxf, /10\n50\n20\n0\n/, 'piece geometry width must remain canonical cm (50), not converted to mm (500)');
});

test('DXF route source documents the unit contract and never rescales geometry by displayUnit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve('src/app/api/export-dxf/route.ts'), 'utf8');

  assert.doesNotMatch(source, /:\s*any\b/, 'route must stay strictly typed (no `any`)');
  assert.match(source, /fromCanonicalCm/, 'label text must go through fromCanonicalCm');
  assert.doesNotMatch(source, /off\.x\s*\*|p\.x\s*\*\s*scale/i, 'geometry coordinates must never be scaled by displayUnit');
});
