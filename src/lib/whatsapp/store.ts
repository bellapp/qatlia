/**
 * Supabase persistence for the WhatsApp bot: contacts and the message log.
 *
 * Every function takes the (service-role) client as its first argument, so the
 * route owns client creation and tests can pass a fake. Errors are thrown; the
 * route decides what to do with them (the webhook never answers 500).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HistoryItem } from '@/lib/whatsapp/assistant';
import type { Lang } from '@/lib/whatsapp/copy';
import type { ContactState } from '@/lib/whatsapp/router';

const CONTACTS = 'whatsapp_contacts';
const MESSAGES = 'whatsapp_messages';
const CONTACT_COLUMNS = 'wa_id, profile_name, lang, greeted_at, handoff_until, referral';

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505';

/** Thrown when migration 015 has not been applied to this database yet. */
export class WhatsAppTablesMissingError extends Error {
  constructor() {
    super('[whatsapp] tables missing: apply supabase/migrations/015_whatsapp_bot.sql');
    this.name = 'WhatsAppTablesMissingError';
  }
}

interface DbError {
  code?: string;
  message?: string;
}

interface ContactRow {
  wa_id: string;
  profile_name: string | null;
  lang: Lang;
  greeted_at: string | null;
  handoff_until: string | null;
  referral: Record<string, unknown> | null;
}

/** PostgREST `PGRST205` (table not in the schema cache) or Postgres `42P01` (undefined table). */
function isMissingTable(error: DbError): boolean {
  return error.code === 'PGRST205' || error.code === '42P01';
}

/** Throws the right error for a failed query. Never returns. */
function raise(error: DbError, action: string): never {
  if (isMissingTable(error)) throw new WhatsAppTablesMissingError();
  throw new Error(`[whatsapp] store ${action} failed (${error.code ?? 'no code'}): ${error.message ?? 'unknown error'}`);
}

function toState(row: ContactRow): ContactState {
  return {
    waId: row.wa_id,
    lang: row.lang,
    greetedAt: row.greeted_at ? new Date(row.greeted_at) : null,
    handoffUntil: row.handoff_until ? new Date(row.handoff_until) : null,
  };
}

async function selectContact(db: SupabaseClient, waId: string): Promise<ContactRow | null> {
  const { data, error } = await db.from(CONTACTS).select(CONTACT_COLUMNS).eq('wa_id', waId).maybeSingle();
  if (error) raise(error, 'read contact');
  return (data as ContactRow | null) ?? null;
}

/**
 * Creates the contact if absent, otherwise refreshes only the profile name
 * (when a different one is given) and fills a still-empty referral. Never
 * touches `greeted_at`, `handoff_until` or an existing referral.
 */
export async function upsertContact(
  db: SupabaseClient,
  input: { waId: string; profileName: string | null; referral: Record<string, unknown> | null },
): Promise<ContactState> {
  let row = await selectContact(db, input.waId);

  if (!row) {
    const { data, error } = await db
      .from(CONTACTS)
      .insert({ wa_id: input.waId, profile_name: input.profileName, referral: input.referral })
      .select(CONTACT_COLUMNS)
      .single();
    if (!error) return toState(data as ContactRow);
    if (error.code !== UNIQUE_VIOLATION) raise(error, 'create contact');

    // A concurrent delivery created it first: carry on with that row.
    row = await selectContact(db, input.waId);
    if (!row) raise(error, 'create contact');
  }

  const patch: Record<string, unknown> = {};
  if (input.profileName && input.profileName !== row.profile_name) patch.profile_name = input.profileName;
  if (input.referral && row.referral === null) patch.referral = input.referral;

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error } = await db.from(CONTACTS).update(patch).eq('wa_id', input.waId);
    if (error) raise(error, 'update contact');
  }
  return toState(row);
}

/**
 * Stores the inbound message. `false` when Meta redelivered it (the wamid is
 * already there), so the caller must not answer it a second time.
 */
export async function claimInbound(
  db: SupabaseClient,
  input: { wamid: string; waId: string; kind: string; body: string | null },
): Promise<boolean> {
  const { error } = await db.from(MESSAGES).insert({
    wamid: input.wamid,
    wa_id: input.waId,
    direction: 'user',
    kind: input.kind,
    body: input.body,
  });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  raise(error, 'claim inbound');
}

/** Logs a message sent by the bot or by a human. An already stored wamid is not an error. */
export async function recordOutbound(
  db: SupabaseClient,
  input: { waId: string; wamid: string | null; direction: 'bot' | 'human'; kind: string; body: string | null },
): Promise<void> {
  const { error } = await db.from(MESSAGES).insert({
    wamid: input.wamid,
    wa_id: input.waId,
    direction: input.direction,
    kind: input.kind,
    body: input.body,
  });
  if (error && error.code !== UNIQUE_VIOLATION) raise(error, 'record outbound');
}

/** Applies the given fields only; `handoffUntil: null` clears the handoff. */
export async function updateContact(
  db: SupabaseClient,
  waId: string,
  patch: { lang?: Lang; greetedAt?: Date; handoffUntil?: Date | null },
): Promise<void> {
  const columns: Record<string, unknown> = {};
  if (patch.lang !== undefined) columns.lang = patch.lang;
  if (patch.greetedAt !== undefined) columns.greeted_at = patch.greetedAt.toISOString();
  if (patch.handoffUntil !== undefined) {
    columns.handoff_until = patch.handoffUntil ? patch.handoffUntil.toISOString() : null;
  }
  if (Object.keys(columns).length === 0) return;

  // No trigger maintains updated_at (see migration 015).
  columns.updated_at = new Date().toISOString();
  const { error } = await db.from(CONTACTS).update(columns).eq('wa_id', waId);
  if (error) raise(error, 'update contact');
}

/**
 * The last `limit` text messages of the conversation, oldest first, leaving
 * out `excludeWamid` (the inbound message being answered, already stored).
 *
 * The exclusion is done here rather than with a `neq` filter: `wamid <> x` is
 * NULL for rows without a wamid (bot messages whose send was not acknowledged)
 * and SQL would drop them.
 */
export async function recentHistory(
  db: SupabaseClient,
  waId: string,
  limit: number,
  excludeWamid?: string,
): Promise<HistoryItem[]> {
  const { data, error } = await db
    .from(MESSAGES)
    .select('direction, body, wamid')
    .eq('wa_id', waId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // One spare row, in case the excluded message is among the newest.
    .limit(limit + 1);
  if (error) raise(error, 'read history');

  const rows = (data ?? []) as Array<{ direction: HistoryItem['direction']; body: string | null; wamid: string | null }>;
  return rows
    .filter((row) => row.body && (excludeWamid === undefined || row.wamid !== excludeWamid))
    .slice(0, limit)
    .reverse()
    .map((row) => ({ direction: row.direction, body: row.body as string }));
}

/** Number of assistant (free-form AI) replies sent to this contact since `since`. */
export async function countAssistantReplies(db: SupabaseClient, waId: string, since: Date): Promise<number> {
  const { count, error } = await db
    .from(MESSAGES)
    .select('id', { count: 'exact', head: true })
    .eq('wa_id', waId)
    .eq('direction', 'bot')
    .eq('kind', 'assistant')
    .gte('created_at', since.toISOString());
  if (error) raise(error, 'count assistant replies');
  return count ?? 0;
}
