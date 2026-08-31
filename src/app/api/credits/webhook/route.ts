import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/billing/stripe-client';
import { getSupabaseAdminConfig, getWebhookSecret, isStripeConfigured } from '@/lib/billing/config';
import { resolveGrant } from '@/lib/billing/grant';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = getWebhookSecret();

  if (!signature || !webhookSecret || !isStripeConfigured()) {
    return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event;
  try {
    const stripe = getStripe(process.env.STRIPE_SECRET_KEY as string);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: unknown) {
    console.error('Webhook signature verification failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 400 });
  }

  const resolved = resolveGrant(event as unknown as Parameters<typeof resolveGrant>[0]);

  // A completed payment that cannot be mapped to a grant must fail delivery so
  // Stripe retries and the operator can investigate. Only events we deliberately
  // do not credit are acknowledged without a grant.
  if (!resolved.ok) {
    if (resolved.retryable) {
      console.error('Paid Stripe event could not be resolved:', resolved.reason);
      return NextResponse.json(
        { error: 'GRANT_RESOLUTION_FAILED', reason: resolved.reason },
        { status: 500 }
      );
    }
    return NextResponse.json({ received: true, granted: false, reason: resolved.reason });
  }

  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig) {
    // Configuration problem, not a payload problem: let Stripe retry.
    console.error('Webhook received a grant but Supabase admin is not configured');
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 500 });
  }

  const supabaseAdmin = createClient(adminConfig.url, adminConfig.serviceRoleKey);
  const { grant } = resolved;

  // add_credits is idempotent: credit_transactions.stripe_payment_id carries a
  // unique index, so a redelivered event is a no-op.
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

  return NextResponse.json({ received: true, granted: true, duplicate: grantResult.duplicate === true });
}
