/**
 * Single boundary between the canonical domain unit (centimetres) and
 * whatever unit an artisan currently wants to see (cm or mm).
 *
 * Every domain calculation — optimizer, costing, persistence — stays in cm.
 * Conversion happens only through `toCanonicalCm()` / `fromCanonicalCm()`,
 * and only ever once per value. No caller should ever guess a unit from the
 * magnitude of a number (e.g. `value > 500 ? value / 10 : value`); the unit
 * must always be explicit.
 *
 * Imperial units are intentionally out of scope here; see the improvement
 * plan for the follow-up task that would introduce them in isolation.
 */

export type DisplayUnit = 'cm' | 'mm';

export interface UnitContext {
  displayUnit: DisplayUnit;
  canonicalUnit: 'cm';
}

export const DEFAULT_DISPLAY_UNIT: DisplayUnit = 'cm';

export const DISPLAY_UNIT_STORAGE_KEY = 'qatlia_display_unit_v1';

/** How many canonical cm one unit of `DisplayUnit` represents. */
const CM_PER_DISPLAY_UNIT: Record<DisplayUnit, number> = {
  cm: 1,
  mm: 0.1,
};

const ROUND_DECIMALS = 4;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertFinite(value: number, fnName: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${fnName}: expected a finite number, received ${value}`);
  }
}

export function isDisplayUnit(value: unknown): value is DisplayUnit {
  return value === 'cm' || value === 'mm';
}

/** Converts an explicit-unit display value into the canonical cm domain value. */
export function toCanonicalCm(value: number, unit: DisplayUnit): number {
  assertFinite(value, 'toCanonicalCm');
  return roundTo(value * CM_PER_DISPLAY_UNIT[unit], ROUND_DECIMALS);
}

/**
 * UI-safe counterpart to `toCanonicalCm`: parses a raw `<input>` string typed
 * by an artisan and converts it to the canonical cm domain, never throwing.
 *
 * Returns `null` for anything that isn't a finite number (empty string,
 * "abc", "NaN", "Infinity", "1e400", …) so callers can refuse the keystroke
 * and keep the last-known-good state instead of letting a non-finite value
 * reach `toCanonicalCm` (which throws by design — see its doc comment) or,
 * worse, silently corrupt canonical state.
 */
export function parseDisplayInputToCanonical(valueString: string, unit: DisplayUnit): number | null {
  if (valueString.trim() === '') return null; // `Number('')` is 0, not NaN — reject explicitly
  const parsed = Number(valueString);
  if (!Number.isFinite(parsed)) return null;
  return toCanonicalCm(parsed, unit);
}

/** Converts a canonical cm domain value into an explicit display unit. */
export function fromCanonicalCm(valueCm: number, unit: DisplayUnit): number {
  assertFinite(valueCm, 'fromCanonicalCm');
  return roundTo(valueCm / CM_PER_DISPLAY_UNIT[unit], ROUND_DECIMALS);
}

/** Formats a single canonical cm value in the requested display unit (no unit suffix). */
export function formatDisplayValue(valueCm: number, unit: DisplayUnit, fractionDigits = 1): string {
  return fromCanonicalCm(valueCm, unit).toFixed(fractionDigits);
}

/** Formats a height × width pair in the requested display unit, including the unit suffix. */
export function formatDimensions(
  heightCm: number,
  widthCm: number,
  unit: DisplayUnit,
  fractionDigits = 1
): string {
  return `${formatDisplayValue(heightCm, unit, fractionDigits)} × ${formatDisplayValue(widthCm, unit, fractionDigits)} ${unit}`;
}

export interface ProjectUnitMetadata extends UnitContext {
  /**
   * True only when this resolution had to assume cm because explicit,
   * valid `displayUnit`/`canonicalUnit` metadata was absent or invalid.
   * A pending-rewrite flag, not a historical record: once a caller stamps
   * explicit metadata on its next save, this goes false for that record.
   */
  migrated: boolean;
  /**
   * Persisted historical marker: does this record's unit metadata trace
   * back to a legacy (pre-metadata) project? Always a real boolean when
   * explicit metadata is present (preserved as-is from the payload,
   * defaulting to `false` for fresh modern metadata that never specified
   * it); `true` when metadata was absent/invalid, since the rewrite that
   * follows originates from a legacy record.
   */
  migratedFromLegacyUnit: boolean;
}

/**
 * Reusable persistence-metadata shape stamped onto every saved project
 * (cloud `/api/projects` payload and local history `options_json` alike),
 * so a save can be traced back to the display unit it was made in, and a
 * legacy record (no metadata at all) can be told apart from a modern one
 * that has already been migrated.
 */
export interface ProjectUnitPersistenceMetadata extends UnitContext {
  /** True while this project still needs its next save to stamp explicit unit metadata. */
  migratedFromLegacyUnit: boolean;
}

/** Builds the persistence-metadata triple stamped onto a saved project. */
export function buildProjectUnitPersistenceMetadata(
  displayUnit: DisplayUnit,
  migratedFromLegacyUnit: boolean
): ProjectUnitPersistenceMetadata {
  return { displayUnit, canonicalUnit: 'cm', migratedFromLegacyUnit };
}

/**
 * Resolves the display unit for a persisted project/import payload.
 *
 * Historical projects saved before this task shipped carry no unit metadata
 * at all. Per product decision, those are assumed to already be canonical cm
 * (the app's only unit before this change) and flagged `migrated: true` so
 * callers can rewrite the record with explicit metadata going forward; their
 * `migratedFromLegacyUnit` is also `true`, since whatever rewrite follows
 * originates from a legacy record.
 *
 * A project is only trusted as "explicit" when both `displayUnit` is a real
 * `DisplayUnit` and `canonicalUnit` (if present at all) is exactly `'cm'` —
 * a garbage `canonicalUnit` invalidates an otherwise-valid `displayUnit`
 * rather than being silently ignored. When explicit, this resolution is
 * never itself a pending rewrite, so `migrated` is `false`; the historical
 * `migratedFromLegacyUnit` marker on the payload is preserved as-is (e.g. a
 * project that was rewritten from a legacy record keeps
 * `migratedFromLegacyUnit: true` forever even though `migrated` is now
 * `false`), defaulting to `false` for fresh modern metadata that never
 * specified it.
 */
export function resolveProjectUnitMetadata(
  project: { displayUnit?: unknown; canonicalUnit?: unknown; migratedFromLegacyUnit?: unknown } | null | undefined
): ProjectUnitMetadata {
  const candidateDisplayUnit = project?.displayUnit;
  const candidateCanonicalUnit = project?.canonicalUnit;
  const hasExplicitUnit =
    isDisplayUnit(candidateDisplayUnit) && (candidateCanonicalUnit === undefined || candidateCanonicalUnit === 'cm');

  if (!hasExplicitUnit) {
    return { displayUnit: DEFAULT_DISPLAY_UNIT, canonicalUnit: 'cm', migrated: true, migratedFromLegacyUnit: true };
  }

  const migratedFromLegacyUnit =
    typeof project?.migratedFromLegacyUnit === 'boolean' ? project.migratedFromLegacyUnit : false;

  return {
    displayUnit: candidateDisplayUnit,
    canonicalUnit: 'cm',
    migrated: false,
    migratedFromLegacyUnit,
  };
}

interface ReadableUnitStorage {
  getItem(key: string): string | null;
}

interface WritableUnitStorage {
  setItem(key: string, value: string): void;
}

/** Reads the persisted display-unit preference, defaulting safely to cm. */
export function readStoredDisplayUnit(storage: ReadableUnitStorage | undefined | null): DisplayUnit {
  if (!storage) return DEFAULT_DISPLAY_UNIT;
  try {
    const raw = storage.getItem(DISPLAY_UNIT_STORAGE_KEY);
    return isDisplayUnit(raw) ? raw : DEFAULT_DISPLAY_UNIT;
  } catch {
    return DEFAULT_DISPLAY_UNIT;
  }
}

/** Persists the display-unit preference; silently no-ops if storage is unavailable. */
export function writeStoredDisplayUnit(storage: WritableUnitStorage | undefined | null, unit: DisplayUnit): void {
  if (!storage) return;
  try {
    storage.setItem(DISPLAY_UNIT_STORAGE_KEY, unit);
  } catch {
    /* storage unavailable (quota, privacy mode, SSR) — display unit falls back to default next read */
  }
}
