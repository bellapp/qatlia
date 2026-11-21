const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { loadTsModule } = require('./helpers/load-ts-module');

// WhatsApp refused the PNG plan picture, in a card ("(#131053) Media upload
// error") and alone (never delivered), while the example JPEG goes through
// (21/11/2026). The bot sends the plan as a JPEG with the sRGB profile.

const ROOT = path.resolve(__dirname, '..');
const { pngToJpeg } = loadTsModule(path.join(ROOT, 'src/lib/jpeg-srgb.ts'));
const { srgbIccProfile } = loadTsModule(path.join(ROOT, 'src/lib/png-srgb.ts'));

function samplePng(width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = 245;
    png.data[i * 4 + 1] = (i % width) % 256;
    png.data[i * 4 + 2] = 35;
    png.data[i * 4 + 3] = 255;
  }
  return new Uint8Array(PNG.sync.write(png));
}

test('a PNG becomes a baseline JPEG of the same size', () => {
  const out = pngToJpeg(samplePng(120, 80));
  assert.equal(out[0], 0xff);
  assert.equal(out[1], 0xd8);
  const decoded = jpeg.decode(Buffer.from(out));
  assert.equal(decoded.width, 120);
  assert.equal(decoded.height, 80);
  // Colors survive (JPEG is lossy: close, not equal).
  assert.ok(Math.abs(decoded.data[0] - 245) < 12);
});

test('the JPEG carries the sRGB profile in an APP2 ICC_PROFILE segment, right after SOI', () => {
  const out = Buffer.from(pngToJpeg(samplePng(16, 16)));
  assert.equal(out[2], 0xff);
  assert.equal(out[3], 0xe2, 'APP2 first');
  const length = out.readUInt16BE(4);
  assert.equal(out.toString('latin1', 6, 18), 'ICC_PROFILE\0');
  assert.equal(out[18], 1, 'chunk 1');
  assert.equal(out[19], 1, 'of 1');
  const icc = srgbIccProfile();
  assert.equal(length, 2 + 14 + icc.length);
  assert.ok(Buffer.from(icc).equals(out.subarray(20, 20 + icc.length)));
});

test('a semi-transparent pixel is laid on white, never on black', () => {
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([0, 0, 0, 0]);
  const decoded = jpeg.decode(Buffer.from(pngToJpeg(new Uint8Array(PNG.sync.write(png)))));
  assert.ok(decoded.data[0] > 240 && decoded.data[1] > 240 && decoded.data[2] > 240);
});
