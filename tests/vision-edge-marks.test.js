const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Chants read from a scanned cut list (user request, 2026-11-12). The model
// reports how many edges run along each dimension; the server turns that into
// sides, one edge going on the left (height) or the top (width) by default.
// What the model reads from real handwriting cannot be tested here; these
// tests pin down what the server does with whatever it answers.

const UUID = '11111111-2222-4333-8444-555555555555';
const IMAGE = `data:image/png;base64,${'a'.repeat(64)}`;

const state = { user: null, fetchBodies: [] };

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      insert: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return {
      from: () => chain,
      rpc: async (name) => {
        if (name === 'ensure_profile') return { data: 5, error: null };
        if (name === 'consume_credit') return { data: { success: true, balance: 4 }, error: null };
        return { data: null, error: null };
      },
    };
  },
});

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
  OPENROUTER_API_KEY: 'or_real',
};

async function scan(modelContent) {
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.fetchBodies = [];
  const savedEnv = {};
  for (const key of [...Object.keys(ENV), 'OPENAI_API_KEY', 'NODE_ENV']) savedEnv[key] = process.env[key];
  Object.assign(process.env, ENV);
  delete process.env.OPENAI_API_KEY;
  delete process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    state.fetchBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: modelContent } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const { POST } = loadTsModule('src/app/api/vision/route.ts');
    const res = await POST(new Request('https://qatlia.example/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: IMAGE }),
    }));
    return { status: res.status, body: await res.json() };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const edgeMarks = () => loadTsModule('src/lib/pieces/edge-marks.ts');

// ─── Counts to sides ────────────────────────────────────────────────────────

test('one edge along the height goes on the left, two on both long sides', () => {
  const { edgesFromCounts } = edgeMarks();
  assert.deepEqual(edgesFromCounts(1, 0), { left: true, right: false, top: false, bottom: false });
  assert.deepEqual(edgesFromCounts(2, 0), { left: true, right: true, top: false, bottom: false });
});

test('one edge along the width goes on the top, two on both short sides', () => {
  const { edgesFromCounts } = edgeMarks();
  assert.deepEqual(edgesFromCounts(0, 1), { left: false, right: false, top: true, bottom: false });
  assert.deepEqual(edgesFromCounts(0, 2), { left: false, right: false, top: true, bottom: true });
});

test('a drawn rectangle (2 and 2) bands all four sides', () => {
  const { edgesFromCounts } = edgeMarks();
  assert.deepEqual(edgesFromCounts(2, 2), { left: true, right: true, top: true, bottom: true });
});

test('no mark, or anything that is not a clean 0, 1 or 2, bands nothing', () => {
  const { edgesFromCounts, readEdgeCount } = edgeMarks();
  assert.equal(edgesFromCounts(0, 0), undefined);
  assert.equal(edgesFromCounts(undefined, undefined), undefined);
  for (const garbage of [3, -1, 1.5, 'deux', '1.0', '', null, true, {}, NaN, Infinity]) {
    assert.equal(readEdgeCount(garbage), 0, `${String(garbage)} must not become an edge`);
  }
  assert.equal(readEdgeCount(' 2 '), 2, 'a numeric string is accepted');
});

// ─── /api/vision ────────────────────────────────────────────────────────────

test('the model is asked for the chants column and the quantity column takes precedence', async () => {
  await scan(JSON.stringify({ pieces: [{ name: '', height: 63, width: 55, quantity: 2 }] }));
  const prompt = state.fetchBodies[0].messages[0].content;
  assert.match(prompt, /edgesHeight/);
  assert.match(prompt, /edgesWidth/);
  assert.match(prompt, /UNIQUEMENT si la fiche a une colonne dédiée aux chants/);
  assert.match(prompt, /un trait dans une colonne de chants n'est jamais une quantité/);
});

test('the user\'s sheet: a stroke gives a left edge, a rectangle all four, quantities untouched', async () => {
  const { status, body } = await scan(JSON.stringify({
    pieces: [
      { name: '', height: 63, width: 55, quantity: 2, edgesHeight: 1, edgesWidth: 0 },
      { name: '', height: 84.4, width: 32, quantity: 10, edgesHeight: 1, edgesWidth: 0 },
      { name: '', height: 87.5, width: 43.8, quantity: 4, edgesHeight: 2, edgesWidth: 2 },
    ],
  }));
  assert.equal(status, 200);
  assert.deepEqual(body.pieces.map((p) => p.quantity), [2, 10, 4]);
  assert.deepEqual(body.pieces[0].edges, { left: true, right: false, top: false, bottom: false });
  assert.deepEqual(body.pieces[1].edges, { left: true, right: false, top: false, bottom: false });
  assert.deepEqual(body.pieces[2].edges, { left: true, right: true, top: true, bottom: true });
});

test('a reply without edge fields returns pieces exactly as before', async () => {
  const { body } = await scan(JSON.stringify({ pieces: [{ name: 'Côté G', height: 41.8, width: 38, quantity: 7 }] }));
  assert.deepEqual(body.pieces, [{ name: 'Côté G', height: 41.8, width: 38, quantity: 7 }]);
});

test('an unreadable edge count bands nothing', async () => {
  const { body } = await scan(JSON.stringify({ pieces: [{ name: '', height: 50, width: 20, quantity: 6, edgesHeight: 3, edgesWidth: 'beaucoup' }] }));
  assert.equal('edges' in body.pieces[0], false);
});

test('a truncated reply still salvages its complete rows with their edges', async () => {
  const truncated = '{"pieces": [{"name":"","height":63,"width":55,"quantity":2,"edgesHeight":1,"edgesWidth":0},{"name":"","height":179.6,"width":34,"quantity":1,"edgesHeight":2,"edgesWidth":2},{"name":"","height":88,"wid';
  const { status, body } = await scan(truncated);
  assert.equal(status, 200);
  assert.equal(body.pieces.length, 2);
  assert.deepEqual(body.pieces[0].edges, { left: true, right: false, top: false, bottom: false });
  assert.deepEqual(body.pieces[1].edges, { left: true, right: true, top: true, bottom: true });
});
