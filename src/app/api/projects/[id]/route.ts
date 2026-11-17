import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { CompanyIdentitySchema, ClientIdentitySchema, QUOTATION_LOCALES } from '@/lib/quotation';
import { sanitizePdfGeneratedAt, sanitizeProjectName } from '@/lib/projects/history-metadata';
import { isOwnScanPath } from '@/lib/projects/scan-image';
import { withFirstScanPath } from '@/lib/projects/scan-sheets';

/**
 * `GET /api/projects/[id]` — read-only, ownership-checked access to a single
 * saved project's quotation metadata (Task 8 remediation — item 10,
 * "persistence roundtrip"). `QuotationDialog` calls this when it opens with
 * a `projectId`, so a re-opened quote can prefill company/client from the
 * server-owned record `/api/export-quotation` already persisted — never
 * from local storage (see src/lib/quotation-local-store.ts's own doc
 * comment on why client identity is never kept there).
 *
 * Returns only the `quotation` sub-object of `options_json`, re-validated
 * through the same schemas the write path uses, so a corrupted or
 * hand-edited DB row degrades to `null` rather than crashing this route or
 * leaking a malformed shape to the client. "Doesn't exist" and "belongs to
 * someone else" answer identically — the same convention as
 * `/api/export-quotation` — so this can never be used to enumerate other
 * artisans' project ids.
 */

type DbClient = SupabaseClient;

function createDbClient(): DbClient {
  const adminConfig = getSupabaseAdminConfig();
  if (adminConfig) return createAdminClient(adminConfig.url, adminConfig.serviceRoleKey);
  return createClient() as unknown as DbClient;
}

// Mirrors exactly what /api/export-quotation's route.ts persists into
// options_json.quotation — see its own POST handler's `mergedOptionsJson`.
const StoredQuotationMetadataSchema = z
  .object({
    company: CompanyIdentitySchema,
    client: ClientIdentitySchema,
    quoteNumber: z.string(),
    issueDate: z.string(),
    expiryDate: z.string().optional(),
    projectReference: z.string().optional(),
    notes: z.string().optional(),
    locale: z.enum(QUOTATION_LOCALES),
    deliveryCost: z.number(),
    tax: z.object({ mode: z.enum(['none', 'percentage']), ratePercent: z.number().optional() }),
    discount: z.object({ mode: z.enum(['none', 'percentage', 'fixed']), value: z.number().optional() }),
    includeAmountInWords: z.boolean(),
    updatedAt: z.string().optional(),
  })
  .strict();

export type StoredQuotationMetadata = z.infer<typeof StoredQuotationMetadataSchema>;

export async function GET(_req: Request, context: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const idResult = z.string().uuid().safeParse(context.params.id);
    if (!idResult.success) {
      return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
    }

    const db = createDbClient();
    const { data, error } = await db
      .from('projects')
      .select('id, user_id, options_json')
      .eq('id', idResult.data)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('PROJECT_QUOTATION_LOOKUP_FAILED:', error.message);
      return NextResponse.json({ error: 'PROJECT_LOOKUP_FAILED' }, { status: 503 });
    }
    // "not found" and "belongs to someone else" answer identically — see
    // the module doc above.
    if (!data) {
      return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
    }

    const optionsJson = data.options_json && typeof data.options_json === 'object' ? (data.options_json as Record<string, unknown>) : {};
    const parsed = StoredQuotationMetadataSchema.safeParse(optionsJson.quotation);

    return NextResponse.json({ success: true, quotation: parsed.success ? parsed.data : null });
  } catch (error: unknown) {
    // Never leak error.message — logged server-side only.
    console.error('PROJECT_QUOTATION_ROUTE_FAILED:', error);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}


/**
 * `PATCH /api/projects/[id]` — rename a saved project, record that its PDF
 * was generated, or attach the scan image the atelier sent after the save
 * (`{ scanPath }` alone: only a path under the artisan's own folder). Ownership-checked: the row only updates when it belongs
 * to the signed-in artisan, and "doesn't exist" / "belongs to someone else"
 * answer identically (the same enumeration-protection convention as the GET
 * handler).
 *
 * The PDF marker is merged into `options_json` (read, then written back with
 * every other key kept — quotation metadata included), so exporting a PDF no
 * longer saves the whole project a second time as a duplicate history entry.
 *
 * Local-only projects (never synced to the cloud `projects` table) cannot be
 * updated here — the client renames those directly in localStorage.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OwnOptions = { ok: true; existing: Record<string, unknown> } | { ok: false; response: NextResponse };

/**
 * Reads the signed-in artisan's own row and returns its `options_json` (an
 * empty object when it holds nothing usable). A lookup error answers 503, and
 * a missing row and another artisan's row answer the same 404, so nothing is
 * ever written for a row that is not theirs.
 */
