const test = require('node:test');
const { before } = test;
const assert = require('node:assert/strict');
const { jsPDF } = require('jspdf');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

/**
 * End-to-end artifact tests for /api/export-quotation, mirroring
 * tests/pdf-artifact.test.js's approach: generate a real PDF through the
 * actual route, then independently re-parse (pdfjs-dist) and re-render
 * (@napi-rs/canvas) it, so glyph-level bugs in what jsPDF actually emits
 * have somewhere to surface — not just in the building blocks' own tests.
 */

let pdfjsLib;
let canvas;

before(async () => {
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  canvas = require('@napi-rs/canvas');
  global.DOMMatrix = canvas.DOMMatrix;
  global.Path2D = canvas.Path2D;
  global.ImageData = canvas.ImageData;
});

const UUID = '11111111-2222-4333-8444-555555555555';

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: UUID, email: 'artisan@example.ma' } }, error: null }) },
  }),
});
// No projectId is exercised in this file, so the admin client is never
// actually queried — stubbed only so module loading never touches the network.
stubModule('@supabase/supabase-js', { createClient: () => ({ from: () => ({}) }) });

function costingInput() {
  return {
    material: { sheets: [{ areaM2: 5.78, quantity: 1, pricing: { mode: 'per_sheet', value: 350 } }], basis: 'estimated' },
    edge: { segments: [{ lengthM: 5, pricePerMeter: 3 }], basis: 'estimated' },
    labor: { pricing: { mode: 'fixed', value: 50 } },
  };
}

function baseBody(locale, overrides = {}) {
  return {
    costingInput: costingInput(),
    tax: { mode: 'percentage', ratePercent: 20 },
    discount: { mode: 'fixed', value: 30 },
    deliveryCost: 25,
    company: { name: 'Atelier Karim', address: 'Casablanca', ice: '001234567000089' },
    client: { name: locale === 'ar' ? 'الزبون الكريم' : 'Client Karim' },
    quoteNumber: 'DEV-20260831-007',
    issueDate: '2026-08-31',
    expiryDate: '2026-09-30',
    locale,
    includeAmountInWords: true,
    notes: locale === 'ar' ? 'شكرا لثقتكم' : 'Merci de votre confiance',
    ...overrides,
  };
}

async function generatePdf(body) {
  const { POST } = loadTsModule('src/app/api/export-quotation/route.ts');
  const req = new Request('https://qatlia.example/api/export-quotation', {
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
  return content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
}

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

function countInk(imageData, width, height) {
  const { data } = imageData;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) ink++;
  }
  return ink;
}

const NO_TOFU = (text) => assert.doesNotMatch(text, /�/, 'extracted text must contain no replacement-character tofu');

// ─── FR: real, parseable, correctly totaled ───────────────────────────────

test('fr: generates a real, parseable one-page PDF with exact server-recomputed totals', async () => {
  const { computeQuotationDocumentTotals } = loadTsModule('src/lib/quotation.ts');
  const { quotationCatalogFor } = loadTsModule('src/lib/exports/quotation-catalog.ts');
  const cat = quotationCatalogFor('fr');

  const body = baseBody('fr');
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);
  assert.ok(buf.length > 3000, `expected a real PDF, got ${buf.length} bytes`);

  const doc = await loadPdf(buf);
  assert.equal(doc.numPages, 1);
  const text = await pageText(doc, 1);
  NO_TOFU(text);

  assert.ok(text.includes(cat.documentTitle));
  assert.ok(text.includes(body.quoteNumber));
  assert.ok(text.includes('Atelier Karim'));
  assert.ok(text.includes('Client Karim'));

  const totals = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, body.deliveryCost);
  const totalLabel = totals.total.toFixed(2).replace('.', ',');
  assert.match(text, new RegExp(`${totalLabel.replace('.', '\\.')} MAD`), `expected the exact recomputed total (${totalLabel} MAD) in extracted text: ${text}`);
});

test('fr: amount-in-words appears and matches amountInWordsFr(total)', async () => {
  const { computeQuotationDocumentTotals, amountInWordsFr } = loadTsModule('src/lib/quotation.ts');
  const body = baseBody('fr');
  const { buf } = await generatePdf(body);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);

  const totals = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, body.deliveryCost);
  const words = amountInWordsFr(totals.total);
  // jsPDF's splitTextToSize may re-wrap onto multiple lines, each collapsed
  // with single spaces by the text-content join above, so the exact phrase
  // (itself single-spaced) must still appear as a contiguous run.
  assert.ok(text.includes(words), `expected "${words}" in extracted text: ${text}`);
});

