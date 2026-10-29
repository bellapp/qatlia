/**
 * What search engines and AI crawlers read about QatlIA: site URL, description and the
 * JSON-LD of the landing page.
 *
 * Every fact is derived from the code that the product itself runs on (billing catalog,
 * signup policy, French FAQ copy), so the structured data can never claim a price, an
 * allowance or an answer the visible page does not show.
 *
 * Pure module: no React, no env vars, no network.
 */

import { BILLING_CURRENCY, CREDIT_PACKS, PACK_IDS } from '@/lib/billing/catalog';
import { OPTIMIZE_CREDIT_COST, SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { fr } from '@/i18n/messages/fr';
import { SELECTABLE_LOCALES } from '@/i18n';
import { SUPPORT_EMAIL, SUPPORT_PHONE_E164 } from '@/lib/support';

export const SITE_URL = 'https://qatlia.ma';
export const SITE_NAME = 'QatliA';

/** Used for <meta name="description"> and Open Graph. 50–160 characters. */
export const SITE_DESCRIPTION =
  `Photographiez votre fiche de débit : QatliA calcule le plan de découpe de vos panneaux et l’exporte en PDF. ` +
  `Pour menuisiers au Maroc, ${SIGNUP_FREE_CREDITS} crédits offerts.`;

/** Public, indexable routes. Everything behind a login stays out of the sitemap. */
export const PUBLIC_ROUTES = ['/'] as const;

/** Routes crawlers have no reason to fetch: APIs, account and admin screens. */
export const PRIVATE_ROUTES = ['/api/', '/admin', '/account', '/auth/', '/signup', '/history', '/credits/success'] as const;

/**
 * QatlIA's official profiles elsewhere. Listed as `sameAs` so search engines and AI
 * assistants tie them to qatlia.ma as one entity — Google still autocorrects « QatlIA »
 * to « KalIA ». Use each platform's canonical URL, without tracking parameters.
 */
export const SAME_AS = [
  'https://www.facebook.com/qatlia.ma',
] as const;

const FAQ_KEYS = [1, 2, 3, 4, 5, 6] as const;

export function landingJsonLd(): Record<string, unknown>[] {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon.svg`,
    areaServed: { '@type': 'Country', name: 'Maroc' },
    ...(SAME_AS.length ? { sameAs: [...SAME_AS] } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: SUPPORT_EMAIL,
      telephone: SUPPORT_PHONE_E164,
      availableLanguage: [...SELECTABLE_LOCALES],
    },
  };

  const offers = [
    {
      '@type': 'Offer',
      name: `Inscription : ${SIGNUP_FREE_CREDITS} crédits d’analyse photo offerts`,
      price: 0,
      priceCurrency: BILLING_CURRENCY,
    },
    ...PACK_IDS.map((id) => {
      const pack = CREDIT_PACKS[id];
      return {
        '@type': 'Offer',
        name: pack.name,
        // Stated in credits, the unit the ledger grants. The marketing description counts
        // « analyses », but one photo analysis costs VISION_CREDIT_COST credits.
        description: `${pack.credits} crédits${pack.monthly ? ' par mois' : ''} — analyse photo ${VISION_CREDIT_COST} crédits, optimisation ${OPTIMIZE_CREDIT_COST} crédit, exports gratuits`,
        price: pack.priceMAD,
        priceCurrency: BILLING_CURRENCY,
        ...(pack.monthly
          ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: pack.priceMAD,
              priceCurrency: BILLING_CURRENCY, unitText: 'mois' } }
          : {}),
      };
    }),
  ];

  const application = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${SITE_URL}/#app`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Optimisation de découpe de panneaux',
    operatingSystem: 'Web',
    inLanguage: [...SELECTABLE_LOCALES],
    audience: { '@type': 'BusinessAudience', name: 'Menuisiers et ateliers de menuiserie' },
    featureList: [
      fr.features.scan.title,
      fr.features.guillotine.title,
      fr.features.report.title,
      fr.features.waste.title,
      fr.features.edges.title,
    ],
    offers,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };

  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_KEYS.map((i) => ({
      '@type': 'Question',
      name: fr.faq2[`q${i}`],
      acceptedAnswer: { '@type': 'Answer', text: fr.faq2[`a${i}`] },
    })),
  };

  return [organization, application, faq];
}
