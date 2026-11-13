'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, Save } from 'lucide-react';

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 outline-none focus:border-amber-500/40';
const labelClass = 'block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1';

type Message = { tone: 'ok' | 'error'; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs font-semibold ${message.tone === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
      {message.text}
    </p>
  );
}

const newRequestId = () => crypto.randomUUID();

/**
 * Add or remove credits. The request id is kept while the inputs stay the
 * same, so resending after a network error cannot credit twice; it changes
 * as soon as the admin edits the form or after a success.
 */
export function CreditAdjustForm({ userId, balance }: { userId: string; balance: number | null }) {
  const router = useRouter();
  const requestId = useRef<string>(newRequestId());
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const edited = () => {
    requestId.current = newRequestId();
    setConfirming(false);
    setMessage(null);
  };

  const quantity = Number(amount);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000 && reason.trim().length >= 3;
  const exceedsBalance = direction === 'remove' && balance !== null && quantity > balance;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy || exceedsBalance) return;
    if (direction === 'remove' && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: direction === 'add' ? quantity : -quantity, reason: reason.trim(), requestId: requestId.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ tone: 'ok', text: data.duplicate ? `Déjà appliqué. Solde : ${data.balance}.` : `Solde mis à jour : ${data.balance} crédits.` });
        setAmount('');
        setReason('');
        setConfirming(false);
        requestId.current = newRequestId();
        router.refresh();
      } else if (data.error === 'INSUFFICIENT_CREDITS') {
        setMessage({ tone: 'error', text: `Retrait refusé : le solde n’est que de ${data.balance} crédits.` });
        setConfirming(false);
      } else if (data.error === 'PROFILE_NOT_FOUND') {
        setMessage({ tone: 'error', text: 'Ce client n’a pas encore de profil (il ne s’est jamais servi de l’atelier).' });
      } else if (data.error === 'MIGRATION_MISSING') {
        setMessage({ tone: 'error', text: 'Migration 014 non appliquée dans Supabase.' });
      } else if (res.status === 401) {
        setMessage({ tone: 'error', text: 'Session expirée : reconnectez-vous.' });
      } else {
        setMessage({ tone: 'error', text: 'L’ajustement n’est pas passé. Vous pouvez renvoyer : il ne sera appliqué qu’une fois.' });
      }
    } catch {
      setMessage({ tone: 'error', text: 'Erreur réseau. Vous pouvez renvoyer : il ne sera appliqué qu’une fois.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-1.5" role="radiogroup" aria-label="Sens de l’ajustement">
        {(['add', 'remove'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={direction === value}
            onClick={() => {
              setDirection(value);
              edited();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider ${
              direction === value
                ? value === 'add'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-rose-600 text-white'
                : 'bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            {value === 'add' ? <Plus className="w-3.5 h-3.5" aria-hidden="true" /> : <Minus className="w-3.5 h-3.5" aria-hidden="true" />}
            {value === 'add' ? 'Ajouter' : 'Retirer'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
        <label className="block">
          <span className={labelClass}>Crédits</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              edited();
            }}
            className={inputClass}
            required
          />
        </label>
        <label className="block">
          <span className={labelClass}>Motif (visible par les admins seulement)</span>
          <input
            type="text"
            value={reason}
            maxLength={500}
            onChange={(e) => {
              setReason(e.target.value);
              edited();
            }}
            placeholder="Ex. geste commercial, erreur d’analyse, paiement reçu hors site"
            className={inputClass}
            required
          />
        </label>
      </div>
      {exceedsBalance ? <p className="text-xs text-rose-400">Le solde actuel est de {balance} crédits.</p> : null}
      <button
        type="submit"
        disabled={!valid || busy || exceedsBalance}
        className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider disabled:opacity-40 ${
          confirming ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-amber-500 hover:bg-amber-600 text-black'
        }`}
      >
        {busy ? '…' : confirming ? `Confirmer le retrait de ${quantity} crédit${quantity > 1 ? 's' : ''}` : direction === 'add' ? 'Ajouter les crédits' : 'Retirer les crédits'}
      </button>
      <p className="text-[11px] text-slate-500">Le client verra « Ajustement QatliA » dans son historique, sans le motif.</p>
      <Feedback message={message} />
    </form>
  );
}

export function ClientNoteForm({
  userId,
  initial,
}: {
  userId: string;
  initial: { phone: string | null; tags: string[]; note: string | null };
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [note, setNote] = useState(initial.note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients/${userId}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim() || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ tone: 'ok', text: 'Enregistré.' });
        router.refresh();
      } else if (data.error === 'INVALID_DATA') {
        setMessage({ tone: 'error', text: 'Vérifiez : téléphone en chiffres (30 max), 10 étiquettes de 30 caractères au plus, note de 2000 caractères au plus.' });
      } else if (data.error === 'MIGRATION_MISSING') {
        setMessage({ tone: 'error', text: 'Migration 012 non appliquée dans Supabase.' });
      } else {
        setMessage({ tone: 'error', text: 'L’enregistrement n’est pas passé. Réessayez.' });
      }
    } catch {
      setMessage({ tone: 'error', text: 'Erreur réseau — rien n’a été enregistré.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Téléphone</span>
          <input type="tel" dir="ltr" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} placeholder="+212 6 …" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Étiquettes (séparées par des virgules)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="VIP, Fès, à rappeler" className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>Note privée</span>
        <textarea value={note} maxLength={2000} rows={4} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black text-[11px] font-black uppercase tracking-wider"
      >
        <Save className="w-3.5 h-3.5" aria-hidden="true" />
        {busy ? '…' : 'Enregistrer'}
      </button>
      <Feedback message={message} />
    </form>
  );
}