// ─── AR: shaped, connected Arabic, correct totals, no tofu ────────────────

test('ar: generates a real PDF with shaped, non-corrupted Arabic company/client/notes and Amiri embedded', async () => {
  const body = baseBody('ar');
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);

  // The Amiri font is embedded as a TrueType program inside the PDF only
  // when Arabic content actually needs it (see payloadNeedsArabicFont) — its
  // presence in the raw bytes is a cheap, direct proxy for "the font was
  // really embedded", independent of glyph-level extraction below.
  const raw = buf.toString('latin1');
  assert.ok(raw.includes('Amiri'), 'expected the Amiri font name to appear in the embedded font program');

  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);

  const shapedClient = new jsPDF().processArabic(body.client.name);
  assert.ok(text.includes(shapedClient), `expected the shaped Arabic client name in: ${text}`);
  assert.notEqual(shapedClient, body.client.name, 'sanity: shaping must actually change Arabic text into presentation forms');

  const shapedNotes = new jsPDF().processArabic(body.notes);
  assert.ok(text.includes(shapedNotes), `expected the shaped Arabic notes in: ${text}`);
});

test('ar: exact server-recomputed total renders in the Arabic PDF too (figures stay LTR/Western-digit)', async () => {
  const { computeQuotationDocumentTotals } = loadTsModule('src/lib/quotation.ts');
  const body = baseBody('ar');
  const { buf } = await generatePdf(body);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);

  const totals = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, body.deliveryCost);
  const totalLabel = totals.total.toFixed(2).replace('.', ',');
  assert.match(text, new RegExp(`${totalLabel.replace('.', '\\.')} MAD`), `expected the exact recomputed total in: ${text}`);
});

test('ar: amount-in-words uses Western digits and connected Arabic script, matching amountInWordsAr(total)', async () => {
  const { computeQuotationDocumentTotals, amountInWordsAr } = loadTsModule('src/lib/quotation.ts');
  const body = baseBody('ar');
  const { buf } = await generatePdf(body);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);

  const totals = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, body.deliveryCost);
  const words = amountInWordsAr(totals.total);
  assert.doesNotMatch(words, /[٠-٩]/, 'sanity: amountInWordsAr itself never emits Arabic-Indic digits');

  const shapedFirstWord = new jsPDF().processArabic(words.split(' ')[0]);
  assert.ok(text.includes(shapedFirstWord), `expected the shaped first word of the amount-in-words phrase in: ${text}`);
});

// ─── Panels/pieces detail table (Task 8 remediation — item 1) ─────────────

function panelLine(overrides = {}) {
  return { ref: 'P1', material: 'MDF', widthCm: 280, heightCm: 207, quantity: 3, ...overrides };
}
function pieceLine(overrides = {}) {
  return { pieceNumber: 1, name: 'Panneau latéral', widthCm: 120, heightCm: 60, quantity: 4, ...overrides };
}

test('fr: renders panel ref/material/dimensions/qty and piece number/name/dimensions/qty when provided', async () => {
  const body = baseBody('fr', {
    panels: [panelLine()],
    pieces: [pieceLine({ edgeBandedSides: ['top', 'left'], edgeLengthM: 2.4 })],
  });
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);
  assert.ok(text.includes('P1'));
  assert.ok(text.includes('MDF'));
  assert.ok(text.includes('280'));
  assert.ok(text.includes('207'));
  assert.ok(text.includes('Panneau lat'), `expected the piece name in: ${text}`);
  assert.ok(text.includes('120'));
  assert.ok(text.includes('2.4') || text.includes('2,4'), `expected the edge length in: ${text}`);
});

// ─── Unnamed-piece sentinel substitution (Task 8 remediation — item 1
// follow-up): a piece line carrying `UNNAMED_PIECE_NAME_PLACEHOLDER` (see
// src/lib/quotation-items.ts) must never print that internal sentinel
// verbatim — the route substitutes the locale-appropriate, numbered
// `unnamedPieceLabel` once the document's actual output locale is known. ──

