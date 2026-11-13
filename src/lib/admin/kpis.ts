import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isMissingMigration } from './db';

/**
 * The overview figures, read from admin_kpis() (migration 013) in one call.
 * The raw JSON is validated: an unexpected shape becomes an error message on
 * the page, never a crash or a NaN tile.
 */

const count = z.number().finite();

const RawKpisSchema = z.object({
  signups: z.object({ today: count, d7: count, d30: count, total: count }),
  active: z.object({ d7: count, d30: count }),
  paying_clients: count,
  revenue_mad: z.object({ d30: count, month: count, total: count }),
  card_payments: z.object({ count_d30: count, count_total: count, usd_total: count, without_amount: count }),
  usage: z.object({ scans_d7: count, scans_d30: count, optimizations_d30: count, credits_used_d30: count }),
  pending_orders: z.object({ count, oldest_created_at: z.string().nullable() }),
  out_of_credits_never_paid: count,
  monthly: z.array(z.object({ month: z.string(), signups: count, revenue_mad: count, scans: count })),
});

export interface Kpis {
  signups: { today: number; d7: number; d30: number; total: number };
  active: { d7: number; d30: number };
  payingClients: number;
  revenueMad: { d30: number; month: number; total: number };
  cardPayments: { countD30: number; countTotal: number; usdTotal: number; withoutAmount: number };
  usage: { scansD7: number; scansD30: number; optimizationsD30: number; creditsUsedD30: number };
  pendingOrders: { count: number; oldestCreatedAt: string | null };
  outOfCreditsNeverPaid: number;
  monthly: { month: string; signups: number; revenueMad: number; scans: number }[];
}

export function parseKpis(raw: unknown): Kpis | null {
  const parsed = RawKpisSchema.safeParse(raw);
  if (!parsed.success) return null;
  const k = parsed.data;
  return {
    signups: k.signups,
    active: k.active,
    payingClients: k.paying_clients,
    revenueMad: k.revenue_mad,
    cardPayments: {
      countD30: k.card_payments.count_d30,
      countTotal: k.card_payments.count_total,
      usdTotal: k.card_payments.usd_total,
      withoutAmount: k.card_payments.without_amount,
    },
    usage: {
      scansD7: k.usage.scans_d7,
      scansD30: k.usage.scans_d30,
      optimizationsD30: k.usage.optimizations_d30,
      creditsUsedD30: k.usage.credits_used_d30,
    },
    pendingOrders: { count: k.pending_orders.count, oldestCreatedAt: k.pending_orders.oldest_created_at },
    outOfCreditsNeverPaid: k.out_of_credits_never_paid,
    monthly: k.monthly.map((m) => ({ month: m.month, signups: m.signups, revenueMad: m.revenue_mad, scans: m.scans })),
  };
}

/** Paying clients over all sign-ups, or null when nobody has signed up. */
export function conversionRate(kpis: Kpis): number | null {
  if (kpis.signups.total <= 0) return null;
  return kpis.payingClients / kpis.signups.total;
}

export type KpisResult = { status: 'ok'; kpis: Kpis } | { status: 'migration_missing' } | { status: 'error' };

export async function getKpis(db: SupabaseClient): Promise<KpisResult> {
  const { data, error } = await db.rpc('admin_kpis');
  if (error) {
    if (isMissingMigration(error)) return { status: 'migration_missing' };
    console.error('admin_kpis failed:', error.message);
    return { status: 'error' };
  }
  const kpis = parseKpis(data);
  if (!kpis) {
    console.error('admin_kpis returned an unexpected shape');
    return { status: 'error' };
  }
  return { status: 'ok', kpis };
}
