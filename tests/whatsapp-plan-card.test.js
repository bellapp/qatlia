const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// « Est-ce qu'on peut rendre l'image cliquable pour renvoyer vers le site ? »
// (owner, 21/11/2026). A WhatsApp image opens full screen, never a link; a
// "call to action" message carries the picture as its header and a real button
// under it that opens the link. The bot answers a read cut list with it.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const { sendPlanCard } = load('src/lib/whatsapp/send.ts');
const { photoResultCard, summarizeCutList } = load('src/lib/whatsapp/photo-summary.ts');

const CONFIG = {
  appSecret: 's', verifyToken: 'v', accessToken: 'SECRET-TOKEN-123', phoneNumberId: 'PNID', graphVersion: 'v23.0',
  enabled: true, handoffMode: 'coexistence', scope: 'ads', ycloud: null,
};
const YCLOUD_CONFIG = { ...CONFIG, ycloud: { apiKey: 'YC-SECRET-KEY', from: '+212726263686' } };
const CARD = {
  image: 'https://qatlia.ma/w/k7m2qx9dab/plan.png',
  body: '👆 هادا طرف من مخطط التقطيع ديالك.',
  button: 'شوف المخطط كامل',
  url: 'https://qatlia.ma/w/k7m2qx9dab',
};
const INTERACTIVE = {
  type: 'interactive',
  interactive: {
    type: 'cta_url',
    header: { type: 'image', image: { link: CARD.image } },
    body: { text: CARD.body },
    action: { name: 'cta_url', parameters: { display_text: CARD.button, url: CARD.url } },
  },
};

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return respond();
  };
  impl.calls = calls;
  return impl;
}

test('with YCloud, the plan card is a cta_url message: the picture on top, a button to the link under it', async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ id: 'yc9', wamid: 'wamid.CARD' }), { status: 200 }));
  assert.equal(await sendPlanCard(YCLOUD_CONFIG, '212600000000', CARD, f), 'wamid.CARD');
  assert.equal(f.calls[0].url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  assert.deepEqual(f.calls[0].body, { from: '+212726263686', to: '+212600000000', ...INTERACTIVE });
});

test('through the Graph API, the plan card has the same shape', async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ messages: [{ id: 'wamid.G' }] }), { status: 200 }));
  assert.equal(await sendPlanCard(CONFIG, '212600000000', CARD, f), 'wamid.G');
  assert.deepEqual(f.calls[0].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '212600000000', ...INTERACTIVE });
});

test('a refused plan card returns null, so the bot falls back to the picture', async () => {
  const errors = test.mock.method(console, 'error', () => {});
  const f = fakeFetch(() => new Response('{}', { status: 400 }));
  assert.equal(await sendPlanCard(YCLOUD_CONFIG, '1', CARD, f), null);
  errors.mock.restore();
});

test('the card text keeps the counts, points at the picture, and leaves the link to the button', () => {
  const pieces = [{ name: 'Côté', height: 200, width: 60, quantity: 2 }, { name: '', height: 80, width: 58, quantity: 6 }];
  const summary = summarizeCutList(pieces, null);
  const link = 'https://qatlia.ma/w/k7m2qx9dab';
  const ar = photoResultCard('ar', summary, link);
  const fr = photoResultCard('fr', summary, link);
  assert.equal(ar.url, link);
  assert.equal(fr.url, link);
  assert.equal(ar.image, 'https://qatlia.ma/w/k7m2qx9dab/plan.png');
  assert.equal(ar.button, 'شوف المخطط كامل');
  assert.equal(fr.button, 'Voir le plan complet');
  assert.match(ar.body, /^✅ القطع اللي تقرات/);
  assert.match(ar.body, /👆/);
  assert.match(ar.body, /24/);
  assert.match(fr.body, /24 h/);
  for (const card of [ar, fr]) {
    assert.doesNotMatch(card.body, /https?:/, 'the link is the button');
    assert.doesNotMatch(card.body, /PDF|optimis|scann|سكان/i);
    assert.ok(card.body.length <= 1024, 'WhatsApp body limit');
    assert.ok(card.button.length <= 20, 'WhatsApp button limit');
  }
});

test('the back office can send the plan card of a read, signed in as admin only', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/app/api/admin/whatsapp/plan-card/route.ts'), 'utf8');
  assert.match(source, /authorizeAdminRequest\(req\)/);
  assert.match(source, /isPhotoCode\(/);
  assert.match(source, /sendPlanCard\(/);
  assert.match(source, /planImageUrl\(/);
  assert.match(source, /photoLink\(/);
  assert.match(source, /recordOutbound\(/);
  assert.match(source, /'expired'/, 'never a card for an expired link');
});
