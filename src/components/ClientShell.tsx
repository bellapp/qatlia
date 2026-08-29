'use client';

import React from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PwaShell } from '@/components/PwaShell';
import { LocaleProvider } from '@/components/LocaleProvider';

export function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <PwaShell>{children}</PwaShell>
      </ThemeProvider>
    </LocaleProvider>
  );
}