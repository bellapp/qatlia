const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A saved project keeps a reduced copy of its scan (src/lib/projects/scan-image.ts,
// private `scans` bucket), removed with the account. The privacy policy, which
// Google Play compares with the app's Data safety form, has to say so.

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

const NOT_KEPT = {
  fr: ['QatliA ne les enregistre pas', 'non conservées par QatliA après l’analyse'],
  en: ['QatliA does not store them', 'not kept by QatliA after the analysis'],
  ar: ['لا تحتفظ بها QatliA.', 'لا تحتفظ بها QatliA بعد التحليل'],
};

const KEPT = {
  fr: /version réduite[^']*projet enregistré/,
  en: /reduced copy[^']*saved project/,
  ar: /مصغّرة[^']*المشروع المحفوظ/,
};

for (const locale of ['fr', 'en', 'ar']) {
  test(`${locale}: the privacy policy says a saved project keeps a reduced photo`, () => {
    const source = read(`src/i18n/messages/legal/${locale}.ts`);
    for (const claim of NOT_KEPT[locale]) assert.ok(!source.includes(claim), `still claims: ${claim}`);
    const matches = source.match(new RegExp(KEPT[locale].source, 'g')) || [];
    assert.equal(matches.length, 2, 'both the data list and the retention list say it');
  });
}

test('the policy date moves with the change', () => {
  // On or after the photo change; a later change of the policy moves it again
  // (2026-11-27: referral data and cookie).
  const date = read('src/lib/legal.ts').match(/LEGAL_UPDATED_AT = '(\d{4}-\d{2}-\d{2})'/)?.[1];
  assert.ok(date && date >= '2026-11-22', `LEGAL_UPDATED_AT is ${date}`);
});
