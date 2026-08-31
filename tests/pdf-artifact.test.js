const test = require('node:test');
const { before } = test;
const assert = require('node:assert/strict');
const { jsPDF } = require('jspdf');
const { loadTsModule } = require('./helpers/load-ts-module');

/**
 * End-to-end artifact tests for /api/export-pdf: unlike pdf-catalog.test.js,
 * pdf-bidi.test.js and pdf-fonts.test.js (which pin the individual building
 * blocks), these tests generate a *real* PDF through the actual route for
 * each locale and then independently re-parse and re-render it — with
 * pdfjs-dist (a completely different codebase from jsPDF, the writer) doing
 * the reading, and @napi-rs/canvas doing the rendering — so a bug that only
 * shows up in the bytes jsPDF actually emits (as opposed to the helpers'
 * inputs/outputs) has somewhere to surface.
 *
 * Nothing here writes a PDF or PNG to disk: every buffer/canvas stays in
 * memory for the duration of one test.
 */

let pdfjsLib;
let canvas;

before(async () => {
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  canvas = require('@napi-rs/canvas');
  // pdf.js's canvas rendering path (`page.render({ canvasContext, viewport })`)
  // constructs DOMMatrix/Path2D/ImageData itself and expects to find them as
  // globals -- none exist in plain Node. @napi-rs/canvas is a real, native
  // implementation of all three (not a stub), so page.render() below actually
  // paints pixels we can inspect, rather than silently no-oping.
  global.DOMMatrix = canvas.DOMMatrix;
  global.Path2D = canvas.Path2D;
  global.ImageData = canvas.ImageData;
});

// An Arabic project name is used for every locale (not just 'ar'): an
// artisan can type an Arabic project name in a French/English-locale export
// too, and drawContentAwareText's Arabic handling is gated on the *text*
// containing Arabic script (via containsArabicScript), not on the export's
// locale (see pdf-fonts.ts).
const ARABIC_PROJECT_NAME = 'مشروع الاختبار';

function baseBody(locale, overrides = {}) {
  return {
    projectName: ARABIC_PROJECT_NAME,
    material: 'MDF',
    locale,
    displayUnit: 'cm',
    sheet: { width: 208, height: 278, kerf: 0.3, margin: 0 },
    result: {
      sheetsUsed: 1,
      wastePercentage: 12.5,
      totalAreaUsed: 5,
      totalAreaAvailable: 5.78,
      totalLinearCutMeters: 8.4,
      offcuts: [{ sheetIndex: 0, x: 0, y: 120, width: 208, height: 158, areaM2: 3.29, isReusable: true }],
      placedPieces: [
        { pieceNumber: 1, name: 'Panneau', sheetIndex: 0, width: 120, height: 60, rotated: false, x: 0, y: 0 },
        { pieceNumber: 2, name: 'Panneau', sheetIndex: 0, width: 60, height: 40, rotated: false, x: 120, y: 0 },
      ],
      costingInput: {
        material: { sheets: [{ areaM2: 5.78, quantity: 1, pricing: { mode: 'per_sheet', value: 350 } }], basis: 'estimated' },
        edge: { segments: [{ lengthM: 5, pricePerMeter: 3 }], basis: 'estimated' },
        labor: { pricing: { mode: 'fixed', value: 50 } },
      },
    },
    ...overrides,
  };
}

async function generatePdf(body) {
  const { POST } = loadTsModule('src/app/api/export-pdf/route.ts');
  const req = new Request('http://localhost/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

async function loadPdf(buf) {
  return pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true }).promise;
}

async function pageText(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return {
    items: content.items,
    text: content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim(),
  };
}

/** Renders `pageNumber` to an in-memory RGBA buffer via @napi-rs/canvas. Nothing touches disk. */
async function renderPage(doc, pageNumber, scale) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const cnv = canvas.createCanvas(width, height);
  const ctx = cnv.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { imageData: ctx.getImageData(0, 0, width, height), width, height };
}

/** Counts pixels that are not (near-)pure white inside the given fraction-of-page rectangle. */
function countInk(imageData, width, height, xFrac0, yFrac0, xFrac1, yFrac1) {
  const { data } = imageData;
  const x0 = Math.max(0, Math.floor(xFrac0 * width));
  const x1 = Math.min(width, Math.ceil(xFrac1 * width));
  const y0 = Math.max(0, Math.floor(yFrac0 * height));
  const y1 = Math.min(height, Math.ceil(yFrac1 * height));
  let ink = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > 0 && (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245)) ink++;
    }
  }
  return ink;
}

const NO_TOFU = (text) => assert.doesNotMatch(text, /�/, 'extracted text must contain no replacement-character tofu');

