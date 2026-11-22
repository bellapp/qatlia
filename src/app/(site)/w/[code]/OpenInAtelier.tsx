'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/components/LocaleProvider';
import { writeAtelierDraft } from '@/lib/atelier-draft';
import { readStoredDisplayUnit } from '@/lib/units';
import { photoDraftToAtelierDraft, photoLinkTracking } from '@/lib/whatsapp/photo-summary';
import { recordBrowserVisit } from '@/lib/acquisition';
import type { PhotoDraft } from '@/lib/whatsapp/photo-store';
import type { OptimizationResult } from '@/lib/cutting/binpacking';

/** Hands the pieces to the atelier through its own draft, then opens it. */
export function OpenInAtelier({ code, draft, preview }: { code: string; draft: PhotoDraft; preview: OptimizationResult | null }) {
  const router = useRouter();
  const { t } = useLocale();
  useEffect(() => {
    // The link carries no tag: this page knows the visitor came from a WhatsApp
    // photo, and which one (its code links the account to the number at sign-up).
    recordBrowserVisit(photoLinkTracking(code));
    try {
      // The visitor's own unit preference, as the atelier would read it.
      const unit = readStoredDisplayUnit(window.localStorage);
      writeAtelierDraft(window.sessionStorage, photoDraftToAtelierDraft(draft, Date.now(), unit, preview));
    } catch {
      // Storage blocked: the atelier opens empty rather than not at all.
    }
    router.replace('/atelier');
  }, [code, draft, preview, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 text-sm opacity-80">
      {t('photoLink.opening')}
    </main>
  );
}
