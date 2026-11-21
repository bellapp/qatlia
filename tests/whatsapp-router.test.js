const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(PROJECT_ROOT, rel));

const { COPY, DEMO_VIDEO_URL, MENU_BUTTONS, MENU_BUTTON_TITLE_MAX, greeting, exampleCaption } = load('src/lib/whatsapp/copy.ts');
const { detectLang, menuChoice, decide, HANDOFF_HOURS, MAX_ASSISTANT_REPLIES_PER_DAY } = load(
  'src/lib/whatsapp/router.ts',
);

const NOW = new Date('2026-11-12T10:00:00.000Z');
const WA_LINK = 'https://wa.me/212600937523';

const contact = (overrides = {}) => ({
  waId: '212600000000',
  lang: 'fr',
  greetedAt: new Date('2026-11-10T10:00:00.000Z'),
  handoffUntil: null,
  ...overrides,
});

const inbound = (overrides = {}) => ({
  type: 'inbound',
  wamid: 'wamid.1',
  waId: '212600000000',
  profileName: null,
  kind: 'text',
  text: 'Quelle est la différence entre vos offres ?',
  referral: null,
  ...overrides,
});

const run = ({ event = {}, contact: c = {}, assistantRepliesLast24h = 0, handoffMode = 'coexistence', voiceEnabled } = {}) =>
  decide({
    event: inbound(event),
    contact: contact(c),
    now: NOW,
    assistantRepliesLast24h,
    handoffMode,
    ...(voiceEnabled === undefined ? {} : { voiceEnabled }),
  });

test('constants', () => {
  assert.equal(HANDOFF_HOURS, 24);
  assert.equal(MAX_ASSISTANT_REPLIES_PER_DAY, 20);
  assert.equal(DEMO_VIDEO_URL, 'https://youtu.be/rAjcW-1Wylk');
});

test('new contact gets the greeting and is marked greeted', () => {
  const d = run({
    event: { text: 'Bonjour ! Puis-je en savoir plus à ce sujet ?' },
    contact: { greetedAt: null },
  });
  // The French pre-filled text says nothing sure about the reader: both languages (see whatsapp-greeting.test.js).
  const expected = greeting({ lang: 'fr', bilingual: true, voice: false });
  assert.deepEqual(d, {
    action: 'send',
    text: expected.text,
    markGreeted: true,
    handoff: false,
    greeting: true,
    menu: { buttons: MENU_BUTTONS, fallbackText: expected.plain },
    exampleCaption: exampleCaption('fr', true),
  });
});

test('new contact choosing 1 gets howItWorks, not the greeting', () => {
  const d = run({ event: { text: '1' }, contact: { greetedAt: null } });
  assert.deepEqual(d, { action: 'send', text: COPY.howItWorks.fr, markGreeted: true, handoff: false });
});

test('menu choices: 1, 2, 3 in several spellings; anything else is not a choice', () => {
  for (const [text, expected] of [
    ['1', 1],
    ['2', 2],
    ['3', 3],
    [' 2 ', 2],
    ['3.', 3],
    ['1)', 1],
    ['1️⃣', 1],
    ['2️⃣', 2],
    ['3️⃣', 3],
    ['١', 1],
    ['٢', 2],
    ['٣', 3],
    ['12', null],
    ['1 panneau', null],
    ['4', null],
    ['', null],
    [null, null],
  ]) {
    assert.equal(menuChoice(text), expected, JSON.stringify(text));
  }
  assert.equal(run({ event: { text: '12' } }).action, 'assistant');
  assert.equal(run({ event: { text: '1 panneau' } }).action, 'assistant');
});

test('spelled menu choices route to the right fixed reply', () => {
  assert.equal(run({ event: { text: '1️⃣' } }).text, COPY.howItWorks.fr);
  assert.equal(run({ event: { text: ' 2 ' } }).text, COPY.pricing.fr);
  assert.equal(run({ event: { text: '٣' } }).text, COPY.advisor.fr);
});

test('the demo video link comes before the site link', () => {
  // The greeting carries the demo as its only link (whatsapp-greeting.test.js).
  // "How it works" now carries the demo as its only link (whatsapp-simple-messages.test.js).
  for (const text of [COPY.howItWorks.fr, COPY.howItWorks.ar]) {
    assert.ok(text.indexOf(DEMO_VIDEO_URL) !== -1);
    assert.ok(!text.includes('https://qatlia.ma'));
  }
});

