const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(PROJECT_ROOT, rel));

const {
  WhatsAppTablesMissingError,
  upsertContact,
  claimInbound,
  recordOutbound,
  updateContact,
  recentHistory,
  countAssistantReplies,
  countBotMessages,
  claimGreeting,
  releaseGreeting,
} = load('src/lib/whatsapp/store.ts');
const { sendText, sendButtons } = load('src/lib/whatsapp/send.ts');

// Failure paths log with the [whatsapp] prefix; capture them to assert on
// what is (not) logged and keep the test output quiet.
const errorLog = mock.method(console, 'error', () => {});
test.beforeEach(() => errorLog.mock.resetCalls());

// Chainable stand-in for the Supabase query builder. Every query is recorded
// as { table, op, payload, options, columns, filters, orders, limit, single }
// and answered by `respond(query)` with { data, error, count }. Awaiting the
// builder (or calling single/maybeSingle) runs the query.
function fakeDb(respond) {
  const queries = [];
  const db = {
    queries,
    from(table) {
      const query = { table, op: 'select', payload: null, options: null, columns: null, filters: [], orders: [], limit: null, single: null };
      const builder = {
        select(columns, options) {
          // After insert/update, select() only picks the returned columns.
          if (query.columns === null) query.columns = columns;
          query.options = options || null;
          return builder;
        },
        insert(payload) { query.op = 'insert'; query.payload = payload; return builder; },
        update(payload) { query.op = 'update'; query.payload = payload; return builder; },
        eq(column, value) { query.filters.push(['eq', column, value]); return builder; },
        is(column, value) { query.filters.push(['is', column, value]); return builder; },
        neq(column, value) { query.filters.push(['neq', column, value]); return builder; },
        gte(column, value) { query.filters.push(['gte', column, value]); return builder; },
        order(column, options) { query.orders.push([column, options]); return builder; },
        limit(n) { query.limit = n; return builder; },
        maybeSingle() { query.single = 'maybe'; return builder; },
        single() { query.single = 'one'; return builder; },
        then(resolve, reject) {
          queries.push(query);
          return Promise.resolve(respond(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return db;
}

const ok = (data = null, extra = {}) => ({ data, error: null, ...extra });
const fail = (code, message = 'boom') => ({ data: null, error: { code, message } });

const CONTACT_ROW = {
  wa_id: '212600000000',
  profile_name: 'Karim',
  lang: 'ar',
  greeted_at: '2026-11-10T09:00:00.000Z',
  handoff_until: '2026-11-13T09:00:00.000Z',
  referral: { source_id: 'ad-1' },
};

// --- claimInbound ----------------------------------------------------------

test('claimInbound inserts the inbound row and returns true', async () => {
  const db = fakeDb(() => ok());
  const claimed = await claimInbound(db, { wamid: 'wamid.A', waId: '212600000000', kind: 'text', body: 'salam' });
  assert.equal(claimed, true);
  assert.equal(db.queries[0].table, 'whatsapp_messages');
  assert.equal(db.queries[0].op, 'insert');
  assert.deepEqual(db.queries[0].payload, {
    wamid: 'wamid.A',
    wa_id: '212600000000',
    direction: 'user',
    kind: 'text',
    body: 'salam',
  });
});

test('claimInbound returns false on a unique violation (Meta redelivery)', async () => {
  const db = fakeDb(() => fail('23505'));
  assert.equal(await claimInbound(db, { wamid: 'wamid.A', waId: '1', kind: 'text', body: null }), false);
});

test('claimInbound rejects with WhatsAppTablesMissingError for PGRST205 and 42P01', async () => {
  for (const code of ['PGRST205', '42P01']) {
    const db = fakeDb(() => fail(code));
    await assert.rejects(
      claimInbound(db, { wamid: 'wamid.A', waId: '1', kind: 'text', body: null }),
      WhatsAppTablesMissingError,
    );
  }
});

test('claimInbound rethrows other database errors', async () => {
  const db = fakeDb(() => fail('XX000', 'disk full'));
  await assert.rejects(
    claimInbound(db, { wamid: 'wamid.A', waId: '1', kind: 'text', body: null }),
    (err) => err instanceof Error && !(err instanceof WhatsAppTablesMissingError) && /disk full/.test(err.message),
  );
});

// --- upsertContact ---------------------------------------------------------

test('upsertContact creates an absent contact with name and referral, and maps the row', async () => {
  const db = fakeDb((q) => {
    if (q.op === 'select') return ok(null);
    return ok({ ...CONTACT_ROW, lang: 'fr', greeted_at: null, handoff_until: null });
  });
  const state = await upsertContact(db, { waId: '212600000000', profileName: 'Karim', referral: { source_id: 'ad-1' } });
  const insert = db.queries.find((q) => q.op === 'insert');
  assert.equal(insert.table, 'whatsapp_contacts');
  assert.deepEqual(insert.payload, { wa_id: '212600000000', profile_name: 'Karim', referral: { source_id: 'ad-1' } });
  assert.deepEqual(state, { waId: '212600000000', lang: 'fr', greetedAt: null, handoffUntil: null, fromAd: true });
});

test('upsertContact on an existing contact never sends greeted_at, handoff_until or referral', async () => {
  const db = fakeDb((q) => (q.op === 'select' ? ok(CONTACT_ROW) : ok()));
  const state = await upsertContact(db, {
    waId: '212600000000',
    profileName: 'Karim B.',
    referral: { source_id: 'ad-2' },
  });
  assert.equal(db.queries.filter((q) => q.op === 'insert').length, 0);
  const update = db.queries.find((q) => q.op === 'update');
  assert.ok(update, 'the changed profile name is written');
  assert.deepEqual(Object.keys(update.payload).sort(), ['profile_name', 'updated_at']);
  assert.equal(update.payload.profile_name, 'Karim B.');
  assert.deepEqual(update.filters, [['eq', 'wa_id', '212600000000']]);
  assert.deepEqual(state, {
    waId: '212600000000',
    lang: 'ar',
    greetedAt: new Date('2026-11-10T09:00:00.000Z'),
    handoffUntil: new Date('2026-11-13T09:00:00.000Z'),
    fromAd: true,
  });
});

test('upsertContact reports fromAd from the stored referral or from the current event, without leaking the referral', async () => {
  const noReferral = { ...CONTACT_ROW, referral: null };
  // Stored referral, none on this event.
  let db = fakeDb(() => ok(CONTACT_ROW));
  let state = await upsertContact(db, { waId: '212600000000', profileName: null, referral: null });
  assert.equal(state.fromAd, true);
  // No stored referral, but this very first ad message carries one (the row returned is the pre-patch row).
  db = fakeDb((q) => (q.op === 'select' ? ok(noReferral) : ok()));
  state = await upsertContact(db, { waId: '212600000000', profileName: null, referral: { source_id: 'ad-2' } });
  assert.equal(state.fromAd, true);
  assert.ok(!('referral' in state));
  // Neither.
  db = fakeDb(() => ok(noReferral));
  state = await upsertContact(db, { waId: '212600000000', profileName: null, referral: null });
  assert.equal(state.fromAd, false);
  // New contact created without referral.
  db = fakeDb((q) => (q.op === 'select' && q.single === 'maybe' ? ok(null) : ok(noReferral)));
  state = await upsertContact(db, { waId: '212600000000', profileName: null, referral: null });
  assert.equal(state.fromAd, false);
});

test('upsertContact writes nothing when the existing contact is unchanged', async () => {
  const db = fakeDb(() => ok(CONTACT_ROW));
  await upsertContact(db, { waId: '212600000000', profileName: 'Karim', referral: { source_id: 'ad-2' } });
  await upsertContact(db, { waId: '212600000000', profileName: null, referral: null });
  assert.equal(db.queries.filter((q) => q.op !== 'select').length, 0);
});

test('upsertContact fills a missing referral but keeps a stored name when none is given', async () => {
  const db = fakeDb((q) => (q.op === 'select' ? ok({ ...CONTACT_ROW, referral: null }) : ok()));
  await upsertContact(db, { waId: '212600000000', profileName: null, referral: { source_id: 'ad-2' } });
  const update = db.queries.find((q) => q.op === 'update');
  assert.deepEqual(Object.keys(update.payload).sort(), ['referral', 'updated_at']);
  assert.deepEqual(update.payload.referral, { source_id: 'ad-2' });
});

test('upsertContact re-selects when a concurrent insert wins the race (23505)', async () => {
  let selects = 0;
  const db = fakeDb((q) => {
    if (q.op === 'select') return ok(++selects === 1 ? null : CONTACT_ROW);
    if (q.op === 'insert') return fail('23505');
    return ok();
  });
  const state = await upsertContact(db, { waId: '212600000000', profileName: 'Karim', referral: null });
  assert.equal(selects, 2);
  assert.equal(state.waId, '212600000000');
  assert.equal(state.lang, 'ar');
});

test('upsertContact rejects with WhatsAppTablesMissingError when the tables are absent', async () => {
  const db = fakeDb(() => fail('PGRST205'));
  await assert.rejects(
    upsertContact(db, { waId: '1', profileName: null, referral: null }),
    WhatsAppTablesMissingError,
  );
});

// --- recordOutbound / updateContact ---------------------------------------

test('recordOutbound inserts the outbound row, with a null wamid allowed', async () => {
  const db = fakeDb(() => ok());
  await recordOutbound(db, { waId: '1', wamid: null, direction: 'bot', kind: 'assistant', body: 'Bonjour' });
  assert.deepEqual(db.queries[0].payload, { wamid: null, wa_id: '1', direction: 'bot', kind: 'assistant', body: 'Bonjour' });
});

test('recordOutbound rejects with WhatsAppTablesMissingError when the tables are absent', async () => {
  const db = fakeDb(() => fail('42P01'));
  await assert.rejects(
    recordOutbound(db, { waId: '1', wamid: 'w', direction: 'human', kind: 'text', body: 'x' }),
    WhatsAppTablesMissingError,
  );
});

test('recordOutbound returns true when a row was inserted', async () => {
  const db = fakeDb(() => ok());
  assert.equal(await recordOutbound(db, { waId: '1', wamid: 'w', direction: 'bot', kind: 'fixed', body: 'x' }), true);
});

test('recordOutbound treats an already stored wamid (23505) as done and returns false', async () => {
  const db = fakeDb(() => fail('23505'));
  assert.equal(await recordOutbound(db, { waId: '1', wamid: 'w', direction: 'human', kind: 'text', body: 'x' }), false);
});

// --- claimGreeting / releaseGreeting ---------------------------------------

test('claimGreeting conditionally sets greeted_at and reports whether this call won', async () => {
  const at = new Date('2026-11-12T10:00:00.000Z');
  let db = fakeDb(() => ok([{ wa_id: '1' }]));
  assert.equal(await claimGreeting(db, '1', at), true);
  const q = db.queries[0];
  assert.equal(q.table, 'whatsapp_contacts');
  assert.equal(q.op, 'update');
  assert.deepEqual(Object.keys(q.payload).sort(), ['greeted_at', 'updated_at']);
  assert.equal(q.payload.greeted_at, '2026-11-12T10:00:00.000Z');
  assert.deepEqual(q.filters, [
    ['eq', 'wa_id', '1'],
    ['is', 'greeted_at', null],
  ]);

  db = fakeDb(() => ok([]));
  assert.equal(await claimGreeting(db, '1', at), false);
});

test('claimGreeting rejects with WhatsAppTablesMissingError and rethrows other errors', async () => {
  const at = new Date();
  await assert.rejects(claimGreeting(fakeDb(() => fail('PGRST205')), '1', at), WhatsAppTablesMissingError);
  await assert.rejects(claimGreeting(fakeDb(() => fail('XX000', 'disk full')), '1', at), /disk full/);
});

test('releaseGreeting clears greeted_at only when it still holds the given instant', async () => {
  const db = fakeDb(() => ok());
  await releaseGreeting(db, '1', new Date('2026-11-12T10:00:00.000Z'));
  const q = db.queries[0];
  assert.equal(q.op, 'update');
  assert.equal(q.payload.greeted_at, null);
  assert.ok(typeof q.payload.updated_at === 'string');
  assert.deepEqual(q.filters, [
    ['eq', 'wa_id', '1'],
    ['eq', 'greeted_at', '2026-11-12T10:00:00.000Z'],
  ]);
  await assert.rejects(releaseGreeting(fakeDb(() => fail('XX000', 'disk full')), '1', new Date()), /disk full/);
});

test('updateContact maps the patch to columns, stamps updated_at, and can clear handoffUntil', async () => {
  const db = fakeDb(() => ok());
  const greetedAt = new Date('2026-11-12T10:00:00.000Z');
  await updateContact(db, '1', { lang: 'ar', greetedAt, handoffUntil: null });
  const q = db.queries[0];
  assert.equal(q.table, 'whatsapp_contacts');
  assert.equal(q.op, 'update');
  assert.equal(q.payload.lang, 'ar');
  assert.equal(q.payload.greeted_at, '2026-11-12T10:00:00.000Z');
  assert.equal(q.payload.handoff_until, null);
  assert.ok(!Number.isNaN(Date.parse(q.payload.updated_at)));
  assert.deepEqual(q.filters, [['eq', 'wa_id', '1']]);
});

test('updateContact only sends the fields it was given, and nothing for an empty patch', async () => {
  const db = fakeDb(() => ok());
  await updateContact(db, '1', { handoffUntil: new Date('2026-11-13T00:00:00.000Z') });
  assert.deepEqual(Object.keys(db.queries[0].payload).sort(), ['handoff_until', 'updated_at']);
  await updateContact(db, '1', {});
  assert.equal(db.queries.length, 1);
});

// --- recentHistory ---------------------------------------------------------

test('recentHistory returns the last rows in chronological order, without the current message', async () => {
  // Newest first, as the database returns them.
  const rows = [
    { direction: 'user', body: 'current', wamid: 'wamid.NOW' },
    { direction: 'bot', body: 'second', wamid: null },
    { direction: 'user', body: 'first', wamid: 'wamid.OLD' },
  ];
  const db = fakeDb(() => ok(rows));
  const history = await recentHistory(db, '1', 2, 'wamid.NOW');
  assert.deepEqual(history, [
    { direction: 'user', body: 'first' },
    { direction: 'bot', body: 'second' },
  ]);
  const q = db.queries[0];
  assert.equal(q.table, 'whatsapp_messages');
  assert.deepEqual(q.filters, [['eq', 'wa_id', '1']]);
  assert.equal(q.orders[0][0], 'created_at');
  assert.equal(q.orders[0][1].ascending, false);
  assert.ok(q.limit >= 2);
});

test('recentHistory keeps bot rows whose wamid is null and skips rows without text', async () => {
  const rows = [
    { direction: 'bot', body: 'sent but not acknowledged', wamid: null },
    { direction: 'user', body: null, wamid: 'wamid.IMG' },
    { direction: 'user', body: 'hello', wamid: 'wamid.B' },
  ];
  const db = fakeDb(() => ok(rows));
  const history = await recentHistory(db, '1', 10);
  assert.deepEqual(history, [
    { direction: 'user', body: 'hello' },
    { direction: 'bot', body: 'sent but not acknowledged' },
  ]);
});

// --- countAssistantReplies -------------------------------------------------

test('countAssistantReplies counts bot assistant rows since the given instant', async () => {
  const db = fakeDb(() => ok(null, { count: 7 }));
  const since = new Date('2026-11-11T12:00:00.000Z');
  assert.equal(await countAssistantReplies(db, '1', since), 7);
  const q = db.queries[0];
  assert.equal(q.table, 'whatsapp_messages');
  assert.deepEqual(q.filters, [
    ['eq', 'wa_id', '1'],
    ['eq', 'direction', 'bot'],
    ['eq', 'kind', 'assistant'],
    ['gte', 'created_at', '2026-11-11T12:00:00.000Z'],
  ]);
  assert.deepEqual(q.options, { count: 'exact', head: true });
});

test('countAssistantReplies treats a missing count as zero', async () => {
  const db = fakeDb(() => ok(null, { count: null }));
  assert.equal(await countAssistantReplies(db, '1', new Date()), 0);
});

test('countBotMessages counts bot rows of the given kind since the given instant', async () => {
  const db = fakeDb(() => ok(null, { count: 2 }));
  const since = new Date('2026-11-12T10:00:00.000Z');
  assert.equal(await countBotMessages(db, '1', 'image_hint', since), 2);
  assert.deepEqual(db.queries[0].filters, [
    ['eq', 'wa_id', '1'],
    ['eq', 'direction', 'bot'],
    ['eq', 'kind', 'image_hint'],
    ['gte', 'created_at', '2026-11-12T10:00:00.000Z'],
  ]);
  assert.deepEqual(db.queries[0].options, { count: 'exact', head: true });
  assert.equal(await countBotMessages(fakeDb(() => ok(null, { count: null })), '1', 'image_hint', since), 0);
});

// --- sendText --------------------------------------------------------------

const CONFIG = {
  appSecret: 's',
  verifyToken: 'v',
  accessToken: 'SECRET-TOKEN-123',
  phoneNumberId: 'PNID',
  graphVersion: 'v23.0',
  enabled: true,
  handoffMode: 'coexistence',
  scope: 'ads',
  model: 'm',
  openrouterKey: null,
  ycloud: null,
};

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return respond();
  };
  impl.calls = calls;
  return impl;
}

test('sendText posts the text message to the Graph API and returns the message id', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }));
  const id = await sendText(CONFIG, '212600000000', 'Bonjour https://qatlia.ma', fetchImpl);
  assert.equal(id, 'wamid.X');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://graph.facebook.com/v23.0/PNID/messages');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer SECRET-TOKEN-123');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(call.body, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '212600000000',
    type: 'text',
    text: { body: 'Bonjour https://qatlia.ma', preview_url: true },
  });
});

