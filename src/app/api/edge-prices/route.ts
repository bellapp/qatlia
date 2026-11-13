import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MAX_UNIT_PRICE } from '@/lib/cutting/optimize-schema';
import { createPresetsDb, isMissingTableError, toStoredPrice } from '@/lib/panel-presets-store';

export const dynamic = 'force-dynamic';

/**
 * The artisan's one price per metre of edge banding, for every colour, is
 * the `edge_band_prices` row with this id (table from migration 015, first
 * built for a price per colour; rows for a single colour are no longer read).
 */
const EDGE_PRICE_ROW_ID = 'all';

/**
 * `GET /api/edge-prices` — `{ success, price }`: the signed-in artisan's
 * price per metre of edge banding, or null for the catalog prices. Until
 * migration 015 is applied, null flagged `cloud_not_ready`, and the atelier
 * keeps the price stored on the device.
 */
export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const db = createPresetsDb();
    if (!db) {
      return NextResponse.json({ success: true, price: null, note: 'cloud_not_ready' });
    }

    const { data, error } = await db
      .from('edge_band_prices')
      .select('price_per_m')
      .eq('user_id', user.id)
      .eq('edge_id', EDGE_PRICE_ROW_ID)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ success: true, price: null, note: 'cloud_not_ready' });
      }
      console.error('edge price read failed:', error.message);
      return NextResponse.json({ error: 'PRICES_UNAVAILABLE' }, { status: 503 });
    }

    const value = data ? Number((data as { price_per_m: number | string }).price_per_m) : NaN;
    return NextResponse.json({ success: true, price: Number.isFinite(value) ? value : null });
  } catch (err) {
    console.error('edge price GET error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

const PutBodySchema = z.object({
  /** MAD per metre; null goes back to the catalog prices. */
  price: z.number().finite().min(0).max(MAX_UNIT_PRICE).nullable(),
});

/** `PUT /api/edge-prices` — `{ price: 9.5 }` sets the price, `{ price: null }` removes it. */
export async function PUT(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const body = PutBodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'INVALID_PRICE' }, { status: 400 });
    }

    const db = createPresetsDb();
    if (!db) {
      return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
    }

    const { price } = body.data;
    const { error } =
      price === null
        ? await db.from('edge_band_prices').delete().eq('user_id', user.id).eq('edge_id', EDGE_PRICE_ROW_ID)
        : await db.from('edge_band_prices').upsert(
            [{ user_id: user.id, edge_id: EDGE_PRICE_ROW_ID, price_per_m: toStoredPrice(price), updated_at: new Date().toISOString() }],
            { onConflict: 'user_id,edge_id' }
          );
    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
      }
      console.error('edge price save failed:', error.message);
      return NextResponse.json({ error: 'PRICES_UNAVAILABLE' }, { status: 503 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('edge price PUT error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
