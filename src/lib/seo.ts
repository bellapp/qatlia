/**
 * What search engines and AI crawlers read about QatlIA: site URL, description and the
 * JSON-LD of the landing page, in French (/) and Arabic (/ar).
 *
 * Every fact is derived from the code that the product itself runs on (billing catalog,
 * signup policy, FAQ copy), so the structured data can never claim a price, an
 * allowance or an answer the visible page does not show.
 *
 * Pure module: no React, no env vars, no network.
 */

import { BILLING_CURRENCY, CREDIT_PACKS, PACK_IDS } from '@/lib/billing/catalog';
import { OPTIMIZE_CREDIT_COST, SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { fr } from '@/i18n/messages/fr';
import { ar } from '@/i18n/messages/ar';
import { SELECTABLE_LOCALES } from '@/i18n';
import { SUPPORT_EMAIL, SUPPORT_PHONE_E164 } from '@/lib/support';

export const SITE_URL = 'https://qatlia.ma';
export const SITE_NAME = 'QatliA';

/** Used for <meta name="description"> and Open Graph. 50–160 characters. */
export const SITE_DESCRIPTION =
  `Photographiez votre fiche de débit : QatliA calcule le plan de découpe de vos panneaux et l’exporte en PDF. ` +
  `Pour menuisiers au Maroc, ${SIGNUP_FREE_CREDITS} crédits offerts.`;

/** The Arabic landing page, served at /ar so search engines can index it. */
export const AR_TITLE = 'QatliA | تحسين تقطيع الألواح للنجّارين';
export const AR_DESCRIPTION =
  `QatliA يحسب مخطط قطع الألواح من صورة ورقة التقطيع. تقرير PDF، تصدير DXF، ` +
  `و${SIGNUP_FREE_CREDITS} رصيدًا مجانيًا عند التسجيل.`;

/** Landing page URL per language. Each version lists both as hreflang alternates. */
export const LANDING_PATHS = { fr: '/', ar: '/ar' } as const;
export type LandingLocale = keyof typeof LANDING_PATHS;

export const LANDING_ALTERNATES = {
  fr: LANDING_PATHS.fr,
  ar: LANDING_PATHS.ar,
  'x-default': LANDING_PATHS.fr,
};

/** Public, indexable routes. Everything behind a login stays out of the sitemap. */
export const PUBLIC_ROUTES = [LANDING_PATHS.fr, LANDING_PATHS.ar] as const;

/** Routes crawlers have no reason to fetch: APIs, account and admin screens. */
export const PRIVATE_ROUTES = ['/api/', '/admin', '/account', '/auth/', '/signup', '/history', '/credits/success'] as const;

/**
 * QatlIA's official profiles elsewhere. Listed as `sameAs` so search engines and AI
 * assistants tie them to qatlia.ma as one entity — Google still autocorrects « QatlIA »
 * to « KalIA ». Use each platform's canonical URL, without tracking parameters.
 */
export const SAME_AS = [
  'https://www.facebook.com/qatlia.ma',
  'https://www.linkedin.com/company/qatlia/',
] as const;

const FAQ_KEYS = [1, 2, 3, 4, 5, 6] as const;

/** The FAQ is read from the same catalog the page renders, so the two cannot drift apart. */
function faqJsonLd(locale: LandingLocale): Record<string, unknown> {
  const catalog = locale === 'ar' ? ar : fr;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    ...(locale === 'ar' ? { inLanguage: 'ar' } : {}),
    mainEntity: FAQ_KEYS.map((i) => ({
      '@type': 'Question',
      name: catalog.faq2[`q${i}`],
      acceptedAnswer: { '@type': 'Answer', text: catalog.faq2[`a${i}`] },
    })),
  };
}

/**
 * JSON-LD of the Arabic landing page. Offers stay on the French page: their names and
 * descriptions exist only in French, and an Arabic page should not mix the two.
 */
function arabicLandingJsonLd(organization: Record<string, unknown>): Record<string, unknown>[] {
  const application = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${SITE_URL}${LANDING_PATHS.ar}#app`,
    name: SITE_NAME,
    url: `${SITE_URL}${LANDING_PATHS.ar}`,
    description: AR_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'ar',
    featureList: [
      ar.features.scan.title,
      ar.features.guillotine.title,
      ar.features.report.title,
      ar.features.waste.title,
      ar.features.edges.title,
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
  return [organization, application, faqJsonLd('ar')];
}

export function landingJsonLd(locale: LandingLocale = 'fr'): Record<string, unknown>[] {
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

  if (locale === 'ar') return arabicLandingJsonLd(organization);

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

  return [organization, application, faqJsonLd('fr')];
}
