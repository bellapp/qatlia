/**
 * Pure helper for `/api/projects` route handlers: safely narrows the unit
 * fields of an arbitrary request body into trustworthy persistence
 * metadata. Kept out of the route module itself so it can be unit-tested
 * directly (Next.js route files may only export HTTP method handlers).
 *
 * Never trusts caller-supplied strings/booleans as-is — anything that isn't
 * exactly `'cm' | 'mm'` for `displayUnit`, or a boolean for
 * `migratedFromLegacyUnit`, falls back to the legacy-safe default
 * (cm / canonical cm / migratedFromLegacyUnit=true), same as
 * `resolveProjectUnitMetadata`.
 */

import { resolveProjectUnitMetadata, type ProjectUnitPersistenceMetadata } from '@/lib/units';

export interface RequestUnitMetadataInput {
  displayUnit?: unknown;
  canonicalUnit?: unknown;
  migratedFromLegacyUnit?: unknown;
}

/** Narrows a request body's unit fields into safe project-persistence metadata. */
export function resolveRequestUnitMetadata(
  body: RequestUnitMetadataInput | null | undefined
): ProjectUnitPersistenceMetadata {
  const resolved = resolveProjectUnitMetadata(body);
  return {
    displayUnit: resolved.displayUnit,
    canonicalUnit: resolved.canonicalUnit,
    migratedFromLegacyUnit: resolved.migratedFromLegacyUnit,
  };
}
