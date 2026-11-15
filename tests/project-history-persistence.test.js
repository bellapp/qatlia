const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// History persistence for signed-in artisans: POST /api/projects keeps the job
// name, the scan thumbnail, the PDF marker and the stock sheets, and PATCH
// /api/projects/[id] records a generated PDF on the existing project instead
// of a second save creating a duplicate history entry.

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-7777-6666-555555555555';
const PROJECT_ID = '22222222-3333-4444-8888-555555555555';
const OTHER_PROJECT_ID = '33333333-3333-4444-8888-555555555555';

// A real, decodable 8x8 JPEG (224 bytes).
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAGBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AK0BHTp//9k=';

const state = { user: null, projects: new Map(), inserts: [], updates: [], uploads: [], uploadError: null };

function resetState() {
  state.user = null;
  state.projects = new Map();
  state.inserts = [];
  state.updates = [];
  state.uploads = [];
  state.uploadError = null;
}

function projectsTable() {
  return {
    insert: (row) => {
      state.inserts.push(row);
      return { select: () => ({ single: async () => ({ data: { id: PROJECT_ID }, error: null }) }) };
    },
    select: () => ({
      eq: (_col1, id) => ({
        eq: (_col2, userId) => ({
          maybeSingle: async () => {
            const row = state.projects.get(id);
            if (!row || row.user_id !== userId) return { data: null, error: null };
            return { data: { id, user_id: row.user_id, options_json: row.options_json }, error: null };
          },
        }),
      }),
    }),
    update: (patch) => ({
      eq: (_col1, id) => ({
        eq: async (_col2, userId) => {
          const row = state.projects.get(id);
          if (row && row.user_id === userId) {
            state.updates.push({ id, patch });
            Object.assign(row, patch);
          }
          return { error: null };
        },
      }),
    }),
  };
}

// storage.from(bucket).upload(path, bytes, opts), recording every call.
function storage() {
  return {
    from: (bucket) => ({
      upload: async (path, bytes, opts) => {
        state.uploads.push({ bucket, path, bytes, opts });
        return state.uploadError ? { data: null, error: state.uploadError } : { data: { path }, error: null };
      },
    }),
  };
}

