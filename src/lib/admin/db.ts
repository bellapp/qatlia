import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';

/**
 * The service-role client the back office reads and writes with.
 *
 * Server-only: import it from Server Components and route handlers, never
 * from a client component — the service-role key bypasses every RLS policy.
 */
export function getAdminDb(): SupabaseClient | null {
  const config = getSupabaseAdminConfig();
  if (!config) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** PostgREST / Postgres codes for "this function or table does not exist yet". */
const MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

/**
 * True when an error means an admin migration has not been applied yet, so a
 * page can say so instead of failing with a 500.
 */
export function isMissingMigration(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return typeof error.code === 'string' && MISSING_CODES.has(error.code);
}
