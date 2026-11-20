const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadTsModule } = require('./helpers/load-ts-module');

// Short bot links (qatlia.ma/wa, /wa/ar, /wa/atelier, /w/<code>): the prospect
// never sees "utm_source=whatsapp", in the chat or in the address bar, and
// sign-ups still record where they came from (src/lib/acquisition.ts).

const { COPY, SITE_LINKS, ATELIER_LINK, PHOTO_COPY } = loadTsModule('src/lib/whatsapp/copy.ts');
const { photoLink, PHOTO_LINK_TRACKING } = loadTsModule('src/lib/whatsapp/photo-summary.ts');
const { buildSystemPrompt } = loadTsModule('src/lib/whatsapp/assistant.ts');
const { parseAcquisition, withoutTracking, recordVisit, ACQUISITION_KEY, ACQUISITION_COOKIE } = loadTsModule('src/lib/acquisition.ts');

const NOW = Date.parse('2026-11-20T12:00:00Z');

test('the bot links are short', () => {
  assert.equal(SITE_LINKS.fr, 'https://qatlia.ma/wa');
  assert.equal(SITE_LINKS.ar, 'https://qatlia.ma/wa/ar');
  assert.equal(ATELIER_LINK, 'https://qatlia.ma/wa/atelier');
  assert.equal(photoLink('k7m2qx9dab'), 'https://qatlia.ma/w/k7m2qx9dab');
});

test('no bot text, nor the assistant prompt, shows a utm tag', () => {
  const texts = [
    COPY.greeting,
    COPY.greetingPlain,
    COPY.menuAgain,
    COPY.menuAgainPlain,
    ...['howItWorks', 'pricing', 'advisor', 'redirect', 'imageHint', 'mediaHandoff', 'voiceUnclear', 'fallback'].flatMap((key) => [COPY[key].fr, COPY[key].ar]),
    PHOTO_COPY.unreadable.fr,
    PHOTO_COPY.already('fr', photoLink('k7m2qx9dab')),
    PHOTO_COPY.already('ar', null),
    buildSystemPrompt('coexistence'),
    buildSystemPrompt('redirect'),
  ];
  for (const text of texts) assert.doesNotMatch(text, /utm_/, text.slice(0, 60));
});

test('each short link redirects (temporarily) to its page with the WhatsApp tag', async () => {
  const config = (await import(pathToFileURL(path.resolve(__dirname, '..', 'next.config.mjs')).href)).default;
  const redirects = await config.redirects();
  const expected = { '/wa': '/', '/wa/ar': '/ar', '/wa/atelier': '/atelier' };
  for (const [source, page] of Object.entries(expected)) {
    const rule = redirects.find((r) => r.source === source);
    assert.ok(rule, source);
    assert.equal(rule.permanent, false, `${source}: a 307, so the target can change later`);
    const [target, search] = rule.destination.split('?');
    assert.equal(target, page);
    assert.deepEqual(parseAcquisition(`?${search}`, NOW).tags, { signup_source: 'whatsapp' }, source);
  }
  for (const link of [SITE_LINKS.fr, SITE_LINKS.ar, ATELIER_LINK]) {
    assert.ok(redirects.some((r) => `https://qatlia.ma${r.source}` === link), link);
  }
});

test('the photo link records its own provenance: whatsapp · bot · photo', () => {
  assert.deepEqual(parseAcquisition(PHOTO_LINK_TRACKING, NOW).tags, {
    signup_source: 'whatsapp',
    signup_medium: 'bot',
    signup_campaign: 'photo',
  });
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/app/(site)/w/[code]/OpenInAtelier.tsx'), 'utf8');
  const recorded = source.indexOf('recordBrowserVisit(PHOTO_LINK_TRACKING)');
  assert.notEqual(recorded, -1, 'OpenInAtelier records the photo provenance');
  assert.ok(recorded < source.indexOf("router.replace('/atelier')"), 'before the atelier opens');
});

test('withoutTracking drops the utm tags and keeps everything else', () => {
  assert.equal(withoutTracking('/ar', '?utm_source=whatsapp', ''), '/ar');
  assert.equal(withoutTracking('/', '?utm_source=whatsapp&utm_medium=bot&utm_campaign=photo', ''), '/');
  assert.equal(withoutTracking('/atelier', '?x=1&utm_source=whatsapp', '#plan'), '/atelier?x=1#plan');
  assert.equal(withoutTracking('/atelier', '?x=1', ''), null, 'nothing to drop');
  assert.equal(withoutTracking('/', '', ''), null);
});

test('recordVisit remembers the tags and gives the cookie for the Google sign-up', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const cookies = [];
  recordVisit(storage, PHOTO_LINK_TRACKING, NOW, true, (cookie) => cookies.push(cookie));
  assert.equal(JSON.parse(store.get(ACQUISITION_KEY)).tags.signup_campaign, 'photo');
  assert.equal(cookies.length, 1);
  assert.ok(cookies[0].startsWith(`${ACQUISITION_COOKIE}=`));
  assert.match(cookies[0], /Secure/);
  // An untagged visit with nothing remembered sets no cookie.
  const empty = [];
  recordVisit({ getItem: () => null, setItem() {}, removeItem() {} }, '', NOW, true, (c) => empty.push(c));
  assert.equal(empty.length, 0);
});

test('the shell records every visit through recordBrowserVisit, then cleans the address bar', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/components/ClientShell.tsx'), 'utf8');
  assert.match(source, /recordBrowserVisit\(window\.location\.search\)/);
  assert.match(source, /withoutTracking\(/);
  assert.match(source, /history\.replaceState\(/);
  assert.ok(source.indexOf('recordBrowserVisit(') < source.indexOf('history.replaceState('), 'recorded before cleaned');
});
