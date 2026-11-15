const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// The bank account for transfers comes from server env vars only. These tests
// use a well-known public example IBAN, never the real account.
const { readBankTransferDetails, isValidIban } = loadTsModule('src/lib/billing/bank-transfer.ts');

// Valid Moroccan IBAN from the public IBAN examples registry.
const EXAMPLE_IBAN = 'MA64 0115 1900 0001 2050 0053 4921';

const quiet = (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

test('a configured account is returned with the RIB and IBAN grouped as banks print them', () => {
  const details = readBankTransferDetails({
    BANK_TRANSFER_IBAN: EXAMPLE_IBAN.toLowerCase(),
    BANK_TRANSFER_BIC: ' bmcemamc ',
    BANK_TRANSFER_HOLDER: '  EXAMPLE SARL ',
    BANK_TRANSFER_BANK_NAME: 'Bank of Africa',
  });
  assert.deepEqual(details, {
    holder: 'EXAMPLE SARL',
    bankName: 'Bank of Africa',
    rib: '011 519 0000012050005349 21',
    iban: 'MA64 0115 1900 0001 2050 0053 4921',
    bic: 'BMCEMAMC',
  });
});

test('the bank name is optional', () => {
  const details = readBankTransferDetails({
    BANK_TRANSFER_IBAN: EXAMPLE_IBAN,
    BANK_TRANSFER_BIC: 'BMCEMAMC',
    BANK_TRANSFER_HOLDER: 'EXAMPLE SARL',
  });
  assert.equal(details.bankName, null);
});

test('nothing configured means nothing shown', () => {
  assert.equal(readBankTransferDetails({}), null);
});

test('a mistyped IBAN hides the block instead of sending money to a wrong account', () => {
  const typo = EXAMPLE_IBAN.replace('4921', '4912');
  assert.equal(isValidIban(typo.replace(/\s/g, '')), false);
  assert.equal(
    quiet(() => readBankTransferDetails({ BANK_TRANSFER_IBAN: typo, BANK_TRANSFER_BIC: 'BMCEMAMC', BANK_TRANSFER_HOLDER: 'X' })),
    null
  );
});

test('a non-Moroccan IBAN, a bad BIC or a missing holder hide the block', () => {
  const base = { BANK_TRANSFER_IBAN: EXAMPLE_IBAN, BANK_TRANSFER_BIC: 'BMCEMAMC', BANK_TRANSFER_HOLDER: 'X' };
  quiet(() => {
    assert.equal(readBankTransferDetails({ ...base, BANK_TRANSFER_IBAN: 'FR76 3000 6000 0112 3456 7890 189' }), null);
    assert.equal(readBankTransferDetails({ ...base, BANK_TRANSFER_BIC: 'BMCE' }), null);
    assert.equal(readBankTransferDetails({ ...base, BANK_TRANSFER_HOLDER: ' ' }), null);
  });
});

test('isValidIban accepts known-good IBANs', () => {
  assert.equal(isValidIban('MA64011519000001205000534921'), true);
  assert.equal(isValidIban('FR7630006000011234567890189'), true);
});

test('the bank details only leave the server through the signed-in manual-payment route', () => {
  const route = fs.readFileSync(path.resolve('src/app/api/credits/manual/route.ts'), 'utf8');
  assert.match(route, /readBankTransferDetails\(\)/);
  // Each response carrying the details comes after the AUTH_REQUIRED guard.
  const authGuards = route.split('AUTH_REQUIRED').length - 1;
  assert.ok(authGuards >= 2, 'both POST and GET must refuse anonymous callers');

  // No client bundle may read the env vars directly.
  const credits = fs.readFileSync(path.resolve('src/app/(site)/credits/page.tsx'), 'utf8');
  assert.doesNotMatch(credits, /BANK_TRANSFER_|bank-transfer'/);
});
