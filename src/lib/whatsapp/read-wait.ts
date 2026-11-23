/**
 * A text or a voice note that comes in while this number's photo is being
 * read waits for the read (Minuisr Aluminium, 23/11/2026: a voice note sent
 * during the read was answered « صوّر الورقة… وصيفطها ليا هنا », one second
 * after his plan). Once the read is stored, the assistant is told the sheet
 * was read (photoReadFor) and does not ask for it again. The read is stored
 * just before its answer is sent: the reply may still go out a moment before
 * the plan card, and the card is not yet in the history.
 *
 * The wait ends READ_WAIT_UNTIL_MS after the message came in, which leaves
 * the assistant its budget (assistantBudgetMs) and the send its retry inside
 * the route's 60 s.
 *
 * - 'none': no read was running; nothing waited;
 * - 'done': a read was running and ended (stored as read, or failed);
 * - 'running': still running when the wait ended.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { photoReadRunning } from '@/lib/whatsapp/photo-store';

export const READ_WAIT_UNTIL_MS = 20_000;
export const READ_POLL_MS = 1_500;

export type ReadWait = 'none' | 'done' | 'running';

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');

/** False when the lookup fails: the answer then goes out as before. */
async function running(db: SupabaseClient, waId: string, now: Date): Promise<boolean> {
  try {
    return await photoReadRunning(db, waId, now);
  } catch (error) {
    console.error('[whatsapp] running read lookup failed', describe(error));
    return false;
  }
}

export async function waitForPhotoRead(
  db: SupabaseClient,
  waId: string,
  receivedAt: Date,
  timing: { clock?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReadWait> {
  const clock = timing.clock ?? Date.now;
  const sleep = timing.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (!(await running(db, waId, new Date(clock())))) return 'none';

  const deadline = receivedAt.getTime() + READ_WAIT_UNTIL_MS;
  while (clock() + READ_POLL_MS <= deadline) {
    await sleep(READ_POLL_MS);
    if (!(await running(db, waId, new Date(clock())))) return 'done';
  }
  return 'running';
}
