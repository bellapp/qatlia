'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, ArrowRight, Lock, Mail, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const supabase = createClient();

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
      }

      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Une erreur est survenue';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#E2E8F0] font-sans antialiased flex items-center justify-center p-6">
      <div className="max-w-md w-full p-8 rounded-3xl bg-[#1E293B]/80 border border-[#334155] shadow-2xl backdrop-blur-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#1E3A5F] to-[#0284C7] text-white font-black text-xl mx-auto shadow-lg shadow-sky-500/20 border border-sky-400/30">
            Q
          </div>
          <h1 className="text-2xl font-black text-white">
            {isLogin ? 'Connexion à QatlIA' : 'Créer un compte Artisan'}
          </h1>
          <p className="text-xs text-[#94A3B8]">
            {isLogin
              ? 'Accède à tes projets de découpe et ton solde de crédits'
              : 'Reçois 5 crédits d\'analyses IA offerts immédiatement'}
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="text-xs font-bold text-[#94A3B8]">Nom complet / Atelier</label>
              <div className="relative mt-1">
                <User className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: Menuiserie Atlas"
                  className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#64748B] focus:border-sky-400 outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-[#94A3B8]">Adresse Email</label>
            <div className="relative mt-1">
              <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="artisan@atelier.ma"
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#64748B] focus:border-sky-400 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-[#94A3B8]">Mot de passe</label>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#64748B] focus:border-sky-400 outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#F5A623] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 disabled:opacity-50"
          >
            {loading ? (
              <Sparkles className="w-4 h-4 animate-spin" />
            ) : (
              <>
                {isLogin ? 'Se connecter' : 'Créer mon compte'}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-[#334155]/60">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setErrorMsg(null);
            }}
            className="text-xs text-sky-400 hover:text-sky-300 font-bold"
          >
            {isLogin
              ? 'Pas encore de compte ? Créer un compte (5 crédits offerts)'
              : 'Déjà un compte ? Se connecter'}
          </button>
        </div>
      </div>
    </div>
  );
}