// ─── Locale coverage: catalog labels, digits/MAD/dimensions, Arabic shaping ──

for (const locale of ['fr', 'en', 'ar']) {
  test(`${locale}: generates a real, parseable, two-page PDF with locale-correct labels`, async () => {
    const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
    const cat = pdfCatalogFor(locale);

    const { res, buf } = await generatePdf(baseBody(locale));
    assert.equal(res.status, 200);
    assert.ok(buf.length > 5000, `expected a real multi-page PDF, got ${buf.length} bytes`);

    const doc = await loadPdf(buf);
    // Page 1: portrait cover/recap. Page 2: the single cutting-pattern schema
    // (both fixture pieces sit on the same sheet, so uniquePatterns.length === 1).
    assert.equal(doc.numPages, 2);

    const { text: page1Text } = await pageText(doc, 1);
    NO_TOFU(page1Text);

    // A jsPDF-shaped Arabic catalog label is drawn in *visual* (left-to-right
    // draw) order by jsPDF's own built-in bidi engine (see pdf-fonts.ts's
    // arabicBidiOptions/drawContentAwareText) -- but pdfjs-dist's own
    // getTextContent() runs its own bidi reconstruction over each
    // RTL-detected text run and hands back *logical* order, which for a
    // pure-Arabic label with shaped presentation-form glyphs turns out to
    // exactly undo that visual reorder (empirically verified: it is NOT
    // simply "the raw catalog string", since presentation forms remain --
    // see the codepoint-range assertion below). So the honest comparison
    // here is against the *shaped-but-not-reordered* string
    // (doc.processArabic(label)), not the plain catalog string. The actual
    // visual (left-to-right glyph position) order is checked independently,
    // from real glyph coordinates, in the dedicated test below this one.
    const expectLabel = (label) => {
      if (locale !== 'ar') {
        assert.ok(page1Text.includes(label), `expected "${label}" in page 1 text: ${page1Text}`);
        return;
      }
      const expected = new jsPDF().processArabic(label);
      assert.ok(page1Text.includes(expected), `expected shaped "${label}" in page 1 text: ${page1Text}`);
      assert.notEqual(label, expected, 'sanity: shaping must actually change Arabic text into presentation forms');
    };

    expectLabel(cat.cuttingList.title);
    expectLabel(cat.panelsUsed.title);
    // cat.recap.title used to need a special-cased expected value here (a
    // hand-documented "known double-shaping ligature artifact"), because the
    // old hand-rolled pipeline shaped Arabic text twice (once manually, once
    // more automatically inside doc.text). Driving jsPDF's own bidi engine
    // instead (see pdf-fonts.ts's arabicBidiOptions) shapes every string
    // exactly once, so this title now behaves like any other pure-Arabic
    // label -- see the dedicated regression test below for the explicit
    // proof that the old artifact is gone.
    expectLabel(cat.recap.title);

    // MAD figures and dimension labels are drawn as plain (non-Arabic) runs
    // in every locale (see route.ts's fmt/fmtMad) -- digits, the decimal
    // separator, "×" and the unit must all survive left-to-right and intact.
    assert.match(page1Text, /\d+,\d{2} MAD/, 'a MAD amount with intact digit order must appear');
    assert.match(page1Text, /\d+\.\d × \d+\.\d cm/, 'a "H × W cm" dimension must appear with intact digit order');

    const { text: page2Text } = await pageText(doc, 2);
    NO_TOFU(page2Text);
  });
}

test('ar: cat.recap.title regression -- no more double-shaping lam-alef ligature corruption', async () => {
  // The old hand-rolled pipeline called doc.processArabic() manually *and*
  // let jsPDF's own preProcessText hook call it again automatically inside
  // doc.text() -- shaping the string twice. That was harmless for plain
  // per-character shaping (its table only matches base Arabic letters, not
  // presentation forms) but jsPDF's mandatory ligature substitution
  // (lam+alef -> a single glyph, U+FEFB/FEFC) does match against
  // already-shaped presentation forms: the hand-rolled reorder's
  // within-word character reversal could coincidentally place an
  // ALEF-final-form glyph directly before a LAM-initial-form glyph -- an
  // adjacency that never existed in the original logical text -- which the
  // second, automatic shaping pass then incorrectly contracted into a
  // single lam-alef ligature glyph. cat.recap.title ("ملخص المعطيات
  // والتكلفة بالدرهم") was the concrete case that surfaced this.
  //
  // Driving jsPDF's own bidi engine directly (see pdf-fonts.ts's
  // arabicBidiOptions/drawContentAwareText) hands it the *raw logical*
  // string and lets its own preProcessText/postProcessText pipeline shape
  // it exactly once, so this ligature contraction cannot happen anymore --
  // for this string or any other. This test proves it stays fixed.
  const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
  const cat = pdfCatalogFor('ar');

  const shapedOnce = new jsPDF().processArabic(cat.recap.title);
  assert.match(shapedOnce, /ﺎﻟ/, 'fixture sanity: expected the ALEF-final+LAM-initial adjacency the old bug needed');
  const corruptedByDoubleShaping = shapedOnce.replace(/ﺎﻟ/, 'ﻻ');

  const { buf } = await generatePdf(baseBody('ar'));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);
  assert.ok(
    text.includes(shapedOnce),
    `expected cat.recap.title shaped exactly once (no corruption) in page 1 text: ${text}`
  );
  assert.ok(
    !text.includes(corruptedByDoubleShaping),
    `the old double-shaping lam-alef ligature corruption must not reappear: ${text}`
  );
});

