const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// The photo reads table (migration 019): one successful read per WhatsApp
// number, a cap on failures and on the day's reads, links that expire.
// The fake records filters without applying them: each test seeds what each
// query should find, told apart by the operations it recorded.

const store = loadTsModule('src/lib/whatsapp/photo-store.ts');
const { reservePhotoRead, completePhotoRead, failPhotoRead, openPhotoDraft, newPhotoCode } = store;

const WA = '212600000001';
const NOW = new Date('2026-11-19T12:00:00Z');
const MIN = 60 * 1000;
const TABLE = 'whatsapp_photo_reads';

const has = (call, op, ...args) => call.ops.some(([o, a]) => o === op && args.every((arg, i) => JSON.stringify(a[i]) === JSON.stringify(arg)));

/** Seeds the four reservation queries: current read, failures, day's reads, insert. */
function seed(fake, { current = [], failures = [], today = [], inserted = { id: 'r1' } } = {}) {
  fake.state.tables[TABLE] = (call) => {
    if (has(call, 'insert')) return inserted;
    if (has(call, 'update')) return null;
    if (has(call, 'in', 'status', ['reading', 'ok'])) return current;
    if (has(call, 'eq', 'status', 'failed')) return failures;
    return today;
  };
}
const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));
/** The updates other than the purge of expired reads every reservation runs. */
const PURGE = { pieces: null, sheet: null, summary: null };
const updates = (fake) => fake.ops(TABLE, 'update').map(([row]) => row).filter((row) => JSON.stringify(row) !== JSON.stringify(PURGE));
const purges = (fake) => fake.state.fromCalls.filter((c) => has(c, 'update', PURGE));
const inserts = (fake) => fake.ops(TABLE, 'insert').map(([row]) => row);

test('a first photo is reserved as a reading row', async () => {
  const fake = createFakeSupabase();
  seed(fake);
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'reserved', id: 'r1' });
  assert.deepEqual(inserts(fake), [{ wa_id: WA, status: 'reading' }]);
});

test('a cap of 0 turns the feature off without a query', async () => {
  const fake = createFakeSupabase();
  seed(fake);
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 0), { status: 'daily_cap' });
  assert.equal(fake.state.fromCalls.length, 0);
});

test('a number already served gets its code back, or null once expired', async () => {
  const fake = createFakeSupabase();
  seed(fake, { current: [{ id: 'r0', status: 'ok', code: 'abcdefghjk', expires_at: new Date(NOW.getTime() + MIN).toISOString(), created_at: NOW.toISOString() }] });
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'already', code: 'abcdefghjk' });
  seed(fake, { current: [{ id: 'r0', status: 'ok', code: 'abcdefghjk', expires_at: new Date(NOW.getTime() - MIN).toISOString(), created_at: NOW.toISOString() }] });
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'already', code: null });
  assert.equal(inserts(fake).length, 0);
});

test('a read running for less than 2 minutes : busy', async () => {
  const fake = createFakeSupabase();
  seed(fake, { current: [{ id: 'r0', status: 'reading', code: null, expires_at: null, created_at: new Date(NOW.getTime() - MIN).toISOString() }] });
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'busy' });
  assert.equal(inserts(fake).length, 0);
});

test('a read stuck for more than 2 minutes is marked failed, and a new one reserved', async () => {
  const fake = createFakeSupabase();
  seed(fake, { current: [{ id: 'r0', status: 'reading', code: null, expires_at: null, created_at: new Date(NOW.getTime() - 3 * MIN).toISOString() }] });
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'reserved', id: 'r1' });
  assert.deepEqual(updates(fake), [{ status: 'failed' }]);
});

test('3 failures in 24 hours : too_many_failures, nothing inserted', async () => {
  const fake = createFakeSupabase();
  seed(fake, { failures: ids(3) });
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'too_many_failures' });
  assert.equal(inserts(fake).length, 0);
  seed(fake, { failures: ids(2) });
  assert.equal((await reservePhotoRead(fake.client, WA, NOW, 300)).status, 'reserved');
});

test('the day has reached the cap : daily_cap', async () => {
  const fake = createFakeSupabase();
  seed(fake, { today: ids(5) });
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 5), { status: 'daily_cap' });
  seed(fake, { today: ids(4) });
  assert.equal((await reservePhotoRead(fake.client, WA, NOW, 5)).status, 'reserved');
});

test('a concurrent read wins the insert (unique violation) : busy', async () => {
  const fake = createFakeSupabase();
  seed(fake);
  fake.state.tableErrors[TABLE] = (call) => (has(call, 'insert') ? { code: '23505', message: 'duplicate' } : null);
  assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'busy' });
});

test('migration 019 missing : unavailable, never the 016 error', async () => {
  for (const code of ['PGRST205', '42P01']) {
    const fake = createFakeSupabase();
    fake.state.tableErrors[TABLE] = { code, message: 'missing' };
    assert.deepEqual(await reservePhotoRead(fake.client, WA, NOW, 300), { status: 'unavailable' });
  }
});

test('another database error is thrown', async () => {
  const fake = createFakeSupabase();
  fake.state.tableErrors[TABLE] = { code: 'XX000', message: 'down' };
  await assert.rejects(() => reservePhotoRead(fake.client, WA, NOW, 300));
});

test('completing writes ok, the code, the result and a 24-hour expiry', async () => {
  const fake = createFakeSupabase();
  const summary = { pieceCount: 2, lineCount: 1, sheetsUsed: 1, wastePercent: 90, sheet: { height: 278, width: 208 }, unplaced: 0 };
  const pieces = [{ name: '', height: 50, width: 40, quantity: 2 }];
  await completePhotoRead(fake.client, 'r1', { code: 'abcdefghjk', pieces, sheet: null, summary, now: NOW });
  assert.deepEqual(updates(fake), [
    {
      status: 'ok',
      code: 'abcdefghjk',
      pieces,
      sheet: null,
      summary,
      expires_at: new Date(NOW.getTime() + 24 * 60 * MIN).toISOString(),
    },
  ]);
  assert.ok(has(fake.state.fromCalls[0], 'eq', 'id', 'r1'));
});

