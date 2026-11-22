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
 * until it expires.
 *
 * A sign-up with Google creates the account at Google's return, on the server
 * (/auth/callback), where localStorage cannot be read. The remembered tags are
 * therefore mirrored in a cookie, and the callback writes them into an account
 * created moments ago that has no source yet (see tagsForNewAccount).
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
  // The code of a WhatsApp photo link (qatlia.ma/w/<code>), which points at the
  // number in whatsapp_photo_reads: the account is linked to that number
  // (owner, 22/11/2026). Unlike the source, the last photo link opened wins.
  utm_content: 'whatsapp_code',
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
  if (!visit) return;
  const remembered = loadAcquisition(storage, now);
  // First touch keeps the source; a newer WhatsApp photo link still updates the code.
  if (remembered && !visit.tags.whatsapp_code) return;
  const next = remembered ? { ...remembered, tags: { ...remembered.tags, whatsapp_code: visit.tags.whatsapp_code } } : visit;
  try {
    storage.setItem(ACQUISITION_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the visit simply goes untracked.
  }
}

/**
 * The URL to show once a visit is recorded: the same page without its utm
 * tags (other parameters and the hash kept), or null when it has none.
 */
export function withoutTracking(pathname: string, search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  const tracked = Object.keys(TAGS).filter((param) => params.has(param));
  if (tracked.length === 0) return null;
  for (const param of tracked) params.delete(param);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

/**
 * Records a visit's tags (first touch wins) and hands the cookie copy of the
 * remembered visit, which reaches /auth/callback for a Google sign-up.
 */
export function recordVisit(
  storage: StorageLike,
  search: string,
  now: number,
  secure: boolean,
  setCookie: (cookie: string) => void,
): void {
  rememberAcquisition(storage, search, now);
  const visit = loadAcquisition(storage, now);
  if (visit) setCookie(acquisitionCookie(visit, now, secure));
}

/** recordVisit for the current browser; a blocked storage leaves the visit untracked. */
export function recordBrowserVisit(search: string): void {
  try {
    recordVisit(window.localStorage, search, Date.now(), window.location.protocol === 'https:', (cookie) => {
      document.cookie = cookie;
    });
  } catch {
    // localStorage blocked: the visit goes untracked.
  }
}

/** The user_metadata fields to add at sign-up: empty when no tagged visit is remembered. */
export function signupMetadata(storage: StorageLike, now: number): Acquisition['tags'] {
  return loadAcquisition(storage, now)?.tags ?? {};
}

// --- Google sign-up -------------------------------------------------------------

export const ACQUISITION_COOKIE = 'qatlia-acq';

/**
 * An account created less than this long before the callback runs is the one
 * this sign-in just created. An older account signing in again is left alone:
 * its source is where it came from the first time.
 */
export const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

/** The Set-Cookie value mirroring a remembered visit, until that visit expires. */
export function acquisitionCookie(visit: Acquisition, now: number, secure: boolean): string {
  const params = new URLSearchParams();
  for (const [param, key] of Object.entries(TAGS) as Array<[keyof typeof TAGS, MetadataKey]>) {
    const value = visit.tags[key];
    if (value) params.set(param, value);
  }
  const maxAge = Math.max(0, Math.floor((visit.at + ACQUISITION_TTL_MS - now) / 1000));
  const flags = `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
  return `${ACQUISITION_COOKIE}=${encodeURIComponent(params.toString())}; ${flags}`;
}

/** The tags carried by a Cookie request header, validated like a query string; empty when absent. */
export function parseAcquisitionCookie(header: string | null): Acquisition['tags'] {
  if (!header) return {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== ACQUISITION_COOKIE) continue;
    try {
      return parseAcquisition(decodeURIComponent(part.slice(separator + 1).trim()), 0)?.tags ?? {};
    } catch {
      return {};
    }
  }
  return {};
}

interface AccountLike {
  created_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/** The tags to write into an account the sign-in just created, or null when there is nothing to write. */
export function tagsForNewAccount(
  user: AccountLike | null | undefined,
  tags: Acquisition['tags'],
  now: number,
): Acquisition['tags'] | null {
  if (!user || !tags.signup_source) return null;
  if (typeof user.user_metadata?.signup_source === 'string') return null;
  const createdAt = user.created_at ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(createdAt) || now - createdAt > NEW_ACCOUNT_WINDOW_MS || createdAt - now > 60 * 1000) {
    return null;
  }
  return tags;
}

/** signupMetadata for the current browser; empty wherever localStorage is unavailable. */
export function browserSignupMetadata(): Acquisition['tags'] {
  try {
    return signupMetadata(window.localStorage, Date.now());
  } catch {
    return {};
  }
}