test('the pricing reply leaves the free-recalculation detail to the assistant, which still knows it', () => {
  // Kept short for carpenters not at ease with technology (whatsapp-simple-messages.test.js).
  const { ANALYSIS_WINDOW_HOURS } = load('src/lib/billing/policy.ts');
  const { buildSystemPrompt } = load('src/lib/whatsapp/assistant.ts');
  assert.ok(!COPY.pricing.fr.includes('même projet'));
  assert.ok(!COPY.pricing.ar.includes('نفس المشروع'));
  assert.ok(buildSystemPrompt('redirect').includes(`pendant ${ANALYSIS_WINDOW_HOURS} h`));
});

test('redirect texts are the literal wa.me message', () => {
  assert.equal(COPY.redirect.fr, `Écrivez directement à notre conseiller ici : ${WA_LINK}`);
  assert.equal(COPY.redirect.ar, `كتب للمستشار ديالنا مباشرة هنا: ${WA_LINK}`);
});

test('choice 3: handoff in coexistence, redirect link and no handoff in redirect mode', () => {
  assert.deepEqual(run({ event: { text: '3' } }), {
    action: 'send',
    text: COPY.advisor.fr,
    markGreeted: true,
    handoff: true,
  });
  const d = run({ event: { text: '3' }, handoffMode: 'redirect' });
  assert.equal(d.text, `${COPY.advisor.fr}\n\n${COPY.redirect.fr}`);
  assert.ok(d.text.includes(WA_LINK));
  assert.equal(d.handoff, false);
  assert.equal(d.markGreeted, true);
});

test('choices 1 and 2 never hand off and do not get the redirect', () => {
  for (const handoffMode of ['coexistence', 'redirect']) {
    const one = run({ event: { text: '1' }, handoffMode });
    const two = run({ event: { text: '2' }, handoffMode });
    assert.equal(one.text, COPY.howItWorks.fr);
    assert.equal(two.text, COPY.pricing.fr);
    assert.equal(one.handoff, false);
    assert.equal(two.handoff, false);
  }
});

test('Arabic contact choosing 2 gets pricing.ar', () => {
  assert.equal(run({ event: { text: '2' }, contact: { lang: 'ar' } }).text, COPY.pricing.ar);
});

test('active handoff window keeps the bot silent, even for a menu choice', () => {
  const handoffUntil = new Date(NOW.getTime() + 60 * 60 * 1000);
  assert.deepEqual(run({ contact: { handoffUntil } }), { action: 'silent' });
  assert.deepEqual(run({ event: { text: '1' }, contact: { handoffUntil } }), { action: 'silent' });
  assert.deepEqual(run({ contact: { handoffUntil, greetedAt: null } }), { action: 'silent' });
});

test('expired handoff window no longer silences the bot', () => {
  const handoffUntil = new Date(NOW.getTime() - 60 * 1000);
  assert.deepEqual(run({ contact: { handoffUntil } }), { action: 'assistant' });
});

test('stickers, reactions and unknown kinds are ignored', () => {
  for (const kind of ['sticker', 'reaction', 'other']) {
    assert.deepEqual(run({ event: { kind, text: null }, contact: { greetedAt: null } }), { action: 'silent' }, kind);
  }
});

test('an image goes to the photo reading', () => {
  assert.deepEqual(run({ event: { kind: 'image', text: null } }), { action: 'photo' });
});

test('a photo as the very first message is read, not greeted', () => {
  assert.deepEqual(run({ event: { kind: 'image', text: null }, contact: { greetedAt: null } }), { action: 'photo' });
});

test('a photo carrying the ad referral is read', () => {
  const referral = { source_type: 'ad', source_id: '1' };
  assert.deepEqual(run({ event: { kind: 'image', text: null, referral }, contact: { greetedAt: null } }), { action: 'photo' });
});

test('a photo during a human hand-off stays silent', () => {
  const handoffUntil = new Date(NOW.getTime() + 60 * 60 * 1000);
  assert.deepEqual(run({ event: { kind: 'image', text: null }, contact: { handoffUntil } }), { action: 'silent' });
});