test('failing marks the row failed', async () => {
  const fake = createFakeSupabase();
  await failPhotoRead(fake.client, 'r1');
  assert.deepEqual(updates(fake), [{ status: 'failed' }]);
  assert.ok(has(fake.state.fromCalls[0], 'eq', 'id', 'r1'));
});

const row = (over = {}) => ({
  id: 'r1',
  pieces: [{ name: '', height: 50, width: 40, quantity: 2 }],
  summary: { sheet: { height: 278, width: 208 } },
  expires_at: new Date(NOW.getTime() + MIN).toISOString(),
  opened_at: null,
  ...over,
});

test('opening a valid link returns the pieces and the panel used, and marks the first opening', async () => {
  const fake = createFakeSupabase();
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row());
  assert.deepEqual(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), {
    pieces: [{ name: '', height: 50, width: 40, quantity: 2 }],
    sheet: { height: 278, width: 208 },
  });
  assert.deepEqual(updates(fake), [{ opened_at: NOW.toISOString() }]);
});

test('a second opening does not touch opened_at', async () => {
  const fake = createFakeSupabase();
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row({ opened_at: NOW.toISOString() }));
  await openPhotoDraft(fake.client, 'abcdefghjk', NOW);
  assert.equal(updates(fake).length, 0);
});

test('an expired link : expired, and its content is purged', async () => {
  const fake = createFakeSupabase();
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row({ expires_at: new Date(NOW.getTime() - MIN).toISOString() }));
  assert.equal(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), 'expired');
  assert.deepEqual(fake.ops(TABLE, 'update').map(([r]) => r), [PURGE]);
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row({ pieces: null, summary: null }));
  assert.equal(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), 'expired');
});

test('an unknown code, or a missing table : null', async () => {
  const fake = createFakeSupabase();
  fake.state.tables[TABLE] = null;
  assert.equal(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), null);
  fake.state.tableErrors[TABLE] = { code: 'PGRST205', message: 'missing' };
  assert.equal(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), null);
});

test('codes are 10 characters of the unambiguous alphabet, and do not repeat', () => {
  const codes = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const code = newPhotoCode();
    assert.match(code, /^[a-km-z2-9]{10}$/);
    assert.ok(!/[lo01]/.test(code));
    codes.add(code);
  }
  assert.equal(codes.size, 1000);
});

test('every reservation purges the content of expired reads, so it does not outlive its 24 hours', async () => {
  const fake = createFakeSupabase();
  seed(fake);
  await reservePhotoRead(fake.client, WA, NOW, 300);
  const [purge] = purges(fake);
  assert.ok(purge, 'a purge update');
  assert.ok(has(purge, 'lt', 'expires_at', NOW.toISOString()));
  assert.ok(has(purge, 'not', 'pieces', 'is', null));
});

test('a failing purge does not block the reservation', async () => {
  const fake = createFakeSupabase();
  seed(fake);
  fake.state.tableErrors[TABLE] = (call) => (has(call, 'update', PURGE) ? { code: 'XX000', message: 'down' } : null);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await reservePhotoRead(fake.client, WA, NOW, 300)).status, 'reserved');
  } finally {
    console.error = original;
  }
});

test('opening without markOpened (a link preview) leaves opened_at alone', async () => {
  const fake = createFakeSupabase();
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row());
  const draft = await openPhotoDraft(fake.client, 'abcdefghjk', NOW, { markOpened: false });
  assert.equal(draft.pieces.length, 1);
  assert.equal(updates(fake).length, 0);
});

test('the 24-hour boundary: a link a minute before its end opens, a minute after it is expired', async () => {
  const fake = createFakeSupabase();
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row({ expires_at: new Date(NOW.getTime() + MIN).toISOString() }));
  assert.notEqual(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), 'expired');
  fake.state.tables[TABLE] = (call) => (has(call, 'update') ? null : row({ expires_at: new Date(NOW.getTime() - MIN).toISOString() }));
  assert.equal(await openPhotoDraft(fake.client, 'abcdefghjk', NOW), 'expired');
  assert.equal(loadTsModule('src/lib/whatsapp/photo-store.ts').PHOTO_READ_TTL_HOURS, 24);
});

// The assistant is told of the sheet a number sent (anas, 21/11/2026): the
// latest read that went through, its piece count, and its code while valid.
test('latestPhotoRead gives the last read sheet of a number: pieces, and the code while the link is valid', async () => {
  const { latestPhotoRead } = store;
  const fake = createFakeSupabase();
  const row = { code: 'abcdefghjk', expires_at: new Date(NOW.getTime() + MIN).toISOString(), summary: { pieceCount: 44 } };
  fake.state.tables[TABLE] = [row];
  assert.deepEqual(await latestPhotoRead(fake.client, WA, NOW), { pieceCount: 44, code: 'abcdefghjk' });
  const call = fake.state.fromCalls[0];
  assert.ok(has(call, 'eq', 'wa_id', WA));
  assert.ok(has(call, 'eq', 'status', 'ok'));

  fake.state.tables[TABLE] = [{ ...row, expires_at: new Date(NOW.getTime() - MIN).toISOString() }];
  assert.deepEqual(await latestPhotoRead(fake.client, WA, NOW), { pieceCount: 44, code: null });

  fake.state.tables[TABLE] = [];
  assert.equal(await latestPhotoRead(fake.client, WA, NOW), null);
});
