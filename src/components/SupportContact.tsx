'use client';

import React from 'react';
import { Mail, MessageCircle } from 'lucide-react';
import { SUPPORT_EMAIL, supportMailto, supportWhatsAppUrl } from '@/lib/support';

interface SupportContactProps {
  /** Translated lead-in, e.g. « Besoin d’aide ? Écrivez-nous : ». */
  label: string;
  /** Translated text prefilled in the WhatsApp message and the email body. */
  message: string;
  className?: string;
}

/**
 * One line that tells the customer who to write to: WhatsApp first (what artisans
 * in Morocco actually use), email second. « WhatsApp » is a proper noun and the
 * address is an address, so neither goes through the catalog.
 */
export function SupportContact({ label, message, className = '' }: SupportContactProps) {
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed ${className}`}>
      <span>{label}</span>
      <a
        href={supportWhatsAppUrl(message)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline"
      >
        <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
        WhatsApp
      </a>
      <a href={supportMailto(message)} dir="ltr" className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline">
        <Mail className="w-3.5 h-3.5" aria-hidden="true" />
        {SUPPORT_EMAIL}
      </a>
    </p>
  );
}
