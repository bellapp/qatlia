import { NextResponse } from 'next/server';
import { getCreemConfig, getCreemWebhookSecret } from '@/lib/billing/config';
import { resolveCreemGrant, verifyCreemSignature } from '@/lib/billing/creem';
import { applyGrant } from '@/lib/billing/apply-grant';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const signature = req.headers.get('creem-signature');
  const webhookSecret = getCreemWebhookSecret();
  const creem = getCreemConfig();

  if (!signature || !webhookSecret || !creem) {
    return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 400 });
  }

  // The signature covers the exact bytes Creem sent, so it is checked on the
  // raw body before anything is parsed.
  const rawBody = await req.text();
  if (!verifyCreemSignature(rawBody, signature, webhookSecret)) {
    console.error('Creem webhook signature verification failed');
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const resolved = resolveCreemGrant(event, creem.products);

  // Same contract as the Stripe webhook: a paid event that cannot be mapped to
  // a grant fails delivery so Creem retries and the operator can investigate.
  if (!resolved.ok) {
    if (resolved.retryable) {
      console.error('Paid Creem event could not be resolved:', resolved.reason);
      return NextResponse.json(
        { error: 'GRANT_RESOLUTION_FAILED', reason: resolved.reason },
        { status: 500 }
      );
    }
    return NextResponse.json({ received: true, granted: false, reason: resolved.reason });
  }

  return applyGrant(resolved.grant);
}
