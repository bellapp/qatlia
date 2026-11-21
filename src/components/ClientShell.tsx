'use client';

import React, { useEffect } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PwaShell } from '@/components/PwaShell';
import { StoreAppGuard } from '@/components/StoreAppGuard';
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
    if (clean === null) return;
    // One tick later: the App Router patches replaceState in its own effect,
    // which runs after this one. With a null state it then keeps its internal
    // history state and moves its own URL too, so the tags do not come back.
    const timer = window.setTimeout(() => {
      try {
        window.history.replaceState(null, '', clean);
      } catch {
        // The address keeps its tags; nothing else depends on them.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <LocaleProvider pinnedLocale={pinnedLocale}>
      <ThemeProvider>
        <PwaShell>
          <StoreAppGuard>{children}</StoreAppGuard>
        </PwaShell>
      </ThemeProvider>
    </LocaleProvider>
  );
}
