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
