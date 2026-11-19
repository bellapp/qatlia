'use client';

import Link from 'next/link';
import { useLocale } from '@/components/LocaleProvider';

/** A link from the bot that is unknown or past its 7 days. */
export function PhotoLinkExpired() {
  const { t } = useLocale();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">{t('photoLink.expiredTitle')}</h1>
      <p className="text-sm opacity-80 max-w-sm">{t('photoLink.expiredBody')}</p>
      <Link href="/atelier" className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-sm font-bold">
        {t('photoLink.openAtelier')}
      </Link>
    </main>
  );
}
