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

export type PreviewExportGate = 'allow' | 'run' | 'sign-in';

/**
 * Whether a file (PDF, quote, DXF, PNG, JSON) may leave the atelier. The free
 * preview never does, whatever the sign-in state: signed out, the visitor
 * signs up first (the paid run follows); signed in but still on the preview
 * (0 credits, a failed run, a sign-up confirmed in another tab), the paid run
 * starts instead. Only a successful run clears the preview.
 */
export function previewExportGate(input: { preview: boolean; signedIn: boolean }): PreviewExportGate {
  if (!input.preview) return 'allow';
  return input.signedIn ? 'run' : 'sign-in';
}
