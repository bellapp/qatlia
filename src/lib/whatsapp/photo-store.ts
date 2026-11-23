/**
 * The photo reads of the WhatsApp bot (public.whatsapp_photo_reads, migration
 * 019): who may have a photo read, and the pieces a link opens.
 *
 * A number gets one successful read, forever. The reservation is a 'reading'
 * row, and the partial unique index on wa_id (status reading or ok) is what
 * makes two photos sent together start only one read. A failed read frees
 * the number, up to MAX_FAILED_READS_PER_DAY; every read, failed or not,
 * counts against the day's cap, since each one called the vision model.
 *
 * A missing table (migration 019 not applied) reads as 'unavailable': the bot
 * then answers as before, and the 016 "tables missing" path is not involved.
 */

import { randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReadPiece, ReadSheet } from '@/lib/vision/read-cut-list';
import { removePlanPictures } from '@/lib/whatsapp/plan-picture-store';

/** A link, and what it holds, last this long: long enough to sign up, short enough not to be passed around. */
export const PHOTO_READ_TTL_HOURS = 24;
export const STALE_READING_MS = 2 * 60 * 1000;
export const MAX_FAILED_READS_PER_DAY = 3;

const TABLE = 'whatsapp_photo_reads';
const DAY_MS = 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';
/** No l, o, 0 or 1: a code read aloud or retyped cannot be misread. */
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 10;

export interface PhotoSummary {
  pieceCount: number;
  lineCount: number;
  sheetsUsed: number;
  wastePercent: number;
  /** The panel the summary was computed on: the one read on the sheet, or the default. */
  sheet: ReadSheet;
  unplaced: number;
  /** True when no panel was written and a larger standard one was taken so the pieces fit (fittingPanel). */
  fitted?: true;
}

export type Reservation =
  | { status: 'reserved'; id: string }
  | { status: 'already'; code: string | null }
  | { status: 'busy' }
  | { status: 'too_many_failures' }
  | { status: 'daily_cap' }
  | { status: 'unavailable' };

export interface PhotoDraft {
  pieces: ReadPiece[];
  sheet: ReadSheet;
}

interface DbError {
  code?: string;
  message?: string;
}

class PhotoTableMissing extends Error {}

const isMissingTable = (error: DbError) => error.code === 'PGRST205' || error.code === '42P01';

function check(error: DbError | null, action: string): void {
  if (!error) return;
  if (isMissingTable(error)) throw new PhotoTableMissing();
  throw new Error(`[whatsapp] photo store ${action} failed (${error.code ?? 'no code'}): ${error.message ?? 'unknown error'}`);
}

export function newPhotoCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

interface CurrentRow {
  id: string;
  status: 'reading' | 'ok';
  code: string | null;
  expires_at: string | null;
  created_at: string;
}

/**
 * Erases what expired reads still hold, so nothing outlives its 24 hours even
 * when its link is never opened again. Runs with each reservation; a failure
 * is logged and never blocks the photo at hand.
 */
async function purgeExpired(db: SupabaseClient, now: Date): Promise<void> {
  const { data, error } = await db
    .from(TABLE)
    .update({ pieces: null, sheet: null, summary: null })
    .lt('expires_at', now.toISOString())
    .not('pieces', 'is', null)
    .select('code');
  if (error && isMissingTable(error)) throw new PhotoTableMissing();
  if (error) console.error('[whatsapp] photo purge failed', error.code ?? 'no code');
  // Their stored plan pictures go with them (src/lib/whatsapp/plan-picture-store.ts).
  const codes = ((data ?? []) as Array<{ code: string | null }>).map((row) => row.code).filter((code): code is string => !!code);
  await removePlanPictures(db, codes);
}