for (const locale of ['fr', 'ar']) {
  test(`${locale}: an unnamed-piece sentinel is replaced with the localized, numbered unnamedPieceLabel — never printed verbatim`, async () => {
    const { UNNAMED_PIECE_NAME_PLACEHOLDER } = loadTsModule('src/lib/quotation-items.ts');
    const { quotationCatalogFor } = loadTsModule('src/lib/exports/quotation-catalog.ts');
    const cat = quotationCatalogFor(locale);
    const body = baseBody(locale, { pieces: [pieceLine({ pieceNumber: 7, name: UNNAMED_PIECE_NAME_PLACEHOLDER })] });
    const { res, buf } = await generatePdf(body);
    assert.equal(res.status, 200);
    const doc = await loadPdf(buf);
    const text = await pageText(doc, 1);
    NO_TOFU(text);
    assert.ok(!text.includes('UNNAMED_PIECE'), `the internal sentinel must never be printed verbatim: ${text}`);

    const expectedLabel = cat.unnamedPieceLabel(7);
    if (locale === 'ar') {
      const shapedLabel = new jsPDF().processArabic(expectedLabel);
      assert.ok(text.includes(shapedLabel), `expected the shaped localized unnamed-piece label in: ${text}`);
    } else {
      assert.ok(text.includes(expectedLabel), `expected "${expectedLabel}" in: ${text}`);
    }
  });
}

test('fr: omits the panels/pieces sections gracefully when none are provided (no fabricated rows)', async () => {
  const { quotationCatalogFor } = loadTsModule('src/lib/exports/quotation-catalog.ts');
  const cat = quotationCatalogFor('fr');
  const { buf } = await generatePdf(baseBody('fr'));
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  assert.ok(!text.includes(cat.panelsTitle));
  assert.ok(!text.includes(cat.piecesTitle));
});

// A known internal material key (see quotation-catalog.ts's
// `localizeQuotationMaterial`) is localized in the panels detail table,
// matching the document's own output locale — the optimizer's raw payload
// value never leaks untranslated when it's one of the app's own known
// materials. An artisan's own free-typed material name (not a known key)
// stays exactly as typed.
test('ar: a known material key localizes in the panels table; a free-typed material name is left untouched', async () => {
  const body = baseBody('ar', {
    panels: [panelLine({ ref: 'P1', material: 'mdf' }), panelLine({ ref: 'P2', material: 'Chêne huilé main' })],
  });
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);
  // The label is a mixed Latin/Arabic string ("MDF / خشب"), whose visual
  // (bidi-reordered) extraction order differs from its logical order — as
  // with the amount-in-words test above, only the shaped Arabic word itself
  // is compared, not the full mixed-order string.
  const shapedArabicWord = new jsPDF().processArabic('خشب');
  assert.ok(text.includes(shapedArabicWord), `expected the localized Arabic material label in: ${text}`);
  assert.ok(text.includes('MDF'), `expected the Latin half of the localized material label in: ${text}`);
  assert.ok(text.includes('huil'), `expected the free-typed (untranslated) material name to survive verbatim in: ${text}`);
});

// ─── Pagination (item 2) + Arabic layout/wrap (item 3): a genuinely large
// document — 4000-char notes and many max-bound pieces/panels — must
// paginate correctly, repeat the header/footer/page number on every page,
// and never draw content below the reserved footer band. ──────────────────

const { QUOTATION_PDF_LAYOUT } = loadTsModule('src/lib/exports/quotation-pdf-layout.ts');
const PT_PER_MM = 72 / 25.4;

function bigNotes() {
  const filler = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(65);
  const notes = `NOTES_START_MARKER ${filler}`;
  const padded = notes.slice(0, 3960);
  return `${padded} NOTES_END_MARKER`.slice(0, 4000);
}

function manyPanels() {
  const { MAX_QUOTATION_PANELS } = loadTsModule('src/lib/quotation.ts');
  return Array.from({ length: MAX_QUOTATION_PANELS }, (_, i) =>
    panelLine({ ref: `P${i + 1}`, material: i === 0 ? 'MARKERMATFIRST' : i === MAX_QUOTATION_PANELS - 1 ? 'MARKERMATLAST' : `M${i}`, widthCm: 100 + i })
  );
}

function manyPieces() {
  const { MAX_QUOTATION_PIECES } = loadTsModule('src/lib/quotation.ts');
  return Array.from({ length: MAX_QUOTATION_PIECES }, (_, i) =>
    pieceLine({
      pieceNumber: i + 1,
      name: i === 0 ? 'MarkerPieceFirst' : i === MAX_QUOTATION_PIECES - 1 ? 'MarkerPieceLast' : `Piece ${i}`,
      widthCm: 10 + (i % 500),
      heightCm: 10 + (i % 300),
    })
  );
}

