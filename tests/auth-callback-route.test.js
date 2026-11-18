const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The OAuth return: a Google sign-up gets the source of the visit that led to
// it, like an email sign-up (src/lib/acquisition.ts), and the sign-in never
// depends on it.

const errorLog = mock.method(console, 'error', () => {});

const state = {};
function reset(overrides = {}) {
  errorLog.mock.resetCalls();
  Object.assign(state, {
    exchange: () => ({ data: { user: { created_at: new Date().toISOString(), user_metadata: {} } }, error: null }),
    updates: [],
    updateResult: () => ({ data: {}, error: null }),
    ...overrides,
  });
}
reset();

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: {
      exchangeCodeForSession: async () => state.exchange(),
      updateUser: async (attrs) => {
        state.updates.push(attrs);
        return state.updateResult();
      },
    },
  }),
});

const { GET } = loadTsModule('src/app/(site)/auth/callback/route.ts');
const { acquisitionCookie } = loadTsModule('src/lib/acquisition.ts');

const WHATSAPP_COOKIE = acquisitionCookie({ tags: { signup_source: 'whatsapp' }, at: Date.now() }, Date.now(), true).split(';')[0];
const callback = (cookie) =>
  new Request('https://qatlia.ma/auth/callback?code=abc&redirect=%2Fatelier', {
    headers: cookie ? { cookie } : {},
  });

test('a Google sign-up that followed a WhatsApp link records the source, then goes on to the page', async () => {
  reset();
  const res = await GET(callback(`theme=dark; ${WHATSAPP_COOKIE}`));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://qatlia.ma/atelier');
  assert.deepEqual(state.updates, [{ data: { signup_source: 'whatsapp' } }]);
});

test('without a remembered visit, or for an older account, nothing is written', async () => {
  reset();
  await GET(callback(null));
  assert.equal(state.updates.length, 0);

  reset({
    exchange: () => ({ data: { user: { created_at: '2026-01-01T00:00:00Z', user_metadata: {} } }, error: null }),
  });
  await GET(callback(WHATSAPP_COOKIE));
  assert.equal(state.updates.length, 0);
});

test('a failure to record the source never blocks the sign-in', async () => {
  for (const updateResult of [
    () => ({ data: null, error: { name: 'AuthApiError', message: 'boom' } }),
    () => {
      throw new Error('network');
    },
  ]) {
    reset({ updateResult });
    const res = await GET(callback(WHATSAPP_COOKIE));
    assert.equal(res.headers.get('location'), 'https://qatlia.ma/atelier');
    assert.equal(errorLog.mock.callCount(), 1);
  }
});

test('a failed code exchange still goes back to the login page, untouched', async () => {
  reset({ exchange: () => ({ data: { user: null }, error: { message: 'bad code' } }) });
  const res = await GET(callback(WHATSAPP_COOKIE));
  assert.equal(res.headers.get('location'), 'https://qatlia.ma/auth/login?error=auth_failed');
  assert.equal(state.updates.length, 0);
});
