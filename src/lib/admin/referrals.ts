import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingMigration } from './db';
import { LEDGER_KEY_PREFIXES, ledgerAmount, type LedgerRow } from './ledger';

/**
 * A client's parrainage, as the back office reads it (migration 022): their
 * parrain, their filleuls with what each earned them, and for each of their
 * purchases the bonuses it gave and whether it was refunded. Server-only.
 */

export interface AdminReferee {
  id: string;
  email: string | null;
  joinedAt: string;
  /** Credits this filleul earned the client, refunds taken off. */
  earned: number;
}

export interface PurchaseBonuses {
  /** The parrain's bonus this purchase gave (0 when none). */
  referral: number;
  /** The client's own welcome bonus this purchase gave (0 when none). */
  welcome: number;
}

export interface AdminReferral {
  referrer: { id: string; email: string | null; since: string } | null;
  referees: AdminReferee[];
  /** Purchase key -> the bonuses it gave. */
  bonusesByPurchase: Record<string, PurchaseBonuses>;
}

export type AdminReferralResult = { status: 'ok'; referral: AdminReferral } | { status: 'unavailable' } | { status: 'error' };

const num = ledgerAmount;

/** The purchase keys a ledger shows as refunded ('purchase_refund:<key>'). */
export function refundedPurchaseKeys(rows: readonly Pick<LedgerRow, 'stripe_payment_id'>[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = row.stripe_payment_id ?? '';
    if (key.startsWith(LEDGER_KEY_PREFIXES.purchaseRefund)) keys.add(key.slice(LEDGER_KEY_PREFIXES.purchaseRefund.length));
  }
  return keys;
}

export async function getClientReferral(db: SupabaseClient, userId: string): Promise<AdminReferralResult> {
  const [mine, referees, earned, given] = await Promise.all([
    db.from('referrals').select('referrer_id, created_at').eq('referee_id', userId).maybeSingle(),
    db.from('referrals').select('referee_id, created_at').eq('referrer_id', userId).order('created_at', { ascending: false }).limit(500),
    // What this client earned as a parrain.
    db.from('referral_rewards').select('referee_id, credits, reversed_at, reversed_credits').eq('user_id', userId).eq('kind', 'referral').limit(5000),
    // The bonuses this client's own purchases gave (to them and to their parrain).
    db.from('referral_rewards').select('purchase_key, kind, credits').eq('referee_id', userId).limit(5000),
  ]);
  const failure = mine.error || referees.error || earned.error || given.error;
  if (failure) {
    if (isMissingMigration(failure)) return { status: 'unavailable' };
    console.error('admin referral read failed:', failure.message);
    return { status: 'error' };
  }

  const mineRow = mine.data as { referrer_id: string; created_at: string } | null;
  const refereeRows = (referees.data as { referee_id: string; created_at: string }[] | null) ?? [];
  const ids = Array.from(new Set([...(mineRow ? [mineRow.referrer_id] : []), ...refereeRows.map((row) => row.referee_id)]));
  const emails = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data } = await db.from('profiles').select('id, email').in('id', ids);
    for (const row of (data as { id: string; email: string | null }[] | null) ?? []) emails.set(row.id, row.email);
  }

  const earnedBy = new Map<string, number>();
  for (const row of (earned.data as { referee_id: string | null; credits: number; reversed_at: string | null; reversed_credits: number | null }[] | null) ?? []) {
    if (!row.referee_id) continue;
    const net = Math.max(0, num(row.credits) - (row.reversed_at ? num(row.reversed_credits) : 0));
    earnedBy.set(row.referee_id, (earnedBy.get(row.referee_id) ?? 0) + net);
  }

  const bonusesByPurchase: Record<string, PurchaseBonuses> = {};
  for (const row of (given.data as { purchase_key: string; kind: string; credits: number }[] | null) ?? []) {
    const entry = (bonusesByPurchase[row.purchase_key] ??= { referral: 0, welcome: 0 });
    if (row.kind === 'referral') entry.referral += num(row.credits);
    if (row.kind === 'welcome') entry.welcome += num(row.credits);
  }

  return {
    status: 'ok',
    referral: {
      referrer: mineRow ? { id: mineRow.referrer_id, email: emails.get(mineRow.referrer_id) ?? null, since: mineRow.created_at } : null,
      referees: refereeRows.map((row) => ({
        id: row.referee_id,
        email: emails.get(row.referee_id) ?? null,
        joinedAt: row.created_at,
        earned: earnedBy.get(row.referee_id) ?? 0,
      })),
      bonusesByPurchase,
    },
  };
}
