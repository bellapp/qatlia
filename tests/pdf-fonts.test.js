const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadTsModule } = require('./helpers/load-ts-module');
const { jsPDF } = require('jspdf');

function load() {
  return loadTsModule('src/lib/exports/pdf-fonts.ts');
}

// ─── Font asset provenance & checksum (assets/fonts/amiri/SOURCE.md's promise) ──

test('the checksum constants exported by pdf-fonts.ts match the actual bytes of assets/fonts/amiri/*.ttf', () => {
  const { AMIRI_REGULAR_SHA256, AMIRI_BOLD_SHA256 } = load();
  const regularBytes = fs.readFileSync(path.resolve('assets/fonts/amiri/Amiri-Regular.ttf'));
  const boldBytes = fs.readFileSync(path.resolve('assets/fonts/amiri/Amiri-Bold.ttf'));

  assert.equal(crypto.createHash('sha256').update(regularBytes).digest('hex'), AMIRI_REGULAR_SHA256);
  assert.equal(crypto.createHash('sha256').update(boldBytes).digest('hex'), AMIRI_BOLD_SHA256);
});

test('the bundled base64 font modules decode to bytes matching the same checksums (no drift between assets/ and the generated bundle)', () => {
  const { AMIRI_REGULAR_SHA256, AMIRI_BOLD_SHA256 } = load();
  const { AMIRI_REGULAR_BASE64 } = loadTsModule('src/lib/exports/fonts/amiri-regular-base64.ts');
  const { AMIRI_BOLD_BASE64 } = loadTsModule('src/lib/exports/fonts/amiri-bold-base64.ts');

  const regularBytes = Buffer.from(AMIRI_REGULAR_BASE64, 'base64');
  const boldBytes = Buffer.from(AMIRI_BOLD_BASE64, 'base64');

  assert.equal(crypto.createHash('sha256').update(regularBytes).digest('hex'), AMIRI_REGULAR_SHA256);
  assert.equal(crypto.createHash('sha256').update(boldBytes).digest('hex'), AMIRI_BOLD_SHA256);
});

test('assets/fonts/amiri/SOURCE.md documents the same two checksums pdf-fonts.ts exports', () => {
  const { AMIRI_REGULAR_SHA256, AMIRI_BOLD_SHA256 } = load();
  const source = fs.readFileSync(path.resolve('assets/fonts/amiri/SOURCE.md'), 'utf8');
  assert.match(source, new RegExp(AMIRI_REGULAR_SHA256));
  assert.match(source, new RegExp(AMIRI_BOLD_SHA256));
});

test('assets/fonts/amiri/SOURCE.md never claims the .ttf files are read from disk at request time', () => {
  // The actual runtime mechanism is a base64-inlined, dynamically-imported JS
  // module (see registerAmiriFont/payloadNeedsArabicFont in pdf-fonts.ts) --
  // an earlier version of this doc claimed a disk read at request time,
  // which was never true and would be actively misleading about the
  // Vercel-safety this design is for.
  const source = fs.readFileSync(path.resolve('assets/fonts/amiri/SOURCE.md'), 'utf8');
  assert.doesNotMatch(
    source,
    /read from disk at request time/i,
    'must not claim the .ttf files are read from disk at request time -- they never are'
  );
  assert.match(source, /never\s+(?:be\s+)?read\s+from\s+disk.*request time|request time.*never.*read from disk/is);
});

test('assets/fonts/amiri/SOURCE.md documents the fonts:build regeneration command and its native test-only devDependencies', () => {
  const source = fs.readFileSync(path.resolve('assets/fonts/amiri/SOURCE.md'), 'utf8');
  assert.match(source, /npm run fonts:build/, 'must document the regeneration command');
  assert.match(source, /pdfjs-dist/);
  assert.match(source, /@napi-rs\/canvas/);
});

// ─── Font registration: bundling-safe, lazy, fail-safe, no fs/network at request time ──

