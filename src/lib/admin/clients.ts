import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/billing/grant';
import { isMissingMigration } from './db';
import { ledgerAmount, summarizeLedger, type LedgerRow, type LedgerSummary } from './ledger';
import { summarizeProject, type ProjectRow, type ProjectSummary } from './projects';

/**
 * Back office reads about clients: the paginated list (one SQL call to
 * admin_client_list, migration 012) and everything known about one client.
 *
 * Server-only: takes the service-role client from ./db.
 */

export const CLIENT_SEGMENTS = ['all', 'paying', 'never_paid', 'out_of_credits', 'inactive_30d', 'pending_order'] as const;
export type ClientSegment = (typeof CLIENT_SEGMENTS)[number];

export const CLIENT_SORTS = ['created_desc', 'last_activity_desc', 'credits_asc', 'credits_desc', 'paid_desc', 'scans_desc'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export const CLIENT_PAGE_SIZE = 50;
const SEARCH_MAX_LENGTH = 80;
export const LEDGER_LIMIT = 2000;
const PROJECT_LIMIT = 100;

export interface ClientListParams {
  search: string;
  segment: ClientSegment;
  sort: ClientSort;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined): string => (typeof value === 'string' ? value : '');

export function parseClientListParams(searchParams: SearchParams): ClientListParams {
  const segment = single(searchParams.segment);
  const sort = single(searchParams.sort);
  const page = Math.floor(Number(single(searchParams.page)));
  return {
    search: single(searchParams.q).trim().slice(0, SEARCH_MAX_LENGTH),
    segment: (CLIENT_SEGMENTS as readonly string[]).includes(segment) ? (segment as ClientSegment) : 'all',
    sort: (CLIENT_SORTS as readonly string[]).includes(sort) ? (sort as ClientSort) : 'created_desc',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export interface ClientListRow {
  userId: string;
  email: string | null;
  fullName: string | null;
  locale: string | null;
  provider: string | null;
  credits: number;
  signedUpAt: string | null;
  lastSignInAt: string | null;
  scans: number;
  optimizations: number;
  purchases: number;
  creditsPurchased: number;
  paidMad: number;
  pendingOrders: number;
  projects: number;
  lastActivityAt: string | null;
  phone: string | null;
  tags: string[];
}

export type ClientListResult =
  | { status: 'ok'; rows: ClientListRow[]; total: number; pageSize: number }
  | { status: 'migration_missing' }
  | { status: 'error' };

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const tags = (value: unknown): string[] => (Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []);

function toClientListRow(raw: Record<string, unknown>): ClientListRow {
  return {
    userId: String(raw.user_id),
    email: str(raw.email),
    fullName: str(raw.full_name),
    locale: str(raw.locale),
    provider: str(raw.provider),
    credits: ledgerAmount(raw.credits),
    signedUpAt: str(raw.signed_up_at),
    lastSignInAt: str(raw.last_sign_in_at),
    scans: ledgerAmount(raw.scans),
    optimizations: ledgerAmount(raw.optimizations),
    purchases: ledgerAmount(raw.purchases),
    creditsPurchased: ledgerAmount(raw.credits_purchased),
    paidMad: ledgerAmount(raw.paid_mad),
    pendingOrders: ledgerAmount(raw.pending_orders),
    projects: ledgerAmount(raw.projects),
    lastActivityAt: str(raw.last_activity_at),
    phone: str(raw.phone),
    tags: tags(raw.tags),
  };
}

export async function listClients(db: SupabaseClient, params: ClientListParams): Promise<ClientListResult> {
  const { data, error } = await db.rpc('admin_client_list', {
    p_search: params.search === '' ? null : params.search,
    p_segment: params.segment,
    p_sort: params.sort,
    p_limit: CLIENT_PAGE_SIZE,
    p_offset: (params.page - 1) * CLIENT_PAGE_SIZE,
  });
  if (error) {
    if (isMissingMigration(error)) return { status: 'migration_missing' };
    console.error('admin_client_list failed:', error.message);
    return { status: 'error' };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return {
    status: 'ok',
    rows: rows.map(toClientListRow),
    total: rows.length > 0 ? ledgerAmount(rows[0].total_count) : 0,
    pageSize: CLIENT_PAGE_SIZE,
  };
}

export interface ManualOrderRow {
  order_number: string;
  pack_id: string;
  amount_mad: number;
  credits: number;
  status: string;
  method: string | null;
  payment_reference: string | null;
  operator_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface ClientNote {
  phone: string | null;
  tags: string[];
  note: string | null;
  updatedAt: string | null;
}

export interface ClientIdentity {
  userId: string;
  email: string | null;
  fullName: string | null;
  locale: string | null;
  provider: string | null;
  phone: string | null;
  emailConfirmedAt: string | null;
  signedUpAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
}

export interface ClientDetail {
  identity: ClientIdentity;
  /** Null when the client has no profile row yet. */
  balance: number | null;
  summary: LedgerSummary;
  /** Newest first. */
  ledger: LedgerRow[];
  ledgerTruncated: boolean;
  orders: ManualOrderRow[];
  paidMad: number;
  projects: ProjectSummary[];
  panelPresetCount: number;
  note: ClientNote | null;
  /** The 50 latest admin actions on this client, newest first. */
  audit: ClientAuditEntry[];
}

export interface ClientAuditEntry {
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  adminId: string;
}

const AUDIT_LIMIT = 50;

export type ClientDetailResult = { status: 'ok'; client: ClientDetail } | { status: 'not_found' } | { status: 'error' };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function toOrder(raw: Record<string, unknown>): ManualOrderRow {
  return {
    order_number: String(raw.order_number ?? ''),
    pack_id: String(raw.pack_id ?? ''),
    amount_mad: ledgerAmount(raw.amount_mad),
    credits: ledgerAmount(raw.credits),
    status: String(raw.status ?? ''),
    method: str(raw.method),
    payment_reference: str(raw.payment_reference),
    operator_note: str(raw.operator_note),
    created_at: String(raw.created_at ?? ''),
    decided_at: str(raw.decided_at),
  };
}

function toLedgerRow(raw: Record<string, unknown>): LedgerRow {
  return {
    id: String(raw.id ?? ''),
    type: str(raw.type),
    amount: ledgerAmount(raw.amount),
    balance_after: raw.balance_after === null || raw.balance_after === undefined ? null : ledgerAmount(raw.balance_after),
    description: str(raw.description),
    reason: str(raw.reason),
    stripe_payment_id: str(raw.stripe_payment_id),
    amount_paid: raw.amount_paid === null || raw.amount_paid === undefined ? null : ledgerAmount(raw.amount_paid),
    currency: str(raw.currency),
    created_at: String(raw.created_at ?? ''),
  };
}

export async function getClientDetail(db: SupabaseClient, userId: string): Promise<ClientDetailResult> {
  if (!isUuid(userId)) return { status: 'not_found' };

  const { data: authData, error: authError } = await db.auth.admin.getUserById(userId);
  if (authError) {
    // The admin API answers "User not found" with an error too.
    if (/not.?found/i.test(authError.message || '')) return { status: 'not_found' };
    console.error('admin getUserById failed:', authError.message);
    return { status: 'error' };
  }
  const user = authData?.user;
  if (!user) return { status: 'not_found' };

  const [profile, ledger, orders, projects, presets, note, audit] = await Promise.all([
    db.from('profiles').select('full_name, locale, credits, updated_at').eq('id', userId).maybeSingle(),
    db
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LEDGER_LIMIT),
    db
      .from('manual_payments')
      .select('order_number, pack_id, amount_mad, credits, status, method, payment_reference, operator_note, created_at, decided_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    db
      .from('projects')
      .select('id, name, material, sheet_width, sheet_height, created_at, options_json')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(PROJECT_LIMIT),
    db.from('panel_presets').select('id').eq('user_id', userId).limit(500),
    db.from('admin_client_notes').select('phone, tags, note, updated_at').eq('user_id', userId).maybeSingle(),
    db
      .from('admin_audit_log')
      .select('action, details, created_at, admin_id')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(AUDIT_LIMIT),
  ]);

  // Without the ledger or the projects every figure on the page would be
  // wrong, so those are hard failures; the rest degrade to empty.
  if (ledger.error || profile.error || projects.error) {
    console.error('admin client detail failed:', (ledger.error || profile.error || projects.error)?.message);
    return { status: 'error' };
  }

  const profileRow = asRecord(profile.data);
  const balance = profileRow && profileRow.credits !== null && profileRow.credits !== undefined ? ledgerAmount(profileRow.credits) : null;
  const ledgerRows = (Array.isArray(ledger.data) ? ledger.data : []).map((row) => toLedgerRow(row as Record<string, unknown>));
  const orderRows = orders.error ? [] : (Array.isArray(orders.data) ? orders.data : []).map((row) => toOrder(row as Record<string, unknown>));
  const noteRow = note.error ? null : asRecord(note.data);
  const clientNote: ClientNote | null = noteRow
    ? { phone: str(noteRow.phone), tags: tags(noteRow.tags), note: str(noteRow.note), updatedAt: str(noteRow.updated_at) }
    : null;

  const appMeta = asRecord(user.app_metadata) ?? {};
  const userMeta = asRecord(user.user_metadata) ?? {};

  return {
    status: 'ok',
    client: {
      identity: {
        userId,
        email: str(user.email),
        fullName: str(profileRow?.full_name) ?? str(userMeta.full_name),
        locale: str(profileRow?.locale),
        provider: str(appMeta.provider),
        phone: clientNote?.phone ?? str(user.phone),
        emailConfirmedAt: str(user.email_confirmed_at),
        signedUpAt: str(user.created_at),
        lastSignInAt: str(user.last_sign_in_at),
        bannedUntil: str((user as { banned_until?: unknown }).banned_until),
      },
      balance,
      summary: summarizeLedger(ledgerRows, balance),
      ledger: ledgerRows,
      ledgerTruncated: ledgerRows.length >= LEDGER_LIMIT,
      orders: orderRows,
      paidMad: orderRows.filter((o) => o.status === 'granted').reduce((sum, o) => sum + o.amount_mad, 0),
      projects: (Array.isArray(projects.data) ? projects.data : []).map((row) => summarizeProject(row as ProjectRow)),
      panelPresetCount: presets.error || !Array.isArray(presets.data) ? 0 : presets.data.length,
      note: clientNote,
      audit:
        audit.error || !Array.isArray(audit.data)
          ? []
          : audit.data.map((row) => {
              const record = row as Record<string, unknown>;
              return {
                action: String(record.action ?? ''),
                details: asRecord(record.details) ?? {},
                createdAt: String(record.created_at ?? ''),
                adminId: String(record.admin_id ?? ''),
              };
            }),
    },
  };
}
