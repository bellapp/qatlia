const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Route-level behaviour of the WhatsApp webhook: Meta verification handshake,
// signature check, routing of inbound messages and human-relay on echoes.
// The store, the Graph sender, the assistant and the Supabase client are stubs;
// the config, signature, payload, router and copy modules are the real ones.

const APP_SECRET = 'wa_app_secret_9f3k';
const VERIFY_TOKEN = 'wa_verify_token_7d2';
const PHONE_NUMBER_ID = '1055550001';
const WA_ID = '212600000001';
const WA_ID_2 = '212600000002';

class WhatsAppTablesMissingError extends Error {
  constructor() {
    super('[whatsapp] tables missing');
    this.name = 'WhatsAppTablesMissingError';
  }
}

const state = {};

function resetState() {
  Object.assign(state, {
    contacts: new Map(),
    sent: [],
    sendResult: (n) => (n === 1 ? 'wamid.OUT' : `wamid.OUT.${n}`),
    outbound: [],
    storedWamids: new Set(),
    greetingWon: () => true,
    greetClaims: [],
    greetReleases: [],
    imageHintCount: 0,
    countCalls: [],
    updates: [],
    claims: [],
    claimResult: () => true,
    upsertFailFor: null,
    claimError: null,
    assistantCalls: [],
    assistantResult: () => null,
    assistantCount: 0,
    historyCalls: [],
    clientArgs: null,
  });
}
resetState();

const DB = { __db: true };

stubModule('@supabase/supabase-js', {
  createClient: (...args) => {
    state.clientArgs = args;
    return DB;
  },
});
stubModule('@/lib/whatsapp/store', {
  WhatsAppTablesMissingError,
  upsertContact: async (db, input) => {
    assert.equal(db, DB);
    if (state.upsertFailFor === input.waId) throw new Error('boom');
    if (!state.contacts.has(input.waId)) {
      state.contacts.set(input.waId, { waId: input.waId, lang: 'fr', greetedAt: null, handoffUntil: null });
    }
    // Like the real store: fromAd is true when a referral is stored or this event carries one.
    const stored = state.contacts.get(input.waId);
    const fromAd = stored.fromAd === true || input.referral !== null;
    stored.fromAd = fromAd;
    return { ...stored, fromAd };
  },
  claimInbound: async (db, input) => {
    if (state.claimError) throw state.claimError;
    state.claims.push(input);
    return state.claimResult(input);
  },
  recordOutbound: async (db, input) => {
    if (input.wamid && state.storedWamids.has(input.wamid)) return false;
    if (input.wamid) state.storedWamids.add(input.wamid);
    state.outbound.push(input);
    return true;
  },
  claimGreeting: async (db, waId, at) => {
    state.greetClaims.push({ waId, at });
    const won = state.greetingWon(waId);
    const contact = state.contacts.get(waId);
    if (won && contact) contact.greetedAt = at;
    return won;
  },
  releaseGreeting: async (db, waId, at) => {
    state.greetReleases.push({ waId, at });
    const contact = state.contacts.get(waId);
    if (contact && contact.greetedAt === at) contact.greetedAt = null;
  },
  countBotMessages: async (db, waId, kind, since) => {
    state.countCalls.push({ waId, kind, since });
    return state.imageHintCount;
  },
  updateContact: async (db, waId, patch) => {
    state.updates.push({ waId, patch });
    const contact = state.contacts.get(waId);
    if (contact) Object.assign(contact, patch);
  },
  recentHistory: async (db, waId, limit, excludeWamid) => {
    state.historyCalls.push({ waId, limit, excludeWamid });
    return [{ direction: 'bot', body: 'Bonjour' }];
  },
  countAssistantReplies: async () => state.assistantCount,
});
stubModule('@/lib/whatsapp/send', {
  sendText: async (config, to, body) => {
    state.sent.push({ to, body, config });
    return state.sendResult(state.sent.length);
  },
});
stubModule('@/lib/whatsapp/assistant', {
  HISTORY_MESSAGES: 10,
  askAssistant: async (input) => {
    state.assistantCalls.push(input);
    return state.assistantResult(input);
  },
});

const { COPY } = loadTsModule('src/lib/whatsapp/copy.ts');
const { GET, POST, dynamic, maxDuration } = loadTsModule('src/app/api/whatsapp/webhook/route.ts');

