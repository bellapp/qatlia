const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// YCloud refuses an image without an embedded color profile ("An embedded
// color profile is required", docs.ycloud.com). The plan image is a PNG drawn
// on the server: an sRGB ICC profile goes into it as an iCCP chunk.

const { srgbIccProfile, withSrgbProfile, crc32 } = loadTsModule('src/lib/png-srgb.ts');

const u32 = (bytes, at) => Buffer.from(bytes).readUInt32BE(at);
const ascii = (bytes, at, length = 4) => Buffer.from(bytes).toString('latin1', at, at + length);

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A 1×1 RGBA PNG, built here so the test needs no image file. */
function tinyPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.from([0, 255, 128, 0, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunks(png) {
  const list = [];
  let at = 8;
  while (at < png.length) {
    const length = u32(png, at);
    const type = ascii(png, at + 4);
    const data = Buffer.from(png).subarray(at + 8, at + 8 + length);
    const crc = u32(png, at + 8 + length);
    list.push({ type, data, crcOk: crc === crc32(Buffer.from(png).subarray(at + 4, at + 8 + length)) });
    at += 12 + length;
  }
  return list;
}

test('crc32 is the PNG checksum', () => {
  assert.equal(crc32(Buffer.from('IEND', 'latin1')), 0xae426082);
  assert.equal(crc32(Buffer.from('123456789', 'latin1')), 0xcbf43926);
});

/** The ICC profile inside the example cut list, whose sends YCloud delivers (21 of 21 on 21/11/2026). */
function exampleProfile() {
  const jpeg = fs.readFileSync(path.join(__dirname, '..', 'public/whatsapp/exemple-fiche.jpg'));
  for (let at = 2; jpeg[at] === 0xff && jpeg[at + 1] !== 0xda; at += 2 + jpeg.readUInt16BE(at + 2)) {
    if (jpeg[at + 1] === 0xe2 && jpeg.toString('latin1', at + 4, at + 16) === 'ICC_PROFILE\0') {
      return jpeg.subarray(at + 18, at + 2 + jpeg.readUInt16BE(at + 2));
    }
  }
  return null;
}

test('the sRGB profile is the one the delivered example image carries', () => {
  const icc = srgbIccProfile();
  assert.equal(u32(icc, 0), icc.length, 'size field');
  assert.equal(ascii(icc, 12), 'mntr');
  assert.equal(ascii(icc, 16), 'RGB ');
  assert.equal(ascii(icc, 36), 'acsp');
  assert.match(Buffer.from(icc).toString('latin1'), /sRGB/);
  assert.deepEqual(new Uint8Array(icc), new Uint8Array(exampleProfile()));
});

test('withSrgbProfile puts the profile right after IHDR and leaves the image as is', () => {
  const png = tinyPng();
  const out = withSrgbProfile(png);
  const list = chunks(out);
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'iCCP', 'IDAT', 'IEND']);
  assert.ok(list.every((c) => c.crcOk), 'every checksum is valid');
  const iccp = list[1].data;
  const nul = iccp.indexOf(0);
  assert.equal(iccp.toString('latin1', 0, nul), 'sRGB');
  assert.equal(iccp[nul + 1], 0, 'deflate');
  assert.deepEqual(new Uint8Array(zlib.inflateSync(iccp.subarray(nul + 2))), new Uint8Array(srgbIccProfile()));
  assert.deepEqual(list[2].data, chunks(png)[1].data, 'pixels untouched');
});

test('a PNG that already has a profile is returned unchanged', () => {
  const once = withSrgbProfile(tinyPng());
  assert.deepEqual(new Uint8Array(withSrgbProfile(once)), new Uint8Array(once));
});

test('anything but a PNG is refused', () => {
  assert.throws(() => withSrgbProfile(Buffer.from('GIF89a......')), /PNG/);
});
