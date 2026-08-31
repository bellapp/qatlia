'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Check, Zap, ArrowLeft, ShieldCheck, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CREDIT_PACKS, PACK_IDS, formatMAD } from '@/lib/billing/catalog';

export default function CreditsPage() {
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // null until the real balance is known — never a hardcoded placeholder.
  const [credits, setCredits] = useState<number | null>(null);

  const packs = PACK_IDS.map((id) => CREDIT_PACKS[id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', user.id).single();
        if (!cancelled && profile && typeof profile.credits === 'number') setCredits(profile.credits);
      } catch {
        /* balance stays unknown rather than being invented */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckout = async (packId: string) => {
    setLoadingPack(packId);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setCheckoutError(
        res.status === 401
          ? 'Connectez-vous pour acheter des crédits.'
          : data.message || 'Le paiement est momentanément indisponible.'
      );
    } catch {
      setCheckoutError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoadingPack(null);
    }
  };

  return (
    <div className="min-h-screen bg-studio-panel text-slate-700 dark:text-slate-200 font-sans antialiased p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/atelier"
            className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour au Dashboard
          </Link>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-400 text-xs font-bold">
            <Zap className="w-3.5 h-3.5 text-[#F5A623]" />
            <span>{credits === null ? 'Solde indisponible' : `Solde actuel : ${credits} crédits`}</span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-2">
          <span className="text-xs font-black uppercase tracking-widest text-[#F5A623] bg-brand-500/10 px-3 py-1 rounded-full border border-brand-500/20">
            Recharge de Crédits
          </span>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">
            {formatMAD(CREDIT_PACKS.starter.priceMAD)} = {CREDIT_PACKS.starter.credits} analyses photo
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
            1 crédit est débité uniquement lors d&apos;une analyse photo réussie. L&apos;optimisation du schéma et
            tous les exports (PDF, DXF, JSON, PNG, devis) sont gratuits et illimités.
          </p>
        </div>

        {checkoutError && (
          <p role="alert" className="text-center text-xs font-semibold text-red-500">
            {checkoutError}
          </p>
        )}

        {/* Packs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {packs.map((p) => (
            <div
              key={p.id}
              className={`rounded-2xl p-6 flex flex-col justify-between transition-all relative ${
                p.highlight
                  ? 'bg-gradient-to-b from-[#1E3A5F] to-[#0F172A] border-2 border-[#F5A623] shadow-xl shadow-orange-500/10'
                  : 'bg-studio-panel/60 border border-studio-border'
              }`}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F5A623] text-black text-[10px] font-black uppercase tracking-wider px-3 py-0.5 rounded-full shadow-md">
                  Recommandé
                </span>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{p.name}</h3>
                </div>
                <div className="flex items-baseline gap-1 my-3">
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{p.priceMAD}</span>
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-400">
                    DH {p.monthly ? '/mois' : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-6">{p.description}</p>

                <div className="space-y-2.5 pt-4 border-t border-studio-border/60 text-xs">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      <strong>{p.displayCredits}</strong> analyses photo{p.monthly ? ' par mois' : ''}
                    </span>
                  </div>
                  {p.renewalNote && (
                    <div className="flex items-center gap-2 text-[#CBD5E1]">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{p.renewalNote}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[#CBD5E1]">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Schémas de coupe illimités et gratuits</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#CBD5E1]">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Exports PDF, DXF, JSON et PNG gratuits</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleCheckout(p.id)}
                disabled={loadingPack === p.id}
                className={`w-full mt-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                  p.highlight
                    ? 'bg-[#F5A623] hover:bg-[#D97706] text-black shadow-lg shadow-orange-500/20'
                    : 'bg-[#0284C7] hover:bg-[#0369A1] text-slate-900 dark:text-white'
                }`}
              >
                {loadingPack === p.id ? (
                  <Sparkles className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    Choisir ce pack
                  </>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Payment Methods Banner */}
        <div className="p-4 rounded-2xl bg-studio-panel/40 border border-studio-border flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>
              Paiement sécurisé par <strong>Stripe</strong> — cartes Visa / Mastercard, débitées en dirhams (MAD)
            </span>
          </div>
          <span className="text-[11px] text-[#64748B]">Facture et reçu instantanés par email</span>
        </div>
      </div>
    </div>
  );
}
