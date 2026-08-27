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

    // Si Supabase est configuré en production
    if (supabaseUrl && serviceRoleKey && !supabaseUrl.includes('placeholder')) {
      const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey);

      // Récupérer le solde actuel
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('credits')
        .eq('id', user.id)
        .single();

      if (profileErr || !profile) {
        return NextResponse.json({ error: 'PROFILE_NOT_FOUND', message: 'Profil utilisateur introuvable.' }, { status: 404 });
      }

      if (profile.credits <= 0) {
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
      const { data: newCredits, error: deductErr } = await supabaseAdmin.rpc('deduct_credit', {
        p_user_id: user.id,
        p_amount: 1,
      });

      if (deductErr) {
        console.error('Erreur deduct_credit RPC:', deductErr);
        // Fallback update direct
        const updated = Math.max(0, profile.credits - 1);
        await supabaseAdmin.from('profiles').update({ credits: updated }).eq('id', user.id);
        return NextResponse.json({ success: true, creditsRemaining: updated });
      }

      return NextResponse.json({ success: true, creditsRemaining: newCredits });
    }

    // Mode Démo / Hors ligne
    return NextResponse.json({ success: true, creditsRemaining: 4 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la vérification des crédits';
    console.error('Credits consume error:', err);
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}
