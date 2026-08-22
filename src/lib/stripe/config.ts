import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2026-07-29.dahlia',
});

export const CREDIT_PACKS = {
  starter: {
    id: 'starter',
    name: 'Pack Découverte',
    credits: 10,
    priceMAD: 10,
    priceEUR: 1,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || 'price_starter_placeholder',
    monthly: false,
    badge: '10 DH',
  },
  standard: {
    id: 'standard',
    name: 'Pack Artisan',
    credits: 50,
    priceMAD: 40,
    priceEUR: 4,
    stripePriceId: process.env.STRIPE_PRICE_STANDARD || 'price_standard_placeholder',
    monthly: false,
    badge: 'Populaire (40 DH)',
  },
  pro: {
    id: 'pro',
    name: 'Pack Atelier Pro',
    credits: 100,
    priceMAD: 70,
    priceEUR: 7,
    stripePriceId: process.env.STRIPE_PRICE_PRO || 'price_pro_placeholder',
    monthly: false,
    badge: 'Économique (70 DH)',
  },
  unlimited: {
    id: 'unlimited',
    name: 'Abonnement Illimité',
    credits: 999,
    priceMAD: 99,
    priceEUR: 9.9,
    stripePriceId: process.env.STRIPE_PRICE_UNLIMITED || 'price_unlimited_placeholder',
    monthly: true,
    badge: '99 DH / mois',
  },
} as const;

export type PackId = keyof typeof CREDIT_PACKS;
