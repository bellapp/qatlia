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
