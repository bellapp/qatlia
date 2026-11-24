const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The cut-list reader shared by the site's scan (/api/vision) and the WhatsApp
// bot (plan 2026-11-19, Task 2). The site's request must stay byte-identical:
// tests/fixtures/vision-request.json was captured from /api/vision before the
// reader was extracted.

const FIXTURE = require('./fixtures/vision-request.json');
const IMAGE = `data:image/png;base64,${'a'.repeat(64)}`;

const { readCutList, classifyPhoto, CLASSIFY_PROMPT } = loadTsModule('src/lib/vision/read-cut-list.ts');

async function read(modelAnswer, options, { env = { OPENROUTER_API_KEY: 'or_real' }, status = 200, rawBody, fetchImpl } = {}) {
  const bodies = [];
  const keys = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl ?? (async (_url, init) => {
    bodies.push({ ...JSON.parse(init.body), signal: init.signal });
    const text = rawBody ?? JSON.stringify({ choices: [{ message: { content: modelAnswer } }] });
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    return { result: await readCutList(IMAGE, options), bodies };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const answer = (obj) => JSON.stringify(obj);

test('default options send exactly the request the site sent before', async () => {
  const { bodies } = await read(answer({ pieces: [{ height: 1, width: 1, quantity: 1 }] }));
  const body = bodies[0];
  assert.equal(body.messages[0].content, FIXTURE.system);
  assert.equal(body.messages[1].content[0].text, FIXTURE.user);
  assert.equal(body.messages[1].content[1].image_url.url, IMAGE);
  assert.equal(body.model, FIXTURE.model);
  assert.equal(body.max_tokens, FIXTURE.max_tokens);
  assert.deepEqual(body.response_format, FIXTURE.response_format);
});

test('pieces are normalised as the site did, with no sheet by default', async () => {
  const { result } = await read(
    answer({
      sheet: { height: 280, width: 207 },
      pieces: [
        { name: 'Pièce 3', height: '41.8', width: 38, quantity: '7', edgesHeight: 2, edgesWidth: 0 },
        { name: ' Côté G ', height: -60, width: 40, quantity: 0 },
      ],
    })
  );
  assert.deepEqual(result, {
    status: 'ok',
    sheet: null,
    pieces: [
      { name: '', height: 41.8, width: 38, quantity: 7, edges: { left: true, right: true, top: false, bottom: false } },
      { name: 'Côté G', height: 60, width: 40, quantity: 1 },
    ],
  });
});

test('readPanel adds one instruction after the site prompt and returns the sheet read', async () => {
  const { result, bodies } = await read(
    answer({ sheet: { height: 280, width: 207 }, pieces: [{ height: 50, width: 40, quantity: 2 }] }),
    { readPanel: true }
  );
  const system = bodies[0].messages[0].content;
  assert.ok(system.startsWith(FIXTURE.system), 'the site prompt comes first, unchanged');
  assert.ok(system.length > FIXTURE.system.length);
  assert.match(system.slice(FIXTURE.system.length), /"sheet"/);
  assert.match(system.slice(FIXTURE.system.length), /panneau/i);
  assert.deepEqual(result.sheet, { height: 280, width: 207 });
});

for (const sheet of [{ height: 0, width: 207 }, { height: 'abc', width: 100 }, { height: -5, width: 10 }, 'grand', null]) {
  test(`readPanel with an unusable sheet ${JSON.stringify(sheet)} gives sheet null`, async () => {
    const { result } = await read(answer({ sheet, pieces: [{ height: 50, width: 40, quantity: 1 }] }), { readPanel: true });
    assert.equal(result.status, 'ok');
    assert.equal(result.sheet, null);
  });
}

test('no pieces, or an answer that is not JSON : unreadable', async () => {
  assert.deepEqual((await read(answer({ pieces: [] }))).result, { status: 'unreadable' });
  assert.deepEqual((await read('je ne vois pas de fiche')).result, { status: 'unreadable' });
});

// 23/11/2026: the bot's photo read is left exactly as it was (the reads that
// give plans today); what the photo showed is asked in a separate call
// (classifyPhoto), only after a read with no pieces.
const PANEL_INSTRUCTION_BEFORE = `

Format du panneau : si la fiche indique le format du panneau à découper (ex : "panneau 280x207", "plaque 244 x 122", "لوحة 280×207"), ajoute au même objet JSON un champ "sheet": { "height": 280, "width": 207 } en centimètres (convertis les millimètres), et ne compte JAMAIS cette ligne comme une pièce. Si la fiche n'indique aucun format de panneau, n'ajoute pas de champ "sheet".`;

test('the bot read sends exactly the request it sent before: the site prompt and the panel instruction', async () => {
  const { bodies } = await read(answer({ pieces: [{ height: 50, width: 40, quantity: 1 }] }), { readPanel: true });
  assert.equal(bodies[0].messages[0].content, FIXTURE.system + PANEL_INSTRUCTION_BEFORE);
  assert.equal(bodies[0].messages[1].content[0].text, FIXTURE.user);
});

test('a bot read with no pieces stays unreadable, whatever else the model says', async () => {
  assert.deepEqual((await read(answer({ pieces: [], kind: 'drawing' }), { readPanel: true })).result, { status: 'unreadable' });
});

async function classify(modelAnswer, { status = 200, fetchImpl, env = { OPENROUTER_API_KEY: 'or_real' } } = {}) {
  const bodies = [];
  const keys = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl ?? (async (_url, init) => {
    bodies.push({ ...JSON.parse(init.body), signal: init.signal });
    return new Response(JSON.stringify({ choices: [{ message: { content: modelAnswer } }] }), { status, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    return { kind: await classifyPhoto(IMAGE, { timeoutMs: 8000 }), bodies };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('classifyPhoto sends the image with one question, and a deadline', async () => {
  const { bodies } = await classify(answer({ kind: 'drawing' }));
  const body = bodies[0];
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].content[0].text, CLASSIFY_PROMPT);
  assert.match(CLASSIFY_PROMPT, /"drawing"/);
  assert.match(CLASSIFY_PROMPT, /"furniture"/);
  assert.match(CLASSIFY_PROMPT, /"list"/);
  assert.equal(body.messages[0].content[1].image_url.url, IMAGE);
  assert.ok(body.signal instanceof AbortSignal);
});

for (const kind of ['drawing', 'furniture']) {
  test(`classifyPhoto: ${kind}`, async () => {
    assert.equal((await classify(answer({ kind }))).kind, kind);
  });
}

test('classifyPhoto: a list, anything else, a failure or no key give null, never a throw', async () => {
  assert.equal((await classify(answer({ kind: 'list' }))).kind, null);
  assert.equal((await classify(answer({ kind: 'other' }))).kind, null);
  assert.equal((await classify('pas du JSON')).kind, null);
  assert.equal((await classify(answer({ kind: 'drawing' }), { status: 502 })).kind, null);
  assert.equal((await classify(null, { fetchImpl: async () => { throw new TypeError('fetch failed'); } })).kind, null);
  const none = await classify(answer({ kind: 'drawing' }), { env: {} });
  assert.equal(none.kind, null);
  assert.equal(none.bodies.length, 0);
});

test('upstream rate limit, as the site has always told it (the body says so) : error, rateLimited', async () => {
  const { result } = await read(null, undefined, { status: 429, rawBody: 'code 429: too many requests' });
  assert.deepEqual(result, { status: 'error', rateLimited: true, httpStatus: 429 });
  const silent = await read(null, undefined, { status: 429, rawBody: 'Too many requests' });
  assert.deepEqual(silent.result, { status: 'error', rateLimited: false, httpStatus: 429 }, 'a bare 429 status stays a 502 on the site, as before');
  const worded = await read(null, undefined, { status: 500, rawBody: 'provider rate limit reached' });
  assert.deepEqual(worded.result, { status: 'error', rateLimited: true, httpStatus: 500 });
});

test('other upstream failure : error, not rate limited', async () => {
  const { result } = await read(null, undefined, { status: 502, rawBody: 'bad gateway' });
  assert.deepEqual(result, { status: 'error', rateLimited: false, httpStatus: 502 });
});

test('no provider key : unavailable, nothing sent', async () => {
  const { result, bodies } = await read(answer({ pieces: [] }), undefined, { env: {} });
  assert.deepEqual(result, { status: 'unavailable' });
  assert.equal(bodies.length, 0);
});

test('timeoutMs gives the request a deadline; running out of time is an error, not a throw', async () => {
  const timed = await read(answer({ pieces: [{ height: 1, width: 1, quantity: 1 }] }), { readPanel: true, timeoutMs: 30000 });
  assert.ok(timed.bodies[0].signal instanceof AbortSignal);
  const site = await read(answer({ pieces: [{ height: 1, width: 1, quantity: 1 }] }));
  assert.equal(site.bodies[0].signal, undefined, 'the site request has no deadline, as before');

  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { result } = await read(null, { timeoutMs: 5 }, { fetchImpl: async () => { throw timeout; } });
  assert.deepEqual(result, { status: 'error', rateLimited: false, httpStatus: 0 });
});

// The answer's headers can come long before its body: the deadline may fall while reading it.
test('running out of time while the answer is read is an error too, for the bot only', async () => {
  const stalled = async () => ({
    ok: true,
    json: async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    },
  });
  const { result } = await read(null, { timeoutMs: 5 }, { fetchImpl: stalled });
  assert.deepEqual(result, { status: 'error', rateLimited: false, httpStatus: 0 });
  await assert.rejects(() => read(null, undefined, { fetchImpl: stalled }));
});

test('any other network failure still throws, as the site route expects', async () => {
  await assert.rejects(() => read(null, undefined, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }));
});
