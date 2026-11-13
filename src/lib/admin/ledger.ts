/**
 * How the back office reads the credit ledger (public.credit_transactions).
 *
 * Every credit movement lands in that one table, and the payment path that
 * wrote a row is recognisable from its idempotency key (stored in the
 * historically-named `stripe_payment_id` column). Optimization refunds are
 * written through add_credits with type 'purchase', so they must be told
 * apart here: they are neither a sale nor revenue.
 *
 * Pure module: safe to import from a client component or a plain Node test.
 */

/** The key prefix each writer uses. The SQL in migration 012 repeats them. */
export const LEDGER_KEY_PREFIXES = {
  manual: 'manual:',
  creem: 'creem:',
  stripe: 'cs:',
  refund: 'optimize_refund_',
  admin: 'admin:',
} as const;

export type LedgerKind =
  | 'manual_payment'
  | 'card_creem'
  | 'card_stripe'
  | 'refund'
  | 'admin_adjustment'
  | 'scan'
  | 'optimization'
  | 'other';

export const PAYMENT_KINDS: readonly LedgerKind[] = ['manual_payment', 'card_creem', 'card_stripe'];

export interface LedgerRow {
  id: string;
  type: string | null;
  amount: number;
  balance_after: number | null;
  description: string | null;
  reason: string | null;
  stripe_payment_id: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  created_at: string;
}

export function classifyLedgerEntry(row: LedgerRow): LedgerKind {
  const key = typeof row.stripe_payment_id === 'string' ? row.stripe_payment_id : '';
  if (key.startsWith(LEDGER_KEY_PREFIXES.manual)) return 'manual_payment';
  if (key.startsWith(LEDGER_KEY_PREFIXES.creem)) return 'card_creem';
  if (key.startsWith(LEDGER_KEY_PREFIXES.stripe)) return 'card_stripe';
  if (row.reason === 'refund' || key.startsWith(LEDGER_KEY_PREFIXES.refund)) return 'refund';
  if (key.startsWith(LEDGER_KEY_PREFIXES.admin) || row.type === 'adjustment') return 'admin_adjustment';
  if (row.type === 'usage' && row.reason === 'vision') return 'scan';
  if (row.type === 'usage' && row.reason === 'optimize') return 'optimization';
  return 'other';
}

export function isPaymentKind(kind: LedgerKind): boolean {
  return PAYMENT_KINDS.includes(kind);
}

export interface LedgerSummary {
  scans: number;
  optimizations: number;
  /** Credits spent on analyses (scans, optimizations, other debits). */
  creditsUsed: number;
  /** Credits bought through any payment path. */
  creditsPurchased: number;
  creditsRefunded: number;
  /** Net credits added (or removed) by an admin. */
  creditsAdjusted: number;
  purchaseCount: number;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  lastEntryAt: string | null;
  /**
   * Credits the ledger does not explain — the sign-up grant, or a manual
   * top-up made before the ledger existed. Null when the balance is unknown.
   */
  freeCredits: number | null;
}

/** A ledger amount as a finite number; Postgres numerics can arrive as strings. */
export function ledgerAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

const earlier = (a: string | null, b: string) => (a === null || b < a ? b : a);
const later = (a: string | null, b: string) => (a === null || b > a ? b : a);

export function summarizeLedger(rows: LedgerRow[], balance: number | null): LedgerSummary {
  const summary: LedgerSummary = {
    scans: 0,
    optimizations: 0,
    creditsUsed: 0,
    creditsPurchased: 0,
    creditsRefunded: 0,
    creditsAdjusted: 0,
    purchaseCount: 0,
    firstPurchaseAt: null,
    lastPurchaseAt: null,
    lastEntryAt: null,
    freeCredits: null,
  };
  let ledgerTotal = 0;

  for (const row of rows) {
    const amount = ledgerAmount(row.amount);
    ledgerTotal += amount;
    if (typeof row.created_at === 'string') summary.lastEntryAt = later(summary.lastEntryAt, row.created_at);

    const kind = classifyLedgerEntry(row);
    switch (kind) {
      case 'manual_payment':
      case 'card_creem':
      case 'card_stripe':
        summary.purchaseCount += 1;
        summary.creditsPurchased += amount;
        if (typeof row.created_at === 'string') {
          summary.firstPurchaseAt = earlier(summary.firstPurchaseAt, row.created_at);
          summary.lastPurchaseAt = later(summary.lastPurchaseAt, row.created_at);
        }
        break;
      case 'refund':
        summary.creditsRefunded += amount;
        break;
      case 'admin_adjustment':
        summary.creditsAdjusted += amount;
        break;
      case 'scan':
        summary.scans += 1;
        summary.creditsUsed += -amount;
        break;
      case 'optimization':
        summary.optimizations += 1;
        summary.creditsUsed += -amount;
        break;
      default:
        if (amount < 0) summary.creditsUsed += -amount;
    }
  }

  summary.freeCredits = typeof balance === 'number' && Number.isFinite(balance) ? balance - ledgerTotal : null;
  return summary;
}
