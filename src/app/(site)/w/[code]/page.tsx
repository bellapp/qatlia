import { headers } from 'next/headers';
import { loadPhotoLink } from '@/lib/whatsapp/photo-link';
import { previewPlanFor } from '@/lib/whatsapp/photo-summary';
import { OpenInAtelier } from './OpenInAtelier';
import { PhotoLinkExpired } from './PhotoLinkExpired';

export const dynamic = 'force-dynamic';

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
