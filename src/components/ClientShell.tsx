'use client';

import React, { useEffect } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PwaShell } from '@/components/PwaShell';
import { LocaleProvider } from '@/components/LocaleProvider';
import { recordBrowserVisit, withoutTracking } from '@/lib/acquisition';
import type { Locale } from '@/i18n';

export function ClientShell({ children, pinnedLocale }: { children: React.ReactNode; pinnedLocale?: Locale }) {
  // Remembers where a tagged visit came from (e.g. a WhatsApp bot link), for the sign-up.
  // The cookie copy reaches /auth/callback, where a Google sign-up creates the account.
  // Once recorded, the tags leave the address bar: the prospect never reads "utm_source=whatsapp".
  useEffect(() => {
    recordBrowserVisit(window.location.search);
    const clean = withoutTracking(window.location.pathname, window.location.search, window.location.hash);
    if (clean !== null) {
      try {
        window.history.replaceState(window.history.state, '', clean);
      } catch {
        // The address keeps its tags; nothing else depends on them.
      }
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
