/**
 * The job on screen in the atelier, kept in the tab while the artisan visits
 * another screen (history, panel list) and put back on return.
 *
 * It lives in `sessionStorage`: one tab, gone when the tab closes. Keeping it
 * is a convenience, so nothing here throws: a draft that does not fit is kept
 * without its plan, or not at all, and leaving the atelier still works.
 */

export const ATELIER_DRAFT_KEY = 'qatlia_atelier_draft';

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
 * left behind to come back in its place. Never throws.
 */
export function writeAtelierDraft(store: DraftStore, draft: AtelierDraft): DraftWriteResult {
  if (tryWrite(store, draft)) return 'full';
  if (tryWrite(store, withoutPlan(draft))) return 'without-plan';
  clearAtelierDraft(store);
  return 'dropped';
}

/** The draft, or null when missing or malformed (then removed). Never throws. */
export function readAtelierDraft(store: DraftStore): AtelierDraft | null {
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
