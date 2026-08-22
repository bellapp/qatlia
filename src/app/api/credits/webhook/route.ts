import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-07-29.dahlia',
});

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', msg);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey && !serviceRoleKey.includes('placeholder')) {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, packId, credits } = session.metadata || {};

      if (userId && credits) {
        const { error } = await supabaseAdmin.rpc('add_credits', {
          p_user_id: userId,
          p_credits: parseInt(credits, 10),
          p_stripe_payment_id: session.payment_intent as string,
          p_pack_id: packId || 'custom',
        });

        if (error) {
          console.error('Erreur Supabase add_credits:', error);
          return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
