/**
 * Where a visitor came from, kept until they create their account.
 *
 * Links shared outside the site carry UTM tags (the WhatsApp bot adds
 * `utm_source=whatsapp`, see src/lib/whatsapp/copy.ts). The first tagged visit
 * is remembered in localStorage for a while, and its tags are written into the
 * new account's user_metadata at sign-up, so sign-ups can be counted by source:
 *
 *   select raw_user_meta_data->>'signup_source' as source, count(*)
 *   from auth.users group by 1;
 *
 * First touch wins: a later tagged visit does not overwrite a remembered one
 * until it expires. A sign-in with Google creates the account elsewhere and
 * carries no tags.
 *
 * Storage is passed in, so the rules run in a plain Node test.
 */

export const ACQUISITION_KEY = 'qatlia-acquisition';
export const ACQUISITION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** URL parameter -> user_metadata key. */
const TAGS = {
  utm_source: 'signup_source',
  utm_medium: 'signup_medium',
  utm_campaign: 'signup_campaign',
} as const;

type MetadataKey = (typeof TAGS)[keyof typeof TAGS];

/** Plain tokens only: anything else is ignored rather than stored in the account. */
const TAG_VALUE = /^[A-Za-z0-9._-]{1,64}$/;

export interface Acquisition {
  tags: Partial<Record<MetadataKey, string>>;
  at: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The tags of a query string (`?utm_source=...`), or null when it has no usable `utm_source`. */
export function parseAcquisition(search: string, now: number): Acquisition | null {
  const params = new URLSearchParams(search);
  const tags: Acquisition['tags'] = {};
  for (const [param, key] of Object.entries(TAGS) as Array<[keyof typeof TAGS, MetadataKey]>) {
    const value = params.get(param);
    if (value !== null && TAG_VALUE.test(value)) tags[key] = value.toLowerCase();
  }
  if (!tags.signup_source) return null;
  return { tags, at: now };
}

/** The remembered visit, or null when there is none, it is unreadable or it has expired. */
export function loadAcquisition(storage: StorageLike, now: number): Acquisition | null {
  let raw: string | null;
  try {
    raw = storage.getItem(ACQUISITION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Acquisition>;
    const tags = parsed?.tags;
    if (typeof parsed?.at !== 'number' || !tags || typeof tags !== 'object') return null;
    if (now - parsed.at > ACQUISITION_TTL_MS) return null;
    const clean: Acquisition['tags'] = {};
    for (const key of Object.values(TAGS)) {
      const value = (tags as Record<string, unknown>)[key];
      if (typeof value === 'string' && TAG_VALUE.test(value)) clean[key] = value;
    }
    return clean.signup_source ? { tags: clean, at: parsed.at } : null;
  } catch {
    return null;
  }
}

/** Remembers this visit's tags, unless an earlier tagged visit is still remembered. Never throws. */
export function rememberAcquisition(storage: StorageLike, search: string, now: number): void {
  const visit = parseAcquisition(search, now);
  if (!visit || loadAcquisition(storage, now)) return;
  try {
    storage.setItem(ACQUISITION_KEY, JSON.stringify(visit));
  } catch {
    // Storage full or blocked: the visit simply goes untracked.
  }
}

/** The user_metadata fields to add at sign-up: empty when no tagged visit is remembered. */
export function signupMetadata(storage: StorageLike, now: number): Acquisition['tags'] {
  return loadAcquisition(storage, now)?.tags ?? {};
}

/** signupMetadata for the current browser; empty wherever localStorage is unavailable. */
export function browserSignupMetadata(): Acquisition['tags'] {
  try {
    return signupMetadata(window.localStorage, Date.now());
  } catch {
    return {};
  }
}
