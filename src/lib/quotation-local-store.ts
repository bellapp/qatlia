/**
 * Persists the artisan's own company identity locally, so `QuotationDialog`
 * doesn't ask for the same company details on every quotation. Mirrors
 * `src/lib/units.ts`'s injected-storage pattern (readable/writable
 * interfaces instead of touching `window` directly), so behaviour is
 * asserted deterministically in tests instead of against real
 * `localStorage`/SSR.
 *
 * The client's identity is deliberately never persisted here (Task 8
 * remediation — item 7, "PII"): a client's name/address/phone/email is that
 * client's personal data, not the artisan's own, and has no business
 * sitting in the artisan's browser storage across unrelated quotations.
 * `QuotationDialog` starts every open with an empty client, and only ever
 * prefills one from a server-owned project's `options_json.quotation.client`
 * (see `/api/projects/[id]`) — scoped to that specific project, ownership
 * checked, never local-device storage.
 *
 * This is client-only, local-device storage — it is entirely separate from
 * (and never a substitute for) the server-side, ownership-checked
 * `options_json` merge `/api/export-quotation` performs for a saved project
 * (see route.ts). Nothing here ever reaches the network.
 */
import { CompanyIdentitySchema, type CompanyIdentity } from '@/lib/quotation';

const COMPANY_STORAGE_KEY = 'qatlia_quotation_company_v1';

interface ReadableStorage {
  getItem(key: string): string | null;
}
interface WritableStorage {
  setItem(key: string, value: string): void;
}

function readIdentity<T>(
  storage: ReadableStorage | undefined | null,
  key: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }
): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data !== undefined ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeIdentity(storage: WritableStorage | undefined | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (quota, privacy mode, SSR) — next read falls back to null */
  }
}

export function readStoredCompanyIdentity(storage: ReadableStorage | undefined | null): CompanyIdentity | null {
  return readIdentity(storage, COMPANY_STORAGE_KEY, CompanyIdentitySchema);
}

export function writeStoredCompanyIdentity(storage: WritableStorage | undefined | null, company: CompanyIdentity): void {
  writeIdentity(storage, COMPANY_STORAGE_KEY, company);
}
