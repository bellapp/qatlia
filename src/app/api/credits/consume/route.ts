import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function POST() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Vérifier si l'utilisateur est connecté
    if (!user) {
      return NextResponse.json(
        { error: 'AUTH_REQUIRED', message: 'Veuillez vous connecter pour télécharger le rapport PDF.' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey && !supabaseUrl.includes('placeholder')) {
      const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey);

      // Assurer que le profil existe
      await supabaseAdmin.from('profiles').upsert(
        {
          id: user.id,
          email: user.email || 'artisan@qatlia.ma',
          full_name: user.user_metadata?.full_name || 'Artisan QatlIA',
          credits: 5,
        },
        { onConflict: 'id' }
      );

      // Récupérer le solde actuel
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('credits')
        .eq('id', user.id)
        .single();

      const currentCredits = profile?.credits ?? 5;

      if (currentCredits <= 0) {
        return NextResponse.json(
          {
            error: 'INSUFFICIENT_CREDITS',
            message: 'Votre solde de crédits est épuisé. Rechargez votre compte pour continuer.',
            credits: 0,
          },
          { status: 402 }
        );
      }

      // Déduire 1 crédit
      const updated = Math.max(0, currentCredits - 1);
      await supabaseAdmin.from('profiles').update({ credits: updated }).eq('id', user.id);

      return NextResponse.json({ success: true, creditsRemaining: updated });
    }

    // Mode Démo / Hors ligne
    return NextResponse.json({ success: true, creditsRemaining: 4 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la vérification des crédits';
    console.error('Credits consume error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}
