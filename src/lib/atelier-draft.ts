/**
 * The job on screen in the atelier, kept in the tab while the artisan visits
 * another screen (history, panel list) and put back on return.
 *
 * It lives in `sessionStorage`: one tab, gone when the tab closes. Keeping it
 * is a convenience, so nothing here throws: a draft that does not fit is kept
 * without its plan, or not at all, and leaving the atelier still works.
 */

export const ATELIER_DRAFT_KEY = 'qatlia_atelier_draft';
/** Left by a sign-out: the atelier still on screen must not keep its job as it closes. */
const DRAFT_HOLD_KEY = 'qatlia_atelier_draft_hold';

export interface AtelierDraft {
  v: 1;
  /** Same shape the atelier already restores from 'qatlia_saved_project'; `result` may be absent. */
  project: Record<string, unknown>;
  /** The pieces the plan on screen was computed from, when they differ from `project.pieces`. */
  plannedPieces: unknown[] | null;
  cutMode: '2d' | '1d';
  projectId: string | null;
  localProjectId: string | null;
  /** ISO date shown by the "reopened plan" banner, when the plan came from the history. */
  restoredAt: string | null;
}

type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type DraftWriteResult = 'full' | 'without-plan' | 'dropped';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isAtelierDraft(value: unknown): value is AtelierDraft {
  return isRecord(value)
    && value.v === 1
    && isRecord(value.project)
    && (value.plannedPieces === null || Array.isArray(value.plannedPieces))
    && (value.cutMode === '2d' || value.cutMode === '1d')
    && isStringOrNull(value.projectId)
    && isStringOrNull(value.localProjectId)
    && isStringOrNull(value.restoredAt);
}

