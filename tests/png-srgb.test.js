const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
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

test('the sRGB profile is a well-formed ICC v2 display profile', () => {
  const icc = srgbIccProfile();
  assert.equal(u32(icc, 0), icc.length, 'size field');
  assert.equal(u32(icc, 8), 0x02100000, 'version 2.1');
  assert.equal(ascii(icc, 12), 'mntr');
  assert.equal(ascii(icc, 16), 'RGB ');
  assert.equal(ascii(icc, 20), 'XYZ ');
  assert.equal(ascii(icc, 36), 'acsp');
  const count = u32(icc, 128);
  const tags = [];
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    tags.push({ sig: ascii(icc, at), offset: u32(icc, at + 4), size: u32(icc, at + 8) });
  }
  assert.deepEqual(tags.map((t) => t.sig).sort(), ['bTRC', 'bXYZ', 'cprt', 'desc', 'gTRC', 'gXYZ', 'rTRC', 'rXYZ', 'wtpt']);
  for (const t of tags) {
    assert.equal(t.offset % 4, 0, `${t.sig} is 4-byte aligned`);
    assert.ok(t.offset + t.size <= icc.length, `${t.sig} lies inside the profile`);
  }
  const type = (sig) => ascii(icc, tags.find((t) => t.sig === sig).offset);
  assert.equal(type('desc'), 'desc');
  assert.equal(type('rXYZ'), 'XYZ ');
  assert.equal(type('rTRC'), 'curv');
  assert.match(Buffer.from(icc).toString('latin1'), /sRGB/);
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