test('sendText returns null on a non-2xx answer and never logs the token or the response body', async () => {
  const fetchImpl = fakeFetch(
    () => new Response(JSON.stringify({ error: { message: 'Bearer SECRET-TOKEN-123 invalid' } }), { status: 401 }),
  );
  assert.equal(await sendText(CONFIG, '1', 'hi', fetchImpl), null);
  assert.equal(errorLog.mock.callCount(), 1);
  const logged = errorLog.mock.calls[0].arguments.map(String).join(' ');
  assert.match(logged, /\[whatsapp\] send failed/);
  assert.match(logged, /401/);
  assert.ok(!logged.includes('SECRET-TOKEN-123'));
  assert.ok(!logged.includes('invalid'));
});

test('sendText returns null on a network error without throwing or leaking the token', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed for Bearer SECRET-TOKEN-123');
  };
  assert.equal(await sendText(CONFIG, '1', 'hi', fetchImpl), null);
  const logged = errorLog.mock.calls[0].arguments.map(String).join(' ');
  assert.match(logged, /\[whatsapp\] send failed/);
  assert.match(logged, /TypeError/);
  assert.ok(!logged.includes('SECRET-TOKEN-123'));
});

test('sendText returns null when a 200 answer carries no message id', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
  assert.equal(await sendText(CONFIG, '1', 'hi', fetchImpl), null);
  assert.equal(errorLog.mock.callCount(), 1);
});

