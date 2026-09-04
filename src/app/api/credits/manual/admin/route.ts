import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';

export const dynamic = 'force-dynamic';

/**
 * Operator-only manual-payment decisions. Auth is a shared operator secret
 * (ADMIN_PANEL_SECRET) sent as a Bearer header — this is the merchant's own
 * back office, not an end-user surface. The secret lives only in Vercel env
 * vars; it is never committed and never asked for in chat.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_PANEL_SECRET || '';
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
}

const DecisionSchema = z.object({
  order_number: z.string().min(4).max(40),
  decision: z.enum(['grant', 'refuse']),
  payment_reference: z.string().max(120).optional(),
  operator_note: z.string().max(500).optional(),
});

/** GET: list payment requests (newest first), optional ?status=pending filter. */
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }
  const admin = createClient(adminConfig.url, adminConfig.serviceRoleKey);
  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  let query = admin
    .from('manual_payments')
    .select('order_number, user_id, pack_id, amount_mad, credits, status, method, payment_reference, created_at, decided_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status && ['pending', 'paid', 'granted', 'refused', 'expired'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    console.error('admin manual-payments list failed:', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  // Resolve buyer emails: manual_payments only stores user_id, and the email
  // lives in auth.users. Batch via the admin API, de-duplicated per user.
  const payments = data || [];
  const uniqueUserIds = Array.from(new Set(payments.map((p) => p.user_id).filter(Boolean)));
  const emailByUserId = new Map<string, string>();
  for (const userId of uniqueUserIds) {
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    if (userData?.user?.email) emailByUserId.set(userId, userData.user.email);
  }
  const paymentsWithEmail = payments.map((p) => ({
    ...p,
    user_email: emailByUserId.get(p.user_id) || null,
  }));

  return NextResponse.json({ success: true, payments: paymentsWithEmail });
}

/** POST: grant or refuse a pending payment. Granting credits the same way the
 * Stripe webhook does — through the idempotent add_credits RPC — so both
 * paths share one ledger. */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }
  const admin = createClient(adminConfig.url, adminConfig.serviceRoleKey);

  const parsed = DecisionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const { order_number, decision, payment_reference, operator_note } = parsed.data;

  // Fetch the pending row atomically via a conditional update claim: only one
  // concurrent decision can flip it away from 'pending'.
  const { data: claimed, error: claimError } = await admin
    .from('manual_payments')
    .update({
      status: decision === 'grant' ? 'paid' : 'refused',
      payment_reference: payment_reference ?? null,
      operator_note: operator_note ?? null,
      decided_at: new Date().toISOString(),
      decided_by: null,
    })
    .eq('order_number', order_number)
    .eq('status', 'pending')
    .select('id, user_id, pack_id, credits, amount_mad, status')
    .single();

  if (claimError || !claimed) {
    return NextResponse.json(
      { error: 'NOT_PENDING', message: 'Commande introuvable ou déjà traitée.' },
      { status: 409 },
    );
  }

  if (decision === 'refuse') {
    return NextResponse.json({ success: true, status: 'refused' });
  }

  // Grant credits through the same idempotent RPC the Stripe webhook uses.
  // The idempotency key derives from the manual payment row's own id, so a
  // re-run of this decision can never double-credit.
  const idempotencyKey = `manual:${claimed.id}`;
  const { data: grantData, error: grantError } = await admin.rpc('add_credits', {
    p_user_id: claimed.user_id,
    p_credits: claimed.credits,
    p_stripe_payment_id: idempotencyKey,
    p_pack_id: claimed.pack_id,
  });

  if (grantError) {
    console.error('manual grant failed:', grantError.message);
    // Roll the claim back to pending so the decision can be retried.
    await admin.from('manual_payments').update({ status: 'pending', decided_at: null }).eq('id', claimed.id);
    return NextResponse.json({ error: 'GRANT_FAILED', message: 'Le crédit n’a pas pu être ajouté. Réessayez.' }, { status: 500 });
  }
  const result = (grantData || {}) as { success?: boolean; duplicate?: boolean; error?: string };
  if (result.success !== true) {
    await admin.from('manual_payments').update({ status: 'pending', decided_at: null }).eq('id', claimed.id);
    return NextResponse.json({ error: 'GRANT_REJECTED', reason: result.error || 'UNKNOWN' }, { status: 500 });
  }

  await admin
    .from('manual_payments')
    .update({ status: 'granted' })
    .eq('id', claimed.id);

  return NextResponse.json({ success: true, status: 'granted', duplicate: result.duplicate === true, credits: claimed.credits });
}