const ENV_KEYS = [
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_GRAPH_VERSION',
  'WHATSAPP_BOT_ENABLED',
  'WHATSAPP_HANDOFF_MODE',
  'WHATSAPP_BOT_SCOPE',
  'WHATSAPP_BOT_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

// Scope 'all' keeps the routing tests independent of the ad gate; the gate has its own tests.
const CONFIGURED = {
  WHATSAPP_BOT_SCOPE: 'all',
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN: 'wa_access_token_5h1',
  WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
  WHATSAPP_BOT_ENABLED: 'true',
  OPENROUTER_API_KEY: 'sk-or-real-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
};

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
  return Promise.resolve().then(fn).finally(restore);
}

const textMessage = (id, from, body) => ({ from, id, type: 'text', text: { body } });

function messagesPayload(messages) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: 'Karim' } })),
              messages,
            },
          },
        ],
      },
    ],
  };
}

const imageMessage = (id, from) => ({ from, id, type: 'image', image: { id: `media-${id}` } });

function echoPayload(to, body, id) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'smb_message_echoes',
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              message_echoes: [{ ...(id ? { id } : {}), to, type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

const sign = (rawBody, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;

function signedPost(payload) {
  // Whitespace on purpose: the signature must be over the exact string sent.
  const rawBody = JSON.stringify(payload, null, 1);
  return new Request('https://qatlia.example/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(rawBody) },
    body: rawBody,
  });
}

function verifyRequest(params) {
  const url = new URL('https://qatlia.example/api/whatsapp/webhook');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

const VERIFY_OK = { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'CHALLENGE' };

/** Runs fn with console.error captured, so expected error logs stay out of the test output. */
async function quietly(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    return await fn(logged);
  } finally {
    console.error = original;
  }
}

const handoffUpdates = () => state.updates.filter((u) => u.patch.handoffUntil !== undefined);

test('the route declares dynamic rendering and a 60 s budget', () => {
  assert.equal(dynamic, 'force-dynamic');
  assert.equal(maxDuration, 60);
});

test('GET answers the Meta handshake with the challenge as text/plain', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const res = await GET(verifyRequest(VERIFY_OK));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'CHALLENGE');
    assert.match(res.headers.get('content-type'), /^text\/plain/);
  });
});

test('GET refuses a wrong verify token or mode with 403', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    assert.equal((await GET(verifyRequest({ ...VERIFY_OK, 'hub.verify_token': 'nope' }))).status, 403);
    assert.equal((await GET(verifyRequest({ ...VERIFY_OK, 'hub.mode': 'unsubscribe' }))).status, 403);
    assert.equal((await GET(verifyRequest({}))).status, 403);
  });
});

test('GET is a 404 when the bot is not configured, and says so in the logs without any value', async () => {
  resetState();
  await quietly(async (logged) => {
    await withEnv({ WHATSAPP_APP_SECRET: 'secret-that-must-not-leak' }, async () => {
      assert.equal((await GET(verifyRequest(VERIFY_OK))).status, 404);
      assert.deepEqual(logged, ['[whatsapp] configuration absente']);
    });
  });
});

test('POST without a signature header is a 401 and sends nothing', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const rawBody = JSON.stringify(messagesPayload([textMessage('wamid.1', WA_ID, 'مرحبا')]));
    const res = await POST(new Request('https://qatlia.example/api/whatsapp/webhook', { method: 'POST', body: rawBody }));
    assert.equal(res.status, 401);
    assert.equal(state.sent.length, 0);
    assert.equal(state.claims.length, 0);
  });
});

test('POST with a signature made for another body or secret is a 401', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const rawBody = JSON.stringify(messagesPayload([textMessage('wamid.1', WA_ID, 'salam')]));
    for (const header of [sign(rawBody + ' '), sign(rawBody, 'other-secret')]) {
      const res = await POST(
        new Request('https://qatlia.example/api/whatsapp/webhook', {
          method: 'POST',
          headers: { 'x-hub-signature-256': header },
          body: rawBody,
        })
      );
      assert.equal(res.status, 401);
    }
    assert.equal(state.sent.length, 0);
  });
});

test('POST is a 200 no-op when the bot is not configured', async () => {
  resetState();
  await quietly(async (logged) => {
    await withEnv({}, async () => {
      const res = await POST(new Request('https://qatlia.example/api/whatsapp/webhook', { method: 'POST', body: '{}' }));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'ok');
      assert.equal(state.sent.length, 0);
      assert.ok(logged.some((line) => line.includes('[whatsapp]')));
    });
  });
});

