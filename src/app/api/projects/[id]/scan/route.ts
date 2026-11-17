import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { SCAN_BUCKET, isOwnScanPath } from '@/lib/projects/scan-image';
import { MAX_SCAN_SHEETS, readScanSheets } from '@/lib/projects/scan-sheets';

/**
 * `GET /api/projects/[id]/scan` — a signed link, valid 5 minutes, to the scan
 * image of one of the signed-in artisan's own projects. The bucket is private
 * and has no storage policy: only this route, with the service key, can sign.
 *
 * The row is read with the artisan's session by `id` AND `user_id`, so a
 * project that is missing and one that belongs to someone else answer the
 * same 404. The stored `options_json.scanPath` is not trusted either: it is
 * checked against the session's user id again before anything is signed.
 * The link is never cached.
 */
export const dynamic = 'force-dynamic';

const SIGNED_URL_SECONDS = 300;
const NO_STORE = { 'Cache-Control': 'no-store' };

const NOT_FOUND = () => NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE });
const UNAVAILABLE = () => NextResponse.json({ error: 'SCAN_UNAVAILABLE' }, { status: 503, headers: NO_STORE });

/** The sheet asked for: `?n=1..4`, default 1; anything else names none. */
function requestedSheet(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get('n');
  if (raw === null) return 1;
  if (!/^[1-9]$/.test(raw)) return null;
  const sheet = Number(raw);
  return sheet <= MAX_SCAN_SHEETS ? sheet : null;
}

export async function GET(req: Request, context: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers: NO_STORE });
    }

    const idResult = z.string().uuid().safeParse(context.params.id);
    if (!idResult.success) return NOT_FOUND();
    const sheet = requestedSheet(req);
    if (sheet === null) return NOT_FOUND();

    const { data, error } = await supabase
      .from('projects')
      .select('id, user_id, options_json')
      .eq('id', idResult.data)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      console.error('Erreur lecture projet pour image scan:', error.message);
      return UNAVAILABLE();
    }
    if (!data) return NOT_FOUND();

    const optionsJson = data.options_json && typeof data.options_json === 'object' ? (data.options_json as Record<string, unknown>) : {};
    // The sheet's image (an old project's single scan is sheet 1).
    const scanPath = readScanSheets(optionsJson)[sheet - 1]?.path;
    if (!isOwnScanPath(scanPath, user.id)) return NOT_FOUND();

    const adminConfig = getSupabaseAdminConfig();
    if (!adminConfig) return UNAVAILABLE();

    const admin = createAdminClient(adminConfig.url, adminConfig.serviceRoleKey);
    const { data: signed, error: signError } = await admin.storage
      .from(SCAN_BUCKET)
      .createSignedUrl(scanPath, SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) {
      console.error('Erreur lien image scan:', signError?.message);
      return UNAVAILABLE();
    }

    return NextResponse.json({ success: true, url: signed.signedUrl }, { headers: NO_STORE });
  } catch (err: unknown) {
    console.error('Erreur image scan:', err instanceof Error ? err.message : err);
    return UNAVAILABLE();
  }
}
