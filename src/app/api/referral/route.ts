import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readReferralOverview } from '@/lib/referral-server';
import { referralLink } from '@/lib/referral';

export const dynamic = 'force-dynamic';

/**
 * GET: the signed-in account's referral code and link, its filleuls (first
 * name or masked email, whether they bought, what they earned it) and its
 * newest bonuses. 503 before migration 022 is applied: the pages then hide
 * the feature.
 */
export async function GET(req: Request) {
  let userId: string | null = null;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

  const result = await readReferralOverview(userId);
  if (result.status === 'unavailable') return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503 });
  if (result.status === 'error') return NextResponse.json({ error: 'READ_FAILED' }, { status: 503 });

  const origin = new URL(req.url).origin;
  return NextResponse.json({ ...result.overview, link: referralLink(origin, result.overview.code) });
}
