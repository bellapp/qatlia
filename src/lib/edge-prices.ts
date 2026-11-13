'use client';

/**
 * The artisan's price per metre for each edge-banding colour.
 *
 * Signed in, they live in the account (`/api/edge-prices`, table
 * `edge_band_prices`, migration 015) and follow the artisan to any device.
 * Anonymous, or while the account store is not set up, they stay on the
 * device. A colour with no price of its own keeps the catalog price
 * (`edgePricePerM` in src/lib/cutting/binpacking.ts).
 */

import { PRICED_EDGE_IDS, type EdgePriceMap } from '@/lib/cutting/binpacking';

const STORAGE_KEY = 'qatlia-edge-prices';

/** Only known colours with a usable price; anything else is dropped. */
export function cleanEdgePrices(value: unknown): EdgePriceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const prices: EdgePriceMap = {};
  for (const [id, price] of Object.entries(value as Record<string, unknown>)) {
    if (PRICED_EDGE_IDS.includes(id) && typeof price === 'number' && Number.isFinite(price) && price >= 0 && price <= 1_000_000) {
      prices[id] = Math.round(price * 100) / 100;
    }
  }
  return prices;
}

export function loadDeviceEdgePrices(): EdgePriceMap {
  if (typeof window === 'undefined') return {};
  try {
    return cleanEdgePrices(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return {};
  }
}

export function saveDeviceEdgePrices(prices: EdgePriceMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanEdgePrices(prices)));
  } catch {
    /* storage full or blocked: the prices still apply to this session */
  }
}

/** The account's prices, or null when the device list must be used instead. */
export async function fetchAccountEdgePrices(): Promise<EdgePriceMap | null> {
  try {
    const res = await fetch('/api/edge-prices', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success || data.note === 'cloud_not_ready') return null;
    return cleanEdgePrices(data.prices);
  } catch {
    return null;
  }
}

/** Sets the given colours (a null price resets one to the catalog price). */
export async function saveAccountEdgePrices(changes: Record<string, number | null>): Promise<boolean> {
  try {
    const res = await fetch('/api/edge-prices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices: changes }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
