/**
 * The account currency on the server: read from the profile, else assigned
 * once from the visitor's country and saved, so a customer who travels keeps
 * the currency they started with (user decision, 2026-11-15).
 *
 * Writes use the service role with an explicit `id` filter, like every other
 * profile write; a database without the `currency` column yet (migration 017
 * not applied) degrades to the country, never to an error page.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { AppCurrency, CURRENCY_COOKIE_NAME, isAppCurrency, resolveCurrency } from '@/lib/currency';

/** The visitor's country as Vercel geolocates it (absent locally). */
export function requestCountry(req: Request): string | null {
  return req.headers.get('x-vercel-ip-country');
}

/** The currency an anonymous visitor picked by hand, from the request cookie. */
export function requestCookieCurrency(req: Request): AppCurrency | null {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CURRENCY_COOKIE_NAME) {
      const value = decodeURIComponent(rest.join('='));
      return isAppCurrency(value) ? value : null;
    }
  }
  return null;
}

function adminClient() {
  const config = getSupabaseAdminConfig();
  return config ? createSupabaseClient(config.url, config.serviceRoleKey) : null;
}

/**
 * The currency for this request. With a signed-in user whose profile has no
 * currency yet, the one resolved now is saved on the profile.
 */
export async function resolveRequestCurrency(req: Request, userId: string | null): Promise<AppCurrency> {
  const fallback = () => resolveCurrency({ cookie: requestCookieCurrency(req), country: requestCountry(req) });
  if (!userId) return fallback();

  // A database that cannot answer must not block a payment: the country decides.
  try {
    const admin = adminClient();
    if (!admin) return fallback();

    const { data, error } = await admin.from('profiles').select('currency').eq('id', userId).maybeSingle();
    if (error) {
      // Most likely migration 017 is not applied yet: price by country, save nothing.
      return fallback();
    }
    const saved = (data as { currency?: unknown } | null)?.currency;
    if (isAppCurrency(saved)) return saved;

    const assigned = fallback();
    if (data) {
      // Only fills an empty currency: a choice saved meanwhile is never replaced.
      const { error: saveError } = await admin
        .from('profiles')
        .update({ currency: assigned })
        .eq('id', userId)
        .is('currency', null);
      if (saveError) console.error('account currency could not be saved:', saveError.message);
    }
    return assigned;
  } catch (error) {
    console.error('account currency lookup failed:', error instanceof Error ? error.message : error);
    return fallback();
  }
}

/** Saves the currency a signed-in customer chose. */
export async function saveAccountCurrency(userId: string, currency: AppCurrency): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { error } = await admin.from('profiles').update({ currency }).eq('id', userId);
  if (error) {
    console.error('account currency update failed:', error.message);
    return false;
  }
  return true;
}
