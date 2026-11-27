const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule, restoreStubs } = require('./helpers/stub-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');
const { splitStatements } = require('./helpers/sql-inspect');

// Parrainage (docs/adr/0001-recompense-parrainage.md and
// docs/adr/0002-rattachement-et-remboursement.md, decided 2026-11-27).
// The SQL itself was run on a real Postgres (PGlite) while it was written;
// these tests pin the text the database receives and the app-side rules.

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/022_referrals.sql'), 'utf8');
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN = '11111111-2222-4333-8444-555555555555';

const referral = loadTsModule('src/lib/referral.ts');
const policy = loadTsModule('src/lib/billing/policy.ts');

// --- Pure rules --------------------------------------------------------------

test('a code is six characters of the order alphabet, whatever its case and separators', () => {
  assert.equal(referral.normalizeReferralCode('k7f-4qm '), 'K7F4QM');
  assert.equal(referral.normalizeReferralCode('K7F4QM'), 'K7F4QM');
  for (const bad of ['K7F4Q', 'K7F4QMX', 'K0F4QM', 'KIF4QM', 'KLF4QM', '', null, 42]) {
    assert.equal(referral.normalizeReferralCode(bad), null, String(bad));
  }
});

test('the referral cookie is written, read and cleared', () => {
  assert.equal(referral.referralCookie('K7F4QM', true), 'qatlia-ref=K7F4QM; Path=/; Max-Age=2592000; SameSite=Lax; Secure');
  assert.equal(referral.readReferralCookie('a=1; qatlia-ref=K7F4QM; b=2'), 'K7F4QM');
  assert.equal(referral.readReferralCookie('qatlia-ref=<script>'), null);
  assert.equal(referral.readReferralCookie(null), null);
  assert.match(referral.clearReferralCookie(false), /^qatlia-ref=; Path=\/; Max-Age=0; SameSite=Lax$/);
});

test('a parrain sees a first name, a business name or a masked email, never the full email', () => {
  assert.equal(referral.refereeDisplayName({ fullName: '  Ahmed Benali ', email: 'ahmed@gmail.com' }), 'Ahmed');
  assert.equal(referral.refereeDisplayName({ fullName: '', atelierName: 'Menuiserie Atlas', email: 'x@y.ma' }), 'Menuiserie Atlas');
  assert.equal(referral.refereeDisplayName({ email: 'ahmed@gmail.com' }), 'a***@gmail.com');
  assert.equal(referral.refereeDisplayName({}), null);
});

test('a final attach answer forgets the kept code; a missing profile or an unknown failure keeps it', () => {
  assert.equal(referral.isFinalAttachAnswer({ success: true }), true);
  for (const error of ['INVALID_CODE', 'OWN_CODE', 'ALREADY_ATTACHED', 'ALREADY_PURCHASED', 'CIRCULAR']) {
    assert.equal(referral.isFinalAttachAnswer({ success: false, error }), true, error);
  }
  assert.equal(referral.isFinalAttachAnswer({ success: false, error: 'PROFILE_NOT_FOUND' }), false);
  assert.equal(referral.isFinalAttachAnswer({ success: false, error: 'WHATEVER' }), false);
});

test('the banner announces each bonus once', () => {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v) };
  const rewards = [
    { id: '1', credits: 8, name: 'Ahmed', createdAt: '2026-11-20T10:00:00Z' },
    { id: '2', credits: 20, name: 'Youssef', createdAt: '2026-11-25T10:00:00Z' },
  ];
  assert.deepEqual(referral.unseenRewards(rewards, storage).map((r) => r.id), ['2', '1']);
  referral.markRewardsSeen(rewards, storage);
  assert.deepEqual(referral.unseenRewards(rewards, storage), []);
  const later = [...rewards, { id: '3', credits: 3, name: null, createdAt: '2026-11-26T10:00:00Z' }];
  assert.deepEqual(referral.unseenRewards(later, storage).map((r) => r.id), ['3']);
});

