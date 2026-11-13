const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Back office access is tied to a Supabase account listed in ADMIN_USER_IDS,
// not to a shared secret (plan 2026-11-12, Task 1).

const ADMIN = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

const state = { user: null };

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('next/navigation', {
  redirect: (url) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
});

const auth = loadTsModule('src/lib/admin/auth.ts');

function withAdminEnv(fn) {
  return async () => {
    const saved = process.env.ADMIN_USER_IDS;
    process.env.ADMIN_USER_IDS = ADMIN;
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.ADMIN_USER_IDS;
      else process.env.ADMIN_USER_IDS = saved;
      state.user = null;
    }
  };
}

const request = (method, headers = {}) =>
  new Request('https://qatlia.ma/api/admin/payments', { method, headers: { host: 'qatlia.ma', ...headers } });

test('getAdminUserIds : absente ou vide ne désigne personne', () => {
  assert.deepEqual(auth.getAdminUserIds({}), []);
  assert.deepEqual(auth.getAdminUserIds({ ADMIN_USER_IDS: '  ' }), []);
});

test("getAdminUserIds : tolère espaces et majuscules, écarte ce qui n'est pas un UUID", () => {
  assert.deepEqual(auth.getAdminUserIds({ ADMIN_USER_IDS: ` ${ADMIN.toUpperCase()} , pas-un-uuid,${ADMIN}` }), [ADMIN]);
});

test('isAdminUserId : refuse un autre compte, null et un objet', () => {
  const env = { ADMIN_USER_IDS: ADMIN };
  assert.equal(auth.isAdminUserId(ADMIN, env), true);
  assert.equal(auth.isAdminUserId(ADMIN.toUpperCase(), env), true);
  assert.equal(auth.isAdminUserId(OTHER, env), false);
  assert.equal(auth.isAdminUserId(null, env), false);
  assert.equal(auth.isAdminUserId({}, env), false);
  assert.equal(auth.isAdminUserId(ADMIN, {}), false);
});

test(
  'requireAdminPage : sans session, redirige vers la connexion avec le retour',
  withAdminEnv(async () => {
    state.user = null;
    await assert.rejects(auth.requireAdminPage('/admin/clients'), /REDIRECT:\/auth\/login\?redirect=%2Fadmin%2Fclients/);
  })
);

test(
  'requireAdminPage : un client connecté non admin obtient un 404',
  withAdminEnv(async () => {
    state.user = { id: OTHER, email: 'client@example.com' };
    await assert.rejects(auth.requireAdminPage('/admin/clients'), /NOT_FOUND/);
  })
);

test(
  "requireAdminPage : l'admin passe",
  withAdminEnv(async () => {
    state.user = { id: ADMIN, email: 'owner@example.com' };
    assert.deepEqual(await auth.requireAdminPage('/admin/clients'), { userId: ADMIN, email: 'owner@example.com' });
  })
);

test(
  'authorizeAdminRequest : 401 sans session et pour un non-admin',
  withAdminEnv(async () => {
    for (const user of [null, { id: OTHER, email: 'x@y.ma' }]) {
      state.user = user;
      const result = await auth.authorizeAdminRequest(request('GET'));
      assert.equal(result.ok, false);
      assert.equal(result.response.status, 401);
      assert.deepEqual(await result.response.json(), { error: 'UNAUTHORIZED' });
    }
  })
);

test(
  'authorizeAdminRequest : POST avec un Origin étranger répond 403 BAD_ORIGIN',
  withAdminEnv(async () => {
    state.user = { id: ADMIN, email: 'owner@example.com' };
    const result = await auth.authorizeAdminRequest(request('POST', { origin: 'https://evil.example' }));
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 403);
    assert.deepEqual(await result.response.json(), { error: 'BAD_ORIGIN' });
  })
);

test(
  "authorizeAdminRequest : POST même origine et GET sans Origin passent pour l'admin",
  withAdminEnv(async () => {
    state.user = { id: ADMIN, email: 'owner@example.com' };
    const post = await auth.authorizeAdminRequest(request('POST', { origin: 'https://qatlia.ma' }));
    assert.equal(post.ok, true);
    assert.equal(post.admin.userId, ADMIN);
    const get = await auth.authorizeAdminRequest(request('GET'));
    assert.equal(get.ok, true);
  })
);

test('authorizeAdminRequest : variable absente, même la bonne session est refusée', async () => {
  const saved = process.env.ADMIN_USER_IDS;
  delete process.env.ADMIN_USER_IDS;
  state.user = { id: ADMIN, email: 'owner@example.com' };
  try {
    const result = await auth.authorizeAdminRequest(request('GET'));
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 401);
  } finally {
    if (saved !== undefined) process.env.ADMIN_USER_IDS = saved;
    state.user = null;
  }
});

test('isMissingMigration reconnaît fonction ou table absente, et rien d’autre', () => {
  const db = loadTsModule('src/lib/admin/db.ts');
  for (const code of ['PGRST202', 'PGRST205', '42883', '42P01']) {
    assert.equal(db.isMissingMigration({ code, message: 'x' }), true);
  }
  assert.equal(db.isMissingMigration({ code: '23505', message: 'duplicate' }), false);
  assert.equal(db.isMissingMigration(null), false);
});