test('a menu choice typed as a caption still wins', () => {
  assert.equal(run({ event: { kind: 'image', text: '2' } }).text, COPY.pricing.fr);
});

test('audio, video, document, location, contacts: mediaHandoff', () => {
  for (const kind of ['audio', 'video', 'document', 'location', 'contacts']) {
    assert.deepEqual(
      run({ event: { kind, text: null } }),
      { action: 'send', text: COPY.mediaHandoff.fr, markGreeted: false, handoff: true },
      kind,
    );
    const d = run({ event: { kind, text: null }, handoffMode: 'redirect' });
    assert.equal(d.text, `${COPY.mediaHandoff.fr}\n\n${COPY.redirect.fr}`, kind);
    assert.equal(d.handoff, false, kind);
  }
});

// Voice notes (plan 2026-11-20-whatsapp-vocal): heard like a typed question
// when the voice is on; off (or not passed), the old mediaHandoff above.

test('voice on : a voice note goes to the voice action, like a text to the assistant', () => {
  assert.deepEqual(run({ event: { kind: 'audio', text: null }, voiceEnabled: true }), { action: 'voice' });
  assert.deepEqual(run({ event: { kind: 'audio', text: null }, voiceEnabled: false }).text, COPY.mediaHandoff.fr);
});

test('voice on : video, document, location and contacts still get mediaHandoff', () => {
  for (const kind of ['video', 'document', 'location', 'contacts']) {
    assert.equal(run({ event: { kind, text: null }, voiceEnabled: true }).text, COPY.mediaHandoff.fr, kind);
  }
});

test('voice on : during a human handoff a voice note is silent, a first contact gets the greeting first', () => {
  const handoffUntil = new Date(NOW.getTime() + 60 * 60 * 1000);
  assert.deepEqual(run({ event: { kind: 'audio', text: null }, contact: { handoffUntil }, voiceEnabled: true }), { action: 'silent' });
  assert.equal(run({ event: { kind: 'audio', text: null }, contact: { greetedAt: null }, voiceEnabled: true }).text, greeting({ lang: 'fr', bilingual: true, voice: true }).text);
});

test('voice on : the daily assistant cap applies to voice notes too', () => {
  assert.deepEqual(run({ event: { kind: 'audio', text: null }, voiceEnabled: true, assistantRepliesLast24h: 20 }), {
    action: 'send',
    text: COPY.advisor.fr,
    markGreeted: false,
    handoff: true,
  });
});

test('mediaHandoff no longer promises to listen; voiceUnclear asks to write, in both languages', () => {
  assert.doesNotMatch(COPY.mediaHandoff.fr, /écouter/);
  assert.doesNotMatch(COPY.mediaHandoff.ar, /نسمع/);
  assert.match(COPY.voiceUnclear.fr, /vocal/);
  assert.match(COPY.voiceUnclear.fr, /conseiller/);
  assert.match(COPY.voiceUnclear.ar, /مستشار/);
  assert.ok(!/[A-Za-z]/.test(COPY.voiceUnclear.ar), 'the darija text has no Latin letters');
});

test('daily assistant cap sends the advisor text and hands off', () => {
  assert.deepEqual(run({ assistantRepliesLast24h: 20 }), {
    action: 'send',
    text: COPY.advisor.fr,
    markGreeted: false,
    handoff: true,
  });
  assert.equal(run({ assistantRepliesLast24h: 19 }).action, 'assistant');
  const d = run({ assistantRepliesLast24h: 20, handoffMode: 'redirect', contact: { lang: 'ar' } });
  assert.equal(d.text, `${COPY.advisor.ar}\n\n${COPY.redirect.ar}`);
  assert.equal(d.handoff, false);
});

test('free text goes to the assistant', () => {
  assert.deepEqual(run(), { action: 'assistant' });
});

test('detectLang', () => {
  assert.equal(detectLang('سلام', 'fr'), 'ar');
  assert.equal(detectLang('salam bghit n3ref', 'ar'), 'fr');
  assert.equal(detectLang('1', 'ar'), 'ar');
  assert.equal(detectLang('1', 'fr'), 'fr');
  assert.equal(detectLang(null, 'ar'), 'ar');
  assert.equal(detectLang('ok', 'ar'), 'ar');
  assert.equal(detectLang('hello سلام', 'fr'), 'ar');
});

