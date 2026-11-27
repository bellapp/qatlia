/**
 * Parrainage on the server: an account's code, its filleuls and what they
 * earned it, and attaching an account to a parrain.
 *
 * The referral tables have Row Level Security on and no policy (migration
 * 022), so everything goes through the service role with an explicit user
 * filter. Before the migration is applied, every read answers 'unavailable'
 * and the pages hide the feature.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminDb, isMissingMigration } from '@/lib/admin/db';
import { LEDGER_KEY_PREFIXES } from '@/lib/admin/ledger';
import { refereeDisplayName, type AttachError, type ReferralReward } from '@/lib/referral';

/** More filleuls than this are counted, not listed one by one. */
export const REFEREE_LIST_LIMIT = 200;

export interface RefereeView {
  name: string | null;
  /** True once a purchase of theirs gave a bonus that was not refunded. */
  purchased: boolean;
  /** Credits this filleul earned the parrain, refunds taken off. */
  earned: number;
  joinedAt: string;
}

export interface ReferralOverview {
  code: string;
  /** The account has a parrain. */
  hasReferrer: boolean;
  /** The account has paid at least once: it can no longer be attached. */
  hasPurchased: boolean;
  /** Its own welcome bonus is still to come (attached, none received yet). */
  welcomePending: boolean;
  referees: RefereeView[];
  refereeCount: number;
  totalEarned: number;
  /** Its newest bonuses as a parrain, for the "you earned" banner. */
  recentRewards: ReferralReward[];
}

export type OverviewResult = { status: 'ok'; overview: ReferralOverview } | { status: 'unavailable' } | { status: 'error' };

const PURCHASE_PREFIXES = [LEDGER_KEY_PREFIXES.manual, LEDGER_KEY_PREFIXES.creem, LEDGER_KEY_PREFIXES.stripe];

interface RewardRow {
  id: string;
  kind: string;
  user_id: string;
  referee_id: string | null;
  credits: number;
  reversed_at: string | null;
  reversed_credits: number | null;
  created_at: string;
}

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** What a bonus is still worth after a refund took some or all of it back. */
export function rewardNet(row: Pick<RewardRow, 'credits' | 'reversed_at' | 'reversed_credits'>): number {
  return Math.max(0, num(row.credits) - (row.reversed_at ? num(row.reversed_credits) : 0));
}

/** True when the account has made at least one purchase (refunded or not). */
export async function hasPurchase(db: SupabaseClient, userId: string): Promise<boolean | null> {
  const answers = await Promise.all(
    PURCHASE_PREFIXES.map((prefix) =>
      db.from('credit_transactions').select('id').eq('user_id', userId).like('stripe_payment_id', `${prefix}%`).limit(1)
    )
  );
  if (answers.some((answer) => answer.error)) return null;
  return answers.some((answer) => Array.isArray(answer.data) && answer.data.length > 0);
}

/** The display names of some accounts, as a parrain may see them. */
export async function displayNames(db: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (userIds.length === 0) return names;
  const [profiles, ateliers] = await Promise.all([
    db.from('profiles').select('id, email, full_name').in('id', userIds),
    db.from('ateliers').select('user_id, name').in('user_id', userIds),
  ]);
  const atelierByUser = new Map<string, string>();
  for (const row of (ateliers.data as { user_id: string; name: string | null }[] | null) ?? []) {
    if (row.name) atelierByUser.set(row.user_id, row.name);
  }
  const profileById = new Map<string, { email: string | null; full_name: string | null }>();
  for (const row of (profiles.data as { id: string; email: string | null; full_name: string | null }[] | null) ?? []) {
    profileById.set(row.id, row);
  }
  for (const id of userIds) {
    const profile = profileById.get(id);
    names.set(id, refereeDisplayName({ fullName: profile?.full_name, atelierName: atelierByUser.get(id), email: profile?.email }));
  }
  return names;
}