function tryWrite(store: DraftStore, draft: AtelierDraft): boolean {
  try {
    store.setItem(ATELIER_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** The draft with what weighs the most left out: the plan, and what only describes it. */
function withoutPlan(draft: AtelierDraft): AtelierDraft {
  const project = { ...draft.project };
  delete project.result;
  return { ...draft, project, plannedPieces: null, restoredAt: null };
}

/**
 * Keeps the draft. When it does not fit (quota), it is kept without its plan:
 * the pieces and the panel are what would be long to type again, the plan is
 * one click away. When even that fails, nothing is kept, and no older draft is
 * left behind to come back in its place. Nothing is kept either after a
 * sign-out, until an atelier opens again (see forgetAtelierDraft). Never throws.
 */
export function writeAtelierDraft(store: DraftStore, draft: AtelierDraft): DraftWriteResult {
  if (isOnHold(store)) {
    clearAtelierDraft(store);
    return 'dropped';
  }
  if (tryWrite(store, draft)) return 'full';
  if (tryWrite(store, withoutPlan(draft))) return 'without-plan';
  clearAtelierDraft(store);
  return 'dropped';
}

/**
 * The draft, or null when missing or malformed (then removed). Called when an
 * atelier opens, it also ends the hold a sign-out left. Never throws.
 */
export function readAtelierDraft(store: DraftStore): AtelierDraft | null {
  // An atelier is opening: whatever it shows from now on is its own to keep.
  try {
    store.removeItem(DRAFT_HOLD_KEY);
  } catch {
    // Nothing to lift on a storage that refuses.
  }
  let raw: string | null;
  try {
    raw = store.getItem(ATELIER_DRAFT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isAtelierDraft(parsed)) return parsed;
  } catch {
    // Malformed: removed below, like a draft of an unknown shape.
  }
  clearAtelierDraft(store);
  return null;
}

export function clearAtelierDraft(store: DraftStore): void {
  try {
    store.removeItem(ATELIER_DRAFT_KEY);
  } catch {
    // A storage that refuses to forget has nothing we could read back either.
  }
}

function isOnHold(store: DraftStore): boolean {
  try {
    return store.getItem(DRAFT_HOLD_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Sign-out: the draft must not wait for the next person on a shared computer.
 * Removing it is not enough, since the menu that signs out sits in the atelier,
 * which closes a moment later and would keep its job again: a hold stops that,
 * until an atelier opens again.
 */
export function forgetAtelierDraft(store: DraftStore): void {
  clearAtelierDraft(store);
  try {
    store.setItem(DRAFT_HOLD_KEY, '1');
  } catch {
    // Without the hold the draft may be kept once more; it stays in this tab only.
  }
}

export interface AtelierLeaveState {
  /** What a save would store (see buildPersistedProjectPayload); its `result` only counts when `hasPlan`. */
  payload: object;
  /** Whether a plan is on screen. */
  hasPlan: boolean;
  /** The pieces that plan was made from. */
  plannedPieces: readonly unknown[] | null;
  cutMode: '2d' | '1d';
  projectId: string | null;
  localProjectId: string | null;
  restoredAt: string | null;
}

/** The draft of an atelier being left: its job as a save would store it, minus a plan that is not there. */
export function buildAtelierDraft(state: AtelierLeaveState): AtelierDraft {
  const { result: plan, ...withoutPlan } = state.payload as Record<string, unknown>;
  const project = state.hasPlan ? { ...withoutPlan, result: plan } : withoutPlan;
  // Said only when the list on screen is no longer the one the plan was made from.
  const plannedDiffers = state.hasPlan
    && state.plannedPieces !== null
    && JSON.stringify(state.plannedPieces) !== JSON.stringify(project.pieces);
  return {
    v: 1,
    project,
    plannedPieces: plannedDiffers && state.plannedPieces ? [...state.plannedPieces] : null,
    cutMode: state.cutMode,
    projectId: state.projectId,
    localProjectId: state.localProjectId,
    restoredAt: state.hasPlan ? state.restoredAt : null,
  };
}

/**
 * The draft the atelier puts back as it opens, or null. A project opened from
 * the history is what the artisan just asked for; work kept for a sign-in asked
 * from this tab is resumed by the atelier itself. Both come before the draft.
 */
export function draftToRestore(
  draft: AtelierDraft | null,
  ahead: { openedFromHistory: boolean; pendingWorkFromThisTab: boolean }
): AtelierDraft | null {
  return ahead.openedFromHistory || ahead.pendingWorkFromThisTab ? null : draft;
}

export interface SavedJob {
  /** The plan the save stored: the kept job is adopted only when it shows that same plan. */
  result: unknown;
  projectId?: string | null;
  localProjectId?: string | null;
  /** The images stored after the save, by sheet; `null` leaves a sheet as it is. */
  scanPaths?: readonly (string | null)[];
}

/**
 * A save still running when the atelier was left finishes after the job was
 * kept: the kept job learns the project the save made, and the images stored
 * for its sheets. On return, a PDF or a name then updates that project instead
 * of saving the plan again. Only a kept job showing the same plan, and with no
 * project yet, is touched; with no kept job, nothing is written. Never throws.
 */
export function adoptSavedJob(store: DraftStore, saved: SavedJob): void {
  let raw: string | null;
  try {
    raw = store.getItem(ATELIER_DRAFT_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  let kept: unknown;
  try {
    kept = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isAtelierDraft(kept) || !('result' in kept.project)) return;
  if (JSON.stringify(kept.project.result) !== JSON.stringify(saved.result)) return;

  let next: AtelierDraft = kept;
  if (kept.projectId === null && kept.localProjectId === null) {
    if (saved.projectId) next = { ...next, projectId: saved.projectId };
    else if (saved.localProjectId) next = { ...next, localProjectId: saved.localProjectId };
  }
  const paths = saved.scanPaths;
  if (paths && Array.isArray(kept.project.scans) && paths.some(Boolean)) {
    const scans = (kept.project.scans as unknown[]).map((entry, index) => {
      const sheet = isRecord(entry) ? entry : {};
      const path = paths[index];
      return path && typeof sheet.path !== 'string' ? { ...sheet, path } : sheet;
    });
    next = { ...next, project: { ...next.project, scans } };
  }
  if (next !== kept) tryWrite(store, next);
}
