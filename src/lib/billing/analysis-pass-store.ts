/**
 * Browser-side keeping of the analysis pass (see analysis-pass.ts), so that a
 * page reload inside the window does not charge a re-optimization again.
 *
 * The pass is opaque here: only the server can tell whether it is still valid,
 * and an invalid one just means the next run is charged. Storage can be
 * unavailable (private mode, blocked site data), so every access is guarded.
 */

const STORAGE_KEY = 'qatlia-analysis-pass';

export function readAnalysisPass(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeAnalysisPass(pass: unknown): void {
  if (typeof pass !== 'string' || pass === '') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pass);
  } catch {
    // Without storage the pass only lives until the next charged run.
  }
}
