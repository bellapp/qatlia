'use client';

/**
 * The artisan's one price per metre of edge banding, for every colour.
 *
 * Signed in, it lives in the account (`/api/edge-prices`, migration 015)
 * and follows the artisan to any device. Anonymous, or while the account
 * store is not set up, it stays on the device. Without it, each colour keeps
 * its catalog price (`edgePricePerM` in src/lib/cutting/binpacking.ts).
 */

const STORAGE_KEY = 'qatlia-edge-price';

/** A usable price per metre, to the cent, or null. */
export function cleanEdgePrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? Math.round(value * 100) / 100
    : null;
}

export function loadDeviceEdgePrice(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : cleanEdgePrice(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDeviceEdgePrice(price: number | null): void {
  try {
    if (price === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanEdgePrice(price)));
  } catch {
    /* storage full or blocked: the price still applies to this session */
  }
}

/** The account's price (null: none set), or undefined when the device price must be used instead. */
export async function fetchAccountEdgePrice(): Promise<number | null | undefined> {
  try {
    const res = await fetch('/api/edge-prices', { cache: 'no-store' });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (!data?.success || data.note === 'cloud_not_ready') return undefined;
    return cleanEdgePrice(data.price);
  } catch {
    return undefined;
  }
}

/** Sets the account's price (null goes back to the catalog prices). */
export async function saveAccountEdgePrice(price: number | null): Promise<boolean> {
  try {
    const res = await fetch('/api/edge-prices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
