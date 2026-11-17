/**
 * The client side of the scan image kept with a saved project: sending it once
 * when a signed-in artisan saves, and finding it again to show it in full.
 *
 * The project save never waits for the image: it goes first, and the image
 * follows and is attached to the project it created (`saveProjectToCloud`).
 *
 * Only the reduced 1600 px JPEG is ever sent, never a phone original: the
 * image is passed through the atelier's own downscale right before it is sent,
 * which returns an already reduced JPEG unchanged and gives null when it
 * cannot reduce. Nothing here throws: a refused or failed upload leaves the
 * save with its thumbnail only, and a link that cannot be had falls back to
 * the thumbnail, marked as reduced.
 *
 * No React, no Supabase: `fetch` and the downscale are passed in.
 */

import { SCAN_IMAGE_MAX_CHARS } from '@/lib/projects/scan-image';

/** The size the atelier already reads a scan at (see the scan upload). */
export const SCAN_KEPT_MAX_SIDE = 1600;
export const SCAN_KEPT_QUALITY = 0.8;

/** An upload slower than this is given up; the save goes on without it. */
const UPLOAD_TIMEOUT_MS = 30_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Downscale = (dataUrl: string, maxSide: number, quality: number) => Promise<string | null>;

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_PATTERN = /^https?:\/\//i;

/**
 * Sends a reduced scan image to the private bucket. Resolves its stored path,
 * or null on any refusal (400, 401, 429, 503), a network error or a timeout.
 */
export async function uploadScanImage(image: string, fetchImpl: FetchLike): Promise<string | null> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) {
      console.warn('Image du scan non gardée:', res.status);
      return null;
    }
    const data = await res.json();
    return typeof data?.scanPath === 'string' && data.scanPath ? data.scanPath : null;
  } catch (err) {
    console.warn('Image du scan non gardée:', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The scan image of the project on screen and the path it is kept under.
 *
 * - `restore` takes a reopened project's saved path (anything but a non-empty
 *   string reads as none) and forgets any fresh scan: the reopened thumbnail
 *   is never sent as if it were the full image.
 * - `newScan` takes a new scan and forgets the previous path, so the next
 *   save sends the new image.
 * - `keep` gives the path to save: the known one, else the fresh scan sent
 *   now (once, even for two saves at the same time), else null.
 */
export interface ScanKeeper {
  restore(savedPath: unknown): void;
  newScan(image: string): void;
  knownPath(): string | null;
  /** The scan made on this page, in memory (null for a reopened project). */
  freshImage(): string | null;
  keep(): Promise<string | null>;
}

export function createScanKeeper(deps: { fetch: FetchLike; downscale: Downscale }): ScanKeeper {
  let path: string | null = null;
  let image: string | null = null;
  let upload: { image: string; path: Promise<string | null> } | null = null;

  const send = async (fresh: string): Promise<string | null> => {
    const reduced = await deps.downscale(fresh, SCAN_KEPT_MAX_SIDE, SCAN_KEPT_QUALITY);
    // No reduced image (the downscale failed): the original is not kept.
    if (!reduced || reduced.length > SCAN_IMAGE_MAX_CHARS) return null;
    return uploadScanImage(reduced, deps.fetch);
  };

  return {
    restore(savedPath) {
      path = typeof savedPath === 'string' && savedPath ? savedPath : null;
      image = null;
      upload = null;
    },
    newScan(next) {
      image = next;
      path = null;
      upload = null;
    },
    knownPath: () => path,
    freshImage: () => image,
    async keep() {
      if (path) return path;
      const fresh = image;
      if (!fresh) return null;
      if (!upload || upload.image !== fresh) upload = { image: fresh, path: send(fresh) };
      const current = upload;
      const sent = await current.path;
      if (image === fresh) {
        if (sent) path = sent;
        // Refused or failed: the next save tries again.
        else if (upload === current) upload = null;
      }
      return sent;
    },
  };
}

/**
 * Attaches a kept image to a project already saved (`PATCH { scanPath }`).
 * Resolves true once the server took it; a refusal or a failure is only
 * logged, and the project keeps its thumbnail.
 */
export async function attachScanPath(projectId: string, scanPath: string, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const res = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanPath }),
    });
    if (!res.ok) console.warn('Image du scan non rattachée au projet:', res.status);
    return res.ok;
  } catch (err) {
    console.warn('Image du scan non rattachée au projet:', err);
    return false;
  }
}

export interface CloudSave {
  /** The server confirmed the save. */
  ok: boolean;
  /** The id of the project the save created, when the server gave one. */
  projectId: string | null;
  /** Settles once the scan image is attached (true) or will not be (false). Never rejects. */
  scanAttached: Promise<boolean>;
}

/**
 * Saves a signed-in artisan's project to the cloud at once, never waiting for
 * the scan image. When the save carried no image path and a scan made on this
 * page is still to be kept, the image is sent afterwards (once, shared by
 * every save that needs it) and attached to the project this save created.
 * A scan replaced while the save was running is not attached to it.
 *
 * A network error of the save itself is thrown, as `fetch` would; the caller
 * falls back to the device then.
 */
