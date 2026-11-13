import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb, isMissingMigration } from '@/lib/admin/db';
import { writeAudit } from '@/lib/admin/audit';
import { isUuid } from '@/lib/billing/grant';

export const dynamic = 'force-dynamic';

/**
 * Save the admin's private note, phone and tags for a client
 * (public.admin_client_notes, migration 012). The client never sees them.
 */

const NoteSchema = z.object({
  phone: z
    .string()
    .max(30)
    .regex(/^[\d\s+\-()]*$/)
    .nullable(),
  tags: z.array(z.string().max(30)).max(10),
  note: z.string().max(2000).nullable(),
});

const blankToNull = (value: string | null): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== '')));
}

const sameTags = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((tag, i) => tag === b[i]);

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const authorization = await authorizeAdminRequest(req);
  if (!authorization.ok) return authorization.response;
  const { admin } = authorization;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const parsed = NoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'DB_NOT_CONFIGURED' }, { status: 503 });
  }

  const { data: userData } = await db.auth.admin.getUserById(params.id);
  if (!userData?.user) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const next = {
    phone: blankToNull(parsed.data.phone),
    tags: normalizeTags(parsed.data.tags),
    note: blankToNull(parsed.data.note),
  };

  const { data: previous, error: readError } = await db
    .from('admin_client_notes')
    .select('phone, tags, note')
    .eq('user_id', params.id)
    .maybeSingle();
  if (readError) {
    if (isMissingMigration(readError)) return NextResponse.json({ error: 'MIGRATION_MISSING' }, { status: 503 });
    console.error('admin note read failed:', readError.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  const { error: writeError } = await db.from('admin_client_notes').upsert(
    {
      user_id: params.id,
      ...next,
      updated_at: new Date().toISOString(),
      updated_by: admin.userId,
    },
    { onConflict: 'user_id' }
  );
  if (writeError) {
    console.error('admin note write failed:', writeError.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  const before = (previous ?? { phone: null, tags: [], note: null }) as { phone: string | null; tags: unknown; note: string | null };
  const fields = [
    before.phone !== next.phone ? 'phone' : null,
    !sameTags(before.tags, next.tags) ? 'tags' : null,
    before.note !== next.note ? 'note' : null,
  ].filter((field): field is string => field !== null);

  if (fields.length > 0) {
    await writeAudit(db, { adminId: admin.userId, action: 'note_updated', targetUserId: params.id, details: { fields } });
  }

  return NextResponse.json({ success: true });
}