// --- sendText through YCloud -------------------------------------------------
// The bot's number was onboarded through YCloud, and Meta only lets YCloud send
// from it: when YCloud is configured, replies go through its API.

const YCLOUD_CONFIG = { ...CONFIG, ycloud: { apiKey: 'YC-SECRET-KEY', from: '+212726263686' } };

test('with YCloud configured, sendText posts to YCloud and returns the WhatsApp message id', async () => {
  const fetchImpl = fakeFetch(
    () => new Response(JSON.stringify({ id: 'yc1', wamid: 'wamid.Y', status: 'accepted' }), { status: 200 }),
  );
  const id = await sendText(YCLOUD_CONFIG, '212600000000', 'Bonjour https://qatlia.ma', fetchImpl);
  assert.equal(id, 'wamid.Y');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-API-Key'], 'YC-SECRET-KEY');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.headers.Authorization, undefined);
  assert.deepEqual(call.body, {
    from: '+212726263686',
    to: '+212600000000',
    type: 'text',
    text: { body: 'Bonjour https://qatlia.ma', previewUrl: true },
  });
});

test('with YCloud, an accepted reply without wamid falls back to the YCloud id', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ id: 'yc1', status: 'accepted' }), { status: 200 }));
  assert.equal(await sendText(YCLOUD_CONFIG, '1', 'hi', fetchImpl), 'ycloud:yc1');
});