test('POST with a valid signature but a body that is not JSON is a 200', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const rawBody = 'not json';
    const res = await POST(
      new Request('https://qatlia.example/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': sign(rawBody) },
        body: rawBody,
      })
    );
    assert.equal(res.status, 200);
    assert.equal(state.sent.length, 0);
  });
});

test('a new contact writing in Arabic gets the greeting once and is marked greeted', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const res = await POST(signedPost(messagesPayload([textMessage('wamid.1', WA_ID, 'سلام، بغيت المعلومات')])));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');

    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].to, WA_ID);
    assert.equal(state.sent[0].body, COPY.greeting);
    assert.equal(state.sent[0].config.phoneNumberId, PHONE_NUMBER_ID);

    assert.ok(
      state.updates.find((u) => u.patch.lang === 'ar'),
      'the detected language is saved'
    );
    assert.equal(state.greetClaims.length, 1, 'greeted_at is set by the conditional claim');
    assert.ok(state.contacts.get(WA_ID).greetedAt instanceof Date);
    assert.equal(handoffUpdates().length, 0);

    assert.deepEqual(state.outbound, [
      { waId: WA_ID, wamid: 'wamid.OUT', direction: 'bot', kind: 'fixed', body: COPY.greeting },
    ]);
    assert.equal(state.claims[0].wamid, 'wamid.1');
    assert.deepEqual(state.clientArgs[2], { auth: { persistSession: false, autoRefreshToken: false } });
  });
});

test('a replayed delivery (claimInbound false) sends nothing and still answers 200', async () => {
  resetState();
  state.claimResult = () => false;
  await withEnv(CONFIGURED, async () => {
    const res = await POST(signedPost(messagesPayload([textMessage('wamid.1', WA_ID, 'سلام')])));
    assert.equal(res.status, 200);
    assert.equal(state.sent.length, 0);
    assert.equal(state.outbound.length, 0);
    assert.equal(state.assistantCalls.length, 0);
  });
});

test('an echo opens a human handoff: the next text from that contact gets no reply', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const echoRes = await POST(signedPost(echoPayload(WA_ID, 'Bonjour, je suis Hamid')));
    assert.equal(echoRes.status, 200);
    assert.deepEqual(state.outbound, [
      { waId: WA_ID, wamid: null, direction: 'human', kind: 'echo', body: 'Bonjour, je suis Hamid' },
    ]);
    const handoff = handoffUpdates()[0];
    assert.ok(handoff && handoff.patch.handoffUntil.getTime() > Date.now() + 23 * 3600 * 1000);

    const res = await POST(signedPost(messagesPayload([textMessage('wamid.2', WA_ID, 'combien ça coûte ?')])));
    assert.equal(res.status, 200);
    assert.equal(state.sent.length, 0);
    assert.equal(state.claims.length, 1, 'the message is still recorded');
  });
});

test('an echo in redirect mode is recorded but opens no handoff', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, WHATSAPP_HANDOFF_MODE: 'redirect' }, async () => {
    await POST(signedPost(echoPayload(WA_ID, 'Bonjour')));
    assert.equal(state.outbound.length, 1);
    assert.equal(handoffUpdates().length, 0);
  });
});

test('free text with no assistant answer falls back and hands the chat to a human', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(Date.now() - 1000), handoffUntil: null });
  await withEnv(CONFIGURED, async () => {
    const res = await POST(signedPost(messagesPayload([textMessage('wamid.3', WA_ID, 'Quelle épaisseur de chant ?')])));
    assert.equal(res.status, 200);
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, COPY.fallback.fr);
    assert.ok(handoffUpdates()[0].patch.handoffUntil instanceof Date, 'handoffUntil is set in coexistence mode');
    assert.equal(state.outbound[0].kind, 'fixed');
  });
});

test('free text without an OpenRouter key is treated as an assistant failure', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
  await withEnv({ ...CONFIGURED, OPENROUTER_API_KEY: undefined }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.3', WA_ID, 'Quelle épaisseur de chant ?')])));
    assert.equal(state.assistantCalls.length, 0);
    assert.equal(state.sent[0].body, COPY.fallback.fr);
  });
});

