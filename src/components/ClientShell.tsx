'use client';

import React from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PwaShell } from '@/components/PwaShell';
import { LocaleProvider } from '@/components/LocaleProvider';
import type { Locale } from '@/i18n';

export function ClientShell({ children, pinnedLocale }: { children: React.ReactNode; pinnedLocale?: Locale }) {
  return (
    <LocaleProvider pinnedLocale={pinnedLocale}>
      <ThemeProvider>
        <PwaShell>{children}</PwaShell>
      </ThemeProvider>
    </LocaleProvider>
  );
}
