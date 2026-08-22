'use client';

import React, { useState } from 'react';
import { Sparkles, Check, Zap, ArrowLeft, ShieldCheck, CreditCard } from 'lucide-react';
import Link from 'next/link';

export default function CreditsPage() {
  const [loadingPack, setLoadingPack] = useState<string | null>(null);

  const packs = [
    {
      id: 'starter',
      name: 'Pack Découverte',
      credits: 10,
      priceMAD: 10,
      desc: 'Idéal pour tester ou pour 1 petit chantier',
      badge: '10 DH',
      highlight: false,
    },
    {
      id: 'standard',
      name: 'Pack Artisan',
      credits: 50,
      priceMAD: 40,
      desc: 'Le choix populaire des menuisiers actifs',
      badge: 'Populaire (40 DH)',
      highlight: true,
    },
    {
      id: 'pro',
      name: 'Pack Atelier Pro',
      credits: 100,
      priceMAD: 70,
      desc: 'Pour les ateliers à fort volume de débit',
      badge: 'Économique (70 DH)',
      highlight: false,
    },
    {
      id: 'unlimited',
      name: 'Abonnement Illimité',
      credits: 'Illimité',
      priceMAD: 99,
      desc: 'Analyses IA illimitées chaque mois',
      badge: '99 DH / mois',
      highlight: false,
    },
  ];

  const handleCheckout = async (packId: string) => {
    setLoadingPack(packId);
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPack(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#E2E8F0] font-sans antialiased p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-bold text-[#94A3B8] hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour au Dashboard
          </Link>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold">
            <Zap className="w-3.5 h-3.5 text-[#F5A623]" />
            <span>Solde actuel : 5 Crédits</span>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-2">
          <span className="text-xs font-black uppercase tracking-widest text-[#F5A623] bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            Recharge de Crédits
          </span>
          <h1 className="text-3xl md:text-4xl font-black text-white">
            10 DH = 10 Analyses IA de Mesures
          </h1>
          <p className="text-sm text-[#94A3B8] max-w-xl mx-auto">
            1 crédit est consommé uniquement lors d&apos;une analyse photo IA réussie. L&apos;optimisation du schéma et les exports sont 100% gratuits et illimités.
          </p>
        </div>

        {/* Packs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {packs.map((p) => (
            <div
              key={p.id}
              className={`rounded-2xl p-6 flex flex-col justify-between transition-all relative ${
                p.highlight
                  ? 'bg-gradient-to-b from-[#1E3A5F] to-[#0F172A] border-2 border-[#F5A623] shadow-xl shadow-orange-500/10'
                  : 'bg-[#1E293B]/60 border border-[#334155]'
              }`}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F5A623] text-black text-[10px] font-black uppercase tracking-wider px-3 py-0.5 rounded-full shadow-md">
                  Recommandé
                </span>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-bold text-white">{p.name}</h3>
                </div>
                <div className="flex items-baseline gap-1 my-3">
                  <span className="text-3xl font-black text-white">{p.priceMAD}</span>
                  <span className="text-sm font-bold text-[#94A3B8]">
                    DH {p.id === 'unlimited' ? '/mois' : ''}
                  </span>
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed mb-6">{p.desc}</p>

                <div className="space-y-2.5 pt-4 border-t border-[#334155]/60 text-xs">
                  <div className="flex items-center gap-2 text-white">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span><strong>{p.credits}</strong> analyses photo IA</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#CBD5E1]">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Schémas de coupe illimités</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#CBD5E1]">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Export PDF & WhatsApp</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleCheckout(p.id)}
                disabled={loadingPack === p.id}
                className={`w-full mt-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                  p.highlight
                    ? 'bg-[#F5A623] hover:bg-[#D97706] text-black shadow-lg shadow-orange-500/20'
                    : 'bg-[#0284C7] hover:bg-[#0369A1] text-white'
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
        <div className="p-4 rounded-2xl bg-[#1E293B]/40 border border-[#334155] flex flex-wrap items-center justify-between text-xs text-[#94A3B8] gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>Paiement sécurisé par <strong>Stripe</strong> (Cartes bancaires Visa / Mastercard) et CMI / CashPlus</span>
          </div>
          <span className="text-[11px] text-[#64748B]">Facture et reçu instantanés par email</span>
        </div>
      </div>
    </div>
  );
}
