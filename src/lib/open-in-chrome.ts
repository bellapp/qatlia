/**
 * Google sign-in from WhatsApp's own browser (owner, 27/11/2026). A plan link
 * the bot sends opens in WhatsApp's in-app browser, which does not share the
 * phone's Google accounts: Google asks for an address and a password the
 * artisan often does not know, and may refuse an embedded browser outright.
 * On Android, « Continuer avec Google » therefore first reopens the plan link
 * in Chrome, where Google lists the phone's accounts. The link brings the same
 * pieces back (it can be opened again for 24 hours).
 *
 * Pure module: no runtime import, safe from a client component and a Node test.
 */

/** sessionStorage key: the plan link (its code) this tab was opened from. */
export const PHOTO_CODE_SESSION_KEY = 'qatlia-photo-code';

export const CHROME_PACKAGE = 'com.android.chrome';

/**
 * How long the page waits for Chrome to take over. Still on screen after that,
 * Chrome did not open (not installed, or the in-app browser ignored the link):
 * the sign-in goes on here, as before.
 */
export const CHROME_HANDOFF_MS = 2000;

/** Same alphabet and length as newPhotoCode (src/lib/whatsapp/photo-store.ts). */
const PHOTO_CODE = /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/;

/**
 * An app's own browser on Android: a WebView (`; wv)` in its user agent) or one
 * that names WhatsApp. Chrome, and the Chrome tabs other apps open, are neither.
 */
export function isAndroidInAppBrowser(userAgent: string): boolean {
  return /Android/i.test(userAgent) && (/;\s*wv\)/.test(userAgent) || /WhatsApp/i.test(userAgent));
}

/** The Android link that opens an https page in Chrome, or null for anything else. */
export function chromeIntentUrl(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=${CHROME_PACKAGE};end`;
}

/**
 * Where « Continuer avec Google » sends the visitor first: Chrome on the plan
 * link this tab came from, or null to sign in here as before. Never from the
 * Play Store app (its sign-in stays in the app), never without a plan link
 * (pieces typed here would not follow the visitor to Chrome).
 */
export function chromeHandoff(input: {
  userAgent: string;
  origin: string;
  photoCode: string | null;
  storeApp: boolean;
}): string | null {
  if (input.storeApp || !isAndroidInAppBrowser(input.userAgent)) return null;
  if (!input.photoCode || !PHOTO_CODE.test(input.photoCode)) return null;
  return chromeIntentUrl(`${input.origin}/w/${input.photoCode}`);
}