test('with YCloud, a failed status returns null and logs the error code but never the key', async () => {
  const fetchImpl = fakeFetch(
    () =>
      new Response(
        JSON.stringify({ id: 'yc1', status: 'failed', errorCode: '131047', errorMessage: 'key YC-SECRET-KEY window' }),
        { status: 200 },
      ),
  );
  assert.equal(await sendText(YCLOUD_CONFIG, '1', 'hi', fetchImpl), null);
  assert.equal(errorLog.mock.callCount(), 1);
  const logged = errorLog.mock.calls[0].arguments.map(String).join(' ');
  assert.match(logged, /\[whatsapp\] send failed/);
  assert.match(logged, /131047/);
  assert.ok(!logged.includes('YC-SECRET-KEY'));
});

test('with YCloud, a non-2xx answer returns null without logging the key or the response body', async () => {
  const fetchImpl = fakeFetch(
    () => new Response(JSON.stringify({ message: 'bad key YC-SECRET-KEY' }), { status: 401 }),
  );
  assert.equal(await sendText(YCLOUD_CONFIG, '1', 'hi', fetchImpl), null);
  const logged = errorLog.mock.calls[0].arguments.map(String).join(' ');
  assert.match(logged, /401/);
  assert.ok(!logged.includes('YC-SECRET-KEY'));
  assert.ok(!logged.includes('bad key'));
});

