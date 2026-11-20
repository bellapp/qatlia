const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Right after the greeting, the bot sends a photo of a real cut list: many
// prospects do not know what "ورقة القياسات" means, and some send a drawing of
// the furniture instead (owner, 20/11/2026).

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const { EXAMPLE_FICHE_URL, exampleCaption } = load('src/lib/whatsapp/copy.ts');
const { decide } = load('src/lib/whatsapp/router.ts');
const { sendImage } = load('src/lib/whatsapp/send.ts');

const ARABIC = /[؀-ۿ]/;
const NOW = new Date('2026-11-20T18:00:00.000Z');

test('the example is a public JPEG of the site, under 5 MB, with the color profile YCloud requires', () => {
  assert.equal(EXAMPLE_FICHE_URL, 'https://qatlia.ma/whatsapp/exemple-fiche.jpg');
  const file = fs.readFileSync(path.join(ROOT, 'public/whatsapp/exemple-fiche.jpg'));
  assert.equal(file[0], 0xff);
  assert.equal(file[1], 0xd8);
  assert.ok(file.length < 5 * 1024 * 1024);
  assert.ok(file.includes(Buffer.from('ICC_PROFILE\0', 'latin1')), 'embedded ICC profile');
  // The middleware leaves .jpg files alone, so the image is served as is.
  assert.match(fs.readFileSync(path.join(ROOT, 'src/middleware.ts'), 'utf8'), /jpg\|jpeg/);
});

test('the caption says it is a list of pieces, taken with the phone and sent here', () => {
  const ar = exampleCaption('ar', false);
  const fr = exampleCaption('fr', false);
  assert.match(ar, /^📸 بحال هادي/);
  assert.match(ar, /لائحة البياسات/);
  assert.match(ar, /بالتيليفون/);
  assert.match(ar, /هنا/);
  assert.doesNotMatch(ar, /[A-Za-z]/);
  assert.match(fr, /^📸 Comme celle-ci/);
  assert.match(fr, /liste des pièces/);
  assert.match(fr, /téléphone/);
  assert.doesNotMatch(fr, ARABIC);
  for (const caption of [ar, fr, exampleCaption('ar', true)]) assert.doesNotMatch(caption, /https?:/);
});

test('the bilingual caption follows the greeting: the contact language first', () => {
  const arFirst = exampleCaption('ar', true);
  const frFirst = exampleCaption('fr', true);
  assert.deepEqual(arFirst.split('\n'), [exampleCaption('ar', false), exampleCaption('fr', false)]);
  assert.deepEqual(frFirst.split('\n'), [exampleCaption('fr', false), exampleCaption('ar', false)]);
});

const decideFor = (text, overrides = {}) =>
  decide({
    event: { type: 'inbound', wamid: 'w', waId: '1', profileName: null, kind: 'text', text, referral: null },
    contact: { waId: '1', lang: 'ar', greetedAt: null, handoffUntil: null, ...overrides },
    now: NOW,
    assistantRepliesLast24h: 0,
    handoffMode: 'redirect',
    voiceEnabled: true,
  });

test('only the greeting carries the example, captioned like the greeting', () => {
  assert.equal(decideFor('سلام').exampleCaption, exampleCaption('ar', false));
  assert.equal(decideFor('Bonjour ! Puis-je en savoir plus à ce sujet ?').exampleCaption, exampleCaption('ar', true));
  assert.equal(decideFor('Bonjour, prix ?', { lang: 'fr' }).exampleCaption, exampleCaption('fr', true));
  // A menu choice, even as a first message, and the menu sent again carry none.
  assert.equal(decideFor('2').exampleCaption, undefined);
  const back = decideFor('Bonjour ! Puis-je en savoir plus à ce sujet ?', { greetedAt: new Date(NOW.getTime() - 3600000) });
  assert.equal(back.exampleCaption, undefined);
});

// --- sendImage ----------------------------------------------------------------

const CONFIG = {
  appSecret: 's',
  verifyToken: 'v',
  accessToken: 'SECRET-TOKEN-123',
  phoneNumberId: 'PNID',
  graphVersion: 'v23.0',
  enabled: true,
  handoffMode: 'coexistence',
  scope: 'ads',
  ycloud: null,
};
const YCLOUD_CONFIG = { ...CONFIG, ycloud: { apiKey: 'YC-SECRET-KEY', from: '+212726263686' } };
const IMAGE = { type: 'image', image: { link: 'https://qatlia.ma/whatsapp/exemple-fiche.jpg', caption: 'بحال هادي' } };

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return respond();
  };
  impl.calls = calls;
  return impl;
}

test('with YCloud, sendImage posts an image message by link with its caption', async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ id: 'yc3', wamid: 'wamid.IMG' }), { status: 200 }));
  assert.equal(await sendImage(YCLOUD_CONFIG, '212600000000', IMAGE.image.link, IMAGE.image.caption, f), 'wamid.IMG');
  assert.equal(f.calls[0].url, 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  assert.deepEqual(f.calls[0].body, { from: '+212726263686', to: '+212600000000', ...IMAGE });
});

test('through the Graph API, sendImage posts the same image message', async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ messages: [{ id: 'wamid.G' }] }), { status: 200 }));
  assert.equal(await sendImage(CONFIG, '212600000000', IMAGE.image.link, IMAGE.image.caption, f), 'wamid.G');
  assert.deepEqual(f.calls[0].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '212600000000', ...IMAGE });
});

test('sendImage returns null when the provider refuses it', async () => {
  const errors = test.mock.method(console, 'error', () => {});
  const f = fakeFetch(() => new Response('{}', { status: 400 }));
  assert.equal(await sendImage(YCLOUD_CONFIG, '1', IMAGE.image.link, IMAGE.image.caption, f), null);
  errors.mock.restore();
});
