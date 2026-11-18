'use client';

import React, { useEffect } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PwaShell } from '@/components/PwaShell';
import { LocaleProvider } from '@/components/LocaleProvider';
import { acquisitionCookie, loadAcquisition, rememberAcquisition } from '@/lib/acquisition';
import type { Locale } from '@/i18n';

export function ClientShell({ children, pinnedLocale }: { children: React.ReactNode; pinnedLocale?: Locale }) {
  // Remembers where a tagged visit came from (e.g. a WhatsApp bot link), for the sign-up.
  // The cookie copy reaches /auth/callback, where a Google sign-up creates the account.
  useEffect(() => {
    try {
      const now = Date.now();
      rememberAcquisition(window.localStorage, window.location.search, now);
      const visit = loadAcquisition(window.localStorage, now);
      if (visit) document.cookie = acquisitionCookie(visit, now, window.location.protocol === 'https:');
    } catch {
      // localStorage blocked: the visit goes untracked.
    }
  }, []);

  return (
    <LocaleProvider pinnedLocale={pinnedLocale}>
      <ThemeProvider>
        <PwaShell>{children}</PwaShell>
      </ThemeProvider>
    </LocaleProvider>
  );
}
