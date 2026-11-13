import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb, isMissingMigration } from '@/lib/admin/db';
import { writeAudit } from '@/lib/admin/audit';
import { isUuid } from '@/lib/billing/grant';

export const dynamic = 'force-dynamic';

/**
 * Add or remove credits by hand (admin_adjust_credits, migration 014).
 *
 * The client sees the movement in their history as "Ajustement QatliA"; the
 * reason the admin types is kept in the audit log only. `requestId` is
 * created by the form and reused on a retry, so a double click or a resend
 * after a network error credits once.
 */

const AdjustSchema = z.object({
  delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0),
  reason: z.string().trim().min(3).max(500),
  requestId: z.string().uuid(),
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
  const parsed = AdjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const { delta, reason, requestId } = parsed.data;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }

  const { data, error } = await db.rpc('admin_adjust_credits', {
    p_user_id: params.id,
    p_delta: delta,
    p_request_id: requestId,
  });
  if (error) {
    if (isMissingMigration(error)) return NextResponse.json({ error: 'MIGRATION_MISSING' }, { status: 503 });
    console.error('admin_adjust_credits failed:', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  const result = (data || {}) as { success?: boolean; duplicate?: boolean; balance?: number; error?: string };
  if (result.success !== true) {
    if (result.error === 'INSUFFICIENT_CREDITS') {
      return NextResponse.json({ error: 'INSUFFICIENT_CREDITS', balance: result.balance ?? null }, { status: 409 });
    }
    if (result.error === 'PROFILE_NOT_FOUND') {
      return NextResponse.json({ error: 'PROFILE_NOT_FOUND' }, { status: 409 });
    }
    return NextResponse.json({ error: result.error || 'ADJUST_FAILED' }, { status: 400 });
  }

  if (result.duplicate !== true) {
    await writeAudit(db, {
      adminId: admin.userId,
      action: 'credits_adjusted',
      targetUserId: params.id,
      details: { delta, reason, balance: result.balance ?? null },
    });
  }

  return NextResponse.json({ success: true, balance: result.balance ?? null, duplicate: result.duplicate === true });
}
