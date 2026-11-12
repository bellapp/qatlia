import { NextResponse } from 'next/server';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Env } from '@/lib/billing/config';
import { isUuid } from '@/lib/billing/grant';

/**
 * Who may open the back office.
 *
 * An admin is a signed-in Supabase account whose id is listed in
 * ADMIN_USER_IDS (comma-separated UUIDs). The id is used rather than the
 * email because nobody can claim someone else's id by signing up. A missing
 * or empty variable means nobody is an admin: the back office fails closed.
 */

export interface AdminIdentity {
  userId: string;
  email: string | null;
}

export function getAdminUserIds(env: Env = process.env): string[] {
  const raw = env.ADMIN_USER_IDS;
  if (typeof raw !== 'string') return [];
  const ids = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => isUuid(part));
  return Array.from(new Set(ids));
}

export function isAdminUserId(userId: unknown, env: Env = process.env): boolean {
  if (typeof userId !== 'string') return false;
  return getAdminUserIds(env).includes(userId.trim().toLowerCase());
}

/** The signed-in admin, or null for a visitor, a customer, or a closed back office. */
export async function getAdminUser(): Promise<AdminIdentity | null> {
  const identity = await getSessionIdentity();
  if (!identity || !isAdminUserId(identity.userId)) return null;
  return identity;
}

async function getSessionIdentity(): Promise<AdminIdentity | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return null;
    return { userId: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

/**
 * Guard for a back office page. A visitor goes to the login page and comes
 * back; a signed-in customer gets a plain 404, so the back office does not
 * even reveal that it exists.
 */
export async function requireAdminPage(returnTo: string): Promise<AdminIdentity> {
  const identity = await getSessionIdentity();
  if (!identity) {
    redirect(`/auth/login?redirect=${encodeURIComponent(returnTo)}`);
  }
  if (!isAdminUserId(identity.userId)) {
    notFound();
  }
  return identity;
}

/**
 * True when a state-changing request comes from another site. Browsers send
 * Origin on cross-site POSTs; a same-site request either omits it or names
 * this host.
 */
function isForeignOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export type AdminRequestAuthorization =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; response: NextResponse };

/** Guard for an /api/admin/* route handler. */
export async function authorizeAdminRequest(req: Request): Promise<AdminRequestAuthorization> {
  const admin = await getAdminUser();
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && isForeignOrigin(req)) {
    return { ok: false, response: NextResponse.json({ error: 'BAD_ORIGIN' }, { status: 403 }) };
  }
  return { ok: true, admin };
}
