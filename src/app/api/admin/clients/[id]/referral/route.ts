import { NextResponse } from 'next/server';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb, isMissingMigration } from '@/lib/admin/db';
import { writeAudit } from '@/lib/admin/audit';
import { isUuid } from '@/lib/billing/grant';

export const dynamic = 'force-dynamic';

/**
 * Detach a client from their parrain (docs/adr/0002, an abusive referral).
 * The client stays a client, without a parrain: their next purchases give
 * no bonus. Bonuses already given stay; refund a purchase to take its own
 * back. The parrain is kept in the audit log.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const authorization = await authorizeAdminRequest(req);
  if (!authorization.ok) return authorization.response;
  const { admin } = authorization;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }

  const { data, error } = await db.from('referrals').delete().eq('referee_id', params.id).select('referrer_id');
  if (error) {
    if (isMissingMigration(error)) return NextResponse.json({ error: 'MIGRATION_MISSING' }, { status: 503 });
    console.error('admin detach referral failed:', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }
  const removed = Array.isArray(data) ? (data as { referrer_id: string }[]) : [];
  if (removed.length === 0) {
    return NextResponse.json({ error: 'NO_REFERRER' }, { status: 404 });
  }

  await writeAudit(db, {
    adminId: admin.userId,
    action: 'referral_detached',
    targetUserId: params.id,
    details: { referrer_id: removed[0].referrer_id },
  });

  return NextResponse.json({ success: true });
}