// ─── Punctuation-adjacent Arabic (colon, parentheses): jsPDF's own bidi
// engine, not a hand-rolled hack ────────────────────────────────────────────
//
// These three cases are real catalog strings (src/lib/exports/pdf-catalog.ts)
// actually drawn by the route for locale 'ar': a bare colon-suffixed label,
// and two parenthesized-unit labels. Each mixes an Arabic run with a
// trailing non-Arabic run (a colon, a unit, "MAD") -- exactly what the old
// hand-rolled toVisualOrder pipeline "mishandled punctuation" on (see
// pdf-bidi.ts's module doc comment). The expected values below are the
// *real*, empirically-observed output of generating an actual PDF through
// this route and re-parsing it with pdfjs-dist, not a theoretical
// prediction: jsPDF's own bidi engine resolves the neutral colon/space/
// parentheses to the paragraph's (right-to-left) embedding direction per
// UAX#9 rule N2, which visually moves the trailing non-Arabic run before
// the (still correctly internally-ordered) Arabic run -- e.g. "العملة: MAD"
// (currency: MAD) extracts with the "MAD :" pair ahead of the shaped Arabic
// word, exactly how a native Arabic reader expects "MAD" to trail a
// colon-suffixed Arabic label. Nothing is dropped, duplicated or tofu'd.

test('ar: currencyLabel ("العملة: MAD") -- colon-adjacent Arabic renders without corruption', async () => {
  const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
  const cat = pdfCatalogFor('ar');
  assert.equal(cat.currencyLabel, 'العملة: MAD');

  const { buf } = await generatePdf(baseBody('ar'));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);

  const shapedWord = new jsPDF().processArabic('العملة');
  const expected = `MAD :${shapedWord}`;
  assert.ok(text.includes(expected), `expected "${expected}" in page 1 text: ${text}`);
});

test('ar: cuttingList.columnDimension("cm") ("الأبعاد (cm)") -- parenthesized unit renders without corruption', async () => {
  const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
  const cat = pdfCatalogFor('ar');
  assert.equal(cat.cuttingList.columnDimension('cm'), 'الأبعاد (cm)');

  const { buf } = await generatePdf(baseBody('ar'));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);

  const shapedWord = new jsPDF().processArabic('الأبعاد');
  // isSymmetricSwapping mirrors the paired parentheses for their RTL
  // context (see pdf-fonts.ts's arabicBidiOptions doc comment) -- the pair
  // swaps position (")cm(" rather than "(cm)") in the extracted text,
  // which is what a correctly mirrored, then bidi-reconstructed, pair
  // looks like; the actual on-page glyphs render as normal-looking "(cm)"
  // (see the visual-rendering ink tests below, and the empirical PNG check
  // this was verified against during development).
  const expected = `)cm( ${shapedWord}`;
  assert.ok(text.includes(expected), `expected "${expected}" in page 1 text: ${text}`);
});

test('ar: recap.financialHeader ("التكلفة المالية (MAD)") -- multi-word Arabic + parenthesized MAD renders without corruption', async () => {
  const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
  const cat = pdfCatalogFor('ar');
  assert.equal(cat.recap.financialHeader, 'التكلفة المالية (MAD)');

  const { buf } = await generatePdf(baseBody('ar'));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);

  const shapedFirstWord = new jsPDF().processArabic('التكلفة');
  const shapedSecondWord = new jsPDF().processArabic('المالية');
  const expected = `)MAD( ${shapedFirstWord} ${shapedSecondWord}`;
  assert.ok(text.includes(expected), `expected "${expected}" in page 1 text: ${text}`);
});