test('with YCloud, a network error returns null without throwing', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed YC-SECRET-KEY');
  };
  assert.equal(await sendText(YCLOUD_CONFIG, '1', 'hi', fetchImpl), null);
  const logged = errorLog.mock.calls[0].arguments.map(String).join(' ');
  assert.match(logged, /TypeError/);
  assert.ok(!logged.includes('YC-SECRET-KEY'));
});

test('with YCloud, a recipient already in E.164 is not given a second plus', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ id: 'yc1', wamid: 'w' }), { status: 200 }));
  await sendText(YCLOUD_CONFIG, '+212600000000', 'hi', fetchImpl);
  assert.equal(fetchImpl.calls[0].body.to, '+212600000000');
});

// --- sendButtons -------------------------------------------------------------

const BUTTONS = [
  { id: '1', title: 'Démo' },
  { id: '2', title: 'Tarifs' },
];
const INTERACTIVE = {
  type: 'interactive',
  interactive: {
    type: 'button',
    body: { text: 'Bonjour' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: '1', title: 'Démo' } },
        { type: 'reply', reply: { id: '2', title: 'Tarifs' } },
      ],
    },
  },
};

test('sendButtons posts an interactive reply-button message to the Graph API', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ messages: [{ id: 'wamid.B' }] }), { status: 200 }));
  assert.equal(await sendButtons(CONFIG, '212600000000', 'Bonjour', BUTTONS, fetchImpl), 'wamid.B');
  assert.deepEqual(fetchImpl.calls[0].body, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '212600000000',
    ...INTERACTIVE,
  });
});

