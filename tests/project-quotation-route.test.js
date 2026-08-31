const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Task 8 remediation — item 10 (persistence roundtrip): GET
// /api/projects/[id] returns the safely-validated quotation metadata for a
// project the caller actually owns, so QuotationDialog can prefill
// company/client from a server-owned project instead of only local storage.

const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER_UUID = '99999999-8888-7777-6666-555555555555';
const PROJECT_ID = '22222222-3333-4444-8888-555555555555';
const OTHER_PROJECT_ID = '33333333-3333-4444-8888-555555555555';

const state = { user: null, projects: new Map() };

function resetState() {
  state.user = null;
  state.projects = new Map();
}

function projectsTable() {
  return {
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
  };
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => ({
    from: (table) => {
      if (table === 'projects') return projectsTable();
      throw new Error(`unexpected table: ${table}`);
    },
  }),
});

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const CONFIGURED = { NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real' };

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  const result = fn();
  return result && typeof result.then === 'function' ? result.finally(restore) : (restore(), result);
}

function freshRoute() {
  return loadTsModule('src/app/api/projects/[id]/route.ts');
}

function getRequest() {
  return new Request(`https://qatlia.example/api/projects/${PROJECT_ID}`, { method: 'GET' });
}

test('requires an authenticated user', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const res = await GET(getRequest(), { params: { id: PROJECT_ID } });
    assert.equal(res.status, 401);
  });
});

test('a non-UUID id is rejected with the same not-found code, never a raw DB error', async () => {
  resetState();
  state.user = { id: UUID };
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const res = await GET(getRequest(), { params: { id: 'not-a-uuid' } });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'PROJECT_NOT_FOUND');
  });
});

test('a missing project and one owned by another user answer identically (no existence leak)', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(OTHER_PROJECT_ID, { user_id: OTHER_UUID, options_json: { quotation: { company: { name: 'Someone Else' } } } });
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const missing = await GET(new Request(`https://x/api/projects/${PROJECT_ID}`), { params: { id: PROJECT_ID } });
    const notOwned = await GET(new Request(`https://x/api/projects/${OTHER_PROJECT_ID}`), { params: { id: OTHER_PROJECT_ID } });
    assert.equal(missing.status, 404);
    assert.equal(notOwned.status, 404);
    assert.deepEqual(await missing.json(), await notOwned.json());
  });
});

test('returns null quotation metadata for an owned project that has none yet', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: { options: {}, pieces: [], result: {} } });
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const res = await GET(getRequest(), { params: { id: PROJECT_ID } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.quotation, null);
  });
});

test('returns the safely-validated quotation metadata for an owned project', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, {
    user_id: UUID,
    options_json: {
      quotation: {
        company: { name: 'Atelier Karim', ice: '001234567000089' },
        client: { name: 'Client X', phone: '0600000000' },
        quoteNumber: 'DEV-1',
        issueDate: '2026-08-30',
        notes: 'Merci',
        locale: 'fr',
        deliveryCost: 30,
        tax: { mode: 'percentage', ratePercent: 20 },
        discount: { mode: 'none' },
        includeAmountInWords: true,
        updatedAt: '2026-08-30T10:00:00.000Z',
      },
    },
  });
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const res = await GET(getRequest(), { params: { id: PROJECT_ID } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.quotation.company.name, 'Atelier Karim');
    assert.equal(body.quotation.client.name, 'Client X');
    assert.equal(body.quotation.deliveryCost, 30);
    assert.equal(body.quotation.tax.ratePercent, 20);
  });
});

test('a project belonging to another user never leaks that user\'s client PII, even by id', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(OTHER_PROJECT_ID, {
    user_id: OTHER_UUID,
    options_json: { quotation: { company: { name: 'Not Mine' }, client: { name: 'Not My Client', phone: '0611111111' } } },
  });
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const res = await GET(new Request(`https://x/api/projects/${OTHER_PROJECT_ID}`), { params: { id: OTHER_PROJECT_ID } });
    assert.equal(res.status, 404);
    const text = JSON.stringify(await res.json());
    assert.doesNotMatch(text, /Not My Client|0611111111|Not Mine/);
  });
});

test('a malformed/corrupted stored quotation object degrades to null rather than crashing or leaking raw data', async () => {
  resetState();
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: { quotation: { company: { name: 123 } } } });
  await withEnv(CONFIGURED, async () => {
    const { GET } = freshRoute();
    const res = await GET(getRequest(), { params: { id: PROJECT_ID } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.quotation, null);
  });
});

test('a DB error never leaks a raw error message', async () => {
  resetState();
  state.user = { id: UUID };
  await withEnv(CONFIGURED, async () => {
    stubModule('@supabase/supabase-js', {
      createClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'internal db detail' } }) }) }) }),
        }),
      }),
    });
    const { GET } = freshRoute();
    const res = await GET(getRequest(), { params: { id: PROJECT_ID } });
    assert.ok(res.status >= 500);
    const text = JSON.stringify(await res.json());
    assert.doesNotMatch(text, /internal db detail/);
    stubModule('@supabase/supabase-js', {
      createClient: () => ({
        from: (table) => {
          if (table === 'projects') return projectsTable();
          throw new Error(`unexpected table: ${table}`);
        },
      }),
    });
  });
});
