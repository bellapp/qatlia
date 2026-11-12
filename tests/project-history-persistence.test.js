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

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/';

const state = { user: null, projects: new Map(), inserts: [], updates: [] };

function resetState() {
  state.user = null;
  state.projects = new Map();
  state.inserts = [];
  state.updates = [];
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

function db() {
  return {
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
