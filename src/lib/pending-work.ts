/**
 * Work a visitor started before signing in, kept across the sign-in.
 *
 * A first-time visitor sends a photo (or clicks "Optimiser") and is asked to
 * sign in. Signing in with Google leaves the site and comes back, and a new
 * account must first confirm its email in another tab: without this, the
 * photo and the pieces were lost and the visitor had to start over.
 *
 * Where it lives:
 *   * the work itself in localStorage, so it survives the email-confirmation
 *     tab, for a few hours only, and cleared on sign-out (workshop computers
 *     are shared);
 *   * the id of the work in sessionStorage, which marks the tab that asked
 *     for it. Only that tab resumes the action on its own, because a resumed
 *     scan or optimization spends a credit. Any other tab offers a button.
 *
 * Storage is passed in, so the rules run in a plain Node test.
 */

export type PendingAction = 'scan' | 'optimize';

export interface PendingWork {
  v: 1;
  id: string;
  action: PendingAction;
  savedAt: number;
  /** The downscaled photo to analyse (scan only). */
  image?: string;
  pieces: unknown[];
  sheets: unknown[];
  options?: Record<string, unknown>;
  cutMode?: '2d' | '1d';
  projectName?: string;
  /** Set once another tab has shown it, so it is not restored over new work. */
  offered?: boolean;
}

export type PendingWorkInput = Omit<PendingWork, 'v' | 'id' | 'savedAt' | 'offered'>;

export const PENDING_WORK_KEY = 'qatlia-pending-work';
export const PENDING_TAB_KEY = 'qatlia-pending-work-tab';
/** The work this tab already offered: it keeps offering it if the page remounts. */
export const PENDING_OFFERED_TAB_KEY = 'qatlia-pending-work-offered';
/** Long enough to confirm an email, short enough on a shared computer. */
export const PENDING_WORK_TTL_MS = 6 * 60 * 60 * 1000;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A stored entry, or null when it is missing, malformed or too old. */
export function parsePendingWork(raw: string | null, now: number): PendingWork | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const work = value as Partial<PendingWork>;
  if (work.v !== 1 || typeof work.id !== 'string' || typeof work.savedAt !== 'number') return null;
  if (work.action !== 'scan' && work.action !== 'optimize') return null;
  if (!Array.isArray(work.pieces) || !Array.isArray(work.sheets)) return null;
  if (work.image !== undefined && typeof work.image !== 'string') return null;
  // A scan with no photo has nothing left to resume.
  if (work.action === 'scan' && !work.image) return null;
  const age = now - work.savedAt;
  if (age < 0 || age > PENDING_WORK_TTL_MS) return null;
  return work as PendingWork;
}

/**
 * Keeps the work and marks this tab as the one that asked for it. When the
 * photo does not fit in storage (it is the heavy part), the pieces are kept
 * without it; a scan without its photo is not worth keeping. Returns whether
 * anything was saved.
 */
export function savePendingWork(
  store: KeyValueStore,
  tabStore: KeyValueStore,
  input: PendingWorkInput,
  now: number = Date.now(),
): boolean {
  const work: PendingWork = { ...input, v: 1, id: `${now}-${Math.floor(Math.random() * 1e9)}`, savedAt: now };
  const attempts: PendingWork[] = [work];
  if (work.image && work.action === 'optimize') attempts.push({ ...work, image: undefined });
  for (const attempt of attempts) {
    try {
      store.setItem(PENDING_WORK_KEY, JSON.stringify(attempt));
      try {
        tabStore.setItem(PENDING_TAB_KEY, attempt.id);
      } catch {
        /* without the tab mark, the work is offered with a button instead */
      }
      return true;
    } catch {
      /* storage full: try the lighter version, if any */
    }
  }
  return false;
}

export function loadPendingWork(store: KeyValueStore, now: number = Date.now()): PendingWork | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(PENDING_WORK_KEY);
  } catch {
    return null;
  }
  const work = parsePendingWork(raw, now);
  if (!work && raw) clearPendingWork(store);
  return work;
}

/** True when this tab is the one that asked for the work. */
export function isFromThisTab(tabStore: KeyValueStore, work: PendingWork): boolean {
  try {
    return tabStore.getItem(PENDING_TAB_KEY) === work.id;
  } catch {
    return false;
  }
}

/**
 * Whether a tab other than the asking one should offer this work: once per
 * entry, in the first tab that shows it. That tab keeps showing it (the page
 * can remount right after loading); a later visit in a new tab does not, so
 * kept work is never restored over newer work.
 */
export function shouldOfferPendingWork(store: KeyValueStore, tabStore: KeyValueStore, work: PendingWork): boolean {
  let offeredHere = false;
  try {
    offeredHere = tabStore.getItem(PENDING_OFFERED_TAB_KEY) === work.id;
  } catch {
    /* treated as not offered here */
  }
  if (work.offered && !offeredHere) return false;
  try {
    if (!work.offered) store.setItem(PENDING_WORK_KEY, JSON.stringify({ ...work, offered: true }));
  } catch {
    /* worst case it is offered again on the next visit */
  }
  try {
    tabStore.setItem(PENDING_OFFERED_TAB_KEY, work.id);
  } catch {
    /* without the mark, a remount in this tab hides it */
  }
  return true;
}

export function clearPendingWork(store: KeyValueStore, tabStore?: KeyValueStore): void {
  try {
    store.removeItem(PENDING_WORK_KEY);
  } catch {
    /* nothing to clear */
  }
  try {
    tabStore?.removeItem(PENDING_TAB_KEY);
    tabStore?.removeItem(PENDING_OFFERED_TAB_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Only a path on this site may be a post-login destination: "/atelier" yes;
 * "//evil.example", "/\evil.example", "@evil.example" or a full URL never.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\') || /[\r\n\t]/.test(value)) return fallback;
  return value;
}