function db() {
  return {
    storage: storage(),
    from: (table) => {
      if (table === 'projects') return projectsTable();
      if (table === 'profiles') return { upsert: async () => ({ error: null }) };
      if (table === 'cut_results' || table === 'pieces') return { insert: async () => ({ error: null }) };
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('@supabase/supabase-js', { createClient: () => db() });

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const CONFIGURED = { NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real' };

async function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const metadata = () => loadTsModule('src/lib/projects/history-metadata.ts');
const projectsRoute = () => loadTsModule('src/app/api/projects/route.ts');
const scansRoute = () => loadTsModule('src/app/api/scans/route.ts');
const scan = () => loadTsModule('src/lib/projects/scan-image.ts');
const projectRoute = () => loadTsModule('src/app/api/projects/[id]/route.ts');

function savePayload(extra = {}) {
  return {
    name: 'Cuisine Alami',
    sheet: { width: 208, height: 278, material: 'mdf', kerf: 0.3 },
    sheets: [{ width: 208, height: 278, material: 'mdf', kerf: 0.3 }],
    pieces: [{ name: 'Côté', width: 40, height: 70, quantity: 2 }],
    options: { kerfWidth: 3 },
    result: { sheetsUsed: 1, wastePercentage: 12 },
    displayUnit: 'cm',
    ...extra,
  };
}

function post(body) {
  return new Request('https://qatlia.example/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postScan(body) {
  return new Request('https://qatlia.example/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function patch(id, body) {
  return [
    new Request(`https://qatlia.example/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

// ─── Pure validators ────────────────────────────────────────────────────────

test('a scan thumbnail is kept only as a small image dataURL', () => {
  const { sanitizeScanThumb, SCAN_THUMB_MAX_CHARS } = metadata();
  assert.equal(sanitizeScanThumb(TINY_JPEG), TINY_JPEG);
  assert.equal(sanitizeScanThumb('data:image/svg+xml;base64,PHN2Zz4='), undefined, 'SVG can carry script');
  assert.equal(sanitizeScanThumb('javascript:alert(1)'), undefined);
  assert.equal(sanitizeScanThumb('https://evil.example/x.jpg'), undefined);
  assert.equal(sanitizeScanThumb(`data:image/jpeg;base64,${'A'.repeat(SCAN_THUMB_MAX_CHARS)}`), undefined);
  assert.equal(sanitizeScanThumb(42), undefined);
});

test('the PDF marker must be a real ISO instant and is normalised', () => {
  const { sanitizePdfGeneratedAt } = metadata();
  assert.equal(sanitizePdfGeneratedAt('2026-11-12T10:20:39.123Z'), '2026-11-12T10:20:39.123Z');
  assert.equal(sanitizePdfGeneratedAt('2026-11-12T11:20:39+01:00'), '2026-11-12T10:20:39.000Z');
  assert.equal(sanitizePdfGeneratedAt('2026-13-45T99:99:99Z'), undefined);
  assert.equal(sanitizePdfGeneratedAt('hier'), undefined);
  assert.equal(sanitizePdfGeneratedAt(Date.now()), undefined);
});

test('the job name is trimmed and length-capped', () => {
  const { sanitizeProjectName, PROJECT_NAME_MAX_CHARS } = metadata();
  assert.equal(sanitizeProjectName('  Cuisine Alami  '), 'Cuisine Alami');
  assert.equal(sanitizeProjectName('   '), undefined);
  assert.equal(sanitizeProjectName('x'.repeat(PROJECT_NAME_MAX_CHARS + 1)), undefined);
});

// ─── POST /api/projects ─────────────────────────────────────────────────────

test('a signed-in save keeps the job name, scan thumbnail, PDF marker and sheets', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = projectsRoute();
    const res = await POST(post(savePayload({
      projectName: 'Cuisine Alami',
      scanThumb: TINY_JPEG,
      pdfGeneratedAt: '2026-11-12T10:20:39.123Z',
    })));
    assert.equal(res.status, 200);
    const stored = state.inserts[0].options_json;
    assert.equal(stored.projectName, 'Cuisine Alami');
    assert.equal(stored.scanThumb, TINY_JPEG);
    assert.equal(stored.pdfGeneratedAt, '2026-11-12T10:20:39.123Z');
    assert.equal(stored.sheets.length, 1);
    // What was stored before this change is still there.
    assert.deepEqual(stored.pieces, savePayload().pieces);
    assert.equal(stored.result.sheetsUsed, 1);
  });
});

test('a save drops an oversized or non-image thumbnail and a bad date instead of storing them', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = projectsRoute();
    const res = await POST(post(savePayload({
      scanThumb: `data:image/jpeg;base64,${'A'.repeat(200_000)}`,
      pdfGeneratedAt: 'not a date',
      projectName: '   ',
    })));
    assert.equal(res.status, 200);
    const stored = state.inserts[0].options_json;
    assert.equal('scanThumb' in stored, false);
    assert.equal('pdfGeneratedAt' in stored, false);
    assert.equal('projectName' in stored, false);
  });
});

test('a save keeps the artisan\'s own scan path and drops anyone else\'s', async () => {
  resetState();
  state.user = { id: UUID };
  await withEnv(CONFIGURED, () => projectsRoute().POST(post(savePayload({ scanPath: `${UUID}/${PROJECT_ID}.jpg` }))));
  await withEnv(CONFIGURED, () => projectsRoute().POST(post(savePayload({ scanPath: `${OTHER_UUID}/${PROJECT_ID}.jpg` }))));
  await withEnv(CONFIGURED, () => projectsRoute().POST(post(savePayload({ scanPath: `${UUID}/../${OTHER_UUID}/${PROJECT_ID}.jpg` }))));
  assert.equal(state.inserts[0].options_json.scanPath, `${UUID}/${PROJECT_ID}.jpg`);
  assert.equal('scanPath' in state.inserts[1].options_json, false);
  assert.equal('scanPath' in state.inserts[2].options_json, false);
});

test('the history metadata keeps a scan path only for the owner it is given', () => {
  const { pickProjectHistoryMetadata } = metadata();
  const body = { scanPath: `${UUID}/${PROJECT_ID}.jpg`, projectName: 'Cuisine' };
  assert.equal(pickProjectHistoryMetadata(body, UUID).scanPath, `${UUID}/${PROJECT_ID}.jpg`);
  assert.equal('scanPath' in pickProjectHistoryMetadata(body, OTHER_UUID), false);
  // Without an owner (the old one-argument call) no path can be vouched for.
  assert.equal('scanPath' in pickProjectHistoryMetadata(body), false);
  assert.equal(pickProjectHistoryMetadata(body).projectName, 'Cuisine');
});

// ─── POST /api/scans ────────────────────────────────────────────────────────

test('storing a scan requires a signed-in artisan and sends nothing otherwise', async () => {
  resetState();
  const res = await withEnv(CONFIGURED, () => scansRoute().POST(postScan({ image: TINY_JPEG })));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'AUTH_REQUIRED');
  assert.equal(state.uploads.length, 0);
});

test('an invalid image answers 400 INVALID_IMAGE and sends nothing', async () => {
  resetState();
  state.user = { id: UUID };
  const bodies = [
    { image: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { image: 'https://evil.example/x.jpg' },
    { image: `data:image/jpeg;base64,${Buffer.from('<html>').toString('base64')}` },
    { image: 42 },
    {},
    '{not json',
  ];
  for (const body of bodies) {
    const res = await withEnv(CONFIGURED, () => scansRoute().POST(postScan(body)));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).error, 'INVALID_IMAGE');
  }
  assert.equal(state.uploads.length, 0);
});

test('a valid image is stored once, privately, under the artisan\'s own server-made path', async () => {
  resetState();
  state.user = { id: UUID };
  const res = await withEnv(CONFIGURED, () => scansRoute().POST(postScan({ image: TINY_JPEG, scanPath: `${OTHER_UUID}/${PROJECT_ID}.jpg` })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(state.uploads.length, 1);
  const [upload] = state.uploads;
  assert.equal(upload.bucket, 'scans');
  assert.equal(upload.path, body.scanPath);
  assert.equal(scan().isOwnScanPath(upload.path, UUID), true);
  assert.equal(upload.path.endsWith('.jpg'), true);
  assert.equal(upload.opts.contentType, 'image/jpeg');
  assert.equal(upload.opts.upsert, false);
  assert.equal(Buffer.isBuffer(upload.bytes), true);
  assert.equal(upload.bytes[0], 0xff);
  assert.equal(upload.bytes.length, 224);
});

test('every stored scan gets a fresh file id', async () => {
  resetState();
  state.user = { id: UUID };
  const first = await withEnv(CONFIGURED, async () => (await scansRoute().POST(postScan({ image: TINY_JPEG }))).json());
  const second = await withEnv(CONFIGURED, async () => (await scansRoute().POST(postScan({ image: TINY_JPEG }))).json());
  assert.notEqual(first.scanPath, second.scanPath);
});

test('the eleventh scan inside the window is refused with Retry-After and stores nothing', async () => {
  resetState();
  state.user = { id: UUID };
  const { SCAN_RATE_LIMIT } = loadTsModule('src/lib/rate-limit.ts');
  assert.deepEqual([SCAN_RATE_LIMIT.limit, SCAN_RATE_LIMIT.windowMs], [10, 60_000]);
  await withEnv(CONFIGURED, async () => {
    const { POST } = scansRoute();
    for (let i = 0; i < SCAN_RATE_LIMIT.limit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await POST(postScan({ image: TINY_JPEG }))).status, 200);
    }
    assert.equal(state.uploads.length, SCAN_RATE_LIMIT.limit);

    // The brake sits right after auth: even an unreadable body is refused as 429.
    const denied = await POST(postScan('{not json'));
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get('Retry-After')) > 0);
    const body = await denied.json();
    assert.equal(body.error, 'RATE_LIMITED');
    assert.equal(state.uploads.length, SCAN_RATE_LIMIT.limit, 'no eleventh upload');

    // Another artisan has a budget of their own.
    state.user = { id: OTHER_UUID };
    assert.equal((await POST(postScan({ image: TINY_JPEG }))).status, 200);
  });
});

test('a signed-out call is refused before it counts against any budget', async () => {
  resetState();
  const { SCAN_RATE_LIMIT } = loadTsModule('src/lib/rate-limit.ts');
  await withEnv(CONFIGURED, async () => {
    const { POST } = scansRoute();
    for (let i = 0; i < SCAN_RATE_LIMIT.limit + 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await POST(postScan({ image: TINY_JPEG }))).status, 401);
    }
  });
});

test('without a service key a scan answers 503 SCAN_STORAGE_UNAVAILABLE and sends nothing', async () => {
  resetState();
  state.user = { id: UUID };
  const res = await withEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '' }, () => scansRoute().POST(postScan({ image: TINY_JPEG })));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'SCAN_STORAGE_UNAVAILABLE');
  assert.equal(state.uploads.length, 0);
});

test('a refused or failing upload answers 503 SCAN_STORAGE_UNAVAILABLE', async () => {
  resetState();
  state.user = { id: UUID };
  state.uploadError = { message: 'Bucket not found' };
  const refused = await withEnv(CONFIGURED, () => scansRoute().POST(postScan({ image: TINY_JPEG })));
  assert.equal(refused.status, 503);
  const refusedBody = await refused.json();
  assert.equal(refusedBody.error, 'SCAN_STORAGE_UNAVAILABLE');
  assert.equal('scanPath' in refusedBody, false);
  assert.doesNotMatch(JSON.stringify(refusedBody), /Bucket not found/, 'the storage error text stays server-side');
});

// ─── PATCH /api/projects/[id] — PDF marker ──────────────────────────────────

test('recording a PDF merges the marker and keeps every other options_json key', async () => {
  resetState();
  state.user = { id: UUID };
  const quotation = { quoteNumber: 'D-2026-001' };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: { pieces: [{ name: 'Côté' }], scanThumb: TINY_JPEG, quotation } });
  await withEnv(CONFIGURED, async () => {
    const { PATCH } = projectRoute();
    const res = await PATCH(...patch(PROJECT_ID, { pdfGeneratedAt: '2026-11-12T10:20:39.123Z' }));
    assert.equal(res.status, 200);
    const saved = state.projects.get(PROJECT_ID).options_json;
    assert.equal(saved.pdfGeneratedAt, '2026-11-12T10:20:39.123Z');
    assert.deepEqual(saved.quotation, quotation);
    assert.equal(saved.scanThumb, TINY_JPEG);
    assert.deepEqual(saved.pieces, [{ name: 'Côté' }]);
  });
});

test('another artisan\'s project answers like a missing one and is never written', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(OTHER_PROJECT_ID, { user_id: OTHER_UUID, options_json: { pieces: [] } });
  await withEnv(CONFIGURED, async () => {
    const { PATCH } = projectRoute();
    const notOwned = await PATCH(...patch(OTHER_PROJECT_ID, { pdfGeneratedAt: '2026-11-12T10:20:39.123Z' }));
    const missing = await PATCH(...patch(PROJECT_ID, { pdfGeneratedAt: '2026-11-12T10:20:39.123Z' }));
    assert.equal(notOwned.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await notOwned.json(), await missing.json());
    assert.equal(state.updates.length, 0);
    assert.equal('pdfGeneratedAt' in state.projects.get(OTHER_PROJECT_ID).options_json, false);
  });
});

test('a PDF marker that is not a date is refused', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: {} });
  await withEnv(CONFIGURED, async () => {
    const { PATCH } = projectRoute();
    const res = await PATCH(...patch(PROJECT_ID, { pdfGeneratedAt: 'demain' }));
    assert.equal(res.status, 400);
    assert.equal(state.updates.length, 0);
  });
});

test('the PDF marker requires a signed-in artisan', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { PATCH } = projectRoute();
    const res = await PATCH(...patch(PROJECT_ID, { pdfGeneratedAt: '2026-11-12T10:20:39.123Z' }));
    assert.equal(res.status, 401);
  });
});

test('an invalid rename body is still refused as INVALID_NAME', async () => {
  resetState();
  state.user = { id: UUID };
  await withEnv(CONFIGURED, async () => {
    const { PATCH } = projectRoute();
    const res = await PATCH(...patch(PROJECT_ID, { name: '   ' }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'INVALID_NAME');
  });
});

// ─── PATCH /api/projects/[id] — rename ──────────────────────────────────────

test('renaming a project also names it for the next reopen, and keeps every other key', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, name: 'Débit', options_json: { projectName: 'Ancien', quotation: { quoteNumber: 'D-1' } } });
  const res = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { name: '  Cuisine Alami ' })));
  assert.equal(res.status, 200);
  assert.deepEqual(state.updates, [{ id: PROJECT_ID, patch: { name: 'Cuisine Alami', options_json: { projectName: 'Cuisine Alami', quotation: { quoteNumber: 'D-1' } } } }]);
});

test('a 120-character name is accepted and a 121-character one refused', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, name: 'Débit', options_json: {} });
  const ok = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { name: 'n'.repeat(120) })));
  const tooLong = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { name: 'n'.repeat(121) })));
  assert.equal(ok.status, 200);
  assert.equal(tooLong.status, 400);
});

test('renaming another artisan\'s project answers 404 and writes nothing', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(OTHER_PROJECT_ID, { user_id: OTHER_UUID, name: 'Autre', options_json: {} });
  const res = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(OTHER_PROJECT_ID, { name: 'Pris' })));
  assert.equal(res.status, 404);
  assert.deepEqual(state.updates, []);
  assert.equal(state.projects.get(OTHER_PROJECT_ID).name, 'Autre');
});

// ─── PATCH /api/projects/[id] — scan image sent after the save ──────────────

const OWN_SCAN = `${UUID}/44444444-3333-4444-8888-555555555555.jpg`;

test('the scan image sent after the save is attached to the artisan\'s own project, every other key kept', async () => {
  resetState();
  state.user = { id: UUID };
  const quotation = { quoteNumber: 'D-2026-001' };
  state.projects.set(PROJECT_ID, { user_id: UUID, name: 'Cuisine', options_json: { scanThumb: TINY_JPEG, quotation, pdfGeneratedAt: '2026-11-12T10:20:39.123Z' } });
  const res = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { scanPath: OWN_SCAN })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, id: PROJECT_ID, scanPath: OWN_SCAN });
  assert.deepEqual(state.updates, [{ id: PROJECT_ID, patch: { options_json: { scanThumb: TINY_JPEG, quotation, pdfGeneratedAt: '2026-11-12T10:20:39.123Z', scanPath: OWN_SCAN } } }]);
  assert.equal(state.projects.get(PROJECT_ID).name, 'Cuisine', 'the name is not touched');
});

test('another artisan\'s image path, or anything that is not a kept-image path, is refused with no write', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: {} });
  for (const scanPath of [`${OTHER_UUID}/44444444-3333-4444-8888-555555555555.jpg`, `${UUID}/../${OTHER_UUID}/a.jpg`, '', null, 42, TINY_JPEG]) {
    const res = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { scanPath })));
    assert.equal(res.status, 400, String(scanPath).slice(0, 40));
    assert.equal((await res.json()).error, 'INVALID_SCAN_PATH');
  }
  assert.deepEqual(state.updates, []);
  assert.equal('scanPath' in state.projects.get(PROJECT_ID).options_json, false);
});

test('an own image path on another artisan\'s project answers 404 and writes nothing', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(OTHER_PROJECT_ID, { user_id: OTHER_UUID, options_json: {} });
  const notOwned = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(OTHER_PROJECT_ID, { scanPath: OWN_SCAN })));
  const missing = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { scanPath: OWN_SCAN })));
  assert.equal(notOwned.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(state.updates, []);
  assert.equal('scanPath' in state.projects.get(OTHER_PROJECT_ID).options_json, false);
});

test('attaching an image requires a signed-in artisan', async () => {
  resetState();
  const res = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { scanPath: OWN_SCAN })));
  assert.equal(res.status, 401);
});

test('a name or a PDF marker sent with a scan path keeps its own branch, and the path is not written', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, name: 'Débit', options_json: {} });
  const renamed = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { name: 'Salon', scanPath: OWN_SCAN })));
  assert.equal(renamed.status, 200);
  assert.deepEqual(await renamed.json(), { success: true, id: PROJECT_ID, name: 'Salon' });
  const marked = await withEnv(CONFIGURED, async () => projectRoute().PATCH(...patch(PROJECT_ID, { pdfGeneratedAt: '2026-11-12T10:20:39.123Z', scanPath: OWN_SCAN })));
  assert.equal(marked.status, 200);
  assert.deepEqual(await marked.json(), { success: true, id: PROJECT_ID, pdfGeneratedAt: '2026-11-12T10:20:39.123Z' });
  assert.equal('scanPath' in state.projects.get(PROJECT_ID).options_json, false);
});
