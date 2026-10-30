/**
 * The three legal documents Creem reviews before approving a live store: terms,
 * privacy policy and refund policy.
 *
 * Their wording lives in the i18n catalogs (`legal.*`); this module holds the
 * facts the wording quotes, so a document can never promise a refund window, a
 * free allowance or a credit cost the product does not apply. Every figure is
 * read from the code that enforces it.
 *
 * Pure module: no React, no env vars, no network.
 */

import type { Metadata } from 'next';
import { ANALYSIS_WINDOW_HOURS, SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { SUPPORT_EMAIL, SUPPORT_PHONE_E164 } from '@/lib/support';
import { fr } from '@/i18n/messages/fr';
import type { TranslationVars } from '@/i18n';

export type LegalDoc = 'terms' | 'privacy' | 'refund';

export const LEGAL_DOCS: readonly LegalDoc[] = ['terms', 'privacy', 'refund'];

export const LEGAL_ROUTES: Record<LegalDoc, string> = {
  terms: '/terms',
  privacy: '/privacy',
  refund: '/refund',
};

/** Shown as « Dernière mise à jour ». Bump it with every change of substance. */
export const LEGAL_UPDATED_AT = '2026-10-30';

/**
 * Days after a payment during which its unused credits can be refunded. Seven
 * matches the withdrawal period of Moroccan law 31-08 for distance sales.
 */
export const REFUND_WINDOW_DAYS = 7;

/** The values every legal string may interpolate. */
export function legalVars(): TranslationVars {
  return {
    email: SUPPORT_EMAIL,
    whatsapp: SUPPORT_PHONE_E164,
    freeCredits: SIGNUP_FREE_CREDITS,
    days: REFUND_WINDOW_DAYS,
    visionCost: VISION_CREDIT_COST,
    windowHours: ANALYSIS_WINDOW_HOURS,
  };
}

/** Section keys in reading order, taken from the French reference catalog. */
export function legalSectionKeys(doc: LegalDoc): string[] {
  return Object.keys(fr.legal[doc].sections);
}

/** Server-rendered metadata stays in French, like the rest of the site's. */
export function legalMetadata(doc: LegalDoc): Metadata {
  return {
    title: `${fr.legal[doc].title} — QatliA`,
    description: fr.legal[doc].summary,
    alternates: { canonical: LEGAL_ROUTES[doc] },
  };
}