test('pdf-fonts.ts never reads the filesystem or the network at module load or registration time', () => {
  const source = fs.readFileSync(path.resolve('src/lib/exports/pdf-fonts.ts'), 'utf8');
  // Strip comments first: the module's own doc comments *talk about* why it
  // avoids process.cwd()/fs reads, which would otherwise false-positive.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /readFileSync|readFile\(|process\.cwd\(\)|require\(['"]fs['"]\)|fetch\(/);
});

test('pdf-fonts.ts imports the base64 font modules lazily (dynamic import), not statically at module load', () => {
  const source = fs.readFileSync(path.resolve('src/lib/exports/pdf-fonts.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(
    code,
    /^import .*amiri-(regular|bold)-base64/m,
    'a static top-level import would bundle/decode the font for every request, including pure-Latin ones'
  );
  assert.match(code, /import\(['"]\.\/fonts\/amiri-regular-base64['"]\)/, 'expected a dynamic import() of the regular weight');
  assert.match(code, /import\(['"]\.\/fonts\/amiri-bold-base64['"]\)/, 'expected a dynamic import() of the bold weight');
});

test('registerAmiriFont registers both weights on a real jsPDF document without throwing', async () => {
  const { registerAmiriFont, AMIRI_FONT_FAMILY } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);

  assert.equal(registration.ok, true);
  const fontList = doc.getFontList();
  assert.ok(fontList[AMIRI_FONT_FAMILY], 'Amiri must appear in the document\'s registered font list');
  assert.ok(fontList[AMIRI_FONT_FAMILY].includes('normal'));
  assert.ok(fontList[AMIRI_FONT_FAMILY].includes('bold'));
});

test('registerAmiriFont degrades safely (returns ok:false, does not throw or leak a path) if VFS registration fails', async () => {
  const { registerAmiriFont } = load();
  const brokenDoc = {
    addFileToVFS() {
      throw new Error('simulated VFS failure');
    },
    addFont() {},
  };
  let logged = '';
  const originalError = console.error;
  console.error = (...args) => {
    logged += args.join(' ');
  };
  try {
    const registration = await registerAmiriFont(brokenDoc);
    assert.equal(registration.ok, false);
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(logged, /\/home\/|\/assets\/|\.ttf/, 'failure log must never leak a filesystem path');
});

test('NOT_REGISTERED is a stable ok:false sentinel for payloads that never needed the font', () => {
  const { NOT_REGISTERED } = load();
  assert.equal(NOT_REGISTERED.ok, false);
});

// ─── payloadNeedsArabicFont: content-gated, not just locale-gated ──────────

test('payloadNeedsArabicFont is true for locale "ar" regardless of the free-text fields', () => {
  const { payloadNeedsArabicFont } = load();
  assert.equal(payloadNeedsArabicFont('ar', 'Cuisine Moderne', 'mdf'), true);
});

test('payloadNeedsArabicFont is false for fr/en with purely Latin free-text fields', () => {
  const { payloadNeedsArabicFont } = load();
  assert.equal(payloadNeedsArabicFont('fr', 'Cuisine Moderne', 'mdf'), false);
  assert.equal(payloadNeedsArabicFont('en', 'Modern Kitchen', 'mdf'), false);
});

test('payloadNeedsArabicFont is true for fr/en when a free-text field contains Arabic script', () => {
  const { payloadNeedsArabicFont } = load();
  assert.equal(payloadNeedsArabicFont('fr', 'مشروع الاختبار', 'mdf'), true, 'an Arabic projectName must trigger it');
  assert.equal(payloadNeedsArabicFont('en', 'Kitchen', 'خشب الزان'), true, 'an Arabic material label must trigger it');
});

// ─── stripBidiControls ──────────────────────────────────────────────────────

test('stripBidiControls removes LRM/RLM/embedding/isolate marks but keeps every other character', () => {
  const { stripBidiControls } = load();
  const controls = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((cp) =>
    String.fromCodePoint(cp)
  );
  for (const ctrl of controls) {
    assert.equal(stripBidiControls(`a${ctrl}b`), 'ab', `code point ${ctrl.codePointAt(0).toString(16)} must be stripped`);
  }
  assert.equal(stripBidiControls('قطعة 200.00 MAD'), 'قطعة 200.00 MAD');
});

// ─── drawContentAwareText: content-gated font switch + restore ─────────────

test('drawContentAwareText leaves the active font untouched for non-Arabic text', async () => {
  const { drawContentAwareText, registerAmiriFont } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  doc.setFont('helvetica', 'bold');

  drawContentAwareText(doc, registration, 'Sous-total: 200.00 MAD', 10, 10);

  const font = doc.getFont();
  assert.equal(font.fontName, 'helvetica');
  assert.equal(font.fontStyle, 'bold');
});

test('drawContentAwareText switches to Amiri for Arabic text, then restores the prior font/style', async () => {
  const { drawContentAwareText, registerAmiriFont, AMIRI_FONT_FAMILY } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  doc.setFont('helvetica', 'bold');

  let fontDuringDraw = null;
  const originalText = doc.text.bind(doc);
  doc.text = (...args) => {
    fontDuringDraw = doc.getFont();
    return originalText(...args);
  };

  drawContentAwareText(doc, registration, 'قطعة 200.00 MAD', 10, 10);

  assert.equal(fontDuringDraw.fontName, AMIRI_FONT_FAMILY, 'must switch to Amiri while drawing Arabic content');
  assert.equal(fontDuringDraw.fontStyle, 'bold', 'must keep the caller\'s bold/normal style, only swap the family');
  const restored = doc.getFont();
  assert.equal(restored.fontName, 'helvetica', 'must restore the prior font family after drawing');
  assert.equal(restored.fontStyle, 'bold');
});

test('drawContentAwareText degrades to the currently active font (no throw) when Arabic content is drawn without a successful registration', () => {
  const { drawContentAwareText, NOT_REGISTERED } = load();
  const doc = new jsPDF();
  doc.setFont('helvetica', 'normal');

  assert.doesNotThrow(() => drawContentAwareText(doc, NOT_REGISTERED, 'قطعة', 10, 10));
  assert.equal(doc.getFont().fontName, 'helvetica', 'must not attempt to select an unregistered font family');
});

test('drawContentAwareText strips bidi control characters even from otherwise-Latin text', () => {
  const { drawContentAwareText, NOT_REGISTERED } = load();
  const doc = new jsPDF();
  let drawnText = null;
  doc.text = (text) => {
    drawnText = text;
    return doc;
  };
  const withRlm = '31' + String.fromCodePoint(0x200f) + '/08' + String.fromCodePoint(0x200f) + '/2026';
  drawContentAwareText(doc, NOT_REGISTERED, withRlm, 10, 10);
  assert.equal(drawnText, '31/08/2026');
});

// ─── drawShapedCellText: multi-line geometry, single-line behavior unchanged ──

function makeMeasurableDoc() {
  // A real jsPDF instance so getFontSize/getLineHeightFactor/scaleFactor/
  // getStringUnitWidth/processArabic behave exactly as in production —
  // only doc.text is spied on, to record every draw call's arguments.
  const doc = new jsPDF();
  doc.setFontSize(10);
  const draws = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    draws.push({ text, x, y, options });
    return originalText(text, x, y, options);
  };
  return { doc, draws };
}

test('drawShapedCellText with a single-line array reproduces the exact prior single-line geometry (left/top)', () => {
  const { drawShapedCellText } = load();
  const { doc, draws } = makeMeasurableDoc();
  drawShapedCellText(doc, ['قطعة واحدة'], 50, 60, {});
  assert.equal(draws.length, 1, 'a single line must draw exactly once');
  assert.equal(draws[0].x, 50, 'left halign must never shift x');
  const fontSize = doc.getFontSize() / doc.internal.scaleFactor;
  assert.equal(draws[0].y, 60 + fontSize * (2 - 1.15));
});

test('drawShapedCellText with a single-line array reproduces the exact prior single-line geometry (center/middle)', () => {
  const { drawShapedCellText } = load();
  const { doc, draws } = makeMeasurableDoc();
  const text = 'قطعة';
  drawShapedCellText(doc, [text], 50, 60, { halign: 'center', valign: 'middle' });
  assert.equal(draws.length, 1);
  const fontSize = doc.getFontSize() / doc.internal.scaleFactor;
  const lineHeight = fontSize * doc.getLineHeightFactor();
  const shapedWidth = doc.getStringUnitWidth(doc.processArabic(text));
  assert.equal(draws[0].x, 50 - shapedWidth * fontSize * 0.5);
  assert.equal(draws[0].y, 60 + fontSize * (2 - 1.15) - lineHeight / 2);
});

test('drawShapedCellText draws every wrapped logical line, stepping y by one lineHeight per line', () => {
  const { drawShapedCellText } = load();
  const { doc, draws } = makeMeasurableDoc();
  const lines = ['السطر الأول', 'السطر الثاني', 'السطر الثالث'];
  drawShapedCellText(doc, lines, 50, 60, {});
  assert.equal(draws.length, 3, 'every wrapped line must be drawn, not just the first');
  assert.deepEqual(draws.map((d) => d.text), lines, 'lines must be drawn in order');
  const fontSize = doc.getFontSize() / doc.internal.scaleFactor;
  const lineHeight = fontSize * doc.getLineHeightFactor();
  const firstY = 60 + fontSize * (2 - 1.15);
  assert.equal(draws[0].y, firstY);
  assert.equal(draws[1].y, firstY + lineHeight);
  assert.equal(draws[2].y, firstY + 2 * lineHeight);
  // Left halign: every line shares the same x — never shifted per-line.
  assert.ok(draws.every((d) => d.x === 50));
});

test('drawShapedCellText right/center-aligns each wrapped line independently by its own shaped width, not the first line\'s width', () => {
  const { drawShapedCellText } = load();
  const { doc, draws } = makeMeasurableDoc();
  const shortLine = 'قطعة';
  const longLine = 'قطعة طويلة جدا جدا';
  drawShapedCellText(doc, [shortLine, longLine], 100, 60, { halign: 'right' });
  assert.equal(draws.length, 2);
  const fontSize = doc.getFontSize() / doc.internal.scaleFactor;
  const shortWidth = doc.getStringUnitWidth(doc.processArabic(shortLine));
  const longWidth = doc.getStringUnitWidth(doc.processArabic(longLine));
  assert.equal(draws[0].x, 100 - shortWidth * fontSize);
  assert.equal(draws[1].x, 100 - longWidth * fontSize);
  assert.notEqual(draws[0].x, draws[1].x, 'two differently-shaped lines must right-align to different x offsets');
});

test('drawShapedCellText shifts the whole multi-line block up for valign middle/bottom, using the true line count', () => {
  const { drawShapedCellText } = load();
  const { doc, draws } = makeMeasurableDoc();
  const lines = ['أ', 'ب', 'ج'];
  drawShapedCellText(doc, lines, 50, 60, { valign: 'bottom' });
  const fontSize = doc.getFontSize() / doc.internal.scaleFactor;
  const lineHeight = fontSize * doc.getLineHeightFactor();
  const firstY = 60 + fontSize * (2 - 1.15) - lines.length * lineHeight;
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} ~= ${expected}`);
  closeTo(draws[0].y, firstY);
  closeTo(draws[2].y, firstY + 2 * lineHeight);
});

test('drawShapedCellText passes arabicBidiOptions on every line, not just the first', () => {
  const { drawShapedCellText, arabicBidiOptions } = load();
  const { doc, draws } = makeMeasurableDoc();
  drawShapedCellText(doc, ['أ', 'ب'], 50, 60, {});
  for (const d of draws) assert.deepEqual(d.options, arabicBidiOptions);
});

// ─── arabicSafeCellHooks: multi-line cell.text preserved, redrawn, isolated ──

function fakeCellHookData({ raw, text, styles = {}, textPos = { x: 12, y: 34 } }) {
  return {
    cell: {
      raw,
      text,
      styles,
      getTextPos: () => textPos,
    },
  };
}

test('arabicSafeCellHooks preserves autoTable\'s already-wrapped multi-line cell.text before blanking it, and redraws every line', async () => {
  const { arabicSafeCellHooks, registerAmiriFont, AMIRI_FONT_FAMILY } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  const hooks = arabicSafeCellHooks(doc, registration);

  const wrappedLines = ['هذا نص طويل جدا', 'يمتد على أكثر', 'من سطر واحد'];
  const data = fakeCellHookData({ raw: wrappedLines.join(' '), text: [...wrappedLines] });

  hooks.willDrawCell(data);
  assert.deepEqual(data.cell.text, [], 'autoTable\'s own (wrong-font) draw must be suppressed');

  const draws = [];
  const fontsDuringDraw = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    draws.push(text);
    fontsDuringDraw.push(doc.getFont().fontName);
    return originalText(text, x, y, options);
  };

  hooks.didDrawCell(data);
  doc.text = originalText;

  assert.equal(draws.length, wrappedLines.length, 'every preserved wrapped line must be redrawn, not just one');
  assert.deepEqual(draws, wrappedLines, 'must redraw the exact preserved lines, not the joined raw string as one line');
  assert.ok(
    fontsDuringDraw.every((name) => name === AMIRI_FONT_FAMILY),
    `every line must draw with the embedded Amiri font, got ${fontsDuringDraw}`
  );
  assert.equal(doc.getFont().fontName, 'helvetica', 'the prior font must be restored after drawing every line');
});

test('arabicSafeCellHooks keeps single-line cells drawing exactly once (unchanged behavior)', async () => {
  const { arabicSafeCellHooks, registerAmiriFont } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  const hooks = arabicSafeCellHooks(doc, registration);

  const data = fakeCellHookData({ raw: 'قطعة واحدة', text: ['قطعة واحدة'] });
  hooks.willDrawCell(data);

  const draws = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    draws.push(text);
    return originalText(text, x, y, options);
  };
  hooks.didDrawCell(data);
  doc.text = originalText;

  assert.deepEqual(draws, ['قطعة واحدة']);
});

test('arabicSafeCellHooks isolates preserved lines per cell instance — two Arabic cells drawn back-to-back never cross-contaminate', async () => {
  const { arabicSafeCellHooks, registerAmiriFont } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  const hooks = arabicSafeCellHooks(doc, registration);

  const cellA = fakeCellHookData({ raw: 'أ ب', text: ['أ', 'ب'] });
  const cellB = fakeCellHookData({ raw: 'ج د هـ', text: ['ج', 'د', 'هـ'] });

  hooks.willDrawCell(cellA);
  hooks.willDrawCell(cellB);

  const draws = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    draws.push(text);
    return originalText(text, x, y, options);
  };
  hooks.didDrawCell(cellA);
  hooks.didDrawCell(cellB);
  doc.text = originalText;

  assert.deepEqual(draws, ['أ', 'ب', 'ج', 'د', 'هـ']);
});

test('arabicSafeCellHooks restores cell.text after didDrawCell, so a repeated header Cell instance redraws correctly across two will/did cycles (multi-page autoTable)', async () => {
  const { arabicSafeCellHooks, registerAmiriFont } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  const hooks = arabicSafeCellHooks(doc, registration);

  // autoTable repeats a header row by redrawing the *same* Cell instance on
  // every page, not by creating a fresh one — this simulates exactly that:
  // two will/did cycles on one `data` object, as if for pages 1 and 2.
  const headerLines = ['التسمية'];
  const data = fakeCellHookData({ raw: headerLines.join(' '), text: [...headerLines] });

  const draws = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    draws.push(text);
    return originalText(text, x, y, options);
  };

  // Page 1.
  hooks.willDrawCell(data);
  assert.deepEqual(data.cell.text, [], 'must blank before autoTable\'s own (page 1) draw');
  hooks.didDrawCell(data);
  assert.deepEqual(
    data.cell.text,
    headerLines,
    'must restore cell.text to the preserved lines after page 1\'s draw, not leave it blanked'
  );

  // Page 2 — same Cell instance, redrawn by autoTable for the repeated header.
  hooks.willDrawCell(data);
  assert.deepEqual(
    data.cell.text,
    [],
    'must blank again before autoTable\'s own (page 2) draw, using the lines restored after page 1'
  );
  hooks.didDrawCell(data);
  assert.deepEqual(data.cell.text, headerLines, 'must restore again after page 2\'s draw');

  doc.text = originalText;
  assert.deepEqual(
    draws,
    [...headerLines, ...headerLines],
    'the header line must be redrawn identically on both pages, not blank on the second'
  );
});

test('arabicSafeCellHooks falls back to the raw string when preserved lines would otherwise be empty', async () => {
  const { arabicSafeCellHooks, registerAmiriFont } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  const hooks = arabicSafeCellHooks(doc, registration);

  // A cell whose `cell.text` is already empty when willDrawCell runs
  // (defensive-only case — see the doc comment) must still preserve
  // something to redraw, rather than silently drawing nothing.
  const data = fakeCellHookData({ raw: 'قطعة واحدة', text: [] });
  hooks.willDrawCell(data);
  assert.deepEqual(data.cell.text, [], 'must still blank cell.text for autoTable\'s own draw');

  const draws = [];
  const originalText = doc.text.bind(doc);
  doc.text = (text, x, y, options) => {
    draws.push(text);
    return originalText(text, x, y, options);
  };
  hooks.didDrawCell(data);
  doc.text = originalText;

  assert.deepEqual(draws, ['قطعة واحدة'], 'must fall back to the raw string as a single line');
  assert.deepEqual(data.cell.text, ['قطعة واحدة'], 'must restore cell.text to the same fallback line');
});

test('arabicSafeCellHooks leaves non-Arabic cells completely untouched by either hook', () => {
  const { arabicSafeCellHooks, NOT_REGISTERED } = load();
  const doc = new jsPDF();
  const hooks = arabicSafeCellHooks(doc, NOT_REGISTERED);
  const data = fakeCellHookData({ raw: 'Sous-total', text: ['Sous-total'] });

  hooks.willDrawCell(data);
  assert.deepEqual(data.cell.text, ['Sous-total'], 'a non-Arabic cell\'s text must never be blanked');

  let drawCalled = false;
  const originalText = doc.text.bind(doc);
  doc.text = (...args) => {
    drawCalled = true;
    return originalText(...args);
  };
  hooks.didDrawCell(data);
  doc.text = originalText;
  assert.equal(drawCalled, false, 'didDrawCell must never draw for a non-Arabic cell');
});

// ─── Generating a real Arabic PDF ──────────────────────────────────────────

test('a jsPDF document with the registered Amiri font and drawContentAwareText produces a real, non-trivial PDF embedding "Amiri"', async () => {
  const { registerAmiriFont, drawContentAwareText, AMIRI_FONT_FAMILY } = load();
  const doc = new jsPDF();
  const registration = await registerAmiriFont(doc);
  assert.equal(registration.ok, true);

  doc.setFont(AMIRI_FONT_FAMILY, 'normal');
  drawContentAwareText(doc, registration, 'مخطط قطع QatlIA', 20, 20);

  const buffer = Buffer.from(doc.output('arraybuffer'));
  assert.ok(buffer.length > 10_000, 'a real embedded-font PDF must be well over a trivial empty-page size');
  const raw = buffer.toString('latin1');
  assert.match(raw, /%PDF-1\./, 'must be a real PDF');
  assert.match(raw, /Amiri/, 'the embedded font\'s PostScript name must appear in the PDF');
});
