/**
 * The WhatsApp button of the site, shared by the site and the bot
 * (docs/superpowers/specs/2026-11-23-bouton-whatsapp-design.md).
 *
 * The site opens WhatsApp on the bot number with a message that depends on
 * the page and the language, ending with SITE_MARKER. The bot recognises that
 * marker and treats the contact as one who came from the ad, so it answers
 * them even when it only answers the ad (WHATSAPP_BOT_SCOPE=ads).
 *
 * Pure: no React, no environment.
 */

import type { InboundEvent } from '@/lib/whatsapp/payload';

export const SITE_MARKER = '(qatlia.ma)';

/**
 * The bot's number (07 26 26 36 86), as wa.me wants it. Not the support line of
 * src/lib/support.ts (06 00 93 75 23): the button leads to the bot, which hands
 * over to a human when asked. Must match WHATSAPP_FROM_NUMBER.
 */
export const BOT_WHATSAPP = '212726263686';

export type SiteTopic = 'general' | 'credits' | 'atelier' | 'history' | 'panels' | 'account';
export type SiteLocale = 'fr' | 'en' | 'ar';

/** In the bar of the work pages, where a floating button would cover the job; floating everywhere else. */
export type Placement = { kind: 'floating' | 'header'; topic: SiteTopic } | { kind: 'none' };

const WORK_PAGES: Readonly<Record<string, SiteTopic>> = {
  '/atelier': 'atelier',
  '/history': 'history',
  '/panels': 'panels',
};

const under = (pathname: string, root: string): boolean => pathname === root || pathname.startsWith(`${root}/`);

export function placementFor(pathname: string): Placement {
  if (under(pathname, '/admin') || under(pathname, '/w')) return { kind: 'none' };
  for (const [root, topic] of Object.entries(WORK_PAGES)) {
    if (under(pathname, root)) return { kind: 'header', topic };
  }
  if (under(pathname, '/credits')) return { kind: 'floating', topic: 'credits' };
  // The account page has no job to cover, and its header is already full on a phone.
  if (under(pathname, '/account')) return { kind: 'floating', topic: 'account' };
  return { kind: 'floating', topic: 'general' };
}

const MESSAGES: Readonly<Record<SiteTopic, Readonly<Record<SiteLocale, string>>>> = {
  general: {
    fr: "Bonjour, j'ai une question sur QatliA.",
    en: 'Hello, I have a question about QatliA.',
    ar: 'السلام، عندي سؤال على QatliA.',
  },
  credits: {
    fr: "Bonjour, j'ai une question sur l'achat de crédits.",
    en: 'Hello, I have a question about buying credits.',
    ar: 'السلام، عندي سؤال على شراء الأرصدة.',
  },
  atelier: {
    fr: "Bonjour, j'ai besoin d'aide dans l'atelier.",
    en: 'Hello, I need help in the workshop.',
    ar: 'السلام، بغيت مساعدة فالورشة.',
  },
  history: {
    fr: "Bonjour, j'ai besoin d'aide avec mon historique.",
    en: 'Hello, I need help with my history.',
    ar: 'السلام، بغيت مساعدة فالسجل ديالي.',
  },
  panels: {
    fr: "Bonjour, j'ai besoin d'aide avec mes panneaux.",
    en: 'Hello, I need help with my panels.',
    ar: 'السلام، بغيت مساعدة فالألواح ديالي.',
  },
  account: {
    fr: "Bonjour, j'ai besoin d'aide avec mon compte.",
    en: 'Hello, I need help with my account.',
    ar: 'السلام، بغيت مساعدة فالحساب ديالي.',
  },
};

export function siteMessage(topic: SiteTopic, locale: SiteLocale): string {
  return `${MESSAGES[topic][locale]} ${SITE_MARKER}`;
}

export function whatsappLink(topic: SiteTopic, locale: SiteLocale): string {
  return `https://wa.me/${BOT_WHATSAPP}?text=${encodeURIComponent(siteMessage(topic, locale))}`;
}

export function isSiteMessage(text: string | null): boolean {
  return text !== null && text.includes(SITE_MARKER);
}

const ALL_MESSAGES: readonly string[] = Object.values(MESSAGES).flatMap((byLocale) => Object.values(byLocale));

/**
 * What the person typed beyond the pre-filled message: '' for the message
 * alone, what follows it otherwise. An edited message keeps its own words,
 * without the marker.
 */
export function typedBeyondSiteMessage(text: string): string {
  const trimmed = text.trim();
  for (const message of ALL_MESSAGES) {
    const whole = `${message} ${SITE_MARKER}`;
    if (trimmed.startsWith(whole)) return trimmed.slice(whole.length).trim();
  }
  return trimmed.replace(SITE_MARKER, ' ').replace(/\s+/g, ' ').trim();
}

/** The source stored on a contact who first wrote through the site button. */
export const SITE_REFERRAL: Readonly<Record<string, unknown>> = { source: 'site' };

export function isSiteReferral(referral: Record<string, unknown> | null): boolean {
  return referral !== null && referral.source === 'site';
}

/**
 * A text carrying the marker, with no ad referral of its own, gets the site
 * referral: the bot then answers it as it answers the ad.
 */
export function withSiteReferral(event: InboundEvent): InboundEvent {
  if (event.type !== 'inbound' || event.referral !== null || event.kind !== 'text' || !isSiteMessage(event.text)) {
    return event;
  }
  return { ...event, referral: { ...SITE_REFERRAL } };
}
