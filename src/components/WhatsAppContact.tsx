'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { placementFor, whatsappLink } from '@/lib/whatsapp/site-contact';

/**
 * The WhatsApp button of the site (docs/superpowers/specs/2026-11-23-bouton-whatsapp-design.md).
 * It opens a chat with the bot, the message of the page already written; where
 * it shows is decided by placementFor (src/lib/whatsapp/site-contact.ts).
 */

const FIELDS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const isField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (FIELDS.has(target.tagName) || target.isContentEditable);

/** True while a field has the focus: on a phone the keyboard is open, the button would sit on it. */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => setTyping(isField(event.target));
    const onFocusOut = () => setTyping(false);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
  return typing;
}

/**
 * The round button in the corner, on the pages where nothing is being worked
 * on. z-40 keeps it under every dialog (z-50 and up), so it never covers one.
 */
export function WhatsAppFloating() {
  const placement = placementFor(usePathname() ?? '/');
  const { locale, t } = useLocale();
  const typing = useTyping();
  if (placement.kind !== 'floating' || typing) return null;

  return (
    <a
      href={whatsappLink(placement.topic, locale)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('support.whatsappButton')}
      title={t('support.whatsappButton')}
      data-testid="whatsapp-floating"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] hover:bg-[#1FBF5B] text-[#0B2E13] shadow-lg shadow-black/25 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] print:hidden"
    >
      <MessageCircle className="w-7 h-7" aria-hidden="true" />
    </a>
  );
}

/** The small button at the end of the bar of the work pages, where a floating one would cover the job. */
export function WhatsAppHeaderButton() {
  const placement = placementFor(usePathname() ?? '/');
  const { locale, t } = useLocale();
  if (placement.kind !== 'header') return null;

  return (
    <a
      href={whatsappLink(placement.topic, locale)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('support.whatsappButton')}
      title={t('support.whatsappButton')}
      data-testid="whatsapp-header"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#128C4A] dark:text-[#25D366] transition-colors"
    >
      <MessageCircle className="w-5 h-5" aria-hidden="true" />
    </a>
  );
}