async function readOwnOptions(db: DbClient, id: string, userId: string, label: string): Promise<OwnOptions> {
  const { data: row, error: lookupError } = await db
    .from('projects')
    .select('id, user_id, options_json')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupError) {
    console.error(`${label} lookup failed:`, lookupError.message);
    return { ok: false, response: NextResponse.json({ error: 'PROJECT_LOOKUP_FAILED' }, { status: 503 }) };
  }
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) };
  }
  const existing = row.options_json && typeof row.options_json === 'object' ? (row.options_json as Record<string, unknown>) : {};
  return { ok: true, existing };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const isPdfMarker = !!body && typeof body === 'object' && 'pdfGeneratedAt' in body && !('name' in body);
    const isScanPath = !!body && typeof body === 'object' && 'scanPath' in body && !('name' in body) && !('pdfGeneratedAt' in body);

    // UUID guard: a non-UUID id can never be a cloud row; refuse early.
    const { id } = await params;

    if (isPdfMarker) {
      const pdfGeneratedAt = sanitizePdfGeneratedAt(body.pdfGeneratedAt);
      if (!pdfGeneratedAt) {
        return NextResponse.json({ error: 'INVALID_PDF_DATE' }, { status: 400 });
      }
      if (!UUID_PATTERN.test(id)) {
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const db = createDbClient();
      const own = await readOwnOptions(db, id, user.id, 'project pdf marker');
      if (!own.ok) return own.response;
      const existing = own.existing;
      const { error: updateError } = await db
        .from('projects')
        .update({ options_json: { ...existing, pdfGeneratedAt } })
        .eq('id', id)
        .eq('user_id', user.id);
      if (updateError) {
        console.error('project pdf marker update failed:', updateError.message);
        return NextResponse.json({ error: 'PROJECT_UPDATE_FAILED' }, { status: 503 });
      }
      return NextResponse.json({ success: true, id, pdfGeneratedAt });
    }

    if (isScanPath) {
      // Never another artisan's image, nor anything that is not a kept-image path.
      if (!isOwnScanPath(body.scanPath, user.id)) {
        return NextResponse.json({ error: 'INVALID_SCAN_PATH' }, { status: 400 });
      }
      const scanPath = body.scanPath;
      if (!UUID_PATTERN.test(id)) {
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const db = createDbClient();
      const own = await readOwnOptions(db, id, user.id, 'project scan path');
      if (!own.ok) return own.response;
      const { error: updateError } = await db
        .from('projects')
        .update({ options_json: withFirstScanPath(own.existing, scanPath) })
        .eq('id', id)
        .eq('user_id', user.id);
      if (updateError) {
        console.error('project scan path update failed:', updateError.message);
        return NextResponse.json({ error: 'PROJECT_UPDATE_FAILED' }, { status: 503 });
      }
      return NextResponse.json({ success: true, id, scanPath });
    }

    // Same rule as the name a save carries: trimmed, not empty, 120 characters at most.
    const name = sanitizeProjectName(body?.name);
    if (!name) {
      return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 });
    }

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const db = createDbClient();
    const own = await readOwnOptions(db, id, user.id, 'project rename');
    if (!own.ok) return own.response;
    // The atelier reads `options_json.projectName` on reopen, so a rename
    // writes both; every other key is kept.
    const { error: updateError } = await db
      .from('projects')
      .update({ name, options_json: { ...own.existing, projectName: name } })
      .eq('id', id)
      .eq('user_id', user.id);
    if (updateError) {
      console.error('project rename update failed:', updateError.message);
      return NextResponse.json({ error: 'PROJECT_UPDATE_FAILED' }, { status: 503 });
    }
    return NextResponse.json({ success: true, id, name });
  } catch (err) {
    console.error('project update failed:', err);
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
