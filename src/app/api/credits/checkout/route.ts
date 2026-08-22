import { NextResponse } from 'next/server';
import { stripe, CREDIT_PACKS, PackId } from '@/lib/stripe/config';
import { z } from 'zod';

const CheckoutSchema = z.object({
  packId: z.enum(['starter', 'standard', 'pro', 'unlimited']),
  userId: z.string().optional(),
  userEmail: z.string().email().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CheckoutSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_PACK_SELECTION', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { packId, userId, userEmail } = parsed.data;
    const pack = CREDIT_PACKS[packId as PackId];
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';

    // Si Stripe n'est pas encore configuré avec une vraie clé secrète, on simule le lien de succès en dev
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('placeholder')) {
      return NextResponse.json({
        success: true,
        mode: 'demo',
        url: `${appUrl}/credits/success?demo=true&pack=${packId}&credits=${pack.credits}`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: pack.monthly ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `QatlIA — ${pack.name}`,
              description: `${pack.credits} crédits d'analyse IA de découpe`,
            },
            unit_amount: Math.round(pack.priceEUR * 100),
            recurring: pack.monthly ? { interval: 'month' } : undefined,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/credits/success?session_id={CHECKOUT_SESSION_ID}&pack=${packId}`,
      cancel_url: `${appUrl}/credits`,
      metadata: {
        userId: userId || 'anonymous',
        packId: packId,
        credits: pack.credits.toString(),
      },
      customer_email: userEmail,
    });

    return NextResponse.json({
      success: true,
      url: session.url,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur lors de la création du paiement';
    return NextResponse.json(
      { error: 'CHECKOUT_FAILED', message },
      { status: 500 }
    );
  }
}
