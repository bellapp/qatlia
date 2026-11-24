import type { SupabaseClient } from '@supabase/supabase-js';
import { OPTIMIZE_CREDIT_COST } from './policy';

/**
 * The balance right after the last credits added (pack or back-office gift),
 * which the low-credits threshold is measured against. Null when nothing was
 * ever added (the sign-up grant is not a movement) or it cannot be read.
 *
 * A failed run gives its credit back as a positive movement of type
 * 'purchase'; it adds nothing, so a movement must exceed that one credit.
 */
export async function readStartBalance(supabase: SupabaseClient): Promise<number | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('balance_after')
    .eq('user_id', session.user.id)
    .gt('amount', OPTIMIZE_CREDIT_COST)
    .order('created_at', { ascending: false })
    .limit(1);
  const balance: unknown = error ? null : data?.[0]?.balance_after;
  return typeof balance === 'number' ? balance : null;
}
