'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Scissors, Camera, TrendingUp, FileText } from 'lucide-react';
import { QatlIALogo } from '@/components/QatlIALogo';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-studio-canvas text-slate-100 font-sans antialiased overflow-x-hidden">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-studio-border/50 bg-studio-canvas/70 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 sm:px-10 h-16">
          <div className="flex items-center gap-3">
            <div className="text-brand-400"><QatlIALogo size="md" /></div>
            <span className="font-display font-extrabold text-lg tracking-tight text-white">QatlIA</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/auth/login" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Connexion
            </Link>
            <Link
              href="/atelier"
              className="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-studio-canvas font-black text-sm transition-all shadow-lg shadow-brand-500/20 active:scale-95"
            >
              Essayer gratuitement
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-24 pb-20 sm:pt-32 sm:pb-28 px-6 sm:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_-100px,rgba(245,166,35,0.08),transparent_70%)] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            Optimisation de découpe pour menuisiers
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.05]">
            Calepinez vos panneaux
            <br />
            <span className="text-brand-400">en quelques secondes</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Économisez jusqu&apos;à <strong className="text-white">530 MAD par chantier</strong>. Scannez vos fiches de débit,
            optimisez le placement, exportez votre plan en PDF industriel.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/atelier"
              className="group px-8 py-4 rounded-2xl bg-brand-500 hover:bg-brand-400 text-studio-canvas font-black text-base transition-all shadow-xl shadow-brand-500/25 active:scale-[0.98] flex items-center gap-2.5"
            >
              <Scissors className="w-5 h-5" />
              Essayer gratuitement
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/auth/login"
              className="px-8 py-4 rounded-2xl border border-studio-border hover:border-studio-border-hover text-slate-300 font-bold text-base transition-all"
            >
              J&apos;ai déjà un compte
            </Link>
          </div>

          <p className="mt-4 text-[11px] text-slate-600">
            5 crédits gratuits à l&apos;inscription · Sans carte bancaire
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { value: '530', unit: 'MAD', label: 'Économie moyenne par chantier' },
            { value: '75', unit: '%', label: 'Surface utile optimisée' },
            { value: '2', unit: 'min', label: 'Pour générer un plan complet' },
            { value: '5', unit: 'crédits', label: 'Offerts à l&apos;inscription' },
          ].map((stat) => (
            <div key={stat.label} className="p-4 rounded-2xl bg-studio-panel/50 border border-studio-border/70 text-center">
              <p className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                {stat.value} <span className="text-brand-400 text-lg">{stat.unit}</span>
              </p>
              <p className="text-[10px] sm:text-[11px] text-slate-500 mt-1.5 leading-tight">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pb-24">
        <div className="text-center mb-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400/80 mb-3">Fonctionnalités</p>
          <h2 className="text-3xl font-black text-white">Tout ce dont votre atelier a besoin</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: Camera,
              title: 'Scan manuscrit IA',
              desc: 'Photographiez votre carnet de mesures. L\'IA extrait automatiquement les cotes.',
              color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
            },
            {
              icon: Scissors,
              title: 'Coupe guillotine',
              desc: 'Algorithme de coupe linéaire traversante, le standard des ateliers de menuiserie.',
              color: 'text-brand-400 bg-brand-500/10 border-brand-500/20',
            },
            {
              icon: FileText,
              title: 'Rapport PDF pro',
              desc: 'Plan de coupe avec cotes, nomenclature, chutes. Prêt pour l\'atelier ou le client.',
              color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
            },
            {
              icon: TrendingUp,
              title: 'Optimisation MAD',
              desc: 'Visualisez le gain économique en dirhams. Matière économisée = argent gagné.',
              color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
            },
          ].map((feat) => (
            <div key={feat.title} className="group p-5 rounded-2xl bg-studio-panel/50 border border-studio-border/70 hover:border-brand-500/30 transition-all space-y-3">
              <span className={`shrink-0 w-10 h-10 rounded-xl ${feat.color} flex items-center justify-center border`}>
                <feat.icon className="w-5 h-5" />
              </span>
              <h3 className="font-black text-white text-sm">{feat.title}</h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-6 sm:px-10 pb-24">
        <div className="text-center mb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400/80 mb-3">Comment ça marche</p>
          <h2 className="text-3xl font-black text-white">Trois étapes, un plan parfait</h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { step: '1', title: 'Ajoutez vos pièces', desc: 'Scannez une fiche ou saisissez les dimensions manuellement en centimètres.' },
            { step: '2', title: 'Lancez l\'optimisation', desc: 'L\'algorithme calcule le placement optimal en quelques secondes.' },
            { step: '3', title: 'Exportez le rapport', desc: 'Téléchargez le PDF avec le plan de coupe et la nomenclature.' },
          ].map((item) => (
            <div key={item.step} className="relative p-6 rounded-2xl bg-studio-panel/50 border border-studio-border/70 text-center space-y-3">
              <span className="inline-flex w-10 h-10 rounded-xl bg-brand-500 text-studio-canvas font-black text-lg items-center justify-center">
                {item.step}
              </span>
              <h3 className="font-black text-white">{item.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Footer */}
      <section className="max-w-3xl mx-auto px-6 sm:px-10 pb-20 text-center">
        <div className="p-10 sm:p-14 rounded-3xl bg-studio-panel/60 border border-studio-border/80 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(400px_circle_at_50%_50%,rgba(245,166,35,0.06),transparent_70%)] pointer-events-none" />
          <div className="relative space-y-5">
            <h2 className="text-2xl sm:text-3xl font-black text-white">Prêt à optimiser votre atelier ?</h2>
            <p className="text-slate-400 text-sm max-w-lg mx-auto">
              Commencez gratuitement avec 5 crédits. Pas de carte bancaire, pas d&apos;engagement.
            </p>
            <Link
              href="/atelier"
              className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-brand-500 hover:bg-brand-400 text-studio-canvas font-black text-base transition-all shadow-xl shadow-brand-500/25 active:scale-[0.98]"
            >
              <Scissors className="w-5 h-5" />
              Essayer QatlIA maintenant
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-studio-border/60 px-6 sm:px-10 py-8 text-center">
        <div className="flex items-center justify-center gap-2 text-xs text-slate-600 mb-2">
          <QatlIALogo size="sm" />
          <span className="font-bold text-slate-500">QatlIA Pro</span>
        </div>
        <p className="text-[10px] text-slate-600">Maroc · MAD · Optimisation de découpe pour menuisiers</p>
      </footer>
    </div>
  );
}