// ─── willDrawCell suppression: an Arabic autoTable cell must be drawn once,
// not twice ──────────────────────────────────────────────────────────────
//
// arabicSafeCellHooks (pdf-fonts.ts) blanks an Arabic-containing cell's own
// text (`cell.text = []`) in `willDrawCell` *before* autoTable draws it, then
// draws the correctly shaped/bidi-ordered label itself in `didDrawCell`. If
// that suppression ever regressed -- e.g. `willDrawCell` no longer blanking
// `cell.text`, or firing after autoTable's own draw instead of before -- the
// cell's label would be drawn twice: once by autoTable's own (wrongly
// shaped/positioned) draw, once by `didDrawCell`'s corrected one. A plain
// `.includes()` check cannot tell "drawn once" from "drawn twice, with the
// second copy sitting next to the first": counting exact occurrences of the
// shaped label in the extracted text can.
test('ar: selected Arabic autoTable-cell labels occur exactly once in the extracted PDF text -- proving willDrawCell suppresses autoTable\'s own draw', async () => {
  const { pdfCatalogFor } = loadTsModule('src/lib/exports/pdf-catalog.ts');
  const cat = pdfCatalogFor('ar');

  const { buf } = await generatePdf(baseBody('ar'));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);

  const countOccurrences = (haystack, needle) => {
    if (!needle) return 0;
    let count = 0;
    let from = 0;
    let idx;
    while ((idx = haystack.indexOf(needle, from)) !== -1) {
      count += 1;
      from = idx + needle.length;
    }
    return count;
  };

  // Two cell labels, each drawn exactly once by the route and with no
  // substring relationship to any other Arabic string on page 1: a body
  // cell ("Panneaux utilisés" table's single stock-raw row) and a head cell
  // ("Récapitulatif" table's technical-column header).
  for (const label of [cat.panelsUsed.stockRaw, cat.recap.technicalHeader]) {
    const shaped = new jsPDF().processArabic(label);
    const count = countOccurrences(text, shaped);
    assert.equal(
      count,
      1,
      `expected the autoTable-cell label "${label}" to appear exactly once (not autoTable's own draw plus didDrawCell's), got ${count} occurrence(s) in: ${text}`
    );
  }
});

test('ar: the Arabic project name is drawn as a left-to-right-increasing sequence of glyphs (visual order, not logical)', async () => {
  const { res, buf } = await generatePdf(baseBody('ar'));
  assert.equal(res.status, 200);
  const doc = await loadPdf(buf);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();

  // The project name is drawn in bold at y=19mm (see drawQatliaHeader); pick
  // out just the items that make up that one line by y-position, then check
  // their transform's x component is non-decreasing -- i.e. glyphs really do
  // get painted left-to-right across the page, which is the whole point of
  // driving jsPDF's own bidi engine in *visual* output mode (see
  // pdf-fonts.ts's arabicBidiOptions): jsPDF itself only ever draws
  // left-to-right, so a correct visual reorder is what makes RTL prose read
  // right-to-left *visually* despite that.
  const ys = content.items.map((item) => Math.round(item.transform[5]));
  const mostCommonY = ys.sort((a, b) => ys.filter((v) => v === a).length - ys.filter((v) => v === b).length).pop();
  const titleItems = content.items.filter((item) => Math.round(item.transform[5]) === mostCommonY && item.str.trim());
  assert.ok(titleItems.length > 0, 'expected at least one text item on the project-name line');

  const xs = titleItems.map((item) => item.transform[4]);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] >= xs[i - 1] - 0.01, `glyph x-positions must be non-decreasing (left-to-right draw order): ${xs}`);
  }
});

// ─── Material label: the artisan's actual selection reaches the PDF ───────
//
// buildPdfPayload/PdfExportPayload used to nest `material` under `sheet`,
// but ExportSchema (and route.ts) only ever read a *top-level* `material`
// field -- so every export silently fell back to the schema's own default
// ("MDF") regardless of what the artisan had actually selected (see
// pdf-payload.ts's PdfExportPayload doc comment). These tests exercise the
// route directly with a non-default and an Arabic-typed material, matching
// what a real payload built by buildPdfPayload now sends.

test('a non-MDF material label reaches the rendered PDF, uppercased like every other material label', async () => {
  const { buf } = await generatePdf(baseBody('fr', { material: 'melamine' }));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);
  assert.ok(text.includes('MELAMINE'), `expected the non-default material label in page 1 text: ${text}`);
});

