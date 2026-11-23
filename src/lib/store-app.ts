/**
 * The Play Store app (spec 2026-11-14, lot 1): the Android app shows qatlia.ma
 * itself, and inside it the site sells nothing. Neither Google's payment rules
 * nor a Moroccan developer account allow selling credits there, so every way to
 * a purchase is hidden or rerouted while the site runs in the app.
 *
 * The mode lives only in the tab: the app opens /atelier?app=android, and the
 * head script remembers it in sessionStorage — never in a cookie or in
 * localStorage, which the app shares with the phone's browser. The server never
 * knows it.
 *
 * Pure module: no runtime import, no env, no network. Safe from a client
 * component, a layout and a plain Node test.
 */

import type { TranslationKey } from '@/i18n';

/** The Android application id, as Google Play knows it. */
export const STORE_APP_PACKAGE = 'com.qatlia.app';

/** The app opens `/atelier?app=android`. */
export const STORE_APP_PARAM = 'app';
export const STORE_APP_VALUE = 'android';

/** sessionStorage key that keeps the mode for the rest of the tab. */
export const STORE_APP_STORAGE_KEY = 'qatlia-store-app';

/**
 * Window property the head script also sets. When a hydration error makes React
 * client-render <html>, it drops every attribute the script put there; this
 * flag keeps the answer for the rest of the page.
 */
export const STORE_APP_WINDOW_FLAG = '__qatliaStoreApp';

/**
 * Pages that sell, and where the app goes instead: the purchase pages lead to
 * the credits usage page (balance and movements), the landings with their prices to the
 * atelier.
 */
export const STORE_APP_REDIRECTS: Readonly<Record<string, string>> = {
  '/': '/atelier',
  '/ar': '/atelier',
  '/credits': '/account/credits',
  '/credits/success': '/account/credits',
};

/**
 * Where a sign-out leads. In a browser, the landing. In the app, the landing
 * would turn into the atelier, which looks the same signed in or out and leaves
 * the artisan unsure they left: the app shows the sign-in page instead.
 */
export function storeAppSignOutPath(inApp: boolean): string {
  return inApp ? '/auth/login' : '/';
}

/** Where the app sends a page instead, or null when the page stays. */
export function storeAppRedirect(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  return Object.prototype.hasOwnProperty.call(STORE_APP_REDIRECTS, path) ? STORE_APP_REDIRECTS[path] : null;
}

/**
 * Whether a page runs inside the app. Any Android app that opens a link sends
 * an `android-app://…` referrer (Gmail, WhatsApp), so only this app's exact id
 * counts: a customer opening their confirmation email keeps the full site.
 */
export function detectStoreApp(input: { search: string; referrer: string; stored: string | null }): boolean {
  if (input.stored === STORE_APP_VALUE) return true;
  if (new URLSearchParams(input.search).get(STORE_APP_PARAM) === STORE_APP_VALUE) return true;
  return input.referrer.replace(/\/+$/, '') === `android-app://${STORE_APP_PACKAGE}`;
}

/** What the head script decided for this document; false on the server. */
export function isStoreAppDocument(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if ((window as unknown as Record<string, unknown>)[STORE_APP_WINDOW_FLAG] === STORE_APP_VALUE) return true;
  return document.documentElement.getAttribute('data-app') === STORE_APP_VALUE;
}

/**
 * Runs first in <body>, before anything paints: marks <html data-app="android">
 * so the stylesheet hides what sells, and leaves a purchase or landing page at
 * once. Same rules as detectStoreApp and storeAppRedirect, in ES5. When the tab
 * cannot remember the mode, the page it leaves for carries the parameter.
 */
export const storeAppInitScript = `(function(){try{var k=${JSON.stringify(STORE_APP_STORAGE_KEY)};var v=${JSON.stringify(
  STORE_APP_VALUE
)};var r=${JSON.stringify(STORE_APP_REDIRECTS)};var s=null;try{s=window.sessionStorage.getItem(k);}catch(e){}
var on=s===v||new URLSearchParams(window.location.search).get(${JSON.stringify(STORE_APP_PARAM)})===v||String(document.referrer||'').replace(/\\/+$/,'')===${JSON.stringify(
  `android-app://${STORE_APP_PACKAGE}`
)};if(!on)return;var kept=true;try{window.sessionStorage.setItem(k,v);}catch(e){kept=false;}
window[${JSON.stringify(STORE_APP_WINDOW_FLAG)}]=v;var d=document.documentElement;d.setAttribute('data-app',v);
var p=window.location.pathname.replace(/\\/+$/,'')||'/';if(Object.prototype.hasOwnProperty.call(r,p)){d.setAttribute('data-app-leaving','');window.location.replace(r[p]+(kept?'':${JSON.stringify(
  `?${STORE_APP_PARAM}=${STORE_APP_VALUE}`
)}));}}catch(e){}})();`;

/**
 * Messages whose site wording invites the reader to pay, and the wording the
 * app shows instead: the vision error says the balance is empty without
 * « Rechargez votre compte », the currency hint leaves out the packs.
 */
const STORE_APP_COPY: Partial<Record<TranslationKey, TranslationKey>> = {
  'atelier.visionError.insufficientCredits': 'atelier.visionError.insufficientCreditsApp',
  'accountPage.currencyHint': 'accountPage.currencyHintApp',
};

/** The key to show: the app's wording inside the app, the site's otherwise. */
export function storeAppCopyKey(key: TranslationKey, inApp: boolean): TranslationKey {
  return (inApp && STORE_APP_COPY[key]) || key;
}
