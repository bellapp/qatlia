const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// How the back office reads credit_transactions (plan 2026-11-12, Task 2).
// Optimization refunds are stored with type 'purchase' — they must never be
// counted as a purchase or as revenue.

const { classifyLedgerEntry, summarizeLedger, LEDGER_KEY_PREFIXES } = loadTsModule('src/lib/admin/ledger.ts');

const row = (over) => ({
  id: 'x',
  type: 'usage',
  amount: -1,
  balance_after: 0,
  description: null,
  reason: null,
  stripe_payment_id: null,
  created_at: '2026-11-01T10:00:00Z',
  ...over,
});

test('LEDGER_KEY_PREFIXES matches the keys the payment paths write', () => {
  assert.deepEqual(LEDGER_KEY_PREFIXES, {
    manual: 'manual:',
    creem: 'creem:',
    stripe: 'cs:',
    refund: 'optimize_refund_',
    admin: 'admin:',
  });
});

test("classifyLedgerEntry suit l'ordre des règles", () => {
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 80, reason: 'standard', stripe_payment_id: 'manual:abc' })), 'manual_payment');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 30, reason: 'starter', stripe_payment_id: 'creem:tran_1' })), 'card_creem');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 30, reason: 'starter', stripe_payment_id: 'cs:cs_1' })), 'card_stripe');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 1, reason: 'refund', stripe_payment_id: 'optimize_refund_1_ab' })), 'refund');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 1, reason: 'refund', stripe_payment_id: null })), 'refund');
  assert.equal(classifyLedgerEntry(row({ type: 'adjustment', amount: 10, reason: 'admin_adjustment', stripe_payment_id: 'admin:r1' })), 'admin_adjustment');
  assert.equal(classifyLedgerEntry(row({ reason: 'vision' })), 'scan');
  assert.equal(classifyLedgerEntry(row({ reason: 'optimize' })), 'optimization');
  assert.equal(classifyLedgerEntry(row({ type: null, reason: null })), 'other');
});

test("summarizeLedger : un remboursement n'est ni un achat ni un revenu", () => {
  const s = summarizeLedger(
    [
      row({ type: 'purchase', amount: 80, stripe_payment_id: 'manual:a', created_at: '2026-11-02T10:00:00Z' }),
      row({ type: 'purchase', amount: 1, reason: 'refund', stripe_payment_id: 'optimize_refund_1' }),
      row({ reason: 'vision' }),
      row({ reason: 'vision' }),
      row({ reason: 'optimize' }),
    ],
    98
  );
  assert.deepEqual(
    [s.purchaseCount, s.creditsPurchased, s.creditsRefunded, s.scans, s.optimizations, s.creditsUsed, s.freeCredits],
    [1, 80, 1, 2, 1, 3, 20]
  );
  assert.equal(s.firstPurchaseAt, '2026-11-02T10:00:00Z');
  assert.equal(s.lastPurchaseAt, '2026-11-02T10:00:00Z');
  assert.equal(s.lastEntryAt, '2026-11-02T10:00:00Z');
});

test('summarizeLedger : premier et dernier achat, quel que soit l’ordre des lignes', () => {
  const s = summarizeLedger(
    [
      row({ type: 'purchase', amount: 30, stripe_payment_id: 'creem:b', created_at: '2026-11-05T10:00:00Z' }),
      row({ type: 'purchase', amount: 30, stripe_payment_id: 'cs:a', created_at: '2026-10-05T10:00:00Z' }),
    ],
    80
  );
  assert.deepEqual([s.purchaseCount, s.firstPurchaseAt, s.lastPurchaseAt], [2, '2026-10-05T10:00:00Z', '2026-11-05T10:00:00Z']);
});

test('summarizeLedger : ajustements admin comptés à part', () => {
  const s = summarizeLedger([row({ type: 'adjustment', amount: -5, stripe_payment_id: 'admin:r' }), row({ type: 'adjustment', amount: 10, stripe_payment_id: 'admin:s' })], 25);
  assert.deepEqual([s.creditsAdjusted, s.creditsUsed, s.purchaseCount], [5, 0, 0]);
});

test('summarizeLedger : aucun mouvement donne des zéros et des dates nulles', () => {
  const s = summarizeLedger([], 20);
  assert.deepEqual([s.purchaseCount, s.creditsUsed, s.lastEntryAt, s.firstPurchaseAt, s.freeCredits], [0, 0, null, null, 20]);
});

test('summarizeLedger : solde inconnu donne des crédits offerts inconnus', () => {
  assert.equal(summarizeLedger([row({ reason: 'vision' })], null).freeCredits, null);
});

test('summarizeLedger : un montant non numérique est ignoré, pas propagé en NaN', () => {
  const s = summarizeLedger([row({ reason: 'vision', amount: 'abc' }), row({ reason: 'vision', amount: '-1' })], 10);
  assert.equal(s.scans, 2);
  assert.equal(s.creditsUsed, 1);
  assert.ok(Number.isFinite(s.freeCredits));
});
