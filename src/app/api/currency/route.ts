import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { APP_CURRENCIES, CURRENCY_COOKIE_NAME, type AppCurrency } from '@/lib/currency';
import { resolveRequestCurrency, saveAccountCurrency } from '@/lib/currency-server';

export const dynamic = 'force-dynamic';

const ONE_YEAR_S = 60 * 60 * 24 * 365;

async function currentUserId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** GET: the currency prices are shown in — the account's, else the visitor's. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  const currency = await resolveRequestCurrency(req, userId);
  return NextResponse.json({ currency, signedIn: userId !== null });
}

const ChangeSchema = z.object({
  currency: z.enum(APP_CURRENCIES as unknown as [AppCurrency, ...AppCurrency[]]),
});

/** POST: the customer changes their currency (saved on the account when signed in). */
export async function POST(req: Request) {
  const parsed = ChangeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_CURRENCY' }, { status: 400 });
  }
  const { currency } = parsed.data;

  const userId = await currentUserId();
  if (userId && !(await saveAccountCurrency(userId, currency))) {
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 });
  }

  const res = NextResponse.json({ currency });
  // Also kept in a cookie, so the choice holds before signing in and on the
  // pages that are not tied to an account.
  res.cookies.set(CURRENCY_COOKIE_NAME, currency, { path: '/', maxAge: ONE_YEAR_S, sameSite: 'lax' });
  return res;
}