test('every fixed reply exists in both languages and is non-empty', () => {
  assert.ok(COPY.greeting.length > 0);
  assert.ok(COPY.greetingPlain.length > 0);
  for (const key of ['howItWorks', 'pricing', 'advisor', 'redirect', 'imageHint', 'mediaHandoff', 'voiceUnclear', 'fallback']) {
    for (const lang of ['fr', 'ar']) {
      assert.ok(typeof COPY[key][lang] === 'string' && COPY[key][lang].length > 0, `${key}.${lang}`);
    }
  }
});

test('no fixed reply mentions a bank card', () => {
  const keys = ['howItWorks', 'pricing', 'advisor', 'redirect', 'imageHint', 'mediaHandoff', 'voiceUnclear', 'fallback'];
  const texts = [COPY.greeting, COPY.greetingPlain, ...keys.flatMap((key) => [COPY[key].fr, COPY[key].ar])];
  for (const text of texts) {
    assert.ok(!/carte|بطاقة|كارت/i.test(text), text.slice(0, 60));
  }
});

test('the pricing reply lists every pack, the signup gift and the cost of an analysis', () => {
  const { CREDIT_PACKS, formatMAD } = load('src/lib/billing/catalog.ts');
  const { SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } = load('src/lib/billing/policy.ts');
  for (const pack of Object.values(CREDIT_PACKS)) {
    assert.ok(COPY.pricing.fr.includes(`${pack.credits} crédits : ${formatMAD(pack.priceMAD)}`), pack.id);
    assert.ok(COPY.pricing.ar.includes(`${pack.credits} كريدي بـ ${pack.priceMAD} درهم`), pack.id);
  }
  assert.ok(COPY.pricing.fr.includes(`${SIGNUP_FREE_CREDITS} crédits gratuits`));
  assert.ok(COPY.pricing.ar.includes(`${SIGNUP_FREE_CREDITS} كريدي مجانا`));
  assert.ok(COPY.pricing.fr.includes(`${VISION_CREDIT_COST} crédit = 1 fiche lue`));
  assert.ok(COPY.pricing.ar.includes(`${VISION_CREDIT_COST} كريدي = ورقة وحدة كتقرا`));
});

test('the menu buttons are the three menu choices, with titles WhatsApp accepts', () => {
  assert.deepEqual(
    MENU_BUTTONS.map((b) => b.id),
    ['1', '2', '3'],
  );
  assert.equal(MENU_BUTTON_TITLE_MAX, 20);
  for (const button of MENU_BUTTONS) {
    assert.ok(button.title.trim().length > 0, button.id);
    assert.ok([...button.title].length <= MENU_BUTTON_TITLE_MAX, button.title);
    assert.equal(menuChoice(button.id), Number(button.id));
  }
  assert.equal(new Set(MENU_BUTTONS.map((b) => b.title)).size, 3);
});

test('tapping a menu button gets the same reply as typing its digit', () => {
  const [howItWorks, pricing, advisor] = MENU_BUTTONS;
  assert.equal(run({ event: { text: howItWorks.id } }).text, COPY.howItWorks.fr);
  assert.equal(run({ event: { text: pricing.id }, contact: { lang: 'ar' } }).text, COPY.pricing.ar);
  assert.equal(run({ event: { text: advisor.id }, handoffMode: 'redirect' }).text, `${COPY.advisor.fr}\n\n${COPY.redirect.fr}`);
});

test('the button greeting points at the buttons; its plain fallback keeps the typed 1/2/3 menu', () => {
  assert.ok(COPY.greeting.includes('👇'));
  assert.ok(!COPY.greeting.includes('1️⃣'));
  assert.ok(!COPY.greeting.includes('1 / 2 / 3'));
  assert.ok(COPY.greetingPlain.includes('1️⃣ Comment ça marche'));
  assert.ok(COPY.greetingPlain.includes('جاوب بـ 1 / 2 / 3'));
  // WhatsApp caps an interactive message body at 1024 characters.
  assert.ok([...COPY.greeting].length <= 1024);
});

