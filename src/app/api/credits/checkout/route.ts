import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_PACKS, PackId } from '@/lib/billing/catalog';
import { buildCheckoutParams, resolveCheckoutOrigin } from '@/lib/billing/checkout-params';
import { allowDemoCheckout, getCardProvider, getCreemConfig, isStripeConfigured } from '@/lib/billing/config';
import { buildCreemCheckoutBody } from '@/lib/billing/creem';
import { getStripe } from '@/lib/billing/stripe-client';

export const dynamic = 'force-dynamic';

/**
 * Which card provider is live, so the credits page can show the price that
 * provider will actually charge (USD through Creem, MAD through Stripe).
 */
export async function GET() {
  return NextResponse.json({ provider: getCardProvider() });
}

// The buyer is resolved from the Supabase session, never from the request body:
// a client-supplied user id would let anyone credit an arbitrary account.
const CheckoutSchema = z.object({
  packId: z.enum(['starter', 'standard', 'pro', 'atelier_max']),
});

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'AUTH_REQUIRED', message: 'Connectez-vous pour acheter des crédits.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = CheckoutSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_PACK_SELECTION' }, { status: 400 });
    }

    const pack = CREDIT_PACKS[parsed.data.packId as PackId];

    const creem = getCreemConfig();
    if (creem) {
      const origin = resolveCheckoutOrigin({
        configured: process.env.NEXT_PUBLIC_APP_URL,
        requestOrigin: req.headers.get('origin'),
        production: process.env.NODE_ENV === 'production',
      });
      if (!origin) {
        return NextResponse.json({ error: 'PAYMENT_CONFIGURATION_ERROR' }, { status: 503 });
      }

      const body = buildCreemCheckoutBody({
        pack,
        productId: creem.products[pack.id],
        userId: user.id,
        userEmail: user.email,
        origin,
        requestId: randomUUID(),
      });

      const res = await fetch(`${creem.apiBase}/v1/checkouts`, {
        method: 'POST',
        headers: { 'x-api-key': creem.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const checkout = (await res.json().catch(() => null)) as { checkout_url?: unknown } | null;
      if (!res.ok || typeof checkout?.checkout_url !== 'string') {
        console.error('Creem checkout failed with status', res.status);
        return NextResponse.json(
          { error: 'CHECKOUT_FAILED', message: 'Impossible de créer le paiement.' },
          { status: 502 }
        );
      }

      return NextResponse.json({ success: true, url: checkout.checkout_url });
    }

    if (!isStripeConfigured()) {
      // Never mint a link that looks like a successful purchase in production.
      if (!allowDemoCheckout()) {
        return NextResponse.json(
          {
            error: 'PAYMENT_UNAVAILABLE',
            message: 'Le paiement est momentanément indisponible. Réessayez plus tard.',
          },
          { status: 503 }
        );
      }
      const demoOrigin = resolveCheckoutOrigin({
        configured: process.env.NEXT_PUBLIC_APP_URL,
        requestOrigin: req.headers.get('origin'),
        production: process.env.NODE_ENV === 'production',
      });
      return NextResponse.json({
        success: true,
        mode: 'demo',
        url: `${demoOrigin || 'http://localhost:3001'}/credits/success?demo=true&pack=${pack.id}`,
      });
    }

    const origin = resolveCheckoutOrigin({
      configured: process.env.NEXT_PUBLIC_APP_URL,
      requestOrigin: req.headers.get('origin'),
      production: process.env.NODE_ENV === 'production',
    });
    if (!origin) {
      return NextResponse.json({ error: 'PAYMENT_CONFIGURATION_ERROR' }, { status: 503 });
    }

    const params = buildCheckoutParams({
      pack,
      userId: user.id,
      userEmail: user.email,
      origin,
    });

    const stripe = getStripe(process.env.STRIPE_SECRET_KEY as string);
    // The pure builder produces exactly the Stripe shape; the cast only bridges
    // the SDK's deeply-literal parameter types.
    const session = await stripe.checkout.sessions.create(
      params as unknown as Parameters<typeof stripe.checkout.sessions.create>[0]
    );

    return NextResponse.json({ success: true, url: session.url });
  } catch (error: unknown) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'CHECKOUT_FAILED', message: 'Impossible de créer le paiement.' },
      { status: 500 }
    );
  }
}
