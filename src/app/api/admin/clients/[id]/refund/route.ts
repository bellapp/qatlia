import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb, isMissingMigration } from '@/lib/admin/db';
import { writeAudit } from '@/lib/admin/audit';
import { classifyLedgerEntry, isPaymentKind, type LedgerRow } from '@/lib/admin/ledger';
import { isUuid } from '@/lib/billing/grant';

export const dynamic = 'force-dynamic';

/**
 * Refund one purchase of a client (refund_purchase, migration 022;
 * docs/adr/0002): takes back the pack's credits, the welcome bonus it gave
 * the client and the bonus it gave their parrain, each balance stopping at
 * zero. The money itself is given back outside the app. A purchase is
 * refunded once: a second call answers duplicate and changes nothing.
 */

const RefundSchema = z.object({
  purchaseKey: z.string().min(4).max(200),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const authorization = await authorizeAdminRequest(req);
  if (!authorization.ok) return authorization.response;
  const { admin } = authorization;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const parsed = RefundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const { purchaseKey, reason } = parsed.data;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }

  // The purchase must be this client's, and a payment: never a bonus, a
  // usage row or an optimization refund.
  const { data: row, error: readError } = await db
    .from('credit_transactions')
    .select('id, type, amount, balance_after, description, reason, stripe_payment_id, created_at')
    .eq('user_id', params.id)
    .eq('stripe_payment_id', purchaseKey)
    .maybeSingle();
  if (readError) {
    console.error('admin refund: purchase read failed:', readError.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }
  if (!row || !isPaymentKind(classifyLedgerEntry(row as LedgerRow))) {
    return NextResponse.json({ error: 'PURCHASE_NOT_FOUND' }, { status: 404 });
  }

  const { data, error } = await db.rpc('refund_purchase', { p_purchase_key: purchaseKey });
  if (error) {
    if (isMissingMigration(error)) return NextResponse.json({ error: 'MIGRATION_MISSING' }, { status: 503 });
    console.error('refund_purchase failed:', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  const result = (data || {}) as {
    success?: boolean;
    duplicate?: boolean;
    error?: string;
    balance?: number;
    removed_purchase?: number;
    removed_welcome?: number;
    removed_referral?: number;
  };
  if (result.success !== true) {
    return NextResponse.json({ error: result.error || 'REFUND_FAILED' }, { status: 409 });
  }

  if (result.duplicate !== true) {
    await writeAudit(db, {
      adminId: admin.userId,
      action: 'purchase_refunded',
      targetUserId: params.id,
      details: {
        purchase_key: purchaseKey,
        reason,
        removed_purchase: result.removed_purchase ?? 0,
        removed_welcome: result.removed_welcome ?? 0,
        removed_referral: result.removed_referral ?? 0,
        balance: result.balance ?? null,
      },
    });
  }

  return NextResponse.json({
    success: true,
    duplicate: result.duplicate === true,
    balance: result.balance ?? null,
    removedPurchase: result.removed_purchase ?? 0,
    removedWelcome: result.removed_welcome ?? 0,
    removedReferral: result.removed_referral ?? 0,
  });
}