test('free text answered by the assistant is sent and recorded as an assistant reply', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
  state.assistantResult = () => ({ reply: 'Salam', handoff: false });
  await withEnv({ ...CONFIGURED, WHATSAPP_BOT_MODEL: 'test/model' }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.4', WA_ID, 'Vous livrez ?')])));

    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, 'Salam');
    assert.equal(state.outbound[0].kind, 'assistant');
    assert.equal(state.outbound[0].direction, 'bot');
    assert.equal(handoffUpdates().length, 0);

    assert.equal(state.assistantCalls.length, 1);
    assert.equal(state.assistantCalls[0].message, 'Vous livrez ?');
    assert.equal(state.assistantCalls[0].model, 'test/model');
    assert.equal(state.assistantCalls[0].apiKey, 'sk-or-real-key');
    assert.deepEqual(state.assistantCalls[0].history, [{ direction: 'bot', body: 'Bonjour' }]);
    assert.deepEqual(state.historyCalls, [{ waId: WA_ID, limit: 10, excludeWamid: 'wamid.4' }]);
  });
});

test('an assistant reply that asks for a human sets the handoff in coexistence mode', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
  state.assistantResult = () => ({ reply: 'Je passe la main.', handoff: true });
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.5', WA_ID, 'Je veux un devis')])));
    assert.equal(state.sent.length, 1);
    assert.ok(handoffUpdates()[0].patch.handoffUntil instanceof Date);
  });
});

test('in redirect mode an assistant handoff adds the redirect message and no handoffUntil', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
  state.assistantResult = () => ({ reply: 'Je passe la main.', handoff: true });
  await withEnv({ ...CONFIGURED, WHATSAPP_HANDOFF_MODE: 'redirect' }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.6', WA_ID, 'Je veux un devis')])));
    assert.deepEqual(
      state.sent.map((m) => m.body),
      ['Je passe la main.', COPY.redirect.fr]
    );
    assert.deepEqual(
      state.outbound.map((o) => o.kind),
      ['assistant', 'fixed']
    );
    assert.equal(handoffUpdates().length, 0);
  });
});

test('in redirect mode the fallback carries the redirect text and no handoffUntil', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
  await withEnv({ ...CONFIGURED, WHATSAPP_HANDOFF_MODE: 'redirect' }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.7', WA_ID, 'Une question ?')])));
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, `${COPY.fallback.fr}\n\n${COPY.redirect.fr}`);
    assert.equal(handoffUpdates().length, 0);
  });
});

test('a failed send records nothing and leaves the contact un-greeted', async () => {
  resetState();
  state.sendResult = () => null;
  await withEnv(CONFIGURED, async () => {
    const res = await POST(signedPost(messagesPayload([textMessage('wamid.8', WA_ID, 'salam')])));
    assert.equal(res.status, 200);
    assert.equal(state.sent.length, 1);
    assert.equal(state.outbound.length, 0);
    assert.equal(state.updates.filter((u) => u.patch.greetedAt !== undefined).length, 0);
  });
});

test('with the bot disabled the message is recorded but nothing is sent', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, WHATSAPP_BOT_ENABLED: undefined }, async () => {
    const res = await POST(signedPost(messagesPayload([textMessage('wamid.9', WA_ID, 'salam')])));
    assert.equal(res.status, 200);
    assert.equal(state.claims.length, 1);
    assert.equal(state.sent.length, 0);
    assert.equal(state.outbound.length, 0);
  });
});

test('missing WhatsApp tables: 200, nothing sent, the rest of the batch is skipped', async () => {
  resetState();
  state.claimError = new WhatsAppTablesMissingError();
  await quietly(async (logged) => {
    await withEnv(CONFIGURED, async () => {
      const res = await POST(
        signedPost(messagesPayload([textMessage('wamid.10', WA_ID, 'salam'), textMessage('wamid.11', WA_ID_2, 'salam')]))
      );
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'ok');
      assert.equal(state.sent.length, 0);
      assert.equal(state.claims.length, 0);
      assert.equal(state.contacts.size, 1, 'the second event was never processed');
      assert.ok(logged.some((line) => line.includes('[whatsapp] migration 015 non appliquée')));
    });
  });
});

test('one failing event does not stop the next one from being answered', async () => {
  resetState();
  state.upsertFailFor = WA_ID;
  await quietly(async (logged) => {
    await withEnv(CONFIGURED, async () => {
      const res = await POST(
        signedPost(messagesPayload([textMessage('wamid.12', WA_ID, 'salam'), textMessage('wamid.13', WA_ID_2, 'salam')]))
      );
      assert.equal(res.status, 200);
      assert.equal(state.sent.length, 1);
      assert.equal(state.sent[0].to, WA_ID_2);
      assert.ok(logged.some((line) => line.includes('[whatsapp] event failed')));
      assert.ok(
        !logged.some((line) => line.includes(WA_ID) || line.includes('salam')),
        'logs carry no phone number or message text'
      );
    });
  });
});

