'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, ArrowRight, Lock, Mail, User, X, Gift } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'login' | 'signup';
  title?: string;
  subtitle?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'signup',
  title = 'Connectez-vous pour télécharger votre plan PDF',
  subtitle = '🎁 5 crédits gratuits offerts immédiatement à la création de votre compte !',
}) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleOAuthGoogle = async () => {
    setOauthLoading(true);
    setErrorMsg(null);
    const supabase = createClient();
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://qatlia.vercel.app';
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la connexion Google';
      setErrorMsg(msg);
      setOauthLoading(false);
    }
  };

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

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Une erreur est survenue';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md p-6 sm:p-8 rounded-3xl bg-[#1E293B] border border-[#334155] shadow-2xl space-y-5">
        
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-2 text-[#94A3B8] hover:text-white rounded-full hover:bg-[#0F172A] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center space-y-2 pt-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#F5A623] to-[#D97706] text-slate-950 font-black text-xl mx-auto shadow-lg shadow-amber-500/20 border border-amber-400/40">
            Q
          </div>
          <h2 className="text-xl font-black text-white">{title}</h2>
          <div className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
            <Gift className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{subtitle}</span>
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold text-center">
            {errorMsg}
          </div>
        )}

        {/* Google OAuth Button */}
        <button
          type="button"
          onClick={handleOAuthGoogle}
          disabled={oauthLoading || loading}
          className="w-full py-3 px-4 rounded-xl bg-[#0F172A] hover:bg-[#283548] border border-[#334155] hover:border-[#475569] text-white font-bold text-xs transition-all flex items-center justify-center gap-3 shadow-md disabled:opacity-50 cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.4 8.9 5 12 5z"
            />
            <path
              fill="#4285F4"
              d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
            />
            <path
              fill="#FBBC05"
              d="M5.3 14.7c-.2-.7-.4-1.4-.4-2.2s.2-1.5.4-2.2L1.6 7.4C.6 9.4 0 11.6 0 14.5s.6 5.1 1.6 7.1l3.7-2.9z"
            />
            <path
              fill="#34A853"
              d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.4-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z"
            />
          </svg>
          <span>{oauthLoading ? 'Redirection Google...' : 'Continuer avec Google (Gmail)'}</span>
        </button>

        {/* Divider */}
        <div className="relative flex items-center justify-center">
          <div className="border-t border-[#334155] w-full"></div>
          <span className="bg-[#1E293B] px-3 text-[11px] font-bold text-[#64748B] uppercase tracking-wider relative">
            ou par email
          </span>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleAuth} className="space-y-3.5">
          {!isLogin && (
            <div>
              <label className="text-xs font-bold text-[#94A3B8]">Nom ou Nom d&apos;Atelier</label>
              <div className="relative mt-1">
                <User className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: Menuiserie Moderne"
                  className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#64748B] focus:border-amber-400 outline-none"
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
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#64748B] focus:border-amber-400 outline-none"
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
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#0F172A] border border-[#334155] rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#64748B] focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || oauthLoading}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#F5A623] to-[#D97706] hover:from-[#D97706] hover:to-[#B45309] text-slate-950 font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <Sparkles className="w-4 h-4 animate-spin" />
            ) : (
              <>
                {isLogin ? 'Se connecter & Télécharger' : 'Créer mon compte & Recevoir 5 crédits'}
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
            className="text-xs text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
          >
            {isLogin
              ? 'Pas encore de compte ? Créer un compte gratuit (+ 5 crédits)'
              : 'Déjà un compte ? Se connecter'}
          </button>
        </div>
      </div>
    </div>
  );
};