for (const locale of ['fr', 'ar']) {
  test(`${locale}: a large document (4000-char notes + max panels/pieces) paginates across multiple pages`, async () => {
    const { quotationCatalogFor } = loadTsModule('src/lib/exports/quotation-catalog.ts');
    const cat = quotationCatalogFor(locale);
    const body = baseBody(locale, { notes: bigNotes(), panels: manyPanels(), pieces: manyPieces(), includeAmountInWords: true });
    const { res, buf } = await generatePdf(body);
    assert.equal(res.status, 200);

    const doc = await loadPdf(buf);
    assert.ok(doc.numPages > 1, `expected a multi-page document, got ${doc.numPages} page(s)`);

    let allText = '';
    for (let p = 1; p <= doc.numPages; p += 1) {
      allText += ` ${await pageText(doc, p)}`;
    }
    NO_TOFU(allText);

    // All marker lines survive pagination — nothing silently dropped/truncated.
    assert.ok(allText.includes('NOTES_START_MARKER'), 'expected the start of the notes to survive');
    assert.ok(allText.includes('NOTES_END_MARKER'), 'expected the tail of the (4000-char) notes to survive pagination, not be truncated');
    assert.ok(allText.includes('MARKERMATFIRST'), 'expected the first panel row to survive');
    assert.ok(allText.includes('MARKERMATLAST'), 'expected the last panel row to survive pagination');
    assert.ok(allText.includes('MarkerPieceFirst'), 'expected the first piece row to survive');
    assert.ok(allText.includes('MarkerPieceLast'), 'expected the last piece row to survive pagination');

    // Header/footer/page number repeat on every page. A full Arabic-script
    // sentence extracts in *visual* (bidi-reordered, word order included)
    // order, not logical reading order (see pdf-fonts.ts's `arabicBidiOptions`
    // doc comment) — so instead of matching the whole footer sentence, this
    // checks for "QatlIA" (kept untranslated/Latin in both catalogs, see
    // quotation-catalog.ts) as a reliable, shaping-agnostic footer marker,
    // and the page/total figures (Western digits, never reshaped) for the
    // page indicator.
    for (let p = 1; p <= doc.numPages; p += 1) {
      const pText = await pageText(doc, p);
      assert.ok(pText.includes(`${p} / ${doc.numPages}`), `expected the page indicator "${p} / ${doc.numPages}" on page ${p}: ${pText.slice(-200)}`);
      assert.ok(pText.includes('QatlIA'), `expected the footer note (marked by "QatlIA") on page ${p}`);
    }
  });

  test(`${locale}: every page of the large document renders as non-blank real ink`, async () => {
    const body = baseBody(locale, { notes: bigNotes(), panels: manyPanels(), pieces: manyPieces() });
    const { buf } = await generatePdf(body);
    const doc = await loadPdf(buf);
    for (let p = 1; p <= doc.numPages; p += 1) {
      const { imageData, width, height } = await renderPage(doc, p, 1.5);
      const ink = countInk(imageData, width, height);
      assert.ok(ink > width * height * 0.001, `page ${p} looks blank: only ${ink} ink pixels of ${width * height}`);
    }
  });

  test(`${locale}: no content is ever drawn below the reserved footer band, on any page`, async () => {
    const body = baseBody(locale, { notes: bigNotes(), panels: manyPanels(), pieces: manyPieces(), includeAmountInWords: true });
    const { buf } = await generatePdf(body);
    const doc = await loadPdf(buf);

    const pageHeightPt = QUOTATION_PDF_LAYOUT.pageHeightMm * PT_PER_MM;
    const footerBottomOriginY = pageHeightPt - QUOTATION_PDF_LAYOUT.footerYMm * PT_PER_MM;
    const TOLERANCE_PT = 12; // font ascent/descent slack around the footer baseline

    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const ys = content.items.map((item) => item.transform[5]);
      assert.ok(ys.length > 0, `page ${p} has no text at all`);
      const minY = Math.min(...ys);
      assert.ok(
        minY >= footerBottomOriginY - TOLERANCE_PT,
        `page ${p}: found content at y=${minY}pt, below the reserved footer band (expected >= ${footerBottomOriginY - TOLERANCE_PT}pt)`
      );
    }
  });
}

