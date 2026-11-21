'use client';

import { useSyncExternalStore } from 'react';
import { isStoreAppDocument } from '@/lib/store-app';

/** The mode never changes during a page's life: nothing to subscribe to. */
const subscribe = () => () => {};

/**
 * Whether the site runs inside the Play Store app, as the head script set it.
 * False on the server and during hydration, then the document's answer, so the
 * first client render matches the server HTML.
 */
export function useStoreApp(): boolean {
  return useSyncExternalStore(subscribe, isStoreAppDocument, () => false);
}
