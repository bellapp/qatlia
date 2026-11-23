const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The WhatsApp button of the site (spec 2026-11-23): where it shows, what it
// pre-fills, and how the bot tells those messages apart. The site and the bot
// share src/lib/whatsapp/site-contact.ts, so the texts sent are the texts read.

const load = (rel) => loadTsModule(path.resolve(__dirname, '..', rel));
const {
  SITE_MARKER,
  placementFor,
  siteMessage,
  BOT_WHATSAPP,
  whatsappLink,
  isSiteMessage,
  typedBeyondSiteMessage,
} = load('src/lib/whatsapp/site-contact.ts');

const ARABIC = /[؀-ۿ]/;
const TOPICS = ['general', 'credits', 'atelier', 'history', 'panels', 'account'];
const LOCALES = ['fr', 'en', 'ar'];

test('public pages get the floating button', () => {
  for (const pathname of ['/', '/ar', '/signup', '/auth/login', '/privacy', '/terms', '/refund', '/page-inconnue']) {
    assert.deepEqual(placementFor(pathname), { kind: 'floating', topic: 'general' }, pathname);
  }
  for (const pathname of ['/credits', '/credits/success']) {
    assert.deepEqual(placementFor(pathname), { kind: 'floating', topic: 'credits' }, pathname);
  }
});

test('work pages get the header button, never the floating one', () => {
  assert.deepEqual(placementFor('/atelier'), { kind: 'header', topic: 'atelier' });
  assert.deepEqual(placementFor('/history'), { kind: 'header', topic: 'history' });
  assert.deepEqual(placementFor('/panels'), { kind: 'header', topic: 'panels' });
});

test('the account page gets the floating button: no job to cover, a full header', () => {
  assert.deepEqual(placementFor('/account'), { kind: 'floating', topic: 'account' });
});

test('no button in the admin nor on the short links', () => {
  for (const pathname of ['/admin', '/admin/clients/abc', '/w/abc123']) {
    assert.deepEqual(placementFor(pathname), { kind: 'none' }, pathname);
  }
});

test('every pre-filled message ends with the marker, in the language of the site', () => {
  for (const topic of TOPICS) {
    for (const locale of LOCALES) {
      const message = siteMessage(topic, locale);
      assert.ok(message.endsWith(` ${SITE_MARKER}`), `${topic}/${locale}`);
      assert.equal(ARABIC.test(message), locale === 'ar', `${topic}/${locale}`);
      assert.ok(isSiteMessage(message));
    }
  }
});

test('the link opens the chat with the bot (07 26 26 36 86), not the support line, with the message of the page', () => {
  assert.equal(BOT_WHATSAPP, '212726263686');
  const { SUPPORT_WHATSAPP } = load('src/lib/support.ts');
  assert.notEqual(BOT_WHATSAPP, SUPPORT_WHATSAPP);
  const link = whatsappLink('atelier', 'ar');
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, 'https://wa.me/212726263686');
  assert.equal(url.searchParams.get('text'), siteMessage('atelier', 'ar'));
});

test('an ordinary message is not a site message', () => {
  assert.equal(isSiteMessage('Bonjour'), false);
  assert.equal(isSiteMessage(null), false);
});

test('what was typed beyond the site message', () => {
  const message = siteMessage('atelier', 'fr');
  assert.equal(typedBeyondSiteMessage(message), '');
  assert.equal(typedBeyondSiteMessage(`${message} Le scan ne marche pas`), 'Le scan ne marche pas');
  assert.equal(typedBeyondSiteMessage(`Mon plan est faux ${SITE_MARKER}`), 'Mon plan est faux');
});

// --- The bot ------------------------------------------------------------------

const { withSiteReferral } = load('src/lib/whatsapp/site-contact.ts');
const { decide, resolveLang } = load('src/lib/whatsapp/router.ts');

const NOW = new Date('2026-11-23T10:00:00.000Z');
const inbound = (text, referral = null) => ({
  type: 'inbound', wamid: 'w', waId: '1', profileName: null, kind: 'text', text, referral,
});
const newContact = { waId: '1', lang: 'ar', greetedAt: null, handoffUntil: null };

test('a site message gets the site referral; an ad referral or a plain text is left alone', () => {
  assert.deepEqual(withSiteReferral(inbound(siteMessage('general', 'fr'))).referral, { source: 'site' });
  const ad = { source_type: 'ad', source_id: 'ad-1' };
  assert.deepEqual(withSiteReferral(inbound(siteMessage('general', 'fr'), ad)).referral, ad);
  assert.equal(withSiteReferral(inbound('Bonjour')).referral, null);
});

test('the bot answers a site message in the language of the site, not in the darija of the ad', () => {
  assert.equal(resolveLang(withSiteReferral(inbound(siteMessage('atelier', 'fr'))), newContact), 'fr');
  assert.equal(resolveLang(withSiteReferral(inbound(siteMessage('atelier', 'en'))), newContact), 'fr');
  assert.equal(resolveLang(withSiteReferral(inbound(siteMessage('atelier', 'ar'))), { ...newContact, lang: 'fr' }), 'ar');
});

const firstContact = (text) =>
  decide({
    event: withSiteReferral(inbound(text)),
    contact: { ...newContact, lang: 'fr' },
    now: NOW,
    assistantRepliesLast24h: 0,
    handoffMode: 'coexistence',
  });

test('the bare site message gets the greeting, not an assistant answer', () => {
  const decision = firstContact(siteMessage('atelier', 'fr'));
  assert.equal(decision.action, 'send');
  assert.equal(decision.greeting, true);
  assert.equal(decision.thenAssistant, undefined);
});

test('a question typed with the site message is answered after the greeting', () => {
  const decision = firstContact(`${siteMessage('atelier', 'fr')} Comment ajouter un panneau ?`);
  assert.equal(decision.greeting, true);
  assert.equal(decision.thenAssistant, true);
});

test('a greeted contact tapping the button again gets the menu again, not a second greeting', () => {
  const decision = decide({
    event: withSiteReferral(inbound(siteMessage('general', 'fr'))),
    contact: { ...newContact, lang: 'fr', greetedAt: new Date(NOW.getTime() - 2 * 3600 * 1000) },
    now: NOW,
    assistantRepliesLast24h: 0,
    handoffMode: 'coexistence',
  });
  assert.equal(decision.action, 'send');
  assert.equal(decision.greeting, undefined);
  assert.equal(decision.markGreeted, false);
});
