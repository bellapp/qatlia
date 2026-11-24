/**
 * Remembers, in this browser, that the low-credits message was closed. The
 * storage comes from a getter because merely reading `window.localStorage`
 * throws when the browser blocks it.
 */
const KEY = 'qatlia_low_credits_closed';

export type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readDismissed(storage: StorageGetter): boolean {
  try {
    return storage().getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDismissed(storage: StorageGetter, dismissed: boolean): void {
  try {
    if (dismissed) storage().setItem(KEY, '1');
    else storage().removeItem(KEY);
  } catch {
    /* blocked storage: the message simply comes back on the next visit */
  }
}
