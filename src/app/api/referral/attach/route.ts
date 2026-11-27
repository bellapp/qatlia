import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { attachReferral } from '@/lib/referral-server';
import {
  REFERRAL_METADATA_KEY,
  clearReferralCookie,
  isFinalAttachAnswer,
  normalizeReferralCode,
  readReferralCookie,
} from '@/lib/referral';

export const dynamic = 'force-dynamic';

/**
 * POST: attach the signed-in account to the owner of a code (ADR 0002).
 *
 * The code is the one in the body (typed on the purchase page), else the one
 * a referral link left in the cookie, else the one typed at sign-up
 * (user_metadata). The account is the session's, never one named in the body.
 * Once the answer cannot change (attached, or refused for good), the cookie
 * is cleared so the browser stops asking.
 */
export async function POST(req: Request) {
  let user: { id: string; user_metadata?: Record<string, unknown> } | null = null;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.length > 1000) return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
    if (text.trim() !== '') body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }

  const typed = body && typeof body === 'object' && 'code' in body ? body.code : undefined;
  const fromCookie = readReferralCookie(req.headers.get('cookie'));
  const code =
    typed !== undefined
      ? normalizeReferralCode(typed)
      : fromCookie ?? normalizeReferralCode(user.user_metadata?.[REFERRAL_METADATA_KEY]);

  const secure = new URL(req.url).protocol === 'https:';
  const forget = (res: NextResponse) => {
    if (fromCookie) res.headers.append('Set-Cookie', clearReferralCookie(secure));
    return res;
  };

  if (!code) {
    // A typed value that cannot be a code is refused like an unknown code.
    if (typed !== undefined) return NextResponse.json({ success: false, error: 'INVALID_CODE' });
    return forget(NextResponse.json({ success: false, error: 'NO_CODE' }));
  }

  const result = await attachReferral(user.id, code);
  if (result.status === 'unavailable') return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503 });
  if (result.status === 'error') return NextResponse.json({ error: 'ATTACH_FAILED' }, { status: 503 });

  const answer = result.status === 'attached' ? { success: true, duplicate: result.duplicate } : { success: false, error: result.error };
  const res = NextResponse.json(answer);
  return isFinalAttachAnswer(answer) ? forget(res) : res;
}
