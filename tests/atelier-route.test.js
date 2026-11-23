const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule, restoreStubs } = require('./helpers/stub-module');

// /api/atelier — the account page reads and saves « Mon entreprise » here. The
// owner is always the session's user, never anything the body says.

const USER_ID = '11111111-2222-4333-8444-555555555555';

// 1x1 PNG, and a JPEG built by hand (see tests/quotation-logo.test.js).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

function jpegBase64() {
  const parts = [Buffer.from([0xff, 0xd8])];
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
  const sof0 = Buffer.alloc(13);
  sof0.writeUInt8(0xff, 0);
  sof0.writeUInt8(0xc0, 1);
  sof0.writeUInt16BE(11, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(10, 5);
  sof0.writeUInt16BE(10, 7);
  sof0.writeUInt8(1, 9);
  sof0.writeUInt8(1, 10);
  sof0.writeUInt8(0x11, 11);
  parts.push(sof0, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts).toString('base64');
}

function loadRoute({ user = { id: USER_ID }, read = null, save = true } = {}) {
  const calls = { reads: [], saves: [] };
  stubModule('@/lib/supabase/server', {
    createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
  });
  stubModule('@/lib/atelier-server', {
    readAtelier: async (userId) => {
      calls.reads.push(userId);
      return read;
    },
    saveAtelier: async (...args) => {
      calls.saves.push(args);
      return save;
    },
  });
  return { route: loadTsModule('src/app/api/atelier/route.ts'), calls };
}

function put(body, query = '') {
  return new Request(`https://qatlia.example/api/atelier${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const GET_REQUEST = () => new Request('https://qatlia.example/api/atelier');

test('GET and PUT without a session answer 401 and save nothing', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute({ user: null });

  const got = await route.GET(GET_REQUEST());
  assert.equal(got.status, 401);
  assert.deepEqual(await got.json(), { error: 'AUTH_REQUIRED' });

  const refused = await route.PUT(put({ name: 'Menuiserie Benali' }));
  assert.equal(refused.status, 401);
  assert.deepEqual(await refused.json(), { error: 'AUTH_REQUIRED' });

  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.saves, []);
});

test('a missing session is answered before the body is read', async (t) => {
  t.after(restoreStubs);
  const { route } = loadRoute({ user: null });
  const res = await route.PUT(put('x'.repeat(1_000_001)));
  assert.equal(res.status, 401);
});

test('the route is never cached', (t) => {
  t.after(restoreStubs);
  const { route } = loadRoute();
  assert.equal(route.dynamic, 'force-dynamic');
});

test('GET answers { atelier: null } when the account has no business', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute({ read: null });
  const res = await route.GET(GET_REQUEST());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { atelier: null });
  assert.deepEqual(calls.reads, [USER_ID]);
});

test('GET answers the saved business', async (t) => {
  t.after(restoreStubs);
  const saved = { name: 'Menuiserie Benali', phone: '0612345678' };
  const { route } = loadRoute({ read: saved });
  const res = await route.GET(GET_REQUEST());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { atelier: saved });
});

test('PUT saves under the session user and answers the validated business', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const body = { name: 'Menuiserie Benali', phone: '0612345678' };
  const res = await route.PUT(put(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { atelier: body });
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0][0], USER_ID);
  assert.deepEqual(calls.saves[0][1], body);
});

test('PUT refuses a body that names another owner', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  for (const key of ['user_id', 'userId']) {
    const res = await route.PUT(put({ name: 'Menuiserie Benali', [key]: 'someone-else' }));
    assert.equal(res.status, 400, key);
    assert.deepEqual(await res.json(), { error: 'INVALID_DATA' });
  }
  assert.deepEqual(calls.saves, []);
});

test('PUT without a name is INVALID_DATA', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const res = await route.PUT(put({ phone: '0612345678' }));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'INVALID_DATA' });
  assert.deepEqual(calls.saves, []);
});

test('PUT with an empty body or invalid JSON is INVALID_DATA', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  for (const body of ['', '{not json', 'null']) {
    const res = await route.PUT(put(body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { error: 'INVALID_DATA' });
  }
  assert.deepEqual(calls.saves, []);
});

test('PUT keeps a valid logo', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const res = await route.PUT(put({ name: 'Menuiserie Benali', logoDataUrl: PNG_URL }));
  assert.equal(res.status, 200);
  assert.equal(calls.saves[0][1].logoDataUrl, PNG_URL);
});

test('PUT with a null logo clears it without validating', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const res = await route.PUT(put({ name: 'Menuiserie Benali', logoDataUrl: null }));
  assert.equal(res.status, 200);
  assert.equal(calls.saves[0][1].logoDataUrl, null);
});

test('PUT with a PNG logo whose bytes are a JPEG is INVALID_LOGO', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const res = await route.PUT(put({ name: 'Menuiserie Benali', logoDataUrl: `data:image/png;base64,${jpegBase64()}` }));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'INVALID_LOGO' });
  assert.deepEqual(calls.saves, []);
});

test('PUT with a body over 1,000,000 bytes is TOO_LARGE', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const res = await route.PUT(put(JSON.stringify({ name: 'x'.repeat(1_000_001) })));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'TOO_LARGE' });
  assert.deepEqual(calls.saves, []);
});

test('the size limit counts bytes, not characters', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  // 500,001 two-byte characters: under 1,000,000 characters, over 1,000,000 bytes.
  const res = await route.PUT(put(JSON.stringify({ name: 'é'.repeat(500_001) })));
  assert.equal(res.status, 413);
  assert.deepEqual(calls.saves, []);
});

test('a failed save answers SAVE_FAILED', async (t) => {
  t.after(restoreStubs);
  const { route } = loadRoute({ save: false });
  const res = await route.PUT(put({ name: 'Menuiserie Benali' }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'SAVE_FAILED' });
});

test('?createOnly=1 passes createOnly to saveAtelier, and only then', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadRoute();
  const body = { name: 'Menuiserie Benali' };

  await route.PUT(put(body, '?createOnly=1'));
  assert.deepEqual(calls.saves[0][2], { createOnly: true });

  await route.PUT(put(body));
  assert.ok(calls.saves[1][2] === undefined || !calls.saves[1][2].createOnly);

  await route.PUT(put(body, '?createOnly=0'));
  assert.ok(calls.saves[2][2] === undefined || !calls.saves[2][2].createOnly);
});