/** An account's code, filleuls and earnings. Never throws. */
export async function readReferralOverview(userId: string, db: SupabaseClient | null = getAdminDb()): Promise<OverviewResult> {
  if (!db) return { status: 'unavailable' };
  try {
    const { data: code, error: codeError } = await db.rpc('referral_code_for', { p_user_id: userId });
    if (codeError) {
      if (isMissingMigration(codeError)) return { status: 'unavailable' };
      console.error('[referral] code read failed:', codeError.message);
      return { status: 'error' };
    }
    if (typeof code !== 'string' || code === '') return { status: 'error' };

    const [mine, referees, rewards, purchased] = await Promise.all([
      db.from('referrals').select('referrer_id').eq('referee_id', userId).maybeSingle(),
      db
        .from('referrals')
        .select('referee_id, created_at')
        .eq('referrer_id', userId)
        .order('created_at', { ascending: false })
        .limit(REFEREE_LIST_LIMIT),
      db
        .from('referral_rewards')
        .select('id, kind, user_id, referee_id, credits, reversed_at, reversed_credits, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1000),
      hasPurchase(db, userId),
    ]);
    const failure = mine.error || referees.error || rewards.error;
    if (failure || purchased === null) {
      if (failure && isMissingMigration(failure)) return { status: 'unavailable' };
      console.error('[referral] overview read failed:', failure?.message ?? 'purchase check');
      return { status: 'error' };
    }

    const rewardRows = (rewards.data as RewardRow[] | null) ?? [];
    const asParrain = rewardRows.filter((row) => row.kind === 'referral');
    const welcomeHeld = rewardRows.some((row) => row.kind === 'welcome' && !row.reversed_at);

    const refereeRows = (referees.data as { referee_id: string; created_at: string }[] | null) ?? [];
    const nameIds = Array.from(new Set([...refereeRows.map((row) => row.referee_id), ...asParrain.map((row) => row.referee_id).filter((id): id is string => !!id)]));
    const names = await displayNames(db, nameIds);

    const earnedBy = new Map<string, number>();
    const boughtBy = new Set<string>();
    for (const row of asParrain) {
      if (!row.referee_id) continue;
      earnedBy.set(row.referee_id, (earnedBy.get(row.referee_id) ?? 0) + rewardNet(row));
      if (!row.reversed_at) boughtBy.add(row.referee_id);
    }

    const hasReferrer = !!(mine.data as { referrer_id?: string } | null)?.referrer_id;
    return {
      status: 'ok',
      overview: {
        code,
        hasReferrer,
        hasPurchased: purchased,
        welcomePending: hasReferrer && !welcomeHeld && !purchased,
        referees: refereeRows.map((row) => ({
          name: names.get(row.referee_id) ?? null,
          purchased: boughtBy.has(row.referee_id),
          earned: earnedBy.get(row.referee_id) ?? 0,
          joinedAt: row.created_at,
        })),
        refereeCount: refereeRows.length,
        totalEarned: asParrain.reduce((sum, row) => sum + rewardNet(row), 0),
        recentRewards: asParrain
          .filter((row) => !row.reversed_at)
          .slice(0, 10)
          .map((row) => ({
            id: row.id,
            credits: num(row.credits),
            name: row.referee_id ? names.get(row.referee_id) ?? null : null,
            createdAt: row.created_at,
          })),
      },
    };
  } catch (error) {
    console.error('[referral] overview failed:', error instanceof Error ? error.message : 'unknown');
    return { status: 'error' };
  }
}

export type AttachResult =
  | { status: 'attached'; duplicate: boolean }
  | { status: 'refused'; error: AttachError }
  | { status: 'unavailable' }
  | { status: 'error' };

/** Attach an account to the owner of a code. Never throws. */
export async function attachReferral(userId: string, code: string, db: SupabaseClient | null = getAdminDb()): Promise<AttachResult> {
  if (!db) return { status: 'unavailable' };
  try {
    const { data, error } = await db.rpc('attach_referral', { p_referee_id: userId, p_code: code });
    if (error) {
      if (isMissingMigration(error)) return { status: 'unavailable' };
      console.error('[referral] attach failed:', error.message);
      return { status: 'error' };
    }
    const answer = (data || {}) as { success?: boolean; duplicate?: boolean; error?: string };
    if (answer.success === true) return { status: 'attached', duplicate: answer.duplicate === true };
    return { status: 'refused', error: (answer.error as AttachError) || 'INVALID_CODE' };
  } catch (error) {
    console.error('[referral] attach failed:', error instanceof Error ? error.message : 'unknown');
    return { status: 'error' };
  }
}
