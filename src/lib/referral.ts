/**
 * Parrainage: the rules that run anywhere (docs/adr/0001 and 0002).
 *
 * A parrain shares a link (qatlia.ma/r/<code>) or tells a code. The link
 * stores the code in a cookie for a while; whoever signs up or signs in with
 * that browser is attached to the parrain by the server, as long as the
 * account has made no purchase (attach_referral, migration 022). A code typed
 * by hand replaces the one a link left.
 *
 * Pure module: no runtime import, no env, no network. Safe from a client
 * component, a route handler and a plain Node test.
 */

/** Six characters of the order-number alphabet: no 0/O, no 1/I/L. Same as the SQL CHECK. */
export const REFERRAL_CODE_PATTERN = /^[2-9A-HJKMNP-Z]{6}$/;

/** The path of the link a parrain shares. */
export const REFERRAL_LINK_PREFIX = '/r/';

/** The page where a parrain finds their code, link and earnings. */
export const REFERRAL_PAGE_PATH = '/account/referral';

/** The cookie that keeps a code from a link (or typed at sign-up) until the account is attached. */
export const REFERRAL_COOKIE = 'qatlia-ref';
export const REFERRAL_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

/** The user_metadata key the email sign-up stores a code in, for a confirmation opened elsewhere. */
export const REFERRAL_METADATA_KEY = 'referral_code';

/** What a referral link is tagged with, so the sign-up source reads "referral". */
export const REFERRAL_LANDING = '/?utm_source=referral&utm_medium=link';

/**
 * A code as typed or read ("k7f-4qm ", "K7F4QM") in its stored form, or null
 * when it cannot be a code. Separators and case do not matter.
 */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/** The link to share, e.g. https://qatlia.ma/r/K7F4QM. */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${REFERRAL_LINK_PREFIX}${code}`;
}

/** The Set-Cookie value that keeps a code. */
export function referralCookie(code: string, secure: boolean): string {
  return `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_COOKIE_MAX_AGE_S}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** The Set-Cookie value that forgets it. */
export function clearReferralCookie(secure: boolean): string {
  return `${REFERRAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** The code kept in a Cookie header (or document.cookie), or null. */
export function readReferralCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== REFERRAL_COOKIE) continue;
    return normalizeReferralCode(part.slice(separator + 1).trim());
  }
  return null;
}

/** What attach_referral answers when it refuses. */
export type AttachError = 'INVALID_CODE' | 'OWN_CODE' | 'ALREADY_ATTACHED' | 'ALREADY_PURCHASED' | 'CIRCULAR' | 'PROFILE_NOT_FOUND';

export const ATTACH_ERRORS: readonly AttachError[] = [
  'INVALID_CODE',
  'OWN_CODE',
  'ALREADY_ATTACHED',
  'ALREADY_PURCHASED',
  'CIRCULAR',
  'PROFILE_NOT_FOUND',
];

/**
 * True when trying the same code again can only give the same answer, so the
 * kept code can be forgotten. A missing profile can be a sign-up still being
 * created: the code is kept for the next try.
 */
export function isFinalAttachAnswer(answer: { success: boolean; error?: string }): boolean {
  if (answer.success) return true;
  return answer.error !== undefined && answer.error !== 'PROFILE_NOT_FOUND' && (ATTACH_ERRORS as readonly string[]).includes(answer.error);
}

/** "ahmed@gmail.com" -> "a***@gmail.com": enough for a parrain to recognise a friend, not to write to them. */
export function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at < 1) return null;
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * How a parrain sees a filleul (ADR 0001): the first name, else the business
 * name, else the masked email. Never the full email, the phone or an amount.
 */
export function refereeDisplayName(input: { fullName?: string | null; atelierName?: string | null; email?: string | null }): string | null {
  const first = typeof input.fullName === 'string' ? input.fullName.trim().split(/\s+/)[0] : '';
  if (first) return first.slice(0, 40);
  const atelier = typeof input.atelierName === 'string' ? input.atelierName.trim() : '';
  if (atelier) return atelier.slice(0, 60);
  return maskEmail(input.email);
}

/** A WhatsApp share with the message ready: the artisan picks the friend. */
export function whatsappShareHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

// --- The "you earned" banner ----------------------------------------------------

/** localStorage key: the newest bonus already shown, so each one is announced once. */
export const REFERRAL_SEEN_KEY = 'qatlia-referral-seen';

export interface ReferralReward {
  id: string;
  credits: number;
  /** The filleul whose purchase gave it, as the parrain sees them. */
  name: string | null;
  createdAt: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function seenAt(storage: StorageLike): string | null {
  try {
    return storage.getItem(REFERRAL_SEEN_KEY);
  } catch {
    return null;
  }
}

/** The bonuses newer than the last one announced, newest first. */
export function unseenRewards(rewards: readonly ReferralReward[], storage: StorageLike): ReferralReward[] {
  const seen = seenAt(storage);
  return rewards
    .filter((reward) => typeof reward.createdAt === 'string' && (seen === null || reward.createdAt > seen))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Marks every bonus up to the newest of these as announced. Never throws. */
export function markRewardsSeen(rewards: readonly ReferralReward[], storage: StorageLike): void {
  const newest = rewards.reduce<string | null>((max, reward) => (max === null || reward.createdAt > max ? reward.createdAt : max), null);
  if (newest === null) return;
  const seen = seenAt(storage);
  if (seen !== null && seen >= newest) return;
  try {
    storage.setItem(REFERRAL_SEEN_KEY, newest);
  } catch {
    // Storage blocked: the banner may show again, nothing else.
  }
}
