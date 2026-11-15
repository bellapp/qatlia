/**
 * Saves the project name the artisan typed in the atelier.
 *
 * A project reopened from the history, or saved by an optimization, already
 * has a record: on the server (`cloudId`) or on this device only (`localId`).
 * The name is written to that record. With no record yet there is nothing to
 * rename: the name stays in the atelier and goes with the next save.
 *
 * No Supabase, no env: the network call and the device history are injected.
 */

export type RenameOutcome = 'saved' | 'pending' | 'failed';

export interface RenameTarget {
  cloudId: string | null;
  localId: string | null;
}

export interface RenameDeps {
  fetch: typeof fetch;
  renameLocal: (id: string, name: string) => boolean;
}

export async function saveProjectName(
  target: RenameTarget,
  name: string,
  deps: RenameDeps,
): Promise<RenameOutcome> {
  const trimmed = name.trim();
  if (!trimmed) return 'pending';

  if (target.cloudId) {
    try {
      const res = await deps.fetch(`/api/projects/${target.cloudId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      return res.ok ? 'saved' : 'failed';
    } catch {
      return 'failed';
    }
  }

  if (target.localId) {
    return deps.renameLocal(target.localId, trimmed) ? 'saved' : 'failed';
  }

  return 'pending';
}
