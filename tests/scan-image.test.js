const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The 1600 px scan image kept in the private `scans` bucket: what may be
// parsed from a client dataURL, and which storage paths belong to an artisan.

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-7777-6666-555555555555';
const PROJECT_ID = '22222222-3333-4444-8888-555555555555';

// A real, decodable 8x8 JPEG (224 bytes).
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAGBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AK0BHTp//9k=';

const scan = () => loadTsModule('src/lib/projects/scan-image.ts');
const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

test('a scan path is only ever the artisan\'s own', () => {
  const { isOwnScanPath, scanPathFor } = scan();
  assert.equal(isOwnScanPath(scanPathFor(UUID, PROJECT_ID, 'jpg'), UUID), true);
  for (const path of [`${OTHER_UUID}/${PROJECT_ID}.jpg`, `${UUID}/../${OTHER_UUID}/${PROJECT_ID}.jpg`, `${UUID}/${PROJECT_ID}.svg`, `${UUID}/x.jpg`, '', null, 42]) {
    assert.equal(isOwnScanPath(path, UUID), false);
  }
});

test('a scan path cannot be widened by a crafted owner id or a trailing segment', () => {
  const { isOwnScanPath } = scan();
  assert.equal(isOwnScanPath(`${UUID}/${PROJECT_ID}.png`, UUID), true);
  assert.equal(isOwnScanPath(`${UUID}/${PROJECT_ID}.webp`, UUID), true);
  for (const path of [
    `${UUID}/${PROJECT_ID}.jpg/extra`,
    `/${UUID}/${PROJECT_ID}.jpg`,
    `${UUID}/${PROJECT_ID}.jpg\n`,
    `${UUID}//${PROJECT_ID}.jpg`,
    `${UUID}/${PROJECT_ID}.JPG`,
  ]) {
    assert.equal(isOwnScanPath(path, UUID), false, path);
  }
  // An owner id that is itself a regex or traversal fragment matches nothing.
  assert.equal(isOwnScanPath(`${UUID}/${PROJECT_ID}.jpg`, '.*'), false);
  assert.equal(isOwnScanPath(`../${PROJECT_ID}.jpg`, '..'), false);
});

test('only a real, bounded image dataURL is parsed', () => {
  const { parseScanImage, SCAN_IMAGE_MAX_CHARS } = scan();
  assert.deepEqual([parseScanImage(TINY_JPEG).mime, parseScanImage(TINY_JPEG).ext], ['image/jpeg', 'jpg']);
  for (const bad of ['data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'https://x/y.jpg', `data:image/jpeg;base64,${'A'.repeat(SCAN_IMAGE_MAX_CHARS)}`, null]) {
    assert.equal(parseScanImage(bad), null);
  }
});

test('the decoded bytes must carry the magic bytes of the declared type', () => {
  const { parseScanImage } = scan();
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const webp = [...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBP')];

  const parsed = parseScanImage(TINY_JPEG);
  assert.equal(Buffer.isBuffer(parsed.bytes), true);
  assert.equal(parsed.bytes[0], 0xff);
  assert.equal(parsed.bytes.length, 224);

  assert.equal(parseScanImage(dataUrl('image/jpeg', jpeg)).ext, 'jpg');
  assert.equal(parseScanImage(dataUrl('image/png', png)).ext, 'png');
  assert.equal(parseScanImage(dataUrl('image/webp', webp)).ext, 'webp');

  // A header is the client's claim: HTML, a PNG or a bare RIFF under another type's label is refused.
  assert.equal(parseScanImage(dataUrl('image/jpeg', Buffer.from('<script>alert(1)</script>'))), null);
  assert.equal(parseScanImage(dataUrl('image/jpeg', png)), null);
  assert.equal(parseScanImage(dataUrl('image/png', jpeg)), null);
  assert.equal(parseScanImage(dataUrl('image/webp', [...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WAVE')])), null);
  assert.equal(parseScanImage(dataUrl('image/webp', jpeg)), null);
  assert.equal(parseScanImage('data:image/jpeg;base64,'), null);
});

test('an image over the bucket byte cap is refused here, not by the bucket', () => {
  const { parseScanImage, SCAN_IMAGE_MAX_BYTES, SCAN_IMAGE_MAX_CHARS } = scan();
  assert.equal(SCAN_IMAGE_MAX_BYTES, 1_048_576);
  const jpegOf = (size) => {
    const bytes = Buffer.alloc(size);
    bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
    return dataUrl('image/jpeg', bytes);
  };
  const atCap = jpegOf(SCAN_IMAGE_MAX_BYTES);
  const overCap = jpegOf(SCAN_IMAGE_MAX_BYTES + 1);
  assert.ok(overCap.length <= SCAN_IMAGE_MAX_CHARS, 'the character cap alone would let it through');
  assert.equal(parseScanImage(atCap).bytes.length, SCAN_IMAGE_MAX_BYTES);
  assert.equal(parseScanImage(overCap), null);
});

test('the private bucket is created without a single storage policy', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '017_scan_images.sql'), 'utf8');
  assert.match(sql, /storage\.buckets/);
  assert.match(sql, /'scans'/);
  assert.match(sql, /'scans',\s*'scans',\s*false,\s*1048576,/, 'id, name, public = false, 1 MB limit');
  assert.match(sql, /array\['image\/jpeg',\s*'image\/png',\s*'image\/webp'\]/i);
  assert.match(sql, /on conflict \(id\) do nothing/i);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /create\s+policy/i, 'only the service key reaches storage.objects');
  assert.doesNotMatch(code, /storage\.objects/i);
});
