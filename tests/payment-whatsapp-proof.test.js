const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The payment dialog's WhatsApp contact was a small text link customers missed.
// It is now a button that says what to send, with the number shown and the
// message already carrying the order number.

const support = loadTsModule('src/lib/support.ts');
const { translate } = loadTsModule('src/i18n/index.ts');

test('the WhatsApp number is shown the way a Moroccan customer dials it', () => {
  assert.equal(support.SUPPORT_WHATSAPP, '212600937523');
  assert.equal(support.SUPPORT_WHATSAPP_DISPLAY, '06 00 93 75 23');
});

test('the proof message carries the order number in every locale', () => {
  for (const locale of ['fr', 'en', 'ar']) {
    const message = translate(locale, 'creditsPage.manual.proofMessage', { orderNumber: 'QIA-20261115-ABCD' });
    assert.match(message, /QIA-20261115-ABCD/, locale);
    const url = support.supportWhatsAppUrl(message);
    assert.ok(url.startsWith('https://wa.me/212600937523?text='), locale);
    assert.equal(decodeURIComponent(url.split('?text=')[1]), message, locale);
  }
});

test('the payment dialog offers the WhatsApp proof button with the order number', () => {
  const page = fs.readFileSync(path.resolve('src/app/(site)/credits/page.tsx'), 'utf8');
  assert.match(page, /data-testid="send-proof-whatsapp"/);
  assert.match(page, /supportWhatsAppUrl\(t\('creditsPage\.manual\.proofMessage', \{ orderNumber: manualOrder\.order_number \}\)\)/);
});
