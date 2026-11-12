const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(PROJECT_ROOT, rel));

const { verifySignature } = load('src/lib/whatsapp/signature.ts');
const { parseWebhook } = load('src/lib/whatsapp/payload.ts');
const { getWhatsAppConfig } = load('src/lib/whatsapp/config.ts');

const PHONE_ID = '100200300';
const CUSTOMER = '212600000000';

const sign = (body, secret) => `sha256=${crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

function messagesPayload(message, extra = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_ID, display_phone_number: '212611000000' },
              contacts: [{ wa_id: CUSTOMER, profile: { name: 'Sara' } }],
              messages: [{ from: CUSTOMER, id: 'wamid.1', timestamp: '1700000000', ...message }],
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

test('verifySignature accepts a valid signature over a UTF-8 body', () => {
  const body = JSON.stringify({ text: 'مرحبا 👋' });
  assert.equal(verifySignature(body, sign(body, 's3cret'), 's3cret'), true);
});

test('verifySignature rejects a re-serialised body', () => {
  const body = JSON.stringify({ text: 'مرحبا 👋' });
  const header = sign(body, 's3cret');
  assert.equal(verifySignature(`${body} `, header, 's3cret'), false);
});

test('verifySignature rejects a wrong secret', () => {
  const body = '{"a":1}';
  assert.equal(verifySignature(body, sign(body, 'other'), 's3cret'), false);
});

test('verifySignature rejects missing, malformed and wrong-length headers', () => {
  const body = '{"a":1}';
  assert.equal(verifySignature(body, null, 's3cret'), false);
  assert.equal(verifySignature(body, 'sha256=', 's3cret'), false);
  assert.equal(verifySignature(body, 'md5=abc', 's3cret'), false);
  assert.equal(verifySignature(body, 'sha256=abcd', 's3cret'), false);
  assert.equal(verifySignature(body, sign(body, 's3cret').slice('sha256='.length), 's3cret'), false);
});

test('parseWebhook returns a text inbound event with profile name and referral', () => {
  const referral = { source_type: 'ad', source_id: '123' };
  const events = parseWebhook(messagesPayload({ type: 'text', text: { body: 'Salam' }, referral }), PHONE_ID);
  assert.deepEqual(events, [
    {
      type: 'inbound',
      wamid: 'wamid.1',
      waId: CUSTOMER,
      profileName: 'Sara',
      kind: 'text',
      text: 'Salam',
      referral,
    },
  ]);
});

test('parseWebhook ignores status-only payloads, other numbers and invalid bodies', () => {
  const statusOnly = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_ID },
              statuses: [{ id: 'wamid.9', status: 'delivered', recipient_id: CUSTOMER }],
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(parseWebhook(statusOnly, PHONE_ID), []);
  assert.deepEqual(parseWebhook(messagesPayload({ type: 'text', text: { body: 'x' } }), 'another-id'), []);
  assert.deepEqual(parseWebhook(null, 'x'), []);
  assert.deepEqual(parseWebhook('nope', 'x'), []);
  assert.deepEqual(parseWebhook({ entry: 'bad' }, 'x'), []);
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ field: 'other', value: {} }] }] }, PHONE_ID), []);
});

test('parseWebhook maps audio, image and unknown types to kinds', () => {
  const [audio] = parseWebhook(messagesPayload({ type: 'audio', audio: { id: 'a1' } }), PHONE_ID);
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.text, null);
  assert.equal(audio.referral, null);

  const [image] = parseWebhook(
    messagesPayload({ type: 'image', image: { id: 'i1', caption: 'ma fiche' } }),
    PHONE_ID,
  );
  assert.equal(image.kind, 'image');
  assert.equal(image.text, 'ma fiche');

  const [other] = parseWebhook(messagesPayload({ type: 'unsupported' }), PHONE_ID);
  assert.equal(other.kind, 'other');
  assert.equal(other.text, null);
});

test('parseWebhook yields null profileName when no contact matches', () => {
  const payload = messagesPayload({ type: 'text', text: { body: 'x' } });
  payload.entry[0].changes[0].value.contacts = [{ wa_id: '999', profile: { name: 'Other' } }];
  const [event] = parseWebhook(payload, PHONE_ID);
  assert.equal(event.profileName, null);
});

test('parseWebhook turns coexistence echoes into echo events addressed to the customer', () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            field: 'smb_message_echoes',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_ID, display_phone_number: '212611000000' },
              message_echoes: [
                { from: '212611000000', to: '212611111111', id: 'wamid.e', timestamp: '1', type: 'text', text: { body: 'Bonjour' } },
              ],
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(parseWebhook(payload, PHONE_ID), [{ type: 'echo', waId: '212611111111', text: 'Bonjour' }]);
  assert.deepEqual(parseWebhook(payload, 'another-id'), []);
});

const FULL_ENV = {
  WHATSAPP_APP_SECRET: 'secret-value',
  WHATSAPP_VERIFY_TOKEN: 'verify-value',
  WHATSAPP_ACCESS_TOKEN: 'token-value',
  WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
};

test('getWhatsAppConfig returns null when anything required is missing or a placeholder', () => {
  assert.equal(getWhatsAppConfig({}), null);
  for (const key of Object.keys(FULL_ENV)) {
    const env = { ...FULL_ENV };
    delete env[key];
    assert.equal(getWhatsAppConfig(env), null, `missing ${key}`);
    assert.equal(getWhatsAppConfig({ ...FULL_ENV, [key]: 'your_value_here' }), null, `placeholder ${key}`);
  }
});

test('getWhatsAppConfig applies defaults and strict enabled/handoff parsing', () => {
  const base = getWhatsAppConfig(FULL_ENV);
  assert.equal(base.appSecret, 'secret-value');
  assert.equal(base.verifyToken, 'verify-value');
  assert.equal(base.accessToken, 'token-value');
  assert.equal(base.phoneNumberId, PHONE_ID);
  assert.equal(base.graphVersion, 'v23.0');
  assert.equal(base.enabled, false);
  assert.equal(base.handoffMode, 'coexistence');
  assert.equal(base.model, 'google/gemini-3.7-flash');
  assert.equal(base.openrouterKey, null);

  assert.equal(getWhatsAppConfig({ ...FULL_ENV, WHATSAPP_BOT_ENABLED: 'true' }).enabled, true);
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, WHATSAPP_BOT_ENABLED: 'TRUE' }).enabled, false);
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, WHATSAPP_HANDOFF_MODE: 'x' }).handoffMode, 'coexistence');
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, WHATSAPP_HANDOFF_MODE: 'redirect' }).handoffMode, 'redirect');
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, WHATSAPP_GRAPH_VERSION: 'v24.0' }).graphVersion, 'v24.0');
});

test('getWhatsAppConfig resolves the model and OpenRouter key', () => {
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, OPENROUTER_MODEL: 'm' }).model, 'm');
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, OPENROUTER_MODEL: 'm', WHATSAPP_BOT_MODEL: 'b' }).model, 'b');
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, OPENROUTER_API_KEY: 'sk-or-real' }).openrouterKey, 'sk-or-real');
  assert.equal(getWhatsAppConfig({ ...FULL_ENV, OPENROUTER_API_KEY: 'your_key' }).openrouterKey, null);
});