// ─── Repeated Arabic header cells across pages (pdf-fonts.ts's
// arabicSafeCellHooks): autoTable redraws a header row's *same* Cell
// instance on every continuation page rather than creating a fresh one, so
// each Arabic column header must draw exactly once per page — not zero
// times (a cell.text left blanked after page 1) and not duplicated. ───────

test('ar: the pieces table\'s Arabic column headers each appear exactly once on every page of a paginated document', async () => {
  const body = baseBody('ar', { pieces: manyPieces() });
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);

  const doc = await loadPdf(buf);
  assert.ok(doc.numPages > 1, `expected a multi-page document to actually exercise the repeated header, got ${doc.numPages} page(s)`);

  const { quotationCatalogFor } = loadTsModule('src/lib/exports/quotation-catalog.ts');
  const cat = quotationCatalogFor('ar');
  // No panels are included in this document, so piecesColumnDimension and
  // piecesColumnQuantity (shared verbatim with the panels table's own
  // headers) can't be conflated with a panels-table draw.
  //
  // Number/name/quantity headers carry no parentheses, so their rendered
  // glyph string equals `processArabic(header)` exactly (verified against a
  // real generated PDF) — exact item-string equality sidesteps the one
  // remaining collision risk: piecesColumnNumber ("رقم") is also a shaped
  // substring of quoteNumberLabel ("رقم العرض"), which is drawn once on
  // page 1 as part of a longer, different string, never as its own
  // standalone text item.
  //
  // The dimension header ("الأبعاد (سم)") does carry parentheses, which
  // `arabicBidiOptions`'s `isSymmetricSwapping` mirrors during the real
  // draw (see its own doc comment in pdf-fonts.ts) — `processArabic` alone
  // (used elsewhere only for *measurement*, never drawn) does not apply
  // that swap, so it does not equal the actually-rendered glyph string. The
  // header's first word alone ("الأبعاد", no parens) shapes identically
  // either way, so that's matched as a substring instead.
  const exactHeaders = [cat.piecesColumnNumber, cat.piecesColumnName, cat.piecesColumnQuantity];
  const shapedExactHeaders = exactHeaders.map((h) => new jsPDF().processArabic(h));
  const shapedDimensionWord = new jsPDF().processArabic('الأبعاد');

  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const [i, shaped] of shapedExactHeaders.entries()) {
      const matches = content.items.filter((item) => item.str === shaped);
      assert.equal(
        matches.length,
        1,
        `expected column header "${exactHeaders[i]}" (shaped: "${shaped}") to appear exactly once on page ${p}, found ${matches.length}`
      );
    }
    const dimensionMatches = content.items.filter((item) => item.str.includes(shapedDimensionWord));
    assert.equal(
      dimensionMatches.length,
      1,
      `expected the dimension column header ("${cat.piecesColumnDimension}") to appear exactly once on page ${p}, found ${dimensionMatches.length}`
    );
  }
});

// ─── Continuation-page separator position (Task 8 remediation — item 3) ───

test('QUOTATION_PDF_LAYOUT.continuationSeparatorYMm is 23mm', () => {
  assert.equal(QUOTATION_PDF_LAYOUT.continuationSeparatorYMm, 23);
});

test('a continuation page draws its repeated-header separator rule at exactly 23mm from the top', async () => {
  const body = baseBody('fr', { notes: bigNotes(), panels: manyPanels(), pieces: manyPieces() });
  const { buf } = await generatePdf(body);
  const doc = await loadPdf(buf);
  assert.ok(doc.numPages > 1, 'expected a multi-page document to actually have a continuation page');

  const scale = 4; // fine enough to isolate a thin (0.2mm) horizontal rule
  const { imageData, width, height } = await renderPage(doc, 2, scale);
  const mmToPx = (mm) => Math.round((mm / QUOTATION_PDF_LAYOUT.pageHeightMm) * height);
  const targetY = mmToPx(QUOTATION_PDF_LAYOUT.continuationSeparatorYMm);

  function rowInkCount(y) {
    const { data } = imageData;
    let ink = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 0 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) ink += 1;
    }
    return ink;
  }

  // The separator spans margin-to-margin (182mm of a 210mm page, ~87%) — a
  // near-full-width row of ink within a couple of pixels of the exact
  // mm->px rounding is a reliable, rendering-based proxy for "the rule is
  // really drawn here", independent of jsPDF's own internal y bookkeeping.
  let found = false;
  for (let dy = -2; dy <= 2 && !found; dy += 1) {
    if (rowInkCount(targetY + dy) > width * 0.3) found = true;
  }
  assert.ok(found, `expected a near-full-width horizontal rule around y=${targetY}px (23mm of ${height}px-tall page)`);
});