test('the bonus is 10 % of the pack credits, rounded down, and the SQL states the same share', () => {
  assert.equal(policy.REFERRAL_BONUS_PERCENT, 10);
  assert.deepEqual([30, 80, 200, 400].map(policy.referralBonus), [3, 8, 20, 40]);
  assert.equal(policy.referralBonus(35), 3);
  assert.equal(policy.referralBonus(5), 0);
  assert.ok(
    MIGRATION.includes(`v_bonus := (p_credits * ${policy.REFERRAL_BONUS_PERCENT}) / 100;`),
    'add_credits must compute the bonus with REFERRAL_BONUS_PERCENT'
  );
});

// --- The migration's text ----------------------------------------------------

test('022 runs in one transaction and keeps add_credits exactly as callable as before', () => {
  const statements = splitStatements(MIGRATION);
  assert.equal(statements[0].toUpperCase(), 'BEGIN');
  assert.equal(statements[statements.length - 1].toUpperCase(), 'COMMIT');
  assert.match(MIGRATION, /CREATE OR REPLACE FUNCTION public\.add_credits\(\s*p_user_id\s+UUID,\s*p_credits\s+INT,\s*p_stripe_payment_id TEXT,\s*p_pack_id\s+TEXT DEFAULT 'custom'\s*\)/);
  assert.ok(!/DROP FUNCTION/i.test(MIGRATION), 'nothing is dropped');
  assert.ok(!/DROP TABLE|DROP COLUMN/i.test(MIGRATION));
});

test('only a payment key gives a bonus, and only once the purchase row is new', () => {
  const fn = MIGRATION.slice(MIGRATION.indexOf('FUNCTION public.add_credits('));
  const body = fn.slice(0, fn.indexOf('$$;'));
  const duplicateReturn = body.indexOf("'duplicate', true");
  const bonusGate = body.indexOf("IF p_stripe_payment_id LIKE 'cs:%' OR p_stripe_payment_id LIKE 'creem:%' OR p_stripe_payment_id LIKE 'manual:%' THEN");
  assert.ok(duplicateReturn > 0 && bonusGate > duplicateReturn, 'the replay returns before any bonus');
  // Bonus rows have their own leading prefix, so no 'cs:%' / 'creem:%' / 'manual:%' reader counts them.
  assert.match(body, /'welcome:' \|\| p_stripe_payment_id/);
  assert.match(body, /'referral:' \|\| p_stripe_payment_id/);
  assert.ok(!/'refund'/.test(body.slice(bonusGate)), "a bonus row never carries reason 'refund'");
});

