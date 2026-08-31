import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { CompanyIdentitySchema, ClientIdentitySchema, QUOTATION_LOCALES } from '@/lib/quotation';

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
