const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// User request, 2026-11-16: in the bar under the header, the history entry sat
// in the middle of the entries that act on the job on screen. It leaves the
// atelier for another page, so it goes last, and it says what it lists.

const source = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');

/** The entries of the bar, from its first one to the machine figures at its end. */
function navEntries() {
  const start = source.indexOf("aria-label={t('atelier.sidebar.title')}");
  const end = source.indexOf('Machine setup figures', start);
  assert.ok(start > 0 && end > start, 'the atelier has its bar of entries');
  return source.slice(start, end);
}

test('the history entry is the last one of the bar', () => {
  const bar = navEntries();
  const history = bar.indexOf('<Link href="/history"');

  assert.ok(history > 0, 'the bar leads to the history');
  const quotation = bar.indexOf('atelier.sidebar.navQuotation');
  assert.ok(quotation > 0 && quotation < history, 'the quotation comes before the history');
  assert.equal(bar.indexOf('<button', history), -1, 'no entry follows the history');
});

test('the history entry says it lists the cut lists', () => {
  const bar = navEntries();
  const link = bar.slice(bar.indexOf('<Link href="/history"'), bar.indexOf('</Link>'));

  assert.ok(link.includes("t('atelier.sidebar.navHistory')"));
  for (const [locale, name] of [['fr', 'Historique des débits'], ['en', 'Cut list history'], ['ar', 'سجل قوائم القطع']]) {
    const messages = fs.readFileSync(path.resolve(`src/i18n/messages/${locale}.ts`), 'utf8');
    assert.ok(messages.includes(`navHistory: '${name}',`), `${locale} names the entry`);
  }
});