test('the referral tables are closed to clients and the functions run for the service role only', () => {
  for (const table of ['referral_codes', 'referrals', 'referral_rewards']) {
    assert.match(MIGRATION, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
    assert.match(MIGRATION, new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM PUBLIC, anon, authenticated`));
    assert.match(MIGRATION, new RegExp(`GRANT ALL ON public\\.${table}\\s+TO service_role`));
  }
  assert.ok(!/CREATE POLICY/i.test(MIGRATION), 'no client policy');
  for (const signature of ['referral_code_for\\(UUID\\)', 'attach_referral\\(UUID, TEXT\\)', 'add_credits\\(UUID, INT, TEXT, TEXT\\)', 'refund_purchase\\(TEXT\\)']) {
    assert.match(MIGRATION, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}\\s+FROM PUBLIC, anon, authenticated`));
    assert.match(MIGRATION, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}\\s+TO service_role`));
  }
  const definers = MIGRATION.match(/SECURITY DEFINER\s+SET search_path = public, pg_temp/g) || [];
  assert.equal(definers.length, 4);
});

test('a refund stops each balance at zero and records what it really took', () => {
  const fn = MIGRATION.slice(MIGRATION.indexOf('FUNCTION public.refund_purchase('));
  const body = fn.slice(0, fn.indexOf('$$;'));
  assert.match(body, /v_purchase := LEAST\(GREATEST\(v_credits, 0\), v_balance\)/);
  assert.match(body, /v_welcome := LEAST\(v_reward\.credits, v_balance\)/);
  assert.match(body, /v_referral := LEAST\(v_reward\.credits, v_ref_balance\)/);
  assert.match(body, /'purchase_refund:' \|\| p_purchase_key/);
});

// --- Routes ------------------------------------------------------------------

function loadAttach({ user = { id: USER, user_metadata: {} }, result = { status: 'attached', duplicate: false } } = {}) {
  const calls = [];
  stubModule('@/lib/supabase/server', { createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) });
  stubModule('@/lib/referral-server', {
    attachReferral: async (userId, code) => {
      calls.push({ userId, code });
      return typeof result === 'function' ? result(code) : result;
    },
  });
  return { route: loadTsModule('src/app/api/referral/attach/route.ts'), calls };
}

const post = (body, cookie) =>
  new Request('https://qatlia.ma/api/referral/attach', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? '' : JSON.stringify(body),
  });

test('attach: no session is 401 and attaches nothing', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadAttach({ user: null });
  const res = await route.POST(post({ code: 'K7F4QM' }));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('attach: the typed code wins over the cookie, and the session decides who is attached', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadAttach();
  const res = await route.POST(post({ code: 'abc-def', userId: CLIENT }, 'qatlia-ref=K7F4QM'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, duplicate: false });
  assert.deepEqual(calls, [{ userId: USER, code: 'ABCDEF' }]);
  assert.match(res.headers.get('set-cookie') || '', /qatlia-ref=; Path=\/; Max-Age=0/);
});

test('attach: without a body, the cookie code is used, then the sign-up metadata', async (t) => {
  t.after(restoreStubs);
  let { route, calls } = loadAttach();
  await route.POST(post(undefined, 'qatlia-ref=K7F4QM'));
  assert.deepEqual(calls, [{ userId: USER, code: 'K7F4QM' }]);

  ({ route, calls } = loadAttach({ user: { id: USER, user_metadata: { referral_code: 'hjk234' } } }));
  const res = await route.POST(post(undefined));
  assert.deepEqual(calls, [{ userId: USER, code: 'HJK234' }]);
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie to clear');
});

test('attach: a refusal for good clears the cookie; a missing profile keeps it; a missing migration is 503', async (t) => {
  t.after(restoreStubs);
  let { route } = loadAttach({ result: { status: 'refused', error: 'OWN_CODE' } });
  let res = await route.POST(post(undefined, 'qatlia-ref=K7F4QM'));
  assert.deepEqual(await res.json(), { success: false, error: 'OWN_CODE' });
  assert.match(res.headers.get('set-cookie') || '', /Max-Age=0/);

  ({ route } = loadAttach({ result: { status: 'refused', error: 'PROFILE_NOT_FOUND' } }));
  res = await route.POST(post(undefined, 'qatlia-ref=K7F4QM'));
  assert.equal(res.headers.get('set-cookie'), null);

  ({ route } = loadAttach({ result: { status: 'unavailable' } }));
  res = await route.POST(post(undefined, 'qatlia-ref=K7F4QM'));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('attach: a typed value that cannot be a code is refused without a database call', async (t) => {
  t.after(restoreStubs);
  const { route, calls } = loadAttach();
  const res = await route.POST(post({ code: 'nope' }));
  assert.deepEqual(await res.json(), { success: false, error: 'INVALID_CODE' });
  assert.equal(calls.length, 0);
});

test('the referral link keeps a valid code in a cookie and opens the tagged home page', async () => {
  const { GET } = loadTsModule('src/app/(site)/r/[code]/route.ts');
  let res = GET(new Request('https://qatlia.ma/r/k7f4qm'), { params: { code: 'k7f4qm' } });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://qatlia.ma/?utm_source=referral&utm_medium=link');
  assert.match(res.headers.get('set-cookie') || '', /^qatlia-ref=K7F4QM; Path=\/; Max-Age=2592000; SameSite=Lax; Secure$/);

  res = GET(new Request('https://qatlia.ma/r/%3Cx%3E'), { params: { code: '<x>' } });
  assert.equal(res.headers.get('set-cookie'), null);
});

test('the referral page is left for the credits page inside the Play Store app', () => {
  const storeApp = loadTsModule('src/lib/store-app.ts');
  assert.equal(storeApp.storeAppRedirect(referral.REFERRAL_PAGE_PATH), '/account/credits');
});

// --- Server reads ------------------------------------------------------------

test('overview: before migration 022 the feature is unavailable, never an error page', async () => {
  const fake = createFakeSupabase();
  fake.state.rpcResult = () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } });
  stubModule('@/lib/admin/db', { getAdminDb: () => fake.client, isMissingMigration: (e) => !!e && e.code === 'PGRST202' });
  const { readReferralOverview } = loadTsModule('src/lib/referral-server.ts');
  assert.deepEqual(await readReferralOverview(USER, fake.client), { status: 'unavailable' });
  restoreStubs();
});

test('overview: earnings net of refunds, a filleul counts as buyer only for a bonus not refunded', async () => {
  const fake = createFakeSupabase();
  fake.state.rpcResult = () => ({ data: 'K7F4QM', error: null });
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  fake.state.tables = {
    referrals: (call) =>
      call.ops.some(([op, args]) => op === 'eq' && args[0] === 'referrer_id')
        ? [
            { referee_id: B, created_at: '2026-11-20T00:00:00Z' },
            { referee_id: C, created_at: '2026-11-21T00:00:00Z' },
          ]
        : null,
    referral_rewards: [
      { id: 'r1', kind: 'referral', user_id: USER, referee_id: B, credits: 8, reversed_at: null, reversed_credits: null, created_at: '2026-11-22T00:00:00Z' },
      { id: 'r2', kind: 'referral', user_id: USER, referee_id: C, credits: 20, reversed_at: '2026-11-24T00:00:00Z', reversed_credits: 5, created_at: '2026-11-23T00:00:00Z' },
    ],
    credit_transactions: [],
    profiles: [
      { id: B, email: 'youssef@gmail.com', full_name: 'Youssef Alaoui' },
      { id: C, email: 'karim@gmail.com', full_name: null },
    ],
    ateliers: [],
  };
  stubModule('@/lib/admin/db', { getAdminDb: () => fake.client, isMissingMigration: () => false });
  const { readReferralOverview } = loadTsModule('src/lib/referral-server.ts');
  const result = await readReferralOverview(USER, fake.client);
  restoreStubs();

  assert.equal(result.status, 'ok');
  const { overview } = result;
  assert.equal(overview.code, 'K7F4QM');
  assert.equal(overview.totalEarned, 8 + 15);
  assert.deepEqual(
    overview.referees.map((r) => [r.name, r.purchased, r.earned]),
    [
      ['Youssef', true, 8],
      ['k***@gmail.com', false, 15],
    ]
  );
  assert.deepEqual(overview.recentRewards.map((r) => [r.id, r.name]), [['r1', 'Youssef']]);
  assert.equal(overview.hasReferrer, false);
  assert.equal(overview.hasPurchased, false);
});

// --- Admin -------------------------------------------------------------------

function loadAdmin(routePath) {
  const fake = createFakeSupabase();
  const auth = { isAdmin: true };
  stubModule('@/lib/admin/auth', {
    authorizeAdminRequest: async () => {
      if (!auth.isAdmin) {
        const { NextResponse } = require('next/server');
        return { ok: false, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
      }
      return { ok: true, admin: { userId: ADMIN, email: 'owner@qatlia.ma' } };
    },
  });
  stubModule('@/lib/admin/db', {
    getAdminDb: () => fake.client,
    isMissingMigration: (e) => !!e && ['PGRST202', 'PGRST205'].includes(e.code),
  });
  return { route: loadTsModule(routePath), fake, auth };
}

const refundReq = (body) =>
  new Request(`https://qatlia.ma/api/admin/clients/${CLIENT}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = { params: { id: CLIENT } };
const PURCHASE = { id: 't1', type: 'purchase', amount: 80, balance_after: 100, description: 'Achat pack crédits', reason: 'standard', stripe_payment_id: 'creem:ord1', created_at: '2026-11-20T00:00:00Z' };

test('admin refund: admins only, a reason required, and only a payment of this client', async (t) => {
  t.after(restoreStubs);
  let { route, fake, auth } = loadAdmin('src/app/api/admin/clients/[id]/refund/route.ts');
  auth.isAdmin = false;
  assert.equal((await route.POST(refundReq({ purchaseKey: 'creem:ord1', reason: 'Client mécontent' }), ctx)).status, 401);
  auth.isAdmin = true;
  assert.equal((await route.POST(refundReq({ purchaseKey: 'creem:ord1' }), ctx)).status, 400);

  fake.state.tables.credit_transactions = null;
  assert.equal((await route.POST(refundReq({ purchaseKey: 'creem:ord1', reason: 'Client mécontent' }), ctx)).status, 404);

  fake.state.tables.credit_transactions = { ...PURCHASE, type: 'bonus', reason: 'referral', stripe_payment_id: 'referral:creem:ord1' };
  assert.equal((await route.POST(refundReq({ purchaseKey: 'referral:creem:ord1', reason: 'Client mécontent' }), ctx)).status, 404);
  assert.equal(fake.state.rpcCalls.length, 0);
});

test('admin refund: calls refund_purchase and logs what was taken back; a replay logs nothing', async (t) => {
  t.after(restoreStubs);
  const { route, fake } = loadAdmin('src/app/api/admin/clients/[id]/refund/route.ts');
  fake.state.tables.credit_transactions = PURCHASE;
  fake.state.rpcResult = () => ({ data: { success: true, duplicate: false, balance: 12, removed_purchase: 80, removed_welcome: 8, removed_referral: 3 }, error: null });
  const res = await route.POST(refundReq({ purchaseKey: 'creem:ord1', reason: 'Client mécontent' }), ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, duplicate: false, balance: 12, removedPurchase: 80, removedWelcome: 8, removedReferral: 3 });
  assert.deepEqual(fake.state.rpcCalls[0], { name: 'refund_purchase', args: { p_purchase_key: 'creem:ord1' } });
  const audit = fake.ops('admin_audit_log', 'insert').map(([row]) => row);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'purchase_refunded');
  assert.equal(audit[0].details.removed_referral, 3);

  fake.state.rpcResult = () => ({ data: { success: true, duplicate: true, balance: 12 }, error: null });
  await route.POST(refundReq({ purchaseKey: 'creem:ord1', reason: 'Client mécontent' }), ctx);
  assert.equal(fake.ops('admin_audit_log', 'insert').length, 1);
});

test('admin detach: removes the parrain and keeps them in the audit log', async (t) => {
  t.after(restoreStubs);
  const { route, fake } = loadAdmin('src/app/api/admin/clients/[id]/referral/route.ts');
  const req = () => new Request(`https://qatlia.ma/api/admin/clients/${CLIENT}/referral`, { method: 'DELETE' });

  fake.state.tables.referrals = [];
  assert.equal((await route.DELETE(req(), ctx)).status, 404);

  fake.state.tables.referrals = [{ referrer_id: USER }];
  const res = await route.DELETE(req(), ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(fake.ops('referrals', 'delete').length, 2);
  const audit = fake.ops('admin_audit_log', 'insert').map(([row]) => row);
  assert.deepEqual(audit.map((row) => [row.action, row.details.referrer_id]), [['referral_detached', USER]]);
});
