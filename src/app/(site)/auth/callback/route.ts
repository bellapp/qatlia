import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/pending-work';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // A same-site path only: `${origin}@evil.example` or `${origin}//evil.example`
  // would send a visitor who just signed in to another site.
  const redirect = safeRedirectPath(searchParams.get('redirect'), '/');

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  // En cas d'erreur, retour vers la page de login
  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
}
