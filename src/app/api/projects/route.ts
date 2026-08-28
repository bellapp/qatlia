import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

async function getSessionAndDb() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, db: null };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db =
    supabaseUrl && serviceRoleKey && !supabaseUrl.includes('placeholder')
      ? createAdminClient(supabaseUrl, serviceRoleKey)
      : supabase;

  return { user, db };
}

export async function GET() {
  try {
    const { user, db } = await getSessionAndDb();
    if (!user || !db) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Non connecté' }, { status: 401 });
    }

    await db.from('profiles').upsert(
      {
        id: user.id,
        email: user.email || 'artisan@qatlia.ma',
        full_name: (user.user_metadata?.full_name as string) || user.email?.split('@')[0] || 'Artisan',
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    const { data: projects, error } = await db
      .from('projects')
      .select('id, name, material, sheet_width, sheet_height, kerf, grain_direction, status, options_json, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur récupération projets:', error);
      return NextResponse.json({ error: 'DB_ERROR', message: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, projects: projects || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, db } = await getSessionAndDb();
    if (!user || !db) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Non connecté' }, { status: 401 });
    }

    const body = await request.json();
    const { name, sheet, pieces, options, result } = body as {
      name?: string;
      sheet?: { width?: number; height?: number; material?: string; kerf?: number; grainDirection?: boolean };
      pieces?: Array<{ name?: string; width?: number; height?: number; quantity?: number; rotatable?: boolean }>;
      options?: unknown;
      result?: { sheetsUsed?: number; wastePercentage?: number; totalAreaUsed?: number };
    };

    await db.from('profiles').upsert(
      {
        id: user.id,
        email: user.email || 'artisan@qatlia.ma',
        full_name: (user.user_metadata?.full_name as string) || user.email?.split('@')[0] || 'Artisan',
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    const baseRow = {
      user_id: user.id,
      name: name || `Débit ${new Date().toLocaleDateString('fr-FR')} — ${(sheet?.material || 'MDF').toUpperCase()}`,
      material: sheet?.material || 'mdf',
      sheet_width: sheet?.width ?? 208,
      sheet_height: sheet?.height ?? 278,
      kerf: sheet?.kerf ?? 0.3,
      grain_direction: sheet?.grainDirection ?? false,
      status: 'optimized',
    };

    let insert = await db
      .from('projects')
      .insert({ ...baseRow, options_json: { options, pieces, sheet, result } })
      .select('id')
      .single();

    if (insert.error && /options_json/i.test(insert.error.message || '')) {
      insert = await db.from('projects').insert(baseRow).select('id').single();
    }

    if (insert.error || !insert.data) {
      console.error('Erreur insertion projet:', insert.error);
      return NextResponse.json(
        { error: 'PROJECT_INSERT_FAILED', message: insert.error?.message || 'Insertion impossible' },
        { status: 500 }
      );
    }

    const projectId = insert.data.id as string;

    if (result) {
      await db.from('cut_results').insert({
        project_id: projectId,
        sheets_used: result.sheetsUsed ?? 1,
        waste_percentage: result.wastePercentage ?? 0,
        total_area_used: result.totalAreaUsed ?? 0,
        layout_data: result,
      });
    }

    if (Array.isArray(pieces) && pieces.length > 0) {
      await db.from('pieces').insert(
        pieces.map((p, i) => ({
          project_id: projectId,
          label: p.name || `Pièce ${i + 1}`,
          width: p.width,
          height: p.height,
          quantity: p.quantity || 1,
          rotatable: p.rotatable ?? true,
          sort_order: i,
        }))
      );
    }

    return NextResponse.json({ success: true, projectId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur sauvegarde projet';
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}
