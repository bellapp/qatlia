'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, ArrowRight, Zap } from 'lucide-react';

export default function CreditsSuccessPage() {
  return (
    <div className="min-h-screen bg-[#0F172A] text-[#E2E8F0] font-sans antialiased flex items-center justify-center p-6">
      <div className="max-w-md w-full p-8 rounded-3xl bg-[#1E293B]/80 border border-emerald-500/40 text-center space-y-6 shadow-2xl backdrop-blur-md">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white">Recharge Réussie !</h1>
          <p className="text-sm text-[#94A3B8]">
            Vos crédits d&apos;analyse IA ont été ajoutés à votre compte. Vous pouvez maintenant analyser vos photos de découpe.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-[#0F172A] border border-[#334155] flex items-center justify-center gap-2 text-amber-300 font-bold text-sm">
          <Zap className="w-4 h-4 text-[#F5A623]" />
          <span>Solde de crédits mis à jour</span>
        </div>

        <Link
          href="/"
          className="w-full py-3.5 rounded-xl bg-[#F5A623] hover:bg-[#D97706] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 transition-all"
        >
          Retourner au Débit de Panneaux
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
