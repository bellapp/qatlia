/**
 * The account's business identity ("Mon entreprise") on the server.
 *
 * `ateliers` has Row Level Security on and no policy, so the session client
 * would read nothing and silently fail to write: every access goes through the
 * service role with an explicit `user_id` filter, and there is NO fallback to
 * the session client. Without the service role, a read means "no business" and
 * a write fails.
 *
 * Reads never throw. A database without the table yet (migration 020 not
 * applied) or any other error is "no business", so an export never turns into
 * an error page. The logo is checked apart from the text: a logo that no
 * longer validates is dropped, the business stays.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { createClient as createSessionClient } from '@/lib/supabase/server';
import { validateLogoDataUrl } from '@/lib/exports/quotation-logo';
import { CompanyIdentitySchema, LogoDataUrlSchema } from '@/lib/quotation';
import type { Atelier } from '@/lib/atelier';

const COLUMNS = 'name, address, phone, email, ice, tax_id, logo_data_url';

/** Business field -> SQL column, for the text part of the row. */
const FIELD_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['name', 'name'],
  ['address', 'address'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['ice', 'ice'],
  ['taxId', 'tax_id'],
];

function adminClient() {
  const config = getSupabaseAdminConfig();
  return config ? createSupabaseClient(config.url, config.serviceRoleKey) : null;
}

/** An empty SQL value (NULL or blank) is an absent field. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The logo of a row, only when it is still a valid PNG/JPEG; otherwise absent. */
function validLogo(value: unknown): string | undefined {
  const logo = text(value);
  if (!logo) return undefined;
  if (!LogoDataUrlSchema.safeParse(logo).success) return undefined;
  return validateLogoDataUrl(logo).ok ? logo : undefined;
}

/** What a read found: a business, none, or a failure (database down, table missing, no service role). */
export type AtelierRead = { status: 'found'; atelier: Atelier } | { status: 'none' } | { status: 'error' };

/**
 * The business of an account, with a failed read told apart from "no
 * business": the account form must not treat a database error as an empty
 * account, or its next save would overwrite the stored business. Never throws.
 * `signal` cancels the query (see `atelierForCurrentRequest`).
 */
export async function readAtelierResult(userId: string, options: { signal?: AbortSignal } = {}): Promise<AtelierRead> {
  try {
    const admin = adminClient();
    if (!admin) return { status: 'error' };

    const query = admin.from('ateliers').select(COLUMNS).eq('user_id', userId);
    const { data, error } = await (options.signal ? query.abortSignal(options.signal) : query).maybeSingle();
    if (error) return { status: 'error' };
    if (!data) return { status: 'none' };

    const row = data as Record<string, unknown>;
    // Absent fields stay absent (no key at all), never `undefined`.
    const fields: Record<string, string> = {};
    for (const [field, column] of FIELD_COLUMNS) {
      const value = text(row[column]);
      if (value !== undefined) fields[field] = value;
    }
    const identity = CompanyIdentitySchema.safeParse(fields);
    if (!identity.success) return { status: 'none' };

    const atelier: Atelier = { ...identity.data };
    const logo = validLogo(row.logo_data_url);
    if (logo) atelier.logoDataUrl = logo;
    return { status: 'found', atelier };
  } catch {
    return { status: 'error' };
  }
}

/** The business of an account, or null when there is none or it cannot be read (the export paths). */
export async function readAtelier(userId: string, options: { signal?: AbortSignal } = {}): Promise<Atelier | null> {
  const result = await readAtelierResult(userId, options);
  return result.status === 'found' ? result.atelier : null;
}

/**
 * Saves the business of an account. The caller validates `atelier` first.
 *
 * `logoDataUrl: undefined` leaves the saved logo alone; `null` removes it.
 * `createOnly` never overwrites a row that already exists.
 */
export async function saveAtelier(
  userId: string,
  atelier: Atelier,
  options: { createOnly?: boolean } = {},
): Promise<boolean> {
  try {
    const admin = adminClient();
    if (!admin) return false;

    const row: Record<string, string | null> = {
      user_id: userId,
      name: atelier.name,
      address: atelier.address || null,
      phone: atelier.phone || null,
      email: atelier.email || null,
      ice: atelier.ice || null,
      tax_id: atelier.taxId || null,
      updated_at: new Date().toISOString(),
    };
    if (atelier.logoDataUrl !== undefined) row.logo_data_url = atelier.logoDataUrl;

    const { error } = await admin
      .from('ateliers')
      .upsert(row, options.createOnly ? { onConflict: 'user_id', ignoreDuplicates: true } : { onConflict: 'user_id' });
    if (error) {
      console.error('atelier save failed:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error('atelier save failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

/** How long an export waits for the business before printing without it. */
export const ATELIER_READ_TIMEOUT_MS = 2500;

/**
 * The business of the signed-in user of this request, or null. The free cut
 * plan export must never hang on a slow database, so the whole read (session,
 * then query) is raced against a timer; the query is aborted when it loses.
 */
export async function atelierForCurrentRequest(timeoutMs: number = ATELIER_READ_TIMEOUT_MS): Promise<Atelier | null> {
  // Checked first: the session client reads cookies(), which only exists inside a request.
  if (!getSupabaseAdminConfig()) return null;

  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(null);
    }, timeoutMs);
  });

  const read = (async () => {
    try {
      const supabase = createSessionClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      return await readAtelier(user.id, { signal: abort.signal });
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([read, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
