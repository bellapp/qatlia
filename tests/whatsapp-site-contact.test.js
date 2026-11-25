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
const { MENU_BUTTONS, greeting, siteQuestion } = load('src/lib/whatsapp/copy.ts');

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

// Wafae, 25/11/2026: « j'ai une question sur QatliA » from the site got the ad's
// greeting (send your sheet) and the example sheet.
test('the bare site message is asked what its question is: no photo invite, no example, no assistant answer', () => {
  for (const topic of TOPICS) {
    const decision = firstContact(siteMessage(topic, 'fr'));
    assert.equal(decision.action, 'send', topic);
    assert.equal(decision.text, siteQuestion({ lang: 'fr', voice: false }).text, topic);
    assert.equal(decision.greeting, true, 'one delivery of a burst sends it');
    assert.equal(decision.markGreeted, true);
    assert.equal(decision.handoff, false);
    assert.equal(decision.exampleCaption, undefined);
    assert.equal(decision.thenAssistant, undefined);
    assert.deepEqual(decision.menu, { buttons: MENU_BUTTONS, fallbackText: siteQuestion({ lang: 'fr', voice: false }).plain });
  }
});

test('the question is asked in the language of the site', () => {
  const event = withSiteReferral(inbound(siteMessage('general', 'ar')));
  const decision = decide({
    event,
    contact: { ...newContact, lang: resolveLang(event, { ...newContact, lang: 'fr' }) },
    now: NOW,
    assistantRepliesLast24h: 0,
    handoffMode: 'redirect',
    voiceEnabled: true,
  });
  assert.equal(decision.text, siteQuestion({ lang: 'ar', voice: true }).text);
});

test('a hello added to the site message is still no question: it is asked for', () => {
  const decision = firstContact(`${siteMessage('general', 'fr')} Salam`);
  assert.equal(decision.text, siteQuestion({ lang: 'fr', voice: false }).text);
});

test('the ad message still gets the greeting and the example', () => {
  const decision = firstContact('Bonjour ! Puis-je en savoir plus à ce sujet ?');
  assert.equal(decision.text, greeting({ lang: 'fr', bilingual: true, voice: false }).text);
  assert.ok(decision.exampleCaption);
});

test('the text asking for the question: short, no sheet asked, a voice note only when it can be heard', () => {
  for (const lang of ['fr', 'ar']) {
    for (const voice of [true, false]) {
      const { text, plain } = siteQuestion({ lang, voice });
      assert.doesNotMatch(text, /📸|fiche|ورقة القياسات|https?:/, `${lang}/${voice}`);
      assert.equal(/vocal|أوديو/.test(text), voice, `${lang}/${voice}`);
      assert.ok(text.split('\n').length <= 4);
      assert.doesNotMatch(text, /très vite|دابا|فالبلاصة|قريب/);
      assert.match(plain, /1️⃣[\s\S]*2️⃣[\s\S]*3️⃣/);
    }
  }
});

test('a question typed with the site message is answered after the greeting', () => {
  const decision = firstContact(`${siteMessage('atelier', 'fr')} Comment ajouter un panneau ?`);
  assert.equal(decision.greeting, true);
  assert.equal(decision.thenAssistant, true);
});

test('a greeted contact tapping the button again is asked the question, not greeted a second time', () => {
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
  assert.equal(decision.text, siteQuestion({ lang: 'fr', voice: false }).text);
});

test('the button tapped right after the greeting stays unanswered, like an ad message (the same burst)', () => {
  const decision = decide({
    event: withSiteReferral(inbound(siteMessage('general', 'fr'))),
    contact: { ...newContact, lang: 'fr', greetedAt: new Date(NOW.getTime() - 60 * 1000) },
    now: NOW,
    assistantRepliesLast24h: 0,
    handoffMode: 'coexistence',
  });
  assert.equal(decision.action, 'silent');
});
