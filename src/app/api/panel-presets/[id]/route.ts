import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { findDuplicatePreset } from '@/lib/panel-preset-rules';
import { MAX_UNIT_PRICE } from '@/lib/cutting/optimize-schema';
import {
  LEGACY_PRESET_COLUMNS,
  PRESET_COLUMNS,
  PresetInputSchema,
  createPresetsDb,
  isMissingColumnError,
  isMissingTableError,
  selectUserPresets,
  toAccountPreset,
  toPresetUpdate,
  toStoredPrice,
  type PanelPresetRow,
} from '@/lib/panel-presets-store';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `DELETE /api/panel-presets/[id]` — removes one of the signed-in artisan's
 * stock panels. "Doesn't exist" and "belongs to someone else" answer
 * identically, as for projects, so ids cannot be probed.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const db = createPresetsDb();
    if (!db) {
      return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
    }

    const { data, error } = await db
      .from('panel_presets')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
      }
      console.error('panel preset delete failed:', error.message);
      return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('panel preset DELETE error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

const PriceBodySchema = z.object({
  /** MAD per panel; null clears it (the catalog price per m² applies again). */
  pricePerSheet: z.number().finite().min(0).max(MAX_UNIT_PRICE).nullable(),
});

/**
 * `PATCH /api/panel-presets/[id]` — two bodies:
 * - `{ pricePerSheet }`: the price of one of the artisan's stock panels changes
 *   with the supplier, the panel does not;
 * - a whole panel (recognised by its `name`, validated like a new one): the
 *   panel page edits every attribute at once. A panel made identical to
 *   another of the artisan's (see panel-preset-rules.ts) is refused with the
 *   other's name, and nothing is written.
 * Same not-found answer as DELETE for someone else's id.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const raw: unknown = await req.json().catch(() => null);
    if (raw && typeof raw === 'object' && 'name' in raw) {
      return await updateWholePreset(user.id, id, raw);
    }
    const body = PriceBodySchema.safeParse(raw);
    if (!body.success) {
      return NextResponse.json({ error: 'INVALID_PRICE' }, { status: 400 });
    }

    const db = createPresetsDb();
    if (!db) {
      return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
    }

    const price = body.data.pricePerSheet;
    const { data, error } = await db
      .from('panel_presets')
      .update({ price_per_sheet: price === null ? null : toStoredPrice(price) })
      .eq('id', id)
      .eq('user_id', user.id)
      .select(PRESET_COLUMNS);

    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
      }
      console.error('panel preset price update failed:', error.message);
      return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ success: true, preset: toAccountPreset(data[0] as unknown as PanelPresetRow) });
  } catch (err) {
    console.error('panel preset PATCH error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

async function updateWholePreset(userId: string, id: string, raw: unknown) {
  const input = PresetInputSchema.safeParse(raw);
  if (!input.success) {
    return NextResponse.json({ error: 'INVALID_PRESET' }, { status: 400 });
  }

  const db = createPresetsDb();
  if (!db) {
    return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
  }

  const { data: rows, error: listError } = await selectUserPresets(db, userId);
  if (listError) {
    if (isMissingTableError(listError)) {
      return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
    }
    console.error('panel presets lookup failed:', listError.message);
    return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
  }
  const known = ((rows || []) as unknown as PanelPresetRow[]).map(toAccountPreset);
  // Someone else's id is not in the artisan's own list: same answer as a missing one.
  if (!known.some((preset) => preset.id === id)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const values = toPresetUpdate(input.data);
  const others = known.filter((preset) => preset.id !== id);
  const duplicate = findDuplicatePreset(toAccountPreset({ ...values, id, user_id: userId }), others);
  if (duplicate) {
    return NextResponse.json({ error: 'DUPLICATE_PRESET', existingName: duplicate.name }, { status: 409 });
  }

  const write = (next: Partial<typeof values>, columns: string) =>
    db.from('panel_presets').update(next).eq('id', id).eq('user_id', userId).select(columns);
  let { data, error } = await write(values, PRESET_COLUMNS);
  if (error && isMissingColumnError(error)) {
    // Migration 015 not applied yet: the panel is edited, without its price.
    const { price_per_sheet: _price, ...withoutPrice } = values;
    void _price;
    ({ data, error } = await write(withoutPrice, LEGACY_PRESET_COLUMNS));
  }
  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
    }
    console.error('panel preset update failed:', error.message);
    return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({ success: true, preset: toAccountPreset(data[0] as unknown as PanelPresetRow) });
}
