const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadTsModule } = require('./helpers/load-ts-module');

// « How do I buy credits? » on WhatsApp: one link that opens the purchase page,
// instead of « sign in, open the account menu, then Buy credits ».

const { CREDITS_LINK, SITE_LINKS } = loadTsModule('src/lib/whatsapp/copy.ts');
const { buildSystemPrompt } = loadTsModule('src/lib/whatsapp/assistant.ts');
const { parseAcquisition } = loadTsModule('src/lib/acquisition.ts');

const NOW = Date.parse('2026-11-24T12:00:00Z');

test('the credits link is short and opens the purchase page with the WhatsApp tag', async () => {
  assert.equal(CREDITS_LINK, 'https://qatlia.ma/wa/credits');
  const config = (await import(pathToFileURL(path.resolve(__dirname, '..', 'next.config.mjs')).href)).default;
  const rule = (await config.redirects()).find((r) => r.source === '/wa/credits');
  assert.ok(rule);
  assert.equal(rule.permanent, false);
  const [target, search] = rule.destination.split('?');
  assert.equal(target, '/credits');
  assert.deepEqual(parseAcquisition(`?${search}`, NOW).tags, { signup_source: 'whatsapp' });
});

test('the Play Store app never takes the link: it opens in the browser, where buying is possible', () => {
  const { APP_LINK_PATHS } = require('../mobile/android/scripts/restrict-links.js');
  for (const opened of ['/wa/credits', '/credits']) {
    assert.ok(!APP_LINK_PATHS.some((prefix) => opened.startsWith(prefix)), opened);
  }
});

test('the assistant gives that link, and no more the menu to find', () => {
  for (const mode of ['coexistence', 'redirect']) {
    const prompt = buildSystemPrompt(mode);
    assert.ok(prompt.includes(`Pour acheter ou recharger des crédits : ouvrir ${CREDITS_LINK}`), mode);
    assert.ok(!prompt.includes('ouvrir le menu du compte'), mode);
    assert.ok(
      prompt.includes(`Si la personne veut acheter ou recharger des crédits, donne-lui seulement ce lien, recopié tel quel : ${CREDITS_LINK}`),
      mode
    );
    // Prices and sign-up keep the site link.
    assert.ok(prompt.includes("Ne donne le lien du site que si la personne parle d'inscription, de compte ou de prix"), mode);
    assert.ok(prompt.includes(SITE_LINKS.ar), mode);
    // Payment questions still go to a human, and cards are still never named.
    assert.ok(prompt.includes('Ne parle jamais de carte bancaire'), mode);
    assert.ok(prompt.includes('si on te demande comment payer, handoff true'), mode);
  }
});
