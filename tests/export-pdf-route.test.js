const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// /api/export-pdf's input geometry (sheet/pieces/offcuts) is always canonical
// centimetres — the optimizer never emits millimetres. The old
// `isMm = sheet.width > 500` heuristic silently reinterpreted a legitimate
// 600cm sheet as millimetres. `displayUnit` (cm|mm, default cm) is now the
// only thing that controls how dimensions are *labeled* in the PDF; the
// underlying area/cost/linear-cut math must stay identical regardless of it.

function baseBody(overrides = {}) {
  return {
    projectName: 'Projet Test',
    material: 'mdf',
    sheet: { width: 208, height: 278, kerf: 0.3, margin: 0 },
    result: {
      sheetsUsed: 1,
      wastePercentage: 12.5,
      totalAreaUsed: 5,
      totalAreaAvailable: 5.78,
      offcuts: [],
      placedPieces: [
        { pieceNumber: 1, name: 'Panneau', sheetIndex: 0, width: 120, height: 60, rotated: false, x: 0, y: 0 },
      ],
    },
    ...overrides,
  };
}

function makeRequest(body) {
  return new Request('http://localhost/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pdfTextOf(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('latin1');
}

test('ExportSchema accepts an explicit displayUnit of "cm" or "mm", defaulting to "cm"', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');

  const withCm = ExportSchema.safeParse(baseBody({ displayUnit: 'cm' }));
  const withMm = ExportSchema.safeParse(baseBody({ displayUnit: 'mm' }));
  const withDefault = ExportSchema.safeParse(baseBody());

  assert.equal(withCm.success, true);
  assert.equal(withCm.data.displayUnit, 'cm');
  assert.equal(withMm.success, true);
  assert.equal(withMm.data.displayUnit, 'mm');
  assert.equal(withDefault.success, true);
  assert.equal(withDefault.data.displayUnit, 'cm', 'displayUnit must default to cm when omitted');
});

test('ExportSchema rejects an unrecognized displayUnit instead of silently accepting it', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const parsed = ExportSchema.safeParse(baseBody({ displayUnit: 'inch' }));
  assert.equal(parsed.success, false);
});

test('a 600cm sheet is never reinterpreted: dimension label reads 600.0, not 60.0', async () => {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  const body = baseBody({
    displayUnit: 'cm',
    sheet: { width: 600, height: 100, kerf: 0.3, margin: 0 },
    result: {
      sheetsUsed: 1,
      wastePercentage: 10,
      totalAreaUsed: 1,
      totalAreaAvailable: 2,
      offcuts: [],
      placedPieces: [{ pieceNumber: 1, name: 'A', sheetIndex: 0, width: 50, height: 50, rotated: false, x: 0, y: 0 }],
    },
  });

  const res = await POST(makeRequest(body));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);

  assert.ok(text.includes('600.0'), 'the legitimate 600cm sheet dimension must survive untouched');
  assert.ok(!text.includes('\\(60.0'), 'a 600cm sheet must never be silently divided by 10 into 60.0');
});

test('with displayUnit "mm", the same 600cm sheet is labeled 6000.0 while the math stays in cm', async () => {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  const sharedResult = {
    sheetsUsed: 1,
    wastePercentage: 10,
    totalAreaUsed: 1,
    totalAreaAvailable: 2,
    offcuts: [],
    placedPieces: [{ pieceNumber: 1, name: 'A', sheetIndex: 0, width: 50, height: 50, rotated: false, x: 0, y: 0 }],
  };
  const sheet = { width: 600, height: 100, kerf: 0.3, margin: 0 };

  const resCm = await POST(makeRequest(baseBody({ displayUnit: 'cm', sheet, result: sharedResult })));
  const resMm = await POST(makeRequest(baseBody({ displayUnit: 'mm', sheet, result: sharedResult })));

  const textCm = await pdfTextOf(resCm);
  const textMm = await pdfTextOf(resMm);

  assert.ok(textCm.includes('600.0'), 'cm export must label the sheet 600.0');
  assert.ok(textMm.includes('6000.0'), 'mm export must label the same canonical sheet 6000.0, converted exactly once');

  // Area (m²) is derived purely from canonical cm geometry and must be
  // byte-identical between the two exports regardless of the chosen label unit.
  const areaCm = textCm.match(/([0-9]+\.[0-9]{2}) m²/);
  const areaMm = textMm.match(/([0-9]+\.[0-9]{2}) m²/);
  assert.ok(areaCm, 'cm export must contain an m² figure');
  assert.ok(areaMm, 'mm export must contain an m² figure');
  assert.equal(areaCm[1], areaMm[1], 'the underlying area/cost math must be unaffected by displayUnit');
});

// ─── locale: server-validated, independent of displayUnit ──────────────────
// The artisan's current UI locale (fr|en|ar) travels with the export request
// so the PDF renders in their language. It must be validated server-side like
// every other field here — a legacy client that never sends it must still get
// a valid French PDF rather than a 400 or an undefined catalog lookup.

test('ExportSchema accepts locale "fr", "en" or "ar", defaulting to "fr"', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');

  const withFr = ExportSchema.safeParse(baseBody({ locale: 'fr' }));
  const withEn = ExportSchema.safeParse(baseBody({ locale: 'en' }));
  const withAr = ExportSchema.safeParse(baseBody({ locale: 'ar' }));
  const withDefault = ExportSchema.safeParse(baseBody());

  assert.equal(withFr.success, true);
  assert.equal(withFr.data.locale, 'fr');
  assert.equal(withEn.success, true);
  assert.equal(withEn.data.locale, 'en');
  assert.equal(withAr.success, true);
  assert.equal(withAr.data.locale, 'ar');
  assert.equal(withDefault.success, true);
  assert.equal(withDefault.data.locale, 'fr', 'locale must default to fr when a legacy client omits it');
});

test('ExportSchema rejects an unrecognized locale instead of silently accepting it', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const parsed = ExportSchema.safeParse(baseBody({ locale: 'de' }));
  assert.equal(parsed.success, false);
});

test('ExportSchema locale stays independent of displayUnit: mixing ar + mm is valid', () => {
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');
  const parsed = ExportSchema.safeParse(baseBody({ locale: 'ar', displayUnit: 'mm' }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.locale, 'ar');
  assert.equal(parsed.data.displayUnit, 'mm');
});

test('ExportSchema accepts every locale the app-wide i18n catalog supports, and nothing else', () => {
  const { LOCALES } = loadTsModule('src/i18n/index.ts');
  const { ExportSchema } = loadTsModule('src/lib/exports/pdf-schema.ts');

  for (const locale of LOCALES) {
    assert.equal(ExportSchema.safeParse(baseBody({ locale })).success, true, `locale "${locale}" must be accepted`);
  }
  assert.equal(
    ExportSchema.safeParse(baseBody({ locale: 'not-a-real-locale' })).success,
    false,
    'a locale outside the app-wide set must be rejected'
  );
});

test('PDF route source contains no sheet.width/isMm magnitude heuristic', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve('src/app/api/export-pdf/route.ts'), 'utf8');

  assert.doesNotMatch(source, /isMm/i, 'no magnitude-based mm/cm guessing may remain');
  assert.doesNotMatch(source, /sheet\.width\s*>\s*500/, 'no `sheet.width > 500` heuristic may remain');
  assert.match(source, /fromCanonicalCm/, 'human dimension labels must go through fromCanonicalCm');
  assert.doesNotMatch(source, /:\s*any\b/, 'route must stay strictly typed (no `any`)');
});
