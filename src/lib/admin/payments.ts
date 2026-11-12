import type { SupabaseClient } from '@supabase/supabase-js';
import { CREDIT_PACKS, isPackId } from '@/lib/billing/catalog';
import { classifyLedgerEntry, LEDGER_KEY_PREFIXES, ledgerAmount, type LedgerRow } from './ledger';

/**
 * Every payment in one list: manual orders (public.manual_payments) and card
 * payments (credit_transactions rows keyed creem:/cs:). Server-only reads;
 * the mapping functions are pure.
 */

export type PaymentSource = 'manual' | 'creem' | 'stripe';
export type PaymentStatus = 'pending' | 'paid' | 'granted' | 'refused' | 'expired';

export interface PaymentView {
  id: string;
  source: PaymentSource;
  userId: string;
  email: string | null;
  packId: string | null;
  credits: number;
  amount: number | null;
  currency: string | null;
  /** True when the amount is the catalog price, not what was recorded as charged. */
  amountIsEstimate: boolean;
  status: PaymentStatus;
  orderNumber: string | null;
  method: string | null;
  reference: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const STATUSES: readonly PaymentStatus[] = ['pending', 'paid', 'granted', 'refused', 'expired'];
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

export function toManualPaymentView(row: Record<string, unknown>): PaymentView {
  const status = String(row.status ?? '');
  return {
    id: String(row.id ?? row.order_number ?? ''),
    source: 'manual',
    userId: String(row.user_id ?? ''),
    email: null,
    packId: str(row.pack_id),
    credits: ledgerAmount(row.credits),
    amount: ledgerAmount(row.amount_mad),
    currency: 'MAD',
    amountIsEstimate: false,
    status: (STATUSES as readonly string[]).includes(status) ? (status as PaymentStatus) : 'expired',
    orderNumber: str(row.order_number),
    method: str(row.method),
    reference: str(row.payment_reference),
    createdAt: String(row.created_at ?? ''),
    decidedAt: str(row.decided_at),
  };
}

export function toCardPaymentView(row: LedgerRow & { user_id: string }): PaymentView | null {
  const kind = classifyLedgerEntry(row);
  if (kind !== 'card_creem' && kind !== 'card_stripe') return null;
  const source: PaymentSource = kind === 'card_creem' ? 'creem' : 'stripe';
  const packId = row.reason;

  let amount: number | null = null;
  let currency: string | null = null;
  let amountIsEstimate = false;
  if (row.amount_paid !== null && row.amount_paid !== undefined && Number.isFinite(Number(row.amount_paid))) {
    amount = Number(row.amount_paid);
    currency = row.currency || null;
  } else if (isPackId(packId)) {
    // Creem bills in US dollars, Stripe in dirhams (src/lib/billing/catalog.ts).
    amount = source === 'creem' ? CREDIT_PACKS[packId].priceUSD : CREDIT_PACKS[packId].priceMAD;
    currency = source === 'creem' ? 'USD' : 'MAD';
    amountIsEstimate = true;
  }

  return {
    id: row.id,
    source,
    userId: row.user_id,
    email: null,
    packId: packId || null,
    credits: ledgerAmount(row.amount),
    amount,
    currency,
    amountIsEstimate,
    status: 'granted',
    orderNumber: null,
    method: source === 'creem' ? 'Carte (Creem)' : 'Carte (Stripe)',
    reference: row.stripe_payment_id,
    createdAt: row.created_at,
    decidedAt: row.created_at,
  };
}

export interface PaymentFilters {
  source: 'all' | 'manual' | 'card';
  status: 'pending' | 'granted' | 'refused' | 'all';
  search: string;
}

type SearchParams = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined): string => (typeof value === 'string' ? value : '');

export function parsePaymentFilters(searchParams: SearchParams): PaymentFilters {
  const source = single(searchParams.source);
  const status = single(searchParams.status);
  return {
    source: source === 'manual' || source === 'card' ? source : 'all',
    status: status === 'granted' || status === 'refused' || status === 'all' ? status : 'pending',
    search: single(searchParams.q).trim().slice(0, 80),
  };
}

const LIST_LIMIT = 200;

export type PaymentListResult = { status: 'ok'; payments: PaymentView[] } | { status: 'error' };

export async function listPayments(db: SupabaseClient, filters: PaymentFilters): Promise<PaymentListResult> {
  const wantManual = filters.source !== 'card';
  // Card payments are granted the moment they exist: never pending or refused.
  const wantCard = filters.source !== 'manual' && (filters.status === 'all' || filters.status === 'granted');

  const manualQuery = wantManual
    ? (() => {
        let query = db
          .from('manual_payments')
          .select('id, order_number, user_id, pack_id, amount_mad, credits, status, method, payment_reference, created_at, decided_at')
          .order('created_at', { ascending: false })
          .limit(LIST_LIMIT);
        if (filters.status !== 'all') query = query.eq('status', filters.status);
        return query;
      })()
    : null;
  const cardQuery = wantCard
    ? db
        .from('credit_transactions')
        .select('*')
        .or(`stripe_payment_id.like.${LEDGER_KEY_PREFIXES.creem}%,stripe_payment_id.like.${LEDGER_KEY_PREFIXES.stripe}%`)
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT)
    : null;

  const [manual, card] = await Promise.all([manualQuery, cardQuery]);
  if (manual?.error || card?.error) {
    console.error('admin payments list failed:', (manual?.error || card?.error)?.message);
    return { status: 'error' };
  }

  const payments: PaymentView[] = [
    ...((manual?.data as Record<string, unknown>[] | null) ?? []).map(toManualPaymentView),
    ...((card?.data as (LedgerRow & { user_id: string })[] | null) ?? [])
      .map(toCardPaymentView)
      .filter((p): p is PaymentView => p !== null),
  ];

  const userIds = Array.from(new Set(payments.map((p) => p.userId).filter(Boolean)));
  if (userIds.length > 0) {
    const { data: profiles } = await db.from('profiles').select('id, email').in('id', userIds);
    const emailById = new Map(((profiles as { id: string; email: string | null }[] | null) ?? []).map((p) => [p.id, p.email]));
    for (const payment of payments) payment.email = emailById.get(payment.userId) ?? null;
  }

  const term = filters.search.toLowerCase();
  const matching = term
    ? payments.filter((p) =>
        [p.orderNumber, p.email, p.reference, p.userId].some((field) => typeof field === 'string' && field.toLowerCase().includes(term))
      )
    : payments;

  matching.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { status: 'ok', payments: matching };
}
