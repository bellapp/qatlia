const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Measurements typed in a WhatsApp message, read by the same model as a photo
// (22/11/2026: « 180x160/140x120/260x60 », « ماريوا 200 الطول العرض 100 », a
// carpenter giving his doors one message at a time). Text only: no image.

const { readTypedCutList, readCutList, SYSTEM_PROMPT, TYPED_SYSTEM_PROMPT } = loadTsModule('src/lib/vision/read-cut-list.ts');

async function read(text, modelAnswer, options, { env = { OPENROUTER_API_KEY: 'or_real' }, status = 200, fetchImpl } = {}) {
  const bodies = [];
  const keys = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl ?? (async (_url, init) => {
    bodies.push({ ...JSON.parse(init.body), signal: init.signal });
    return new Response(JSON.stringify({ choices: [{ message: { content: modelAnswer } }] }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    return { result: await readTypedCutList(text, options), bodies };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const answer = (obj) => JSON.stringify(obj);

test('the typed message goes as text, with its own prompt, never as an image', async () => {
  const { bodies } = await read('180x160/140x120/260x60', answer({ pieces: [{ height: 180, width: 160, quantity: 1 }] }));
  assert.equal(bodies.length, 1);
  const body = bodies[0];
  assert.equal(body.model, 'google/gemini-3.7-flash');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, TYPED_SYSTEM_PROMPT);
  assert.equal(body.messages[1].role, 'user');
  assert.equal(typeof body.messages[1].content, 'string');
  assert.ok(body.messages[1].content.includes('180x160/140x120/260x60'));
  assert.ok(!JSON.stringify(body).includes('image_url'));
});

test('the prompt knows panels, whole furniture, thickness and units are not pieces', () => {
  assert.notEqual(TYPED_SYSTEM_PROMPT, SYSTEM_PROMPT);
  for (const words of ['darija', 'sheet', 'meuble entier', 'سمك', 'millimètres', 'mètres', "N'invente jamais"]) {
    assert.ok(TYPED_SYSTEM_PROMPT.includes(words), words);
  }
});

test('pieces are normalised like a photo read, and the panel comes back as the sheet', async () => {
  const { result } = await read(
    'باب 195 على 45 زوج، لوحة 280x207',
    answer({ pieces: [{ name: 'باب', height: '195', width: 45, quantity: '2' }], sheet: { height: 280, width: 207 } }),
  );
  assert.deepEqual(result, {
    status: 'ok',
    pieces: [{ name: 'باب', height: 195, width: 45, quantity: 2 }],
    sheet: { height: 280, width: 207 },
  });
});

test('no piece (a panel size alone, a whole wardrobe), or no JSON: unreadable', async () => {
  assert.deepEqual((await read('244*122', answer({ pieces: [], sheet: { height: 244, width: 122 } }))).result, { status: 'unreadable' });
  assert.deepEqual((await read('ماريوا 200 الطول العرض 100', answer({ pieces: [] }))).result, { status: 'unreadable' });
  assert.deepEqual((await read('?', 'pas du JSON')).result, { status: 'unreadable' });
});

test('no provider key: unavailable, nothing sent', async () => {
  const { result, bodies } = await read('180x60', answer({ pieces: [] }), undefined, { env: {} });
  assert.deepEqual(result, { status: 'unavailable' });
  assert.equal(bodies.length, 0);
});

test('an upstream failure or running out of time is an error, never a throw', async () => {
  const failed = await read('180x60', '', undefined, { status: 500 });
  assert.equal(failed.result.status, 'error');
  const late = await read('180x60', '', { timeoutMs: 5 }, {
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  });
  assert.deepEqual(late.result, { status: 'error', rateLimited: false, httpStatus: 0 });
  const down = await read('180x60', '', undefined, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(down.result, { status: 'error', rateLimited: false, httpStatus: 0 });
});

test('the site photo reader is untouched', () => {
  assert.equal(typeof readCutList, 'function');
});