// ─── Arabic layout: split via shaped/Amiri metrics, dimensions stay LTR ────

test('ar: long Arabic notes wrap onto multiple lines using shaped (Amiri) metrics, not Helvetica, and dimensions stay Western-digit LTR', async () => {
  const longArabicNotes = 'شكرا لثقتكم بنا ونتطلع إلى تعاون طويل الأمد معكم في جميع مشاريعكم المستقبلية بإذن الله. '.repeat(15).slice(0, 3990);
  const body = baseBody('ar', { notes: longArabicNotes, panels: [panelLine()], pieces: [pieceLine()] });
  const { buf } = await generatePdf(body);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);
  // The panel dimension figures must render as plain Western digits, never
  // reshaped/reordered like the surrounding Arabic script.
  assert.match(text, /280/);
  assert.match(text, /207/);
});

// ─── Arabic-script content in an fr-locale document (Task 8 remediation —
// re-review, item 5): the font gate is content-based, not locale-based, so
// a document whose *locale* is fr but whose free-typed quote number or a
// piece name happens to be Arabic still needs the embedded Amiri font — a
// gate keyed only on locale + company/client name+address would leave these
// fields drawn in Helvetica (no Arabic glyphs at all) and render as tofu. ──

test('fr: a piece name and quote number written in Arabic script still shape correctly via the embedded Amiri font, even though the document locale is fr', async () => {
  const arabicQuoteNumber = 'مرجع العرض التجريبي';
  const arabicPieceName = 'قطعة جانبية';
  const body = baseBody('fr', {
    quoteNumber: arabicQuoteNumber,
    panels: [panelLine()],
    pieces: [pieceLine({ name: arabicPieceName })],
  });
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);

  const raw = buf.toString('latin1');
  assert.ok(raw.includes('Amiri'), 'expected the Amiri font to be embedded for an fr-locale document carrying Arabic-script free text');

  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);

  const shapedPieceName = new jsPDF().processArabic(arabicPieceName);
  assert.ok(text.includes(shapedPieceName), `expected the shaped Arabic piece name in: ${text}`);
  assert.notEqual(shapedPieceName, arabicPieceName, 'sanity: shaping must actually change Arabic text into presentation forms');

  const shapedQuoteNumber = new jsPDF().processArabic(arabicQuoteNumber);
  assert.ok(text.includes(shapedQuoteNumber), `expected the shaped Arabic quote number in: ${text}`);
});

// ─── Identity-block wrapping (Task 8 remediation — re-review, item 5): a
// long company/client field wraps content-aware within its own column
// instead of drawing as one unbroken line that runs into the other column,
// and every continuation line is drawn strictly below the one before it. ──

test('fr: a long company address wraps onto multiple lines within its own column instead of one unbroken line', async () => {
  const filler = 'Zone Industrielle Sidi Bernoussi Lotissement '.repeat(6);
  const longAddress = `ADDR_START ${filler} ADDR_END`.trim();
  const body = baseBody('fr', { company: { name: 'Atelier Karim', address: longAddress, ice: '001234567000089' } });
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);

  const doc = await loadPdf(buf);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();

  const startItems = content.items.filter((item) => item.str.includes('ADDR_START'));
  const endItems = content.items.filter((item) => item.str.includes('ADDR_END'));
  assert.ok(startItems.length > 0, 'expected the start of the long address to appear');
  assert.ok(endItems.length > 0, 'expected the end of the long address to appear (not truncated)');

  // Wrapped onto more than one line: the end of the address sits strictly
  // below (smaller PDF-space y, since y grows upward) the start of it —
  // never on the same line, and never overlapping the next field/section.
  const startY = startItems[0].transform[5];
  const endY = endItems[0].transform[5];
  assert.ok(endY < startY, `expected the wrapped continuation line below the first line (start y=${startY}, end y=${endY})`);

  // Every extracted item for this address stays within the company column —
  // it never reaches the client column's own x-anchor (110mm), which would
  // signal a visual collision between the two identity blocks.
  const PT_PER_MM = 72 / 25.4;
  const clientColumnXPt = 110 * PT_PER_MM;
  for (const item of [...startItems, ...endItems]) {
    assert.ok(item.transform[4] < clientColumnXPt, `expected address text to stay left of the client column (x=${item.transform[4]}pt, limit=${clientColumnXPt}pt)`);
  }
});

