import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { CREDIT_PACKS, PackId } from '@/lib/billing/catalog';
import { readBankTransferDetails } from '@/lib/billing/bank-transfer';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  packId: z.enum(['starter', 'standard', 'pro', 'atelier_max']),
  method: z.enum(['manual', 'cashplus_agency', 'bank_transfer', 'wafacash']).default('manual'),
});

const ORDER_COLUMNS = 'order_number, amount_mad, credits, pack_id, method, status';

/** QIA-YYYYMMDD-XXXX over the alphabet generateOrderNumber() draws from. */
const CancelSchema = z.object({
  orderNumber: z.string().regex(/^QIA-\d{8}-[2-9A-HJKMNP-Z]{4}$/),
});

/** Human-readable, hard-to-misread order number: QIA-YYYYMMDD-XXXX (no 0/O, 1/I). */
function generateOrderNumber(): string {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  // Crockford-ish alphabet: no I, L, O, U, 0, 1 — nothing that reads ambiguously over the phone.
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `QIA-${ymd}-${suffix}`;
}

/** POST: create a pending manual payment with a fresh order number. */
export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED', message: 'Connectez-vous pour créer une commande.' }, { status: 401 });
    }

    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
    }
    const { packId, method } = parsed.data;
    const pack = CREDIT_PACKS[packId as PackId];
    if (!pack) {
      return NextResponse.json({ error: 'UNKNOWN_PACK' }, { status: 400 });
    }

    const adminConfig = getSupabaseAdminConfig();
    if (!adminConfig) {
      return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
    }
    const admin = createSupabaseClient(adminConfig.url, adminConfig.serviceRoleKey);

    // One order to pay at a time: a customer who already has a pending order
    // gets that order back (whatever pack was clicked) instead of a second one.
    // To switch packs they cancel it first (DELETE below), so an order they may
    // already have paid is never dropped behind their back.
    const { data: pending, error: pendingError } = await admin
      .from('manual_payments')
      .select(ORDER_COLUMNS)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingError) {
      console.error('manual payment pending lookup failed:', pendingError.message);
      return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
    }
    if (pending) {
      return NextResponse.json({ success: true, order: pending, existing: true, bank: readBankTransferDetails() });
    }

    // Retry on the (astronomically unlikely) unique collision of order_number.
    let orderNumber = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      orderNumber = generateOrderNumber();
      const { data, error } = await admin
        .from('manual_payments')
        .insert({
          order_number: orderNumber,
          user_id: user.id,
          pack_id: packId,
          amount_mad: pack.priceMAD,
          credits: pack.credits,
          method,
          status: 'pending',
        })
        .select(ORDER_COLUMNS)
        .single();

      if (!error && data) {
        // The account to pay into goes only to the signed-in buyer of this order.
        return NextResponse.json({ success: true, order: data, bank: readBankTransferDetails() });
      }
      if (error && !/duplicate|unique/i.test(error.message)) {
        console.error('manual payment insert failed:', error.message);
        return NextResponse.json({ error: 'DB_ERROR', message: 'La création de la commande a échoué. Réessayez.' }, { status: 500 });
      }
    }
    return NextResponse.json({ error: 'ORDER_NUMBER_COLLISION', message: 'Réessayez.' }, { status: 500 });
  } catch (err) {
    console.error('manual payment POST error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

/** GET: the signed-in artisan's own payment requests (newest first). */
export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }
    const { data, error } = await supabase
      .from('manual_payments')
      .select('order_number, pack_id, amount_mad, credits, status, method, created_at, decided_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error('manual payment GET failed:', error.message);
      return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
    }
    const orders = data || [];
    // Shown again only while the customer still has an order to pay.
    const hasPendingOrder = orders.some((order) => order.status === 'pending');
    return NextResponse.json({ success: true, orders, bank: hasPendingOrder ? readBankTransferDetails() : null });
  } catch (err) {
    console.error('manual payment GET error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

/**
 * DELETE: the signed-in customer cancels one of their own orders that is still
 * pending, e.g. to pick another pack. The row is kept (status `expired`) so the
 * back office still sees it; an order already validated or refused, or someone
 * else's, is never touched. The update is conditional on `pending`, like the
 * admin claim, so a cancel and a validation can never both win.
 */
export async function DELETE(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const parsed = CancelSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
    }

    const adminConfig = getSupabaseAdminConfig();
    if (!adminConfig) {
      return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
    }
    const admin = createSupabaseClient(adminConfig.url, adminConfig.serviceRoleKey);

    const { data, error } = await admin
      .from('manual_payments')
      .update({ status: 'expired', decided_at: new Date().toISOString() })
      .eq('order_number', parsed.data.orderNumber)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .select('order_number, status')
      .maybeSingle();
    if (error) {
      console.error('manual payment cancel failed:', error.message);
      return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'NOT_PENDING' }, { status: 409 });
    }
    return NextResponse.json({ success: true, order: data });
  } catch (err) {
    console.error('manual payment DELETE error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
