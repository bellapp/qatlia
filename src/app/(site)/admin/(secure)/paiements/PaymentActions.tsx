'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';

/**
 * Validate or refuse one pending manual order. The operator has checked the
 * transfer or the cash himself; this only records the decision.
 */
export function PaymentActions({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState<'grant' | 'refuse' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const decide = async (decision: 'grant' | 'refuse') => {
    setBusy(decision);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_number: orderNumber,
          decision,
          ...(reference.trim() ? { payment_reference: reference.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ tone: 'ok', text: decision === 'grant' ? `Crédits ajoutés (${data.credits ?? ''} cr).` : 'Commande refusée.' });
        router.refresh();
      } else if (res.status === 409) {
        setMessage({ tone: 'error', text: 'Déjà traitée — liste rafraîchie.' });
        router.refresh();
      } else if (res.status === 401) {
        setMessage({ tone: 'error', text: 'Session expirée : reconnectez-vous.' });
      } else {
        setMessage({ tone: 'error', text: data?.message || 'La décision n’est pas passée. Réessayez.' });
      }
    } catch {
      setMessage({ tone: 'error', text: 'Erreur réseau — la décision n’est pas passée.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 pt-1">
      <input
        type="text"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={120}
        placeholder="Référence du paiement (facultatif)"
        aria-label={`Référence du paiement pour ${orderNumber}`}
        className="w-full sm:w-80 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide('grant')}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-black uppercase tracking-wider"
        >
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          {busy === 'grant' ? '…' : 'Valider — créditer'}
        </button>
        <button
          type="button"
          onClick={() => decide('refuse')}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 border border-rose-500/30 hover:bg-rose-500/10 disabled:opacity-40 text-rose-400 text-[11px] font-black uppercase tracking-wider"
        >
          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {busy === 'refuse' ? '…' : 'Refuser'}
        </button>
      </div>
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs font-semibold ${message.tone === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
