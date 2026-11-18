'use client';

import React, { useEffect } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PwaShell } from '@/components/PwaShell';
import { LocaleProvider } from '@/components/LocaleProvider';
import { rememberAcquisition } from '@/lib/acquisition';
import type { Locale } from '@/i18n';

export function ClientShell({ children, pinnedLocale }: { children: React.ReactNode; pinnedLocale?: Locale }) {
  // Remembers where a tagged visit came from (e.g. a WhatsApp bot link), for the sign-up.
  useEffect(() => {
    try {
      rememberAcquisition(window.localStorage, window.location.search, Date.now());
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
