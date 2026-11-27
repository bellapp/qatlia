'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2, Unlink } from 'lucide-react';

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40';

type Message = { tone: 'ok' | 'error'; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-[11px] font-semibold ${message.tone === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
      {message.text}
    </p>
  );
}

/**
 * "Rembourser cet achat" on one purchase row (docs/adr/0002): takes back the
 * pack credits and both referral bonuses, each balance stopping at zero. The
 * money is given back outside the app. Two steps: a reason, then a confirm.
 */
export function RefundPurchaseButton({ userId, purchaseKey, credits }: { userId: string; purchaseKey: string; credits: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-500/30 text-[10px] font-bold text-rose-300 hover:bg-rose-500/10"
      >
        <Undo2 className="w-3 h-3" aria-hidden="true" />
        Rembourser
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients/${userId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseKey, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const parts = [`−${data.removedPurchase} cr au client`];
        if (data.removedWelcome > 0) parts.push(`−${data.removedWelcome} cr de bienvenue`);
        if (data.removedReferral > 0) parts.push(`−${data.removedReferral} cr au parrain`);
        setMessage({ tone: 'ok', text: data.duplicate ? 'Déjà remboursé : rien n’a changé.' : `Remboursé : ${parts.join(', ')}.` });
        router.refresh();
      } else if (data.error === 'MIGRATION_MISSING') {
        setMessage({ tone: 'error', text: 'Migration 022 non appliquée.' });
      } else if (res.status === 404) {
        setMessage({ tone: 'error', text: 'Achat introuvable pour ce client.' });
      } else {
        setMessage({ tone: 'error', text: 'Le remboursement n’est pas passé. Rien n’a changé, réessayez.' });
      }
    } catch {
      setMessage({ tone: 'error', text: 'Erreur réseau. Rechargez la page avant de réessayer.' });
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-1.5 min-w-[220px]">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motif (journal admin)"
        aria-label="Motif du remboursement"
        className={inputClass}
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy || reason.trim().length < 3}
          className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-[10px] font-black"
        >
          {busy ? '…' : `Retirer ${credits} cr et les bonus`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 rounded-lg text-[10px] text-slate-400 hover:text-slate-200">
          Annuler
        </button>
      </div>
      <Feedback message={message} />
    </form>
  );
}

/** Detach the client from their parrain: next purchases give no bonus. */
export function DetachReferralButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const detach = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients/${userId}/referral`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        router.refresh();
        return;
      }
      setMessage({ tone: 'error', text: data.error === 'NO_REFERRER' ? 'Ce client n’a plus de parrain.' : 'Le détachement n’est pas passé. Réessayez.' });
    } catch {
      setMessage({ tone: 'error', text: 'Erreur réseau. Rechargez la page.' });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={detach}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/30 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
      >
        <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
        {busy ? '…' : confirming ? 'Confirmer : détacher du parrain' : 'Détacher du parrain'}
      </button>
      {confirming && !busy && <p className="text-[11px] text-slate-500">Ses prochains achats ne donneront plus de bonus. Les bonus déjà versés restent.</p>}
      <Feedback message={message} />
    </div>
  );
}
