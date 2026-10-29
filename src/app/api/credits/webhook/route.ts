import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe-client';
import { getWebhookSecret, isStripeConfigured } from '@/lib/billing/config';
import { resolveGrant } from '@/lib/billing/grant';
import { applyGrant } from '@/lib/billing/apply-grant';

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

  return applyGrant(resolved.grant);
}
