import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isPhotoCode, loadPhotoLink } from '@/lib/whatsapp/photo-link';
import { planImageUrl } from '@/lib/whatsapp/plan-image';
import { photoPreviewPlan } from '@/lib/whatsapp/photo-summary';
import { OpenInAtelier } from './OpenInAtelier';
import { PhotoLinkExpired } from './PhotoLinkExpired';

export const dynamic = 'force-dynamic';

/**
 * The link preview WhatsApp builds shows the plan picture (plan.png): no page
 * read here, so a preview fetch never touches the link's "opened" mark.
 */
export function generateMetadata({ params }: { params: { code: string } }): Metadata {
  if (!isPhotoCode(params.code)) return {};
  return { openGraph: { images: [{ url: planImageUrl(params.code) }] } };
}

/**
 * The link the WhatsApp bot sends after reading a photographed cut list
 * (plan 2026-11-19): it opens the atelier on the pieces read. The utm tags
 * on the URL are recorded by ClientShell before the atelier opens.
 */
export default async function PhotoLinkPage({ params }: { params: { code: string } }) {
  const draft = await loadPhotoLink(params.code, headers().get('user-agent'));
  if (!draft) return <PhotoLinkExpired />;
  // The free preview, computed here from the stored pieces (never from the browser).
  return <OpenInAtelier draft={draft} preview={photoPreviewPlan(draft)} />;
}