// ─── Long Arabic cell wrapping (pdf-fonts.ts's generalized
// arabicSafeCellHooks/drawShapedCellText): a piece name long enough to wrap
// within the pieces table's own "name" column must render every wrapped
// logical line — not just the first, and not the whole raw string collapsed
// onto one line/position. ───────────────────────────────────────────────

/**
 * Builds an Arabic piece name at exactly the schema's 120-character cap
 * (`QuotationPieceSchema.name`), long enough to force jspdf-autotable to
 * wrap it within the pieces table's "name" column — verified empirically
 * against the real route. Distinct start/end markers let the test confirm
 * both survive (nothing truncated/dropped) and land on different lines.
 */
function longWrappingArabicPieceName() {
  const filler = 'قطعة خشبية طويلة جدا مخصصة للمطبخ ';
  const marker1 = 'بداية_القطعة ';
  const marker2 = 'نهاية_القطعة';
  const budget = 120 - marker1.length - marker2.length;
  return marker1 + filler.repeat(10).slice(0, budget) + marker2;
}

test('ar: a long Arabic piece name wraps onto multiple lines within the pieces table cell, every wrapped line rendered at a distinct, descending y', async () => {
  const longName = longWrappingArabicPieceName();
  const body = baseBody('ar', { pieces: [pieceLine({ pieceNumber: 1, name: longName })] });
  const { res, buf } = await generatePdf(body);
  assert.equal(res.status, 200);

  const doc = await loadPdf(buf);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str).join(' ');
  NO_TOFU(text);

  const shapedStart = new jsPDF().processArabic('بداية_القطعة');
  const shapedEnd = new jsPDF().processArabic('نهاية_القطعة');
  const startItems = content.items.filter((item) => item.str.includes(shapedStart));
  const endItems = content.items.filter((item) => item.str.includes(shapedEnd));
  assert.ok(startItems.length > 0, `expected the start marker in: ${text}`);
  assert.ok(endItems.length > 0, `expected the end marker to survive wrapping (not truncated) in: ${text}`);

  // The end marker must land strictly below the start marker (PDF y grows
  // upward) — proof this is two distinct wrapped lines, not the whole raw
  // string collapsed onto a single draw position.
  const startY = startItems[0].transform[5];
  const endY = endItems[0].transform[5];
  assert.ok(endY < startY, `expected the wrapped continuation line below the first (start y=${startY}, end y=${endY})`);

  // The two lines must be spaced by roughly one line height, not overlapping
  // and not spuriously far apart (e.g. accidentally landing on a new page).
  const delta = startY - endY;
  assert.ok(delta > 1 && delta < 20, `expected a plausible single-line-height gap between wrapped lines, got ${delta}pt`);
});

test('ar: a long Arabic piece name that wraps still reports the correct aggregated quantity/dimensions alongside it (row height grew to fit every line)', async () => {
  const longName = longWrappingArabicPieceName();
  const body = baseBody('ar', { pieces: [pieceLine({ pieceNumber: 1, name: longName, quantity: 6, widthCm: 77, heightCm: 33 })] });
  const { buf } = await generatePdf(body);
  const doc = await loadPdf(buf);
  const text = await pageText(doc, 1);
  NO_TOFU(text);
  assert.ok(text.includes('77'));
  assert.ok(text.includes('33'));
  assert.ok(text.includes('6'), `expected the piece quantity in: ${text}`);
});

// ─── Visual rendering: real pixels, not just extracted text ───────────────

for (const locale of ['fr', 'ar']) {
  test(`${locale}: page renders as a non-blank portrait A4-ish page with real ink`, async () => {
    const { buf } = await generatePdf(baseBody(locale));
    const doc = await loadPdf(buf);
    const scale = 2;
    const { imageData, width, height } = await renderPage(doc, 1, scale);

    const ratio = width / height;
    assert.ok(ratio > 0.65 && ratio < 0.75, `expected a portrait A4-ish ratio, got ${ratio} (${width}x${height})`);

    const ink = countInk(imageData, width, height);
    assert.ok(ink > width * height * 0.002, `expected a non-blank page, only ${ink} ink pixels of ${width * height}`);
  });
}