async function reserve(db: SupabaseClient, waId: string, now: Date, dailyCap: number): Promise<Reservation> {
  await purgeExpired(db, now);
  const current = await db
    .from(TABLE)
    .select('id, status, code, expires_at, created_at')
    .eq('wa_id', waId)
    .in('status', ['reading', 'ok']);
  check(current.error, 'current read');
  for (const row of (current.data ?? []) as CurrentRow[]) {
    if (row.status === 'ok') {
      const valid = row.code && row.expires_at && Date.parse(row.expires_at) > now.getTime();
      return { status: 'already', code: valid ? row.code : null };
    }
    if (now.getTime() - Date.parse(row.created_at) < STALE_READING_MS) return { status: 'busy' };
    // A read that never finished (the function was stopped): it frees the number.
    const stale = await db.from(TABLE).update({ status: 'failed' }).eq('id', row.id);
    check(stale.error, 'stale read');
  }

  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const failures = await db
    .from(TABLE)
    .select('id')
    .eq('wa_id', waId)
    .eq('status', 'failed')
    .gte('created_at', since)
    .limit(MAX_FAILED_READS_PER_DAY);
  check(failures.error, 'failures');
  if ((failures.data ?? []).length >= MAX_FAILED_READS_PER_DAY) return { status: 'too_many_failures' };

  const today = await db.from(TABLE).select('id').gte('created_at', since).limit(dailyCap);
  check(today.error, 'daily count');
  if ((today.data ?? []).length >= dailyCap) return { status: 'daily_cap' };

  const inserted = await db.from(TABLE).insert({ wa_id: waId, status: 'reading' }).select('id').single();
  if (inserted.error?.code === UNIQUE_VIOLATION) return { status: 'busy' };
  check(inserted.error, 'reserve');
  const id = (inserted.data as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') throw new Error('[whatsapp] photo store reserve returned no id');
  return { status: 'reserved', id };
}

/** Reserves this number's photo read, or says why not. Throws only on an unexpected database error. */
export async function reservePhotoRead(db: SupabaseClient, waId: string, now: Date, dailyCap: number): Promise<Reservation> {
  if (dailyCap <= 0) return { status: 'daily_cap' };
  try {
    return await reserve(db, waId, now, dailyCap);
  } catch (error) {
    if (error instanceof PhotoTableMissing) return { status: 'unavailable' };
    throw error;
  }
}

export async function completePhotoRead(
  db: SupabaseClient,
  id: string,
  result: { code: string; pieces: ReadPiece[]; sheet: ReadSheet | null; summary: PhotoSummary; now: Date },
): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({
      status: 'ok',
      code: result.code,
      pieces: result.pieces,
      sheet: result.sheet,
      summary: result.summary,
      expires_at: new Date(result.now.getTime() + PHOTO_READ_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', id);
  check(error, 'complete');
}

export async function failPhotoRead(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from(TABLE).update({ status: 'failed' }).eq('id', id);
  check(error, 'fail');
}

interface DraftRow {
  id: string;
  pieces: ReadPiece[] | null;
  summary: { sheet?: ReadSheet } | null;
  expires_at: string | null;
  opened_at: string | null;
}

/**
 * The pieces and the panel a link opens; 'expired' once its 24 hours are over
 * (its content is then purged); null for an unknown code or a missing table.
 * `markOpened: false` (a link preview fetch) leaves `opened_at` as it is.
 */
export async function openPhotoDraft(
  db: SupabaseClient,
  code: string,
  now: Date,
  options: { markOpened?: boolean } = {},
): Promise<PhotoDraft | 'expired' | null> {
  const markOpened = options.markOpened ?? true;
  try {
    const found = await db.from(TABLE).select('id, pieces, summary, expires_at, opened_at').eq('code', code).maybeSingle();
    check(found.error, 'open');
    const row = found.data as DraftRow | null;
    if (!row) return null;

    const sheet = row.summary?.sheet;
    const expired = !row.expires_at || Date.parse(row.expires_at) <= now.getTime();
    if (expired || !Array.isArray(row.pieces) || !sheet) {
      if (row.pieces !== null) {
        const purge = await db.from(TABLE).update({ pieces: null, sheet: null, summary: null }).eq('id', row.id);
        check(purge.error, 'purge');
      }
      return 'expired';
    }

    if (markOpened && row.opened_at === null) {
      const opened = await db.from(TABLE).update({ opened_at: now.toISOString() }).eq('id', row.id).is('opened_at', null);
      check(opened.error, 'opened');
    }
    return { pieces: row.pieces, sheet };
  } catch (error) {
    if (error instanceof PhotoTableMissing) return null;
    throw error;
  }
}

/**
 * The last sheet this number sent that the bot read: its piece count, and its
 * code while the link is valid (null once expired). For the assistant, which
 * asked again for a sheet it had read (anas, 21/11/2026). Null when none was read.
 */
export async function latestPhotoRead(
  db: SupabaseClient,
  waId: string,
  now: Date,
): Promise<{ pieceCount: number; code: string | null } | null> {
  const found = await db
    .from(TABLE)
    .select('code, expires_at, summary')
    .eq('wa_id', waId)
    .eq('status', 'ok')
    .order('created_at', { ascending: false })
    .limit(1);
  check(found.error, 'latest read');
  const row = ((found.data ?? []) as Array<{ code: string | null; expires_at: string | null; summary: { pieceCount?: unknown } | null }>)[0];
  if (!row) return null;
  const valid = row.code && row.expires_at && Date.parse(row.expires_at) > now.getTime();
  const pieceCount = typeof row.summary?.pieceCount === 'number' ? row.summary.pieceCount : 0;
  return { pieceCount, code: valid ? row.code : null };
}

/**
 * Whether a read of this number started less than STALE_READING_MS ago and
 * has not ended: a message sent meanwhile waits for it (src/lib/whatsapp/read-wait.ts).
 */
export async function photoReadRunning(db: SupabaseClient, waId: string, now: Date): Promise<boolean> {
  const found = await db
    .from(TABLE)
    .select('id')
    .eq('wa_id', waId)
    .eq('status', 'reading')
    .gt('created_at', new Date(now.getTime() - STALE_READING_MS).toISOString())
    .limit(1);
  check(found.error, 'running read');
  return (found.data ?? []).length > 0;
}
