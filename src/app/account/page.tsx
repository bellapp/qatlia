'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, KeyRound, LogOut, Receipt, Shield, Zap } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';

interface Tx {
  id: string;
  type?: string;
  amount: number;
  balance_after?: number;
  description?: string;
  created_at: string;
}

const LOCAL_TX_KEY = 'qatlia_credit_tx_v1';

export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [credits, setCredits] = useState(5);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login?redirect=/account');
        return;
      }
      setEmail(user.email || null);
      try { const { data: p } = await supabase.from('profiles').select('credits').eq('id', user.id).single(); if (p) setCredits(p.credits); } catch {/* noop */}

      try {
        const res = await fetch('/api/credits/history');
        const data = await res.json();
        if (Array.isArray(data.transactions) && data.transactions.length) {
          setTxs(data.transactions);
        } else {
          const local = JSON.parse(localStorage.getItem(LOCAL_TX_KEY) || '[]');
          setTxs(Array.isArray(local) ? local : []);
        }
      } catch {
        const local = JSON.parse(localStorage.getItem(LOCAL_TX_KEY) || '[]');
        setTxs(Array.isArray(local) ? local : []);
      }
    }
    load();
  }, [router]);

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdErr(null);
    setPwdMsg(null);
    if (password.length < 6) {
      setPwdErr('6 caractères minimum.');
      return;
    }
    if (password !== confirm) {
      setPwdErr('Les mots de passe ne correspondent pas.');
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setPwdErr(error.message);
      return;
    }
    setPassword('');
    setConfirm('');
    setPwdMsg('Mot de passe mis à jour.');
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-100 font-sans antialiased">
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 sm:px-8 h-16">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-studio-panel border border-studio-border text-xs font-semibold text-slate-300 hover:bg-studio-field transition-all">
            <ArrowLeft className="w-4 h-4" />
              Atelier
            </Link>
            <div className="text-brand-400">
              <QatlIALogo size="sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/credits" className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-all">
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" />
              <span className="font-mono font-bold">{credits}</span>
            </Link>
            {email && <AccountMenu email={email} />}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400/80">Compte</p>
          <h1 className="text-2xl font-black text-white mt-1">Votre espace artisan</h1>
          <p className="text-sm text-slate-400 mt-1">{email}</p>
        </div>

        <section id="credits" className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-brand-400" />
              <h2 className="text-sm font-bold text-white">Usage des crédits</h2>
            </div>
            <Link href="/credits" className="text-xs font-semibold text-brand-400 hover:text-brand-400">
              Recharger →
            </Link>
          </div>
          <div className="flex items-end gap-3">
            <p className="text-3xl font-black font-mono text-white">{credits}</p>
            <p className="text-xs text-slate-400 pb-1">crédits restants</p>
          </div>
          {txs.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun mouvement pour l’instant. Un crédit est débité à chaque export PDF.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {txs.map((tx) => (
                <li key={tx.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="text-slate-200 font-medium">{tx.description || (tx.amount < 0 ? 'Export PDF' : 'Crédit')}</p>
                    <p className="text-slate-500 font-mono mt-0.5">
                      {new Date(tx.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className={`font-mono font-bold ${tx.amount < 0 ? 'text-rose-300' : 'text-emerald-400'}`}>
                    {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="password" className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-white">Changer le mot de passe</h2>
          </div>
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Si vous vous connectez uniquement via Google, un mot de passe n’est pas obligatoire.
          </p>
          <form onSubmit={handlePassword} className="grid sm:grid-cols-2 gap-3">
            <input
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nouveau mot de passe"
              className="px-3 py-2.5 rounded-xl bg-studio-field border border-studio-border text-sm outline-none focus:border-brand-500/50"
            />
            <input
              type="password"
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirmer"
              className="px-3 py-2.5 rounded-xl bg-studio-field border border-studio-border text-sm outline-none focus:border-brand-500/50"
            />
            <button
              type="submit"
              disabled={saving}
              className="sm:col-span-2 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Mettre à jour le mot de passe'}
            </button>
          </form>
          {pwdErr && <p className="text-xs text-rose-300">{pwdErr}</p>}
          {pwdMsg && <p className="text-xs text-emerald-400">{pwdMsg}</p>}
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/10"
        >
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </button>
      </main>
    </div>
  );
}
