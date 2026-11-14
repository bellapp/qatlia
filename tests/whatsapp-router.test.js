const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(PROJECT_ROOT, rel));

const { COPY, DEMO_VIDEO_URL } = load('src/lib/whatsapp/copy.ts');
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

const run = ({ event = {}, contact: c = {}, assistantRepliesLast24h = 0, handoffMode = 'coexistence' } = {}) =>
  decide({
    event: inbound(event),
    contact: contact(c),
    now: NOW,
    assistantRepliesLast24h,
    handoffMode,
  });

test('constants', () => {
  assert.equal(HANDOFF_HOURS, 24);
  assert.equal(MAX_ASSISTANT_REPLIES_PER_DAY, 20);
  assert.equal(DEMO_VIDEO_URL, 'https://youtu.be/dQE_PzXUAR0');
});

test('new contact gets the greeting and is marked greeted', () => {
  const d = run({
    event: { text: 'Bonjour ! Puis-je en savoir plus à ce sujet ?' },
    contact: { greetedAt: null },
  });
  assert.deepEqual(d, { action: 'send', text: COPY.greeting, markGreeted: true, handoff: false });
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
  for (const text of [COPY.howItWorks.fr, COPY.howItWorks.ar, COPY.greeting]) {
    assert.ok(text.indexOf(DEMO_VIDEO_URL) !== -1);
    assert.ok(text.indexOf(DEMO_VIDEO_URL) < text.indexOf('https://qatlia.ma'));
  }
});

test('the pricing copy derives its free-recalculation window from the policy and speaks of the same list', () => {
  const { ANALYSIS_WINDOW_HOURS } = load('src/lib/billing/policy.ts');
  assert.ok(COPY.pricing.fr.includes(`${ANALYSIS_WINDOW_HOURS} h`));
  assert.ok(COPY.pricing.fr.includes('la même liste'));
  assert.ok(!COPY.pricing.fr.includes('même projet'));
  assert.ok(COPY.pricing.ar.includes(`${ANALYSIS_WINDOW_HOURS} ساعة`));
  assert.ok(COPY.pricing.ar.includes('نفس اللائحة'));
  assert.ok(!COPY.pricing.ar.includes('نفس المشروع'));
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

test('image gets the image hint', () => {
  assert.deepEqual(run({ event: { kind: 'image', text: null } }), {
    action: 'send',
    text: COPY.imageHint.fr,
    markGreeted: false,
    handoff: false,
  });
});

test('a new contact sending an image is greeted first', () => {
  const d = run({ event: { kind: 'image', text: null }, contact: { greetedAt: null } });
  assert.equal(d.text, COPY.greeting);
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
  for (const key of ['howItWorks', 'pricing', 'advisor', 'redirect', 'imageHint', 'mediaHandoff', 'fallback']) {
    for (const lang of ['fr', 'ar']) {
      assert.ok(typeof COPY[key][lang] === 'string' && COPY[key][lang].length > 0, `${key}.${lang}`);
    }
  }
});
