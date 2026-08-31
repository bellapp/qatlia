const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 8 — src/lib/exports/quotation-logo.ts decodes and validates an
// artisan-supplied company logo before it ever reaches jsPDF: strict base64
// decode, a hard 500KB decoded-size cap, PNG/JPEG magic-number verification
// against the declared MIME (never trusting the data: URL prefix alone),
// and a generous dimension-bomb guard. It never logs or returns the raw
// decoded bytes on failure.

function loadQuotationLogo() {
  return loadTsModule('src/lib/exports/quotation-logo.ts');
}

// 1x1 transparent PNG (valid magic bytes + IHDR: 1x1).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Minimal baseline JPEG (SOI + APP0 + SOF0 1x1 + ... ) is fiddly to hand-craft;
// these tests instead build synthetic byte sequences via Buffer to cover the
// JPEG SOF0 dimension parser directly, and use the real tiny PNG above for the
// PNG happy path end-to-end through the public data-URL API.

function pngDataUrl(base64 = TINY_PNG_BASE64) {
  return `data:image/png;base64,${base64}`;
}

function jpegBufferWithDimensions(width, height) {
  // SOI
  const parts = [Buffer.from([0xff, 0xd8])];
  // APP0 (JFIF) segment, length 16 (including the length bytes themselves)
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
  // SOF0: marker, length(2)=11, precision(1)=8, height(2), width(2), components(1)=1, component data(3)
  const sof0 = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1 + 3);
  sof0.writeUInt8(0xff, 0);
  sof0.writeUInt8(0xc0, 1);
  sof0.writeUInt16BE(11, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(1, 9);
  sof0.writeUInt8(1, 10);
  sof0.writeUInt8(0x11, 11);
  sof0.writeUInt8(0, 12);
  parts.push(sof0);
  // EOI (enough for the parser, which only needs to reach SOF0)
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function jpegDataUrl(width = 10, height = 10) {
  return `data:image/jpeg;base64,${jpegBufferWithDimensions(width, height).toString('base64')}`;
}

// ─── Happy path ─────────────────────────────────────────────────────────

test('validateLogoDataUrl accepts a well-formed small PNG and reports its dimensions', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl(pngDataUrl());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mime, 'image/png');
    assert.equal(result.width, 1);
    assert.equal(result.height, 1);
    assert.ok(result.bytes instanceof Uint8Array);
  }
});

test('validateLogoDataUrl accepts a well-formed small JPEG and reports its dimensions', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl(jpegDataUrl(200, 100));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mime, 'image/jpeg');
    assert.equal(result.width, 200);
    assert.equal(result.height, 100);
  }
});

// ─── Rejections ─────────────────────────────────────────────────────────

test('validateLogoDataUrl rejects an SVG data URL outright', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'UNSUPPORTED_FORMAT');
});

test('validateLogoDataUrl rejects a string that is not a data URL at all', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl('https://attacker.example/logo.png');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'UNSUPPORTED_FORMAT');
});

test('validateLogoDataUrl rejects invalid base64 content', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl('data:image/png;base64,not-valid-base64!!!');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'DECODE_FAILED');
});

test('validateLogoDataUrl rejects a MIME/magic-number mismatch (declared PNG, actually JPEG bytes)', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const jpegBytes = jpegBufferWithDimensions(10, 10).toString('base64');
  const result = validateLogoDataUrl(`data:image/png;base64,${jpegBytes}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MAGIC_MISMATCH');
});

test('validateLogoDataUrl rejects a MIME/magic-number mismatch (declared JPEG, actually PNG bytes)', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl(`data:image/jpeg;base64,${TINY_PNG_BASE64}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MAGIC_MISMATCH');
});

test('validateLogoDataUrl rejects decoded content over the 500KB cap', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const oversized = Buffer.alloc(500 * 1024 + 1, 0).toString('base64');
  const result = validateLogoDataUrl(`data:image/png;base64,${oversized}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'TOO_LARGE');
});

test('validateLogoDataUrl accepts content exactly at the 500KB cap', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  // Not a real PNG, so it will fail signature checking, but must fail with
  // BAD_SIGNATURE rather than TOO_LARGE — proving the cap itself is inclusive.
  const atCap = Buffer.alloc(500 * 1024, 0).toString('base64');
  const result = validateLogoDataUrl(`data:image/png;base64,${atCap}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.notEqual(result.code, 'TOO_LARGE');
});

test('validateLogoDataUrl rejects a PNG whose signature bytes are corrupted', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const corrupted = Buffer.from(TINY_PNG_BASE64, 'base64');
  corrupted[0] = 0x00; // stomp the PNG magic byte
  const result = validateLogoDataUrl(`data:image/png;base64,${corrupted.toString('base64')}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MAGIC_MISMATCH');
});

test('validateLogoDataUrl rejects a PNG reporting a dimension-bomb IHDR', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const bomb = Buffer.from(TINY_PNG_BASE64, 'base64');
  bomb.writeUInt32BE(50000, 16); // width
  bomb.writeUInt32BE(50000, 20); // height
  const result = validateLogoDataUrl(`data:image/png;base64,${bomb.toString('base64')}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'DIMENSION_BOMB');
});

test('validateLogoDataUrl rejects a JPEG reporting a dimension-bomb SOF0', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl(jpegDataUrl(20000, 20000));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'DIMENSION_BOMB');
});

test('a failed validation never exposes the raw decoded bytes', () => {
  const { validateLogoDataUrl } = loadQuotationLogo();
  const result = validateLogoDataUrl('data:image/png;base64,not-valid-base64!!!');
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).length < 200, true, 'a failure result must stay small — no embedded payload');
});

test('the module never logs the raw logo bytes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/lib/exports/quotation-logo.ts'), 'utf8');
  assert.doesNotMatch(source, /console\.(log|error|warn)\([^)]*bytes/i, 'raw logo bytes must never reach a log call');
});
