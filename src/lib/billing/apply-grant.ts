import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from './config';
import { CreditGrant } from './grant';

/**
 * Write a resolved grant to the ledger and answer the payment provider.
 *
 * The one place a webhook turns a payment into credits, shared by Stripe and
 * Creem so both get the same failure semantics: every non-200 here makes the
 * provider retry, because a customer has paid and has not been credited yet.
 */
export async function applyGrant(grant: CreditGrant): Promise<NextResponse> {
  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig) {
    // Configuration problem, not a payload problem: let the provider retry.
    console.error('Webhook received a grant but Supabase admin is not configured');
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 500 });
  }

  const supabaseAdmin = createClient(adminConfig.url, adminConfig.serviceRoleKey);

  // add_credits is idempotent: credit_transactions.stripe_payment_id carries a
  // unique index (it holds every provider's payment key), so a redelivered
  // event is a no-op.
  const { data, error } = await supabaseAdmin.rpc('add_credits', {
    p_user_id: grant.userId,
    p_credits: grant.credits,
    p_stripe_payment_id: grant.idempotencyKey,
    p_pack_id: grant.packId,
  });

  if (error) {
    console.error('add_credits failed:', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  const grantResult = (data || {}) as { success?: boolean; duplicate?: boolean; error?: string };
  if (grantResult.success !== true) {
    console.error('add_credits rejected grant:', grantResult.error || 'unknown');
    return NextResponse.json(
      { error: 'GRANT_FAILED', reason: grantResult.error || 'UNKNOWN_GRANT_FAILURE' },
      { status: 500 }
    );
  }

  if (grantResult.duplicate !== true && grant.amountPaid !== null) {
    await recordAmountPaid(supabaseAdmin, grant);
  }

  return NextResponse.json({ received: true, granted: true, duplicate: grantResult.duplicate === true });
}

/**
 * Note on the ledger row what the provider charged, for the back office.
 * Best effort: the credits are already granted, so a failure here (for
 * instance migration 013 not applied yet) is logged and never retried by the
 * provider.
 */
async function recordAmountPaid(supabaseAdmin: SupabaseClient, grant: CreditGrant): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('credit_transactions')
      .update({ amount_paid: grant.amountPaid, currency: grant.currency })
      .eq('stripe_payment_id', grant.idempotencyKey);
    if (error) console.error('recording the paid amount failed:', error.message);
  } catch (err) {
    console.error('recording the paid amount failed:', err);
  }
}
