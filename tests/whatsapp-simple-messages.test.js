const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Most carpenters who write to the bot are not at ease with technology (owner,
// 20/11/2026; YCloud conversations: voice notes, "سمحلي هدشي بعيد عليا").
// Every message says one thing to do, in everyday words, and that thing is the
// simplest one: send the photo of the cut list right here.

const load = (rel) => loadTsModule(path.resolve(__dirname, '..', rel));
const { COPY, PHOTO_COPY, DEMO_VIDEO_URL, SITE_LINKS } = load('src/lib/whatsapp/copy.ts');
const { buildSystemPrompt } = load('src/lib/whatsapp/assistant.ts');
const { CREDIT_PACKS } = load('src/lib/billing/catalog.ts');
const { SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } = load('src/lib/billing/policy.ts');

const JARGON_FR = /optimis|scann?|algorithm|interface|export|PDF|analyse|calepinage|\bIA\b/i;
const JARGON_AR = /التحسين|سكان|الذكاء الاصطناعي|PDF|تحليل/;
const lines = (text) => text.split('\n').filter((line) => line.trim() !== '');

const SHORT = ['howItWorks', 'advisor', 'imageHint', 'mediaHandoff', 'voiceUnclear'];

test('the short fixed replies use everyday words', () => {
  for (const key of [...SHORT, 'pricing']) {
    assert.doesNotMatch(COPY[key].fr, JARGON_FR, `${key}.fr`);
    assert.doesNotMatch(COPY[key].ar, JARGON_AR, `${key}.ar`);
  }
  assert.doesNotMatch(PHOTO_COPY.unreadable.fr, JARGON_FR);
  assert.doesNotMatch(PHOTO_COPY.unreadable.ar, JARGON_AR);
});

test('the short fixed replies fit in a few lines', () => {
  for (const key of SHORT) {
    for (const lang of ['fr', 'ar']) {
      assert.ok(lines(COPY[key][lang]).length <= 4, `${key}.${lang}: ${lines(COPY[key][lang]).length} lines`);
    }
  }
});

test('"how it works" is the photo sent here, then the demo: no account steps, no site link', () => {
  assert.match(lines(COPY.howItWorks.fr)[1], /📸 .*envoyez-la-moi ici/);
  assert.match(lines(COPY.howItWorks.ar)[1], /📸 .*صيفطها ليا هنا/);
  for (const text of [COPY.howItWorks.fr, COPY.howItWorks.ar]) {
    assert.deepEqual(text.match(/https?:\/\/\S+/g), [DEMO_VIDEO_URL]);
  }
});

test('a message the bot cannot open or hear points to the photo', () => {
  for (const key of ['mediaHandoff', 'voiceUnclear']) {
    assert.match(COPY[key].fr, /photo de votre fiche/, key);
    assert.match(COPY[key].ar, /تصويرة ورقة القياسات/, key);
  }
});

test('an unreadable photo asks for a new one here (the failed read frees the number)', () => {
  assert.match(PHOTO_COPY.unreadable.fr, /renvoyez-la-moi ici/);
  assert.match(PHOTO_COPY.unreadable.ar, /عاود صيفطها ليا هنا/);
});

test('the menu sent again also invites the photo', () => {
  for (const text of [COPY.menuAgain, COPY.menuAgainPlain]) {
    assert.match(text, /📸/);
  }
});

test('pricing keeps the packs, the gift and what a credit buys, in plain words', () => {
  for (const pack of Object.values(CREDIT_PACKS)) {
    assert.ok(COPY.pricing.fr.includes(`${pack.credits} crédits`), pack.id);
    assert.ok(COPY.pricing.ar.includes(`${pack.credits} كريدي`), pack.id);
  }
  assert.ok(COPY.pricing.fr.includes(`${SIGNUP_FREE_CREDITS} crédits gratuits`));
  assert.ok(COPY.pricing.ar.includes(`${SIGNUP_FREE_CREDITS} كريدي مجانا`));
  assert.ok(COPY.pricing.fr.includes(`${VISION_CREDIT_COST} crédit = 1 fiche lue + son plan de coupe`));
  assert.ok(COPY.pricing.ar.includes(`${VISION_CREDIT_COST} كريدي = ورقة وحدة كتقرا + مخطط التقطيع ديالها`));
  assert.ok(COPY.pricing.fr.includes(SITE_LINKS.fr));
  assert.ok(COPY.pricing.ar.includes(SITE_LINKS.ar));
  // Title, gift, what a credit buys, the packs heading, the packs, the link.
  assert.ok(lines(COPY.pricing.fr).length <= 5 + Object.keys(CREDIT_PACKS).length);
});

test('the assistant knows the photo can be sent here, and that voice notes are heard', () => {
  for (const mode of ['coexistence', 'redirect']) {
    const prompt = buildSystemPrompt(mode);
    assert.ok(prompt.includes('ici même, dans WhatsApp, la photo de sa fiche de débit'), mode);
    assert.ok(prompt.includes('message vocal'), mode);
  }
});

test('"how it works" says to take the photo with the phone', () => {
  assert.match(COPY.howItWorks.fr, /avec votre téléphone/);
  assert.match(COPY.howItWorks.ar, /صوّر ورقة القياسات ديالك بالتيليفون/);
});

test('the assistant says "photograph it with your phone", never "scan it" (owner, 20/11/2026)', () => {
  const prompt = buildSystemPrompt('redirect');
  assert.ok(prompt.includes('« صوّرها بالتيليفون »'));
  assert.ok(prompt.includes('jamais « سكاني »'));
  assert.ok(prompt.includes('« prenez-la en photo avec votre téléphone »'));
});

test('the assistant writes for people not at ease with technology', () => {
  const prompt = buildSystemPrompt('redirect');
  assert.ok(prompt.includes("pas à l'aise avec la technologie"));
  assert.ok(prompt.includes('3 lignes courtes maximum'));
  assert.ok(!prompt.includes('5 lignes courtes maximum'));
  assert.ok(prompt.includes('une seule chose à faire'));
  assert.ok(prompt.includes('« optimisation »'));
  // The photo first; the site only when it is what the person asks about.
  assert.ok(prompt.includes("propose d'abord d'envoyer ici la photo de sa fiche"));
  assert.ok(prompt.includes("Ne donne le lien du site que si la personne parle d'inscription, de compte ou de prix"));
  assert.ok(!prompt.includes('Invite la personne à essayer, avec le lien'));
});
