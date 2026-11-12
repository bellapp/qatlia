import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { findDuplicatePreset } from '@/lib/panel-preset-rules';
import {
  MAX_PRESETS_PER_REQUEST,
  MAX_PRESETS_PER_USER,
  PRESET_COLUMNS,
  PresetInputSchema,
  createPresetsDb,
  isMissingTableError,
  toAccountPreset,
  toPresetRow,
  type PanelPresetRow,
} from '@/lib/panel-presets-store';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/panel-presets` — the signed-in artisan's own stock panels.
 *
 * Until migration 011 is applied (or without the service role), the answer is
 * an empty list flagged `cloud_not_ready`, and the atelier keeps using the
 * presets stored on the device.
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
      return NextResponse.json({ success: true, presets: [], note: 'cloud_not_ready' });
    }

    const { data, error } = await db
      .from('panel_presets')
      .select(PRESET_COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ success: true, presets: [], note: 'cloud_not_ready' });
      }
      console.error('panel presets list failed:', error.message);
      return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
    }

    return NextResponse.json({ success: true, presets: ((data || []) as PanelPresetRow[]).map(toAccountPreset) });
  } catch (err) {
    console.error('panel presets GET error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

const CreateBodySchema = z.object({
  presets: z.array(z.unknown()).min(1).max(MAX_PRESETS_PER_REQUEST),
});

/**
 * `POST /api/panel-presets` — `{ presets: [...] }`, one preset for a save or
 * the device list for the one-time import. Each preset is validated on its
 * own; a duplicate of an existing panel (see panel-preset-rules.ts) is
 * reported, not stored, so a re-run of the import is harmless.
 */
export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const body = CreateBodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'INVALID_PRESET' }, { status: 400 });
    }
    const inputs = body.data.presets.map((item) => PresetInputSchema.safeParse(item));
    const valid = inputs.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    const invalid = inputs.length - valid.length;
    if (valid.length === 0) {
      return NextResponse.json({ error: 'INVALID_PRESET' }, { status: 400 });
    }

    const db = createPresetsDb();
    if (!db) {
      return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
    }

    const { data: existingRows, error: listError } = await db
      .from('panel_presets')
      .select(PRESET_COLUMNS)
      .eq('user_id', user.id);
    if (listError) {
      if (isMissingTableError(listError)) {
        return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
      }
      console.error('panel presets lookup failed:', listError.message);
      return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
    }

    const known = ((existingRows || []) as PanelPresetRow[]).map(toAccountPreset);
    const existingCount = known.length;
    const toInsert: ReturnType<typeof toPresetRow>[] = [];
    const duplicates: Array<{ name: string; existingName: string }> = [];
    for (const input of valid) {
      const row = toPresetRow(user.id, input);
      const candidate = toAccountPreset({ ...row, id: '' });
      const duplicate = findDuplicatePreset(candidate, known);
      if (duplicate) {
        duplicates.push({ name: input.name, existingName: duplicate.name });
        continue;
      }
      known.push(candidate);
      toInsert.push(row);
    }

    if (existingCount + toInsert.length > MAX_PRESETS_PER_USER) {
      return NextResponse.json({ error: 'PRESET_LIMIT', limit: MAX_PRESETS_PER_USER }, { status: 409 });
    }

    let created: ReturnType<typeof toAccountPreset>[] = [];
    if (toInsert.length > 0) {
      const { data, error } = await db.from('panel_presets').insert(toInsert).select(PRESET_COLUMNS);
      if (error) {
        if (isMissingTableError(error)) {
          return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
        }
        console.error('panel presets insert failed:', error.message);
        return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
      }
      created = ((data || []) as PanelPresetRow[]).map(toAccountPreset);
    }

    return NextResponse.json({ success: true, created, duplicates, invalid });
  } catch (err) {
    console.error('panel presets POST error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
