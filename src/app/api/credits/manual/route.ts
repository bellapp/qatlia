import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { CREDIT_PACKS, PackId } from '@/lib/billing/catalog';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  packId: z.enum(['starter', 'standard', 'pro', 'atelier_max']),
  method: z.enum(['manual', 'cashplus_agency', 'bank_transfer', 'wafacash']).default('manual'),
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
        .select('order_number, amount_mad, credits, pack_id, method, status')
        .single();

      if (!error && data) {
        return NextResponse.json({ success: true, order: data });
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
    return NextResponse.json({ success: true, orders: data || [] });
  } catch (err) {
    console.error('manual payment GET error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