test('with YCloud, sendButtons posts the interactive message to YCloud', async () => {
  const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ id: 'yc2', wamid: 'wamid.YB' }), { status: 200 }));
  assert.equal(await sendButtons(YCLOUD_CONFIG, '212600000000', 'Bonjour', BUTTONS, fetchImpl), 'wamid.YB');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  assert.deepEqual(call.body, { from: '+212726263686', to: '+212600000000', ...INTERACTIVE });
});

test('sendButtons returns null when the provider refuses the message', async () => {
  const fetchImpl = fakeFetch(() => new Response('{}', { status: 400 }));
  assert.equal(await sendButtons(YCLOUD_CONFIG, '1', 'Bonjour', BUTTONS, fetchImpl), null);
});

// --- failed sends --------------------------------------------------------------

test('recentHistory leaves out the sends that failed', async () => {
  const rows = [
    { direction: 'bot', body: 'never received', wamid: null, kind: 'send_failed' },
    { direction: 'bot', body: 'received', wamid: 'wamid.R', kind: 'fixed' },
    { direction: 'user', body: 'hello', wamid: 'wamid.B', kind: 'text' },
  ];
  const db = fakeDb(() => ok(rows));
  assert.deepEqual(await recentHistory(db, '1', 10), [
    { direction: 'user', body: 'hello' },
    { direction: 'bot', body: 'received' },
  ]);
  assert.match(db.queries[0].columns, /\bkind\b/);
});

