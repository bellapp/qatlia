import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isPhotoCode, loadPhotoLink } from '@/lib/whatsapp/photo-link';
import { planImageUrl } from '@/lib/whatsapp/plan-image';
import { previewPlanFor } from '@/lib/whatsapp/photo-summary';
import { OpenInAtelier } from './OpenInAtelier';
import { PhotoLinkExpired } from './PhotoLinkExpired';

export const dynamic = 'force-dynamic';

/**
 * The link preview WhatsApp builds shows the plan picture (plan.png): no page
 * read here, so a preview fetch never touches the link's "opened" mark.
 */
export function generateMetadata({ params }: { params: { code: string } }): Metadata {
  if (!isPhotoCode(params.code)) return {};
  // A page openGraph replaces the layout's whole: title and description are restated.
  const title = 'QatliA · مخطط التقطيع · Plan de coupe';
  const description = 'مخطط التقطيع ديال الورقة اللي صيفطتي · Le plan de coupe de votre fiche de débit';
  return { openGraph: { title, description, siteName: 'QatliA', images: [{ url: planImageUrl(params.code) }] } };
}

/**
 * The link the WhatsApp bot sends after reading a photographed cut list
 * (plan 2026-11-19): it opens the atelier on the pieces read. The utm tags
 * on the URL are recorded by ClientShell before the atelier opens.
 */
export default async function PhotoLinkPage({ params }: { params: { code: string } }) {
  const draft = await loadPhotoLink(params.code, headers().get('user-agent'));
  if (!draft) return <PhotoLinkExpired />;
  // The free preview, computed here from the stored pieces (never from the browser);
  // none for a list too long to plan here: the atelier plans it after sign-up.
  return <OpenInAtelier draft={draft} preview={previewPlanFor(draft)} />;
}
