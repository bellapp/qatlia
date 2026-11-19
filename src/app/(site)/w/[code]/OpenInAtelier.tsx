'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/components/LocaleProvider';
import { writeAtelierDraft } from '@/lib/atelier-draft';
import { readStoredDisplayUnit } from '@/lib/units';
import { photoDraftToAtelierDraft } from '@/lib/whatsapp/photo-summary';
import type { PhotoDraft } from '@/lib/whatsapp/photo-store';
import type { OptimizationResult } from '@/lib/cutting/binpacking';

/** Hands the pieces to the atelier through its own draft, then opens it. */
export function OpenInAtelier({ draft, preview }: { draft: PhotoDraft; preview: OptimizationResult }) {
  const router = useRouter();
  const { t } = useLocale();
  useEffect(() => {
    try {
      // The visitor's own unit preference, as the atelier would read it.
      const unit = readStoredDisplayUnit(window.localStorage);
      writeAtelierDraft(window.sessionStorage, photoDraftToAtelierDraft(draft, Date.now(), unit, preview));
    } catch {
      // Storage blocked: the atelier opens empty rather than not at all.
    }
    router.replace('/atelier');
  }, [draft, preview, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 text-sm opacity-80">
      {t('photoLink.opening')}
    </main>
  );
}
