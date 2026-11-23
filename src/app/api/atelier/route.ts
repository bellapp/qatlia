import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AtelierSchema } from '@/lib/atelier';
import { readAtelier, saveAtelier } from '@/lib/atelier-server';
import { validateLogoDataUrl } from '@/lib/exports/quotation-logo';

export const dynamic = 'force-dynamic';

/** A business is a few text fields and a logo of at most 500 KB (about 700 KB as base64). */
const MAX_BODY_BYTES = 1_000_000;

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

/** GET: the signed-in account's business, or null when it has none. */
export async function GET(_req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

  return NextResponse.json({ atelier: await readAtelier(userId) });
}

/**
 * PUT: saves the account's business (the whole form). The owner is always the
 * session's user — the schema is strict, so a body naming one is refused. The
 * body and the logo are never logged.
 */
export async function PUT(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'TOO_LARGE' }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }

  const parsed = AtelierSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const atelier = parsed.data;

  // The data-URL shape is checked by the schema; the bytes (real PNG/JPEG,
  // declared type, dimensions) only by the logo validator.
  if (typeof atelier.logoDataUrl === 'string' && !validateLogoDataUrl(atelier.logoDataUrl).ok) {
    return NextResponse.json({ error: 'INVALID_LOGO' }, { status: 400 });
  }

  const createOnly = new URL(req.url).searchParams.get('createOnly') === '1';
  const saved = await saveAtelier(userId, atelier, createOnly ? { createOnly: true } : undefined);
  if (!saved) return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 });

  return NextResponse.json({ atelier });
}
