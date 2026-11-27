import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authorizeAdminRequest, isAdminUserId } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { writeAudit } from '@/lib/admin/audit';
import { classifyLedgerEntry, isPaymentKind, type LedgerRow } from '@/lib/admin/ledger';
import { isUuid } from '@/lib/billing/grant';
import { SCAN_BUCKET } from '@/lib/projects/scan-image';

export const dynamic = 'force-dynamic';

/**
 * Delete a client's account, for test accounts and accounts created by
 * mistake. Deleting the auth user removes everything that references it
 * (profile, ledger, orders, projects, panels, prices, admin note: all ON
 * DELETE CASCADE); the scan photos in Storage are removed afterwards.
 *
 * Refused, so that nothing anyone paid for disappears:
 * - for an account that has ever paid, or has a manual order still open;
 * - for an admin account, the admin's own included.
 * The admin confirms by typing the client's email (its id when it has none).
 * The audit log has no foreign key, so the deletion stays recorded.
 */

const DeleteSchema = z.object({ confirm: z.string().trim().min(1).max(320) });

/** Manual orders that mean money is, or may be, on its way. */
const OPEN_OR_PAID_ORDER_STATUSES = ['pending', 'paid', 'granted', 'refunded'];

/** More non-usage rows than this and the account is not a test account: refused. */
const LEDGER_CHECK_LIMIT = 1000;

/**
 * A row that is, or might be, money received. Wider than the back office's
 * own classifier on purpose: a purchase written with an unknown or missing
 * key, or any row with an amount paid, keeps the account.
 */
function mayBePayment(row: LedgerRow): boolean {
  const kind = classifyLedgerEntry(row);
  if (isPaymentKind(kind)) return true;
  if (row.type === 'purchase' && kind !== 'refund') return true;
  return Number(row.amount_paid ?? 0) > 0;
}

/** Scan photos are stored at {user_id}/{uuid}.{ext}; one page is plenty for one account. */
const SCAN_LIST_LIMIT = 1000;

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const authorization = await authorizeAdminRequest(req);
  if (!authorization.ok) return authorization.response;
  const { admin } = authorization;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const userId = params.id.toLowerCase();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }

  if (isAdminUserId(userId)) {
    return NextResponse.json({ error: 'ADMIN_ACCOUNT' }, { status: 403 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }

  const { data: authData, error: authError } = await db.auth.admin.getUserById(userId);
  if (authError && !/not.?found/i.test(authError.message || '')) {
    console.error('admin delete: getUserById failed:', authError.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }
  const user = authData?.user;
  if (!user) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const email = typeof user.email === 'string' && user.email ? user.email : null;
  const expected = (email ?? userId).trim().toLowerCase();
  if (parsed.data.confirm.toLowerCase() !== expected) {
    return NextResponse.json({ error: 'CONFIRMATION_MISMATCH' }, { status: 400 });
  }

  // Any doubt about payments keeps the account: a failed check refuses.
  const [orders, ledger] = await Promise.all([
    db.from('manual_payments').select('status').eq('user_id', userId).in('status', OPEN_OR_PAID_ORDER_STATUSES).limit(1),
    // Usage rows (by far the most) cannot be payments; everything else is read.
    db
      .from('credit_transactions')
      .select('id, type, amount, balance_after, description, reason, stripe_payment_id, amount_paid, created_at')
      .eq('user_id', userId)
      .neq('type', 'usage')
      .limit(LEDGER_CHECK_LIMIT),
  ]);
  if (orders.error || ledger.error) {
    console.error('admin delete: payment check failed:', (orders.error || ledger.error)?.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }
  const ledgerRows = Array.isArray(ledger.data) ? (ledger.data as LedgerRow[]) : [];
  const hasOrder = Array.isArray(orders.data) && orders.data.length > 0;
  const hasPayment = ledgerRows.length >= LEDGER_CHECK_LIMIT || ledgerRows.some(mayBePayment);
  if (hasOrder || hasPayment) {
    return NextResponse.json({ error: 'HAS_PAYMENTS' }, { status: 409 });
  }

  const { error: deleteError } = await db.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('admin delete: deleteUser failed:', deleteError.message);
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 });
  }

  const scansRemoved = await removeScanPhotos(db, userId);

  await writeAudit(db, {
    adminId: admin.userId,
    action: 'account_deleted',
    targetUserId: userId,
    details: { email, scans_removed: scansRemoved },
  });

  return NextResponse.json({ success: true });
}

/**
 * Best effort: the account is already gone, so a failure here is logged and
 * the photos are left for a manual clean-up (they are private either way).
 * Returns how many were removed, or null when the clean-up failed.
 */
async function removeScanPhotos(db: SupabaseClient, userId: string): Promise<number | null> {
  try {
    const bucket = db.storage.from(SCAN_BUCKET);
    const { data, error } = await bucket.list(userId, { limit: SCAN_LIST_LIMIT });
    if (error) throw error;
    const paths = (data ?? []).filter((entry) => entry.name).map((entry) => `${userId}/${entry.name}`);
    if (paths.length === 0) return 0;
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw removeError;
    return paths.length;
  } catch (error) {
    console.error('admin delete: scan photos not removed:', error instanceof Error ? error.message : error);
    return null;
  }
}
