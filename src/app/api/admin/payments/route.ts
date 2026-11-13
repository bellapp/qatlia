import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { writeAudit } from '@/lib/admin/audit';
import { LEDGER_KEY_PREFIXES } from '@/lib/admin/ledger';

export const dynamic = 'force-dynamic';

/**
 * Validate or refuse a manual payment (virement, CashPlus, Wafacash).
 *
 * The operator confirms the money arrived himself, outside the app, then
 * decides here. Granting credits goes through the same idempotent add_credits
 * RPC as the card webhooks, keyed on the payment row's own id, so a repeated
 * decision can never credit twice.
 */

const DecisionSchema = z.object({
  order_number: z.string().min(4).max(40),
  decision: z.enum(['grant', 'refuse']),
  payment_reference: z.string().max(120).optional(),
  operator_note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const authorization = await authorizeAdminRequest(req);
  if (!authorization.ok) return authorization.response;
  const { admin } = authorization;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const { order_number, decision, payment_reference, operator_note } = parsed.data;

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }

  // Claim the row: only one concurrent decision can move it away from pending.
  const { data: claimed, error: claimError } = await db
    .from('manual_payments')
    .update({
      status: decision === 'grant' ? 'paid' : 'refused',
      payment_reference: payment_reference?.trim() || null,
      operator_note: operator_note?.trim() || null,
      decided_at: new Date().toISOString(),
      decided_by: admin.userId,
    })
    .eq('order_number', order_number)
    .eq('status', 'pending')
    .select('id, user_id, pack_id, credits, amount_mad, status')
    .single();

  if (claimError || !claimed) {
    return NextResponse.json({ error: 'NOT_PENDING', message: 'Commande introuvable ou déjà traitée.' }, { status: 409 });
  }

  const auditDetails = {
    order_number,
    pack_id: claimed.pack_id,
    amount_mad: Number(claimed.amount_mad),
    credits: Number(claimed.credits),
    payment_reference: payment_reference?.trim() || null,
    operator_note: operator_note?.trim() || null,
  };

  if (decision === 'refuse') {
    await writeAudit(db, { adminId: admin.userId, action: 'payment_refused', targetUserId: claimed.user_id, details: auditDetails });
    return NextResponse.json({ success: true, status: 'refused' });
  }

  const idempotencyKey = `${LEDGER_KEY_PREFIXES.manual}${claimed.id}`;
  const rollback = () =>
    db.from('manual_payments').update({ status: 'pending', decided_at: null, decided_by: null }).eq('id', claimed.id);

  const { data: grantData, error: grantError } = await db.rpc('add_credits', {
    p_user_id: claimed.user_id,
    p_credits: claimed.credits,
    p_stripe_payment_id: idempotencyKey,
    p_pack_id: claimed.pack_id,
  });

  if (grantError) {
    console.error('manual grant failed:', grantError.message);
    await rollback();
    return NextResponse.json({ error: 'GRANT_FAILED', message: 'Le crédit n’a pas pu être ajouté. Réessayez.' }, { status: 500 });
  }
  const result = (grantData || {}) as { success?: boolean; duplicate?: boolean; error?: string };
  if (result.success !== true) {
    await rollback();
    return NextResponse.json({ error: 'GRANT_REJECTED', reason: result.error || 'UNKNOWN' }, { status: 500 });
  }

  await db.from('manual_payments').update({ status: 'granted' }).eq('id', claimed.id);

  // The ledger row learns what was paid, as for card payments. Best effort.
  const { error: amountError } = await db
    .from('credit_transactions')
    .update({ amount_paid: Number(claimed.amount_mad), currency: 'MAD' })
    .eq('stripe_payment_id', idempotencyKey);
  if (amountError) console.error('recording the manual amount failed:', amountError.message);

  await writeAudit(db, { adminId: admin.userId, action: 'payment_granted', targetUserId: claimed.user_id, details: auditDetails });

  return NextResponse.json({ success: true, status: 'granted', duplicate: result.duplicate === true, credits: claimed.credits });
}
