const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The first message a prospect from the ad reads (analysis of the 80 ad
// conversations, 20/11/2026): 59 % left after the long bilingual greeting,
// which never said that a photo or a voice note can be sent right here.

const load = (rel) => loadTsModule(path.resolve(__dirname, '..', rel));
const { COPY, DEMO_VIDEO_URLS, MENU_BUTTONS, greeting, exampleCaption } = load('src/lib/whatsapp/copy.ts');
const { decide, resolveLang } = load('src/lib/whatsapp/router.ts');

const NOW = new Date('2026-11-20T16:00:00.000Z');
const ARABIC = /[؀-ۿ]/;
const AR_PREFILL = 'مرحبًا! هل يمكنني الحصول على مزيد من المعلومات حول هذا؟';
const FR_PREFILL = 'Bonjour ! Puis-je en savoir plus à ce sujet ?';

const firstContact = (text, lang, voiceEnabled = true) =>
  decide({
    event: { type: 'inbound', wamid: 'w', waId: '1', profileName: null, kind: 'text', text, referral: null },
    contact: { waId: '1', lang, greetedAt: null, handoffUntil: null },
    now: NOW,
    assistantRepliesLast24h: 0,
    handoffMode: 'redirect',
    voiceEnabled,
  });

test('the greeting opens on the photo to send here, then the voice note', () => {
  const ar = greeting({ lang: 'ar', bilingual: false, voice: true }).text;
  const fr = greeting({ lang: 'fr', bilingual: false, voice: true }).text;
  assert.match(ar.split('\n')[1], /^📸 صيفط ليا هنا/);
  assert.match(ar.split('\n')[2], /^🎤 /);
  assert.match(fr.split('\n')[1], /^📸 Envoyez-moi ici la photo de votre fiche/);
  assert.match(fr.split('\n')[2], /^🎤 /);
});

test('a darija-only greeting has no French, a French-only one no Arabic', () => {
  const ar = greeting({ lang: 'ar', bilingual: false, voice: true });
  const fr = greeting({ lang: 'fr', bilingual: false, voice: true });
  for (const text of [ar.text, ar.plain]) assert.doesNotMatch(text, /Bonjour|Envoyez|Choisissez|Répondez/);
  for (const text of [fr.text, fr.plain]) assert.doesNotMatch(text, ARABIC);
});

test('the bilingual greeting puts the contact language first', () => {
  const arFirst = greeting({ lang: 'ar', bilingual: true, voice: true }).text;
  const frFirst = greeting({ lang: 'fr', bilingual: true, voice: true }).text;
  assert.ok(arFirst.indexOf('صيفط ليا هنا') < arFirst.indexOf('Envoyez-moi ici'));
  assert.ok(frFirst.indexOf('Envoyez-moi ici') < frFirst.indexOf('صيفط ليا هنا'));
});

test('the greeting is short: one link, the demo video in the contact language, and no site link to compete with the photo', () => {
  for (const lang of ['ar', 'fr']) {
    for (const bilingual of [true, false]) {
      const { text, plain } = greeting({ lang, bilingual, voice: true });
      for (const body of [text, plain]) {
        assert.deepEqual(body.match(/https?:\/\/\S+/g), [DEMO_VIDEO_URLS[lang]], `${lang} ${bilingual}`);
      }
      assert.ok([...text].length <= (bilingual ? 480 : 260), `${lang} ${bilingual}: ${[...text].length}`);
    }
  }
});

test('voice off: the greeting does not invite a voice note', () => {
  for (const lang of ['ar', 'fr']) {
    for (const bilingual of [true, false]) {
      const { text, plain } = greeting({ lang, bilingual, voice: false });
      assert.doesNotMatch(text, /🎤/);
      assert.doesNotMatch(plain, /🎤/);
    }
  }
});

test('the button greeting points at the buttons; the plain one keeps the typed 1/2/3 menu', () => {
  for (const lang of ['ar', 'fr']) {
    for (const bilingual of [true, false]) {
      const { text, plain } = greeting({ lang, bilingual, voice: true });
      assert.ok(text.includes('👇'));
      assert.ok(!text.includes('1️⃣'));
      assert.ok(plain.includes('1️⃣') && plain.includes('2️⃣') && plain.includes('3️⃣'));
    }
  }
  assert.ok(COPY.greetingPlain.includes('1️⃣ Comment ça marche'));
  assert.ok(COPY.greetingPlain.includes('جاوب بـ 1 / 2 / 3'));
});

test('a first message in Arabic letters gets the darija-only greeting', () => {
  for (const text of [AR_PREFILL, 'سلام', 'بشحال']) {
    const d = firstContact(text, 'ar');
    const expected = greeting({ lang: 'ar', bilingual: false, voice: true });
    assert.deepEqual(d, {
      action: 'send',
      text: expected.text,
      markGreeted: true,
      handoff: false,
      greeting: true,
      menu: { buttons: MENU_BUTTONS, fallbackText: expected.plain },
      exampleCaption: exampleCaption('ar', false),
    });
  }
});

test('the French pre-filled text (a French phone, often a darija speaker) gets both languages, darija first', () => {
  const d = firstContact(FR_PREFILL, 'ar');
  assert.equal(d.text, greeting({ lang: 'ar', bilingual: true, voice: true }).text);
  assert.equal(d.greeting, true);
});

test('a typed French first message gets both languages, French first', () => {
  const d = firstContact('Bonjour, c’est combien ?', 'fr');
  assert.equal(d.text, greeting({ lang: 'fr', bilingual: true, voice: true }).text);
});

test('voice off: the greeting decided for a first contact has no voice line', () => {
  assert.doesNotMatch(firstContact('سلام', 'ar', false).text, /🎤/);
  assert.doesNotMatch(firstContact(FR_PREFILL, 'ar', false).text, /🎤/);
});

test('the Arabic pre-filled text sets darija even for a contact known in French', () => {
  const prefill = { kind: 'text', text: AR_PREFILL, referral: null };
  assert.equal(resolveLang(prefill, { lang: 'fr', greetedAt: NOW }), 'ar');
  assert.equal(resolveLang(prefill, { lang: 'fr', greetedAt: null }), 'ar');
  // The French pre-filled text still leaves a known contact's language alone.
  assert.equal(resolveLang({ kind: 'text', text: FR_PREFILL, referral: null }, { lang: 'fr', greetedAt: NOW }), 'fr');
});

test('"how it works" also says the photo can be sent here', () => {
  assert.match(COPY.howItWorks.fr, /📸 .*ici/);
  assert.match(COPY.howItWorks.ar, /📸 .*هنا/);
});