test('an artisan-typed Arabic material label reaches the rendered PDF, shaped and without corruption', async () => {
  const arabicMaterial = 'خشب الزان';
  const { buf } = await generatePdf(baseBody('fr', { material: arabicMaterial }));
  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);
  // route.ts draws material.toUpperCase() -- toUpperCase() is a no-op on
  // Arabic script, which has no case distinction.
  const shaped = new jsPDF().processArabic(arabicMaterial);
  assert.ok(text.includes(shaped), `expected the shaped Arabic material label in page 1 text: ${text}`);
});

// ─── Injection safety: untrusted projectName cannot break out of the PDF's own string/content-stream syntax ──

test('a projectName containing raw PDF content-stream syntax is drawn as inert literal text, not injected as operators', async () => {
  // ")" closes a PDF string literal that isn't backslash-escaped, and "re f"
  // is a real fill-rectangle operator pair -- if the route (or jsPDF) ever
  // stopped escaping this correctly, this payload would break out of the Tj
  // string, inject a real drawing operator, and the literal text below would
  // no longer appear in the extracted content (only the harmless preface
  // "INJECT" and suffix "END" would, with the rest reinterpreted as drawing).
  const injected = 'INJECT) 0 0 500 500 re f (END';
  const { res, buf } = await generatePdf(baseBody('fr', { projectName: injected }));
  assert.equal(res.status, 200);

  const doc = await loadPdf(buf);
  assert.ok(doc.numPages >= 1, 'the PDF must still parse into at least one page');
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);
  // route.ts draws projectName.toUpperCase().
  assert.ok(text.includes(injected.toUpperCase()), `expected the full literal payload intact in the page text: ${text}`);
});

test('a projectName containing backslashes and a <script> tag is drawn as inert literal text and the PDF still parses', async () => {
  const injected = 'A\\B<script>alert(1)</script>C';
  const { res, buf } = await generatePdf(baseBody('en', { projectName: injected }));
  assert.equal(res.status, 200);

  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);
  assert.ok(text.includes(injected.toUpperCase()), `expected the full literal payload intact in the page text: ${text}`);
});

test('a projectName combining an RTL override control character with content-stream syntax still parses and cannot inject operators', async () => {
  const injected = '‮X) 0 0 300 300 re f (Y‬';
  const { res, buf } = await generatePdf(baseBody('ar', { projectName: injected }));
  assert.equal(res.status, 200);

  const doc = await loadPdf(buf);
  const { text } = await pageText(doc, 1);
  NO_TOFU(text);
  // stripBidiControls (see pdf-fonts.ts) removes the RLO/PDF control
  // characters before drawing, so the surviving literal text is the payload
  // with those two control characters removed, not vanished entirely along
  // with everything else on the line.
  const withoutControls = injected.replace(/[‮‬]/g, '').toUpperCase();
  assert.ok(text.includes(withoutControls), `expected the control-stripped literal payload intact in the page text: ${text}`);
});

// ─── Visual rendering: real pixels via @napi-rs/canvas, tolerant thresholds ──

test('page 1 renders as a non-blank, portrait A4-proportioned page with real ink in the header and table regions', async () => {
  const { buf } = await generatePdf(baseBody('fr'));
  const doc = await loadPdf(buf);
  const scale = 2;
  const { imageData, width, height } = await renderPage(doc, 1, scale);

  // A4 portrait is 210 x 297mm (an 0.707:1 width:height ratio); tolerate
  // rendering-engine rounding rather than pinning exact pixel counts.
  const ratio = width / height;
  assert.ok(ratio > 0.65 && ratio < 0.75, `expected a portrait A4-ish ratio, got ${ratio} (${width}x${height})`);
  assert.ok(width > 1000 && height > 1400, `expected a full-resolution render at scale ${scale}, got ${width}x${height}`);

  const totalInk = countInk(imageData, width, height, 0, 0, 1, 1);
  const totalPixels = width * height;
  assert.ok(totalInk > totalPixels * 0.003, `expected a non-blank page, only ${totalInk}/${totalPixels} ink pixels`);

  // The QatlIA header band (see drawQatliaHeader: doc.rect(14, 10, pW-28, 15)
  // on a 210x297mm page) -- as a fraction of the full page.
  const headerInk = countInk(imageData, width, height, 14 / 210, 10 / 297, 196 / 210, 25 / 297);
  assert.ok(headerInk > 100, `expected meaningful ink in the header band, got ${headerInk} pixels`);

  // The cutting-list/panels-used table region starts at y=43mm; generous
  // enough to catch both left and right tables' titles, header row and at
  // least one data row for this fixture without pinning exact row heights.
  const tableInk = countInk(imageData, width, height, 14 / 210, 40 / 297, 196 / 210, 90 / 297);
  assert.ok(tableInk > 200, `expected meaningful ink in the table region, got ${tableInk} pixels`);
});
