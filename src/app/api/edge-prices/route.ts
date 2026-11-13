import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { PRICED_EDGE_IDS } from '@/lib/cutting/binpacking';
import { MAX_UNIT_PRICE } from '@/lib/cutting/optimize-schema';
import { createPresetsDb, isMissingTableError, toStoredPrice } from '@/lib/panel-presets-store';

export const dynamic = 'force-dynamic';

interface EdgePriceRow {
  edge_id: string;
  price_per_m: number | string;
}

/**
 * `GET /api/edge-prices` — the signed-in artisan's own price per metre for
 * each edge-banding colour (migration 015). A colour without one keeps the
 * catalog price. Until 015 is applied, an empty map flagged
 * `cloud_not_ready`, and the atelier keeps the prices stored on the device.
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
      return NextResponse.json({ success: true, prices: {}, note: 'cloud_not_ready' });
    }

    const { data, error } = await db.from('edge_band_prices').select('edge_id, price_per_m').eq('user_id', user.id);
    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ success: true, prices: {}, note: 'cloud_not_ready' });
      }
      console.error('edge prices list failed:', error.message);
      return NextResponse.json({ error: 'PRICES_UNAVAILABLE' }, { status: 503 });
    }

    const prices: Record<string, number> = {};
    for (const row of (data || []) as EdgePriceRow[]) {
      const value = Number(row.price_per_m);
      if (PRICED_EDGE_IDS.includes(row.edge_id) && Number.isFinite(value)) prices[row.edge_id] = value;
    }
    return NextResponse.json({ success: true, prices });
  } catch (err) {
    console.error('edge prices GET error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

const PutBodySchema = z.object({
  /** Colour → MAD/m. null resets that colour to the catalog price. */
  prices: z
    .record(z.string(), z.number().finite().min(0).max(MAX_UNIT_PRICE).nullable())
    .refine((prices) => Object.keys(prices).length > 0 && Object.keys(prices).every((id) => PRICED_EDGE_IDS.includes(id)), {
      message: 'unknown edge-banding colour',
    }),
});

/**
 * `PUT /api/edge-prices` — `{ prices: { white: 8.5, oak: null } }`: sets or
 * resets the given colours only; the others are left as they are.
 */
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

    const entries = Object.entries(body.data.prices);
    const toSet = entries.flatMap(([edgeId, price]) =>
      price === null ? [] : [{ user_id: user.id, edge_id: edgeId, price_per_m: toStoredPrice(price), updated_at: new Date().toISOString() }]
    );
    const toReset = entries.flatMap(([edgeId, price]) => (price === null ? [edgeId] : []));

    if (toSet.length > 0) {
      const { error } = await db.from('edge_band_prices').upsert(toSet, { onConflict: 'user_id,edge_id' });
      if (error) {
        if (isMissingTableError(error)) {
          return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
        }
        console.error('edge prices upsert failed:', error.message);
        return NextResponse.json({ error: 'PRICES_UNAVAILABLE' }, { status: 503 });
      }
    }
    if (toReset.length > 0) {
      const { error } = await db.from('edge_band_prices').delete().eq('user_id', user.id).in('edge_id', toReset);
      if (error) {
        if (isMissingTableError(error)) {
          return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
        }
        console.error('edge prices reset failed:', error.message);
        return NextResponse.json({ error: 'PRICES_UNAVAILABLE' }, { status: 503 });
      }
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('edge prices PUT error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