export async function saveProjectToCloud(
  payload: { scans?: { path?: string }[] },
  keeper: ScanKeeper,
  fetchImpl: FetchLike
): Promise<CloudSave> {
  const scanAtSave = keeper.freshImage();
  const res = await fetchImpl('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, projectId: null, scanAttached: Promise.resolve(false) };
  const data = await res.json().catch(() => null);
  const projectId = data?.success && typeof data.projectId === 'string' ? data.projectId : null;
  const needsImage = !!projectId && !payload.scans?.[0]?.path && !!scanAtSave && keeper.freshImage() === scanAtSave;
  const scanAttached = needsImage
    ? keeper.keep().then((path) => (path ? attachScanPath(projectId as string, path, fetchImpl) : false), () => false)
    : Promise.resolve(false);
  return { ok: true, projectId, scanAttached };
}

/** How long a PDF marker or a rename waits for a running scan attach (see `settledWithin`). */
export const SCAN_ATTACH_WAIT_MS = 30_000;

/**
 * Waits until `pending` settles, or `ms` at most; never rejects. The atelier
 * waits so for the scan attach (a read-merge-write of the project's
 * `options_json`) before its own PATCH on the same row, which would otherwise
 * lose one of the two keys.
 */
export function settledWithin(pending: Promise<unknown>, ms: number = SCAN_ATTACH_WAIT_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    pending.then(done, done);
  });
}

/** A signed link slower than this is given up: the thumbnail is shown instead. */
const LINK_TIMEOUT_MS = 15_000;

/** A 5-minute signed link to a cloud project's kept image, or null. */
export async function fetchScanUrl(projectId: string, fetchImpl: FetchLike): Promise<string | null> {
  // A hung request would keep the scan buttons waiting until a reload.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), LINK_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/scan`, {
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) {
      console.warn('Lien de l’image du scan indisponible:', res.status);
      return null;
    }
    const data = await res.json();
    return typeof data?.url === 'string' && SIGNED_URL_PATTERN.test(data.url) ? data.url : null;
  } catch (err) {
    console.warn('Lien de l’image du scan indisponible:', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ScanViewInput {
  /** The full scan still in memory (made on this page): shown as is. */
  localImage?: string | null;
  /** The saved project's server id, when it has one. */
  projectId?: string | null;
  /** Whether the saved project kept its full image. */
  hasFullScan: boolean;
  /** The thumbnail saved with the project. */
  thumb?: string | null;
}

/**
 * Why only the thumbnail is shown: the project never kept its full image, or
 * it did but the link to it could not be had (offline, server refused).
 */
export type ScanReducedReason = 'not-kept' | 'link-failed';

/**
 * What the viewer shows. `src` is null only when the project kept its full
 * image but neither it nor a thumbnail can be shown: the note says so alone.
 */
export type ScanViewSource =
  | { src: string; reduced: false }
  | { src: string | null; reduced: true; reducedReason: ScanReducedReason };

/**
 * A signed link lives 300 s; it is reused for 4 minutes, so reopening the
 * same image does not download it again under a new link, and a link handed
 * out always has a minute left.
 */
export const SCAN_LINK_REUSE_MS = 4 * 60_000;

export interface ScanLinkCache {
  get(projectId: string): string | null;
  set(projectId: string, url: string): void;
}

export function createScanLinkCache(now: () => number = Date.now): ScanLinkCache {
  const links = new Map<string, { url: string; expiresAt: number }>();
  return {
    get(projectId) {
      const link = links.get(projectId);
      if (!link) return null;
      if (now() > link.expiresAt) {
        links.delete(projectId);
        return null;
      }
      return link.url;
    },
    set(projectId, url) {
      links.set(projectId, { url, expiresAt: now() + SCAN_LINK_REUSE_MS });
    },
  };
}

function wantsLink(input: ScanViewInput): boolean {
  return !input.localImage && input.hasFullScan && typeof input.projectId === 'string' && PROJECT_ID_PATTERN.test(input.projectId);
}

/** True when showing the scan needs a signed link from the server first. */
export function scanViewNeedsFetch(input: ScanViewInput, cache?: ScanLinkCache): boolean {
  return wantsLink(input) && !(cache && cache.get(input.projectId as string));
}

/**
 * What the viewer shows: the full image (in memory, or through a signed link,
 * reused from `cache` while it is fresh), else the thumbnail marked reduced
 * with the reason, else null when there is nothing to show at all.
 */
export async function resolveScanView(input: ScanViewInput, fetchImpl: FetchLike, cache?: ScanLinkCache): Promise<ScanViewSource | null> {
  if (input.localImage) return { src: input.localImage, reduced: false };
  if (wantsLink(input)) {
    const projectId = input.projectId as string;
    const cached = cache?.get(projectId);
    if (cached) return { src: cached, reduced: false };
    const url = await fetchScanUrl(projectId, fetchImpl);
    if (url) {
      cache?.set(projectId, url);
      return { src: url, reduced: false };
    }
  }
  const reducedReason: ScanReducedReason = input.hasFullScan ? 'link-failed' : 'not-kept';
  if (!input.thumb) return input.hasFullScan ? { src: null, reduced: true, reducedReason } : null;
  return { src: input.thumb, reduced: true, reducedReason };
}
