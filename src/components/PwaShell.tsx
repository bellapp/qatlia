'use client';

import React from 'react';
import { PwaRegister } from '@/components/PwaRegister';
import { TopProgressBar } from '@/components/TopProgressBar';

export function PwaShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PwaRegister />
      <TopProgressBar />
      {children}
    </>
  );
}