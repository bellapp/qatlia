import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/pending-work';
import { parseAcquisitionCookie, tagsForNewAccount } from '@/lib/acquisition';
import { attachReferral } from '@/lib/referral-server';
import {
  REFERRAL_METADATA_KEY,
  clearReferralCookie,
  isFinalAttachAnswer,
  normalizeReferralCode,
  readReferralCookie,
} from '@/lib/referral';

type ServerClient = ReturnType<typeof createClient>;
type SessionUser = Parameters<typeof tagsForNewAccount>[0];

/**
 * A Google sign-up creates the account here: give it the source of the visit
 * that led to it (src/lib/acquisition.ts), as the email sign-up form does.
 * Never blocks the sign-in.
 */
async function tagNewAccount(supabase: ServerClient, user: SessionUser, cookieHeader: string | null): Promise<void> {
  try {
    const tags = tagsForNewAccount(user, parseAcquisitionCookie(cookieHeader), Date.now());
    if (!tags) return;
    const { error } = await supabase.auth.updateUser({ data: tags });
    if (error) console.error('[auth] could not record the sign-up source', error.name);
  } catch (error) {
    console.error('[auth] could not record the sign-up source', error instanceof Error ? error.name : 'unknown error');
  }
}

/**
 * Attach the account to its parrain (docs/adr/0002): the code a referral link
 * left in the cookie, else the one typed at an email sign-up, which reaches
 * here when the confirmation link is opened on another device. Returns true
 * when the cookie can be forgotten. Never blocks the sign-in.
 */
async function attachToParrain(user: { id?: string; user_metadata?: Record<string, unknown> } | null, cookieHeader: string | null): Promise<boolean> {
  if (!user?.id) return false;
  try {
    const fromCookie = readReferralCookie(cookieHeader);
    const code = fromCookie ?? normalizeReferralCode(user.user_metadata?.[REFERRAL_METADATA_KEY]);
    if (!code) return false;
    const result = await attachReferral(user.id, code);
    if (result.status === 'attached') return fromCookie !== null;
    if (result.status === 'refused') return fromCookie !== null && isFinalAttachAnswer({ success: false, error: result.error });
    return false;
  } catch (error) {
    console.error('[auth] could not attach the referral', error instanceof Error ? error.name : 'unknown error');
    return false;
  }
}

export async function GET(request: Request) {
  const { searchParams, origin, protocol } = new URL(request.url);
  const code = searchParams.get('code');
  // A same-site path only: `${origin}@evil.example` or `${origin}//evil.example`
  // would send a visitor who just signed in to another site.
  const redirect = safeRedirectPath(searchParams.get('redirect'), '/');

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const cookieHeader = request.headers.get('cookie');
      await tagNewAccount(supabase, data?.user ?? null, cookieHeader);
      const forget = await attachToParrain(data?.user ?? null, cookieHeader);
      const res = NextResponse.redirect(`${origin}${redirect}`);
      if (forget) res.headers.append('Set-Cookie', clearReferralCookie(protocol === 'https:'));
      return res;
    }
  }

  // En cas d'erreur, retour vers la page de login
  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
}