test('a missing Supabase admin config is a logged 200 no-op', async () => {
  resetState();
  await quietly(async (logged) => {
    await withEnv({ ...CONFIGURED, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
      const res = await POST(signedPost(messagesPayload([textMessage('wamid.14', WA_ID, 'salam')])));
      assert.equal(res.status, 200);
      assert.equal(state.sent.length, 0);
      assert.ok(logged.some((line) => line.includes('[whatsapp] supabase admin non configuré')));
    });
  });
});

// --- I1: audience gate (coexistence only) ----------------------------------

const AD_REFERRAL = { source_type: 'ad', source_id: 'ad-1' };
const withReferral = (message, referral = AD_REFERRAL) => ({ ...message, referral });

test('coexistence + scope ads: a new contact whose first message carries the ad referral gets the greeting', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, WHATSAPP_BOT_SCOPE: 'ads' }, async () => {
    await POST(signedPost(messagesPayload([withReferral(textMessage('wamid.a1', WA_ID, 'Bonjour'))])));
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, COPY.greeting);
  });
});

test('coexistence + scope ads: a contact with a stored referral is answered later on', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null, fromAd: true });
  await withEnv({ ...CONFIGURED, WHATSAPP_BOT_SCOPE: 'ads' }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.a2', WA_ID, '2')])));
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, COPY.pricing.fr);
  });
});

test('coexistence + scope ads (also the default): a contact without a referral is recorded and gets no answer at all', async () => {
  for (const scope of ['ads', undefined]) {
    resetState();
    await withEnv({ ...CONFIGURED, WHATSAPP_BOT_SCOPE: scope }, async () => {
      for (const message of [
        textMessage('wamid.b1', WA_ID, 'Bonjour'),
        textMessage('wamid.b2', WA_ID, '3'),
        imageMessage('wamid.b3', WA_ID),
      ]) {
        const res = await POST(signedPost(messagesPayload([message])));
        assert.equal(res.status, 200);
      }
      assert.equal(state.claims.length, 3, 'the messages are still recorded');
      assert.equal(state.sent.length, 0);
      assert.equal(state.outbound.length, 0);
      assert.equal(state.greetClaims.length, 0);
      assert.equal(state.assistantCalls.length, 0);
      assert.equal(
        state.updates.filter((u) => u.patch.greetedAt !== undefined || u.patch.handoffUntil !== undefined).length,
        0
      );
    });
  }
});

test('the gate still lets echoes through: the owner writing to a non-ad contact opens a handoff', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, WHATSAPP_BOT_SCOPE: 'ads' }, async () => {
    await POST(signedPost(echoPayload(WA_ID, 'Bonjour, ici Hamid', 'wamid.echo1')));
    assert.equal(handoffUpdates().length, 1);
  });
});

test('scope all: a contact without a referral gets the greeting', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, WHATSAPP_BOT_SCOPE: 'all' }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.c1', WA_ID, 'Bonjour')])));
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, COPY.greeting);
  });
});

test('redirect mode answers everyone, referral or not, even with scope ads', async () => {
  resetState();
  await withEnv({ ...CONFIGURED, WHATSAPP_HANDOFF_MODE: 'redirect', WHATSAPP_BOT_SCOPE: 'ads' }, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.d1', WA_ID, 'Bonjour')])));
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, COPY.greeting);
  });
});

// --- I4: bursts ------------------------------------------------------------

test('the greeting is claimed before it is sent, and not set a second time through updateContact', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.e1', WA_ID, 'Bonjour')])));
    assert.equal(state.greetClaims.length, 1);
    assert.equal(state.greetClaims[0].waId, WA_ID);
    assert.ok(state.greetClaims[0].at instanceof Date);
    assert.equal(state.sent.length, 1);
    assert.equal(state.updates.filter((u) => u.patch.greetedAt !== undefined).length, 0);
    assert.equal(state.greetReleases.length, 0);
  });
});

test('a concurrent delivery that loses the greeting claim is handled as a follow-up: the assistant answers', async () => {
  resetState();
  state.greetingWon = () => false;
  state.assistantResult = () => ({ reply: 'Le pack Artisan coûte 100 DH.', handoff: false });
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.f1', WA_ID, "c'est combien ?")])));
    assert.equal(state.greetClaims.length, 1);
    assert.deepEqual(
      state.sent.map((m) => m.body),
      ['Le pack Artisan coûte 100 DH.']
    );
    assert.ok(!state.sent.some((m) => m.body === COPY.greeting), 'no second greeting');
    assert.equal(state.assistantCalls.length, 1);
  });
});

