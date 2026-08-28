import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// GET : Récupérer tous les projets / historiques de l'utilisateur connecté
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Non connecté' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey && !supabaseUrl.includes('placeholder')) {
      const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey);

      const { data: projects, error } = await supabaseAdmin
        .from('projects')
        .select(`
          id,
          name,
          material,
          sheet_width,
          sheet_height,
          kerf,
          grain_direction,
          status,
          options_json,
          created_at,
          updated_at,
          cut_results (
            id,
            sheets_used,
            waste_percentage,
            total_area_used,
            layout_data,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erreur récupération projets:', error);
        return NextResponse.json({ error: 'DB_ERROR', message: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, projects });
    }

    // Fallback mode démo
    return NextResponse.json({ success: true, projects: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}

// POST : Sauvegarder un calcul de débit / projet dans l'historique
export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Non connecté' }, { status: 401 });
    }

    const body = await request.json();
    const { name, sheet, pieces, options, result } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey && !supabaseUrl.includes('placeholder')) {
      const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey);

      // 1. Créer le projet
      const { data: project, error: projErr } = await supabaseAdmin
        .from('projects')
        .insert({
          user_id: user.id,
          name: name || `Débit ${new Date().toLocaleDateString('fr-FR')} - ${sheet.material?.toUpperCase() || 'MDF'}`,
          material: sheet.material || 'mdf',
          sheet_width: sheet.width,
          sheet_height: sheet.height,
          kerf: sheet.kerf || 0.3,
          grain_direction: sheet.grainDirection ?? false,
          status: 'optimized',
          options_json: { options, pieces, sheet },
        })
        .select()
        .single();

      if (projErr || !project) {
        console.error('Erreur insertion projet:', projErr);
        return NextResponse.json({ error: 'PROJECT_INSERT_FAILED', message: projErr?.message }, { status: 500 });
      }

      // 2. Insérer le résultat de découpe
      if (result) {
        await supabaseAdmin.from('cut_results').insert({
          project_id: project.id,
          sheets_used: result.sheetsUsed,
          waste_percentage: result.wastePercentage,
          total_area_used: result.totalAreaUsed,
          layout_data: result,
        });
      }

      return NextResponse.json({ success: true, projectId: project.id });
    }

    return NextResponse.json({ success: true, projectId: 'demo_proj_' + Date.now() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur sauvegarde projet';
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}
