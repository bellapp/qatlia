/**
 * What the atelier does with a job opened from a WhatsApp link that still
 * shows the free preview of its plan (plan 2026-11-19-whatsapp-plan-apercu):
 * signed in, it runs the normal, paid optimization once; signed out, it shows
 * the sign-up banner; while the sign-in is unknown, it waits.
 *
 * Pure: the atelier passes the marker and the sign-in state.
 */

export type PhotoPreviewStep = 'run' | 'banner' | 'wait' | 'none';

export function photoPreviewStep(input: { preview: boolean; signedIn: boolean | null }): PhotoPreviewStep {
  if (!input.preview) return 'none';
  if (input.signedIn === null) return 'wait';
  return input.signedIn ? 'run' : 'banner';
}