test('a concurrent delivery that loses the greeting claim and sends a photo gets the image hint', async () => {
  resetState();
  state.greetingWon = () => false;
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([imageMessage('wamid.f2', WA_ID)])));
    assert.deepEqual(
      state.sent.map((m) => m.body),
      [COPY.imageHint.fr]
    );
  });
});

test('a failed greeting send releases the claim so the next message can greet again', async () => {
  resetState();
  state.sendResult = () => null;
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.g1', WA_ID, 'Bonjour')])));
    assert.equal(state.greetClaims.length, 1);
    assert.equal(state.greetReleases.length, 1);
    assert.equal(state.greetReleases[0].waId, WA_ID);
    assert.equal(state.greetReleases[0].at, state.greetClaims[0].at, 'releases exactly what it claimed');
    assert.equal(state.contacts.get(WA_ID).greetedAt, null);
    assert.equal(state.outbound.length, 0);
  });
});

test('menu choices keep marking the contact greeted through updateContact, without a greeting claim', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.h1', WA_ID, '2')])));
    assert.equal(state.greetClaims.length, 0);
    assert.equal(state.updates.filter((u) => u.patch.greetedAt instanceof Date).length, 1);
  });
});

test('two photos in a row get one image hint, recorded under its own kind', async () => {
  resetState();
  state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([imageMessage('wamid.i1', WA_ID)])));
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].body, COPY.imageHint.fr);
    assert.equal(state.outbound[0].kind, 'image_hint');
    assert.equal(state.countCalls[0].kind, 'image_hint');
    const windowMs = Date.now() - state.countCalls[0].since.getTime();
    assert.ok(windowMs >= 10 * 60 * 1000 - 2000 && windowMs <= 10 * 60 * 1000 + 2000, 'a 10 minute cooldown');

    // The second photo now sees the recorded hint.
    state.imageHintCount = state.outbound.filter((o) => o.kind === 'image_hint').length;
    await POST(signedPost(messagesPayload([imageMessage('wamid.i2', WA_ID)])));
    assert.equal(state.sent.length, 1, 'no second hint');
    assert.equal(state.claims.length, 2, 'the second photo is still recorded');
  });
});

// --- M2: echo dedupe -------------------------------------------------------

test('an echo passes its own id to recordOutbound', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(echoPayload(WA_ID, 'Bonjour', 'wamid.echoA')));
    assert.deepEqual(state.outbound, [
      { waId: WA_ID, wamid: 'wamid.echoA', direction: 'human', kind: 'echo', body: 'Bonjour' },
    ]);
  });
});

test('a redelivered echo starts the handoff only once', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(echoPayload(WA_ID, 'Bonjour', 'wamid.echoB')));
    await POST(signedPost(echoPayload(WA_ID, 'Bonjour', 'wamid.echoB')));
    assert.equal(state.outbound.length, 1);
    assert.equal(handoffUpdates().length, 1);
  });
});

test('the echo of a message the bot itself sent (same wamid) opens no handoff', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    await POST(signedPost(messagesPayload([textMessage('wamid.j1', WA_ID, 'Bonjour')])));
    assert.equal(state.sent.length, 1);
    await POST(signedPost(echoPayload(WA_ID, COPY.greeting, 'wamid.OUT')));
    assert.equal(handoffUpdates().length, 0);
    assert.equal(state.outbound.filter((o) => o.direction === 'human').length, 0);
  });
});

// --- M5: the assistant gets the handoff mode -------------------------------

test('the route tells the assistant which handoff mode is active', async () => {
  for (const mode of [undefined, 'redirect']) {
    resetState();
    state.contacts.set(WA_ID, { waId: WA_ID, lang: 'fr', greetedAt: new Date(), handoffUntil: null });
    state.assistantResult = () => ({ reply: 'ok', handoff: false });
    await withEnv({ ...CONFIGURED, WHATSAPP_HANDOFF_MODE: mode }, async () => {
      await POST(signedPost(messagesPayload([textMessage('wamid.k1', WA_ID, 'Vous livrez ?')])));
      assert.equal(state.assistantCalls[0].handoffMode, mode ?? 'coexistence');
    });
  }
});