// --- one retry -----------------------------------------------------------------

function sequenceFetch(responders) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const respond = responders[Math.min(calls.length, responders.length) - 1];
    return respond();
  };
  impl.calls = calls;
  return impl;
}
const okMeta = () => new Response(JSON.stringify({ messages: [{ id: 'wamid.RETRY' }] }), { status: 200 });

test('a send the provider answered 5xx or 429 is tried once more', async () => {
  for (const status of [503, 429]) {
    const fetchImpl = sequenceFetch([() => new Response('{}', { status }), okMeta]);
    assert.equal(await sendText(CONFIG, '1', 'hi', fetchImpl), 'wamid.RETRY', String(status));
    assert.equal(fetchImpl.calls.length, 2);
  }
});

test('a connection failure is tried once more, and gives up after the second failure', async () => {
  const fetchImpl = sequenceFetch([
    () => {
      throw new TypeError('fetch failed');
    },
  ]);
  assert.equal(await sendText(YCLOUD_CONFIG, '1', 'hi', fetchImpl), null);
  assert.equal(fetchImpl.calls.length, 2);
});

test('a refused message, a provider failure or a timeout is not sent twice', async () => {
  const timeout = () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  const failedStatus = () => new Response(JSON.stringify({ id: 'yc', status: 'failed', errorCode: '131047' }), { status: 200 });
  for (const [config, respond] of [
    [CONFIG, () => new Response('{}', { status: 400 })],
    [YCLOUD_CONFIG, failedStatus],
    [YCLOUD_CONFIG, timeout],
  ]) {
    const fetchImpl = sequenceFetch([respond, okMeta]);
    assert.equal(await sendText(config, '1', 'hi', fetchImpl), null);
    assert.equal(fetchImpl.calls.length, 1);
  }
});
