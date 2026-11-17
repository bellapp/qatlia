/**
 * Scan groups: several cut-list photos of one project for one credit.
 *
 * A paid photo read opens a group of MAX_SCANS_PER_ANALYSIS reads, valid
 * ANALYSIS_WINDOW_HOURS (migration 018). The atelier sends the group back with
 * the next photo of the same project, which is then read without a debit while
 * the group has room.
 *
 * Every ledger error here reads as "no group": the photo is then charged
 * exactly as before groups existed. That keeps /api/vision working before
 * migration 018 reaches the database, and a broken group can never block a
 * read the artisan is willing to pay for.
 *
 * The admin client is passed in, so the module has no env and no I/O of its own.
 */

import { isUuid } from './grant';

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** The group id a request presents, or null when it presents none worth asking about. */
export function requestedScanGroup(value: unknown): string | null {
  return isUuid(value) ? (value as string) : null;
}

async function call(admin: RpcClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await admin.rpc(fn, args);
    if (error) {
      console.warn(`${fn} failed:`, error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`${fn} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Advisory: whether a read in this group may skip the balance check. `claimScanRead` decides. */
export async function scanGroupHasRoom(admin: RpcClient, userId: string, groupId: string): Promise<boolean> {
  return (await call(admin, 'scan_group_has_room', { p_user_id: userId, p_group_id: groupId })) === true;
}

/**
 * Counts one more read in the group. Resolves the reads used after it, or null
 * when the group is not the caller's, is full, has expired, or the ledger failed.
 */
export async function claimScanRead(admin: RpcClient, userId: string, groupId: string): Promise<number | null> {
  const used = await call(admin, 'claim_scan_read', { p_user_id: userId, p_group_id: groupId });
  return typeof used === 'number' && Number.isInteger(used) ? used : null;
}

/** Opens a group after a paid read (which counts as its first), or null. */
export async function openScanGroup(admin: RpcClient, userId: string): Promise<string | null> {
  const id = await call(admin, 'open_scan_group', { p_user_id: userId });
  return isUuid(id) ? (id as string) : null;
}
