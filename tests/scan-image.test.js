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
  // A bucket created earlier by hand is brought back to these settings, private first.
  assert.doesNotMatch(sql, /do nothing/i);
  assert.match(sql, /on conflict \(id\) do update set\s+public = false,\s*file_size_limit = excluded\.file_size_limit,\s*allowed_mime_types = excluded\.allowed_mime_types;/i);
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /create\s+policy/i, 'only the service key reaches storage.objects');
  assert.doesNotMatch(code, /storage\.objects/i);
});

// GET /api/projects/[id]/scan hands the owner a 5-minute signed link to the
// image kept in the private bucket, and nobody else.

const { stubModule } = require('./helpers/stub-module');

const SCAN_PATH = `${UUID}/${PROJECT_ID}.jpg`;
const scanState = { user: null, rows: new Map(), lookupError: null, signed: [], signError: null, eqCalls: [] };

function resetScanState() {
  scanState.user = null;
  scanState.rows = new Map();
  scanState.lookupError = null;
  scanState.signed = [];
  scanState.signError = null;
  scanState.eqCalls = [];
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scanState.user }, error: null }) },
    from: (table) => {
      assert.equal(table, 'projects');
      const filters = {};
      const chain = {
        select: () => chain,
        eq: (col, value) => { filters[col] = value; scanState.eqCalls.push([col, value]); return chain; },
        maybeSingle: async () => {
          if (scanState.lookupError) return { data: null, error: { message: scanState.lookupError } };
          const row = scanState.rows.get(filters.id);
          if (!row || row.user_id !== filters.user_id) return { data: null, error: null };
          return { data: { id: filters.id, user_id: row.user_id, options_json: row.options_json }, error: null };
        },
      };
      return chain;
    },
  }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => ({
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (signedPath, expiresIn) => {
          scanState.signed.push([bucket, signedPath, expiresIn]);
          if (scanState.signError) return { data: null, error: { message: scanState.signError } };
          return { data: { signedUrl: `https://files.example/${bucket}/${signedPath}?token=abc` }, error: null };
        },
      }),
    },
  }),
});

const SCAN_ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const SCAN_CONFIGURED = { NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real' };

async function withScanEnv(overrides, fn) {
  const saved = {};
  for (const key of SCAN_ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  try { return await fn(); } finally {
    for (const key of SCAN_ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}

async function getScan(id = PROJECT_ID, env = SCAN_CONFIGURED, query = '') {
  const { GET } = loadTsModule('src/app/api/projects/[id]/scan/route.ts');
  const consoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    return await withScanEnv(env, async () => {
      const res = await GET(new Request(`https://qatlia.example/api/projects/${id}/scan${query}`), { params: { id } });
      return { res, body: await res.json(), logged };
    });
  } finally {
    console.error = consoleError;
  }
}

test('the owner of a project with an image gets a 5-minute signed link', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json: { scanPath: SCAN_PATH } });
  const { res, body } = await getScan();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { success: true, url: `https://files.example/scans/${SCAN_PATH}?token=abc` });
  assert.deepEqual(scanState.signed, [['scans', SCAN_PATH, 300]]);
  assert.deepEqual(scanState.eqCalls, [['id', PROJECT_ID], ['user_id', UUID]], 'the row is read by id AND owner');
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});

test('another artisan\'s project is a 404 and nothing is signed', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  scanState.rows.set(PROJECT_ID, { user_id: OTHER_UUID, options_json: { scanPath: `${OTHER_UUID}/${PROJECT_ID}.jpg` } });
  const { res, body } = await getScan();
  assert.equal(res.status, 404);
  assert.equal(body.error, 'NOT_FOUND');
  assert.deepEqual(scanState.signed, []);
});

test('a project that does not exist, or a non-UUID id, is the same 404', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  assert.equal((await getScan()).res.status, 404);
  assert.equal((await getScan('not-a-uuid')).res.status, 404);
  assert.deepEqual(scanState.signed, []);
});

test('a stored scanPath that points at another artisan is never signed', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  for (const bad of [`${OTHER_UUID}/${PROJECT_ID}.jpg`, `${UUID}/../${OTHER_UUID}/${PROJECT_ID}.jpg`, `${UUID}/${PROJECT_ID}.svg`, 42, {}]) {
    scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json: { scanPath: bad } });
    const { res, body } = await getScan();
    assert.equal(res.status, 404, String(bad));
    assert.equal(body.error, 'NOT_FOUND');
  }
  assert.deepEqual(scanState.signed, []);
});

test('a project without an image is a 404 and nothing is signed', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  for (const options_json of [{}, null, { scanPath: null }, { scanPath: '' }]) {
    scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json });
    assert.equal((await getScan()).res.status, 404);
  }
  assert.deepEqual(scanState.signed, []);
});

test('signed out is a 401 and nothing is read or signed', async () => {
  resetScanState();
  scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json: { scanPath: SCAN_PATH } });
  const { res, body } = await getScan();
  assert.equal(res.status, 401);
  assert.equal(body.error, 'AUTH_REQUIRED');
  assert.deepEqual(scanState.eqCalls, []);
  assert.deepEqual(scanState.signed, []);
});

test('a missing service key is a 503 and nothing is signed', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json: { scanPath: SCAN_PATH } });
  const { res } = await getScan(PROJECT_ID, {});
  assert.equal(res.status, 503);
  assert.deepEqual(scanState.signed, []);
});

test('a signing error is a 503 that never leaks the error text', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json: { scanPath: SCAN_PATH } });
  scanState.signError = 'secret bucket detail sbsvc_real';
  const { res, body, logged } = await getScan();
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(body), /secret|sbsvc|bucket detail/);
  assert.equal(body.url, undefined);
  assert.ok(logged.some((line) => line.includes('secret bucket detail')), 'the text goes to the server log only');
});

test('a failed lookup is a 503 that never leaks the error text', async () => {
  resetScanState();
  scanState.user = { id: UUID };
  scanState.lookupError = 'relation projects exploded';
  const { res, body } = await getScan();
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(body), /exploded/);
  assert.deepEqual(scanState.signed, []);
});

test('a sheet of a project read from several sheets is signed by its number', async () => {
  const third = `${UUID}/33333333-3333-4444-8888-555555555555.jpg`;
  resetScanState();
  scanState.user = { id: UUID };
  scanState.rows.set(PROJECT_ID, { user_id: UUID, options_json: { scans: [{ path: SCAN_PATH }, {}, { path: third }] } });
  const first = await getScan(PROJECT_ID, SCAN_CONFIGURED);
  const sheet3 = await getScan(PROJECT_ID, SCAN_CONFIGURED, '?n=3');
  assert.equal(first.res.status, 200);
  assert.equal(sheet3.res.status, 200);
  assert.deepEqual(scanState.signed.map((call) => call[1]), [SCAN_PATH, third]);
  for (const query of ['?n=2', '?n=5', '?n=0', '?n=x', '?n=1.5']) {
    // eslint-disable-next-line no-await-in-loop
    const { res } = await getScan(PROJECT_ID, SCAN_CONFIGURED, query);
    assert.equal(res.status, 404, `${query} has no image to sign`);
  }
  assert.equal(scanState.signed.length, 2);
});
