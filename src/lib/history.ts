import type { DisplayUnit } from '@/lib/units';

export const LOCAL_HISTORY_KEY = 'qatlia_local_history_v1';

export interface LocalHistoryItem {
  id: string;
  name: string;
  material: string;
  sheet_width: number;
  sheet_height: number;
  kerf: number;
  grain_direction: boolean;
  status: string;
  created_at: string;
  options_json: {
    pieces?: Array<{ name: string; height: number; width: number; quantity: number }>;
    sheet?: Record<string, unknown>;
    options?: Record<string, unknown>;
    result?: { sheetsUsed?: number; wastePercentage?: number };
    // Persistence metadata (see src/lib/units.ts ProjectUnitPersistenceMetadata):
    // geometry above always stays canonical cm; these fields only record which
    // display unit the artisan was using and whether this record still owes a
    // rewrite with explicit unit metadata.
    displayUnit?: DisplayUnit;
    canonicalUnit?: 'cm';
    migratedFromLegacyUnit?: boolean;
    projectName?: string;
    pdfGeneratedAt?: string;
  };
}

export function readLocalHistory(): LocalHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLocalHistoryItem(item: LocalHistoryItem) {
  if (typeof window === 'undefined') return;
  const current = readLocalHistory().filter((p) => p.id !== item.id);
  const next = [item, ...current].slice(0, 50);
  window.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
}

/**
 * Renames an entry of the localStorage history: its `name` and the
 * `options_json.projectName` the atelier reads when the project is reopened.
 * Returns false when the entry is not there or the storage cannot be written.
 */
export function renameLocalHistoryItem(id: string, name: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const list = readLocalHistory();
    if (!list.some((item) => item.id === id)) return false;
    const next = list.map((item) =>
      item.id === id
        ? { ...item, name, options_json: { ...item.options_json, projectName: name } }
        : item,
    );
    window.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * Records that the PDF of a device-only project was generated, on its own
 * history entry, so exporting it does not add a second entry. Returns false
 * when the entry is not there or the storage cannot be written.
 */
export function markLocalHistoryPdf(id: string, pdfGeneratedAt: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const list = readLocalHistory();
    if (!list.some((item) => item.id === id)) return false;
    const next = list.map((item) =>
      item.id === id ? { ...item, options_json: { ...item.options_json, pdfGeneratedAt } } : item,
    );
    window.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
