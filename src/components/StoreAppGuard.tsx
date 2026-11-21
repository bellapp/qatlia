'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStoreApp } from '@/components/useStoreApp';
import { STORE_APP_VALUE, storeAppRedirect } from '@/lib/store-app';

/**
 * In the Play Store app, an in-app navigation to a page that sells (a sign-out
 * pushes '/', a link to /credits) leads elsewhere, and nothing of that page is
 * shown meanwhile. A full page load is handled earlier, by the head script.
 */
export function StoreAppGuard({ children }: { children: React.ReactNode }) {
  const inApp = useStoreApp();
  const pathname = usePathname();
  const router = useRouter();
  const target = inApp ? storeAppRedirect(pathname ?? '') : null;

  // A hydration error makes React client-render <html> without the attribute
  // the head script set; put it back so the stylesheet keeps hiding what sells.
  useEffect(() => {
    if (inApp) document.documentElement.setAttribute('data-app', STORE_APP_VALUE);
  }, [inApp, pathname]);

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return target ? null : <>{children}</>;
}
