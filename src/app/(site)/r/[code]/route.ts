import { NextResponse } from 'next/server';
import { REFERRAL_LANDING, normalizeReferralCode, referralCookie } from '@/lib/referral';

export const dynamic = 'force-dynamic';

/**
 * The link a parrain shares (qatlia.ma/r/<code>): it keeps the code in a
 * cookie and opens the home page, tagged so the sign-up source reads
 * "referral". The code is checked when the account is attached, not here: an
 * unknown code simply attaches nobody. A link that cannot hold a code opens
 * the home page and keeps nothing.
 */
export function GET(req: Request, { params }: { params: { code: string } }) {
  const url = new URL(req.url);
  const code = normalizeReferralCode(params.code);
  const res = NextResponse.redirect(new URL(REFERRAL_LANDING, url.origin));
  if (code) res.headers.append('Set-Cookie', referralCookie(code, url.protocol === 'https:'));
  return res;
}
