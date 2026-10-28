/**
 * How a customer reaches QatlIA. One place, so the footer, the account menu, the
 * payment dialog and the landing JSON-LD can never disagree on an address.
 *
 * 2026-10-28: the WhatsApp number is the founder's personal line until a dedicated
 * business number exists. Swap it here and every link follows.
 *
 * Pure module: no React, no env vars, no network.
 */

export const SUPPORT_EMAIL = 'contact@qatlia.ma';

/** International format without the "+", as wa.me expects (06 72 59 16 19). */
export const SUPPORT_WHATSAPP = '212672591619';

/** E.164, for structured data and `tel:` links. */
export const SUPPORT_PHONE_E164 = `+${SUPPORT_WHATSAPP}`;

/** Opens a WhatsApp chat with QatlIA, the message box already filled when `text` is given. */
export function supportWhatsAppUrl(text?: string): string {
  const base = `https://wa.me/${SUPPORT_WHATSAPP}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Opens the customer's mail client addressed to QatlIA, the body prefilled when given. */
export function supportMailto(body?: string): string {
  const base = `mailto:${SUPPORT_EMAIL}`;
  return body ? `${base}?body=${encodeURIComponent(body)}` : base;
}
