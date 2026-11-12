import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPresetsDb, isMissingTableError } from '@/lib/panel-presets-store';

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
