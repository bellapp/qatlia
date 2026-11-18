import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { findDuplicatePreset } from '@/lib/panel-preset-rules';
import { PANEL_CATALOG_VERSION, missingCatalogPanels } from '@/lib/panel-catalog';
import { resolveRequestCurrency } from '@/lib/currency-server';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import {
  LEGACY_PRESET_COLUMNS,
  MAX_PRESETS_PER_REQUEST,
  MAX_PRESETS_PER_USER,
  PRESET_COLUMNS,
  PresetInputSchema,
  createPresetsDb,
  isMissingColumnError,
  isMissingTableError,
  selectUserPresets,
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
 *
 * The first read of an account's list copies the panel catalogue into it
 * (see copyCatalogOnce); the list answered includes the copied panels.
 */
export async function GET(req?: Request) {
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

    const { data, error } = await selectUserPresets(db, user.id);

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ success: true, presets: [], note: 'cloud_not_ready' });
      }
      console.error('panel presets list failed:', error.message);
      return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
    }

    const presets = ((data || []) as unknown as PanelPresetRow[]).map(toAccountPreset);
    const copied = await copyCatalogOnce(db, user, presets, req);
    return NextResponse.json({ success: true, presets: [...presets, ...copied] });
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

    const { data: existingRows, error: listError } = await selectUserPresets(db, user.id);
    if (listError) {
      if (isMissingTableError(listError)) {
        return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
      }
      console.error('panel presets lookup failed:', listError.message);
      return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
    }

    const known = ((existingRows || []) as unknown as PanelPresetRow[]).map(toAccountPreset);
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
      let { data, error } = await db.from('panel_presets').insert(toInsert).select(PRESET_COLUMNS);
      if (error && isMissingColumnError(error)) {
        // Migration 015 not applied yet: keep the panels, without their price.
        const withoutPrice = toInsert.map(({ price_per_sheet: _price, ...row }) => {
          void _price;
          return row;
        });
        ({ data, error } = await db.from('panel_presets').insert(withoutPrice).select(LEGACY_PRESET_COLUMNS));
      }
      if (error) {
        if (isMissingTableError(error)) {
          return NextResponse.json({ error: 'CLOUD_NOT_READY' }, { status: 503 });
        }
        console.error('panel presets insert failed:', error.message);
        return NextResponse.json({ error: 'PRESETS_UNAVAILABLE' }, { status: 503 });
      }
      created = ((data || []) as unknown as PanelPresetRow[]).map(toAccountPreset);
    }

    return NextResponse.json({ success: true, created, duplicates, invalid });
  } catch (err) {
    console.error('panel presets POST error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}

/** Set in the account once the catalogue was copied: a panel removed after never comes back. */
const CATALOG_FLAG = 'panel_catalog';

/**
 * Copies the panel catalogue (src/lib/panel-catalog.ts) into the artisan's
 * list once: only the panels they do not have yet, within their limit, priced
 * in their currency. Marked as done in the account afterwards, so a failed
 * copy is tried again on the next read and a done one never again. Never
 * throws: the list is answered whatever happens here.
 */
async function copyCatalogOnce(db: SupabaseClient, user: User, existing: ReturnType<typeof toAccountPreset>[], req?: Request) {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (meta[CATALOG_FLAG] === PANEL_CATALOG_VERSION) return [];
  try {
    const currency = req ? await resolveRequestCurrency(req, user.id) : DEFAULT_CURRENCY;
    const missing = missingCatalogPanels(existing, currency, MAX_PRESETS_PER_USER - existing.length);
    let created: ReturnType<typeof toAccountPreset>[] = [];
    if (missing.length > 0) {
      const rows = missing.map((preset) => toPresetRow(user.id, preset as Parameters<typeof toPresetRow>[1]));
      let { data, error } = await db.from('panel_presets').insert(rows).select(PRESET_COLUMNS);
      if (error && isMissingColumnError(error)) {
        // Migration 015 not applied yet: the panels are copied, without their price.
        const withoutPrice = rows.map(({ price_per_sheet: _price, ...row }) => {
          void _price;
          return row;
        });
        ({ data, error } = await db.from('panel_presets').insert(withoutPrice).select(LEGACY_PRESET_COLUMNS));
      }
      if (error) {
        console.error('panel catalogue copy failed:', error.message);
        return [];
      }
      created = ((data || []) as unknown as PanelPresetRow[]).map(toAccountPreset);
    }
    // What the account already holds is sent back with the flag: whether the
    // update merges or replaces it, the sign-in providers stay.
    try {
      const { error: flagError } = await db.auth.admin.updateUserById(user.id, { app_metadata: { ...meta, [CATALOG_FLAG]: PANEL_CATALOG_VERSION } });
      if (flagError) console.error('panel catalogue flag failed:', flagError.message);
    } catch (err) {
      // Not marked: the next read finds the panels already there and copies none.
      console.error('panel catalogue flag error:', err);
    }
    return created;
  } catch (err) {
    console.error('panel catalogue copy error:', err);
    return [];
  }
}