test('only the first-contact greeting carries buttons', () => {
  assert.equal(run({ event: { text: '2' } }).menu, undefined);
  assert.equal(run({ event: { kind: 'video', text: null } }).menu, undefined);
  assert.ok(run({ event: { kind: 'video', text: null }, contact: { greetedAt: null } }).menu);
});

// --- ad pre-filled messages ----------------------------------------------------

const { isAdPrefill, resolveLang, AD_DEFAULT_LANG, REGREET_QUIET_MINUTES } = load('src/lib/whatsapp/router.ts');

test('isAdPrefill: the ad referral, or one of the texts WhatsApp pre-fills', () => {
  const ev = (text, referral = null, kind = 'text') => ({ kind, text, referral });
  assert.equal(isAdPrefill(ev('salam', { source_type: 'ad' })), true);
  assert.equal(isAdPrefill(ev('Bonjour ! Puis-je en savoir plus à ce sujet ?')), true);
  assert.equal(isAdPrefill(ev('Hello! Can I get more info on this?')), true);
  assert.equal(isAdPrefill(ev('مرحبًا! هل يمكنني الحصول على مزيد من المعلومات حول هذا؟')), true);
  assert.equal(isAdPrefill(ev('Bonjour, combien ça coûte ?')), false);
  assert.equal(isAdPrefill(ev('سلام')), false);
  assert.equal(isAdPrefill(ev(null, null, 'image')), false);
});

test('resolveLang: an ad message sets darija on a first contact and keeps a known contact language', () => {
  const prefill = { kind: 'text', text: 'Bonjour ! Puis-je en savoir plus à ce sujet ?', referral: null };
  assert.equal(AD_DEFAULT_LANG, 'ar');
  assert.equal(resolveLang(prefill, { lang: 'fr', greetedAt: null }), 'ar');
  assert.equal(resolveLang(prefill, { lang: 'fr', greetedAt: NOW }), 'fr');
  // Typed text is detected as before.
  assert.equal(resolveLang({ kind: 'text', text: 'je veux les tarifs', referral: null }, { lang: 'ar', greetedAt: NOW }), 'fr');
  assert.equal(resolveLang({ kind: 'text', text: '2', referral: null }, { lang: 'ar', greetedAt: NOW }), 'ar');
});

test('an ad message from a greeted contact gets the menu again, unless it is the tail of the first burst', () => {
  const prefill = { text: 'Bonjour ! Puis-je en savoir plus à ce sujet ?', referral: { source_type: 'ad' } };
  const later = run({ event: prefill, contact: { greetedAt: new Date(NOW.getTime() - 60 * 60 * 1000) } });
  assert.deepEqual(later, {
    action: 'send',
    text: COPY.menuAgain,
    markGreeted: false,
    handoff: false,
    menu: { buttons: MENU_BUTTONS, fallbackText: COPY.menuAgainPlain },
  });
  const sameBurst = run({
    event: prefill,
    contact: { greetedAt: new Date(NOW.getTime() - (REGREET_QUIET_MINUTES - 1) * 60 * 1000) },
  });
  assert.deepEqual(sameBurst, { action: 'silent' });
  // A human who took over still keeps the bot quiet.
  assert.deepEqual(
    run({ event: prefill, contact: { greetedAt: null, handoffUntil: new Date(NOW.getTime() + 1000) } }),
    { action: 'silent' },
  );
});

test('the bot links are short WhatsApp links (tagged by their redirect), and the darija texts open the Arabic site', () => {
  const { SITE_LINKS, ATELIER_LINK } = load('src/lib/whatsapp/copy.ts');
  assert.equal(SITE_LINKS.fr, 'https://qatlia.ma/wa');
  assert.equal(SITE_LINKS.ar, 'https://qatlia.ma/wa/ar');
  assert.ok(COPY.pricing.ar.includes(SITE_LINKS.ar));
  // A photo is answered with the workshop, which opens without an account.
  assert.ok(COPY.imageHint.fr.includes(ATELIER_LINK));
  assert.ok(COPY.imageHint.ar.includes(ATELIER_LINK));
  for (const text of [COPY.greeting, COPY.greetingPlain, COPY.pricing.fr, COPY.howItWorks.fr, COPY.imageHint.fr]) {
    assert.ok(!/https:\/\/qatlia\.ma(?![/?])/.test(text) && !/qatlia\.ma\s/.test(text), 'no untagged site link');
  }
});
