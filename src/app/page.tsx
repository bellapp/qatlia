'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Upload,
  Layers,
  Sparkles,
  Play,
  Plus,
  Trash2,
  RefreshCw,
  Download,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Zap,
  LogIn,
  User as UserIcon,
} from 'lucide-react';
import { Piece, Sheet, OptimizationResult } from '@/lib/cutting/binpacking';

// Palette officielle QatlIA
const PIECE_COLORS = [
  '#38BDF8', // Sky Blue
  '#F5A623', // Amber / Orange QatlIA
  '#34D399', // Emerald
  '#F87171', // Red coral
  '#A78BFA', // Purple soft
  '#FBBF24', // Yellow gold
  '#2DD4BF', // Teal
  '#818CF8', // Indigo light
  '#FB923C', // Orange soft
  '#60A5FA', // Blue bright
];

export default function QatlIADashboard() {
  const [step, setStep] = useState<'capture' | 'results'>('capture');
  const [isProcessingVision, setIsProcessingVision] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [userProfile, setUserProfile] = useState<{ email?: string; credits: number } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', session.user.id)
          .single();

        setUserProfile({
          email: session.user.email,
          credits: profile?.credits ?? 5,
        });
      }
    };
    fetchUser();
  }, []);

  // Paramètres de panneau par défaut (MDF standard Maghreb)
  const [sheet, setSheet] = useState<Sheet>({
    width: 280, // cm
    height: 207, // cm
    kerf: 0.4, // cm (4 mm)
    margin: 1.0, // cm
    grainDirection: true,
  });

  // Liste de pièces à découper
  const [pieces, setPieces] = useState<Piece[]>([
    { id: '1', name: 'Panneau Latéral G', width: 200, height: 58, quantity: 2, rotatable: false },
    { id: '2', name: 'Panneau Latéral D', width: 200, height: 58, quantity: 2, rotatable: false },
    { id: '3', name: 'Base / Plafond', width: 120, height: 58, quantity: 2, rotatable: true },
    { id: '4', name: 'Étagères Mobiles', width: 116.4, height: 55, quantity: 4, rotatable: true },
    { id: '5', name: 'Façades Tiroirs', width: 59.5, height: 25, quantity: 4, rotatable: true },
    { id: '6', name: 'Socle Inférieur', width: 120, height: 10, quantity: 2, rotatable: false },
  ]);

  // Résultat d'optimisation
  const [result, setResult] = useState<OptimizationResult | null>(null);

  // Vision IA Upload handler
  const [visionError, setVisionError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingVision(true);
    setVisionError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;

          const res = await fetch('/api/vision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: base64,
              sheetMaterial: 'mdf',
            }),
          });

          const data = await res.json();
          if (data.success && Array.isArray(data.pieces) && data.pieces.length > 0) {
            setPreviewImage(base64);
            const newPieces: Piece[] = data.pieces.map((p: { name?: string; width: number | string; height: number | string; quantity?: number | string }, i: number) => ({
              id: `ext_${Date.now()}_${i}`,
              name: p.name || `Pièce ${i + 1}`,
              width: Number(p.width),
              height: Number(p.height),
              quantity: Number(p.quantity) || 1,
              rotatable: true,
            }));
            setPieces(newPieces);
          } else {
            setVisionError(data.message || data.error || 'Aucune pièce détectée sur l\'image.');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Erreur de connexion API';
          setVisionError(msg);
        } finally {
          setIsProcessingVision(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur de lecture du fichier';
      setVisionError(msg);
      setIsProcessingVision(false);
    }
  };

  // Run Optimization
  const handleRunOptimization = async () => {
    setIsOptimizing(true);
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, pieces }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setResult(data.result);
        setActiveSheetIndex(0);
        setStep('results');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    try {
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'Cuisine Moderne',
          material: 'MDF',
          sheet,
          result,
        }),
      });

      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qatlia_schema_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      window.print();
    }
  };

  const handleAddPiece = () => {
    const newId = `p_${Date.now()}`;
    setPieces([
      ...pieces,
      { id: newId, name: `Pièce ${pieces.length + 1}`, width: 60, height: 40, quantity: 1, rotatable: true },
    ]);
  };

  const handleUpdatePiece = (index: number, field: keyof Piece, val: string | number | boolean) => {
    const copy = [...pieces];
    copy[index] = { ...copy[index], [field]: val };
    setPieces(copy);
  };

  const handleDeletePiece = (index: number) => {
    setPieces(pieces.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#E2E8F0] font-sans antialiased selection:bg-[#F5A623] selection:text-black">
      {/* HEADER TOP BAR */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-[#1E293B] bg-[#0F172A]/90 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-[#1E3A5F] to-[#0284C7] shadow-lg shadow-sky-500/20 border border-sky-400/30 text-white font-black">
            Q
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-1.5">
              Qatl<span className="text-[#F5A623]">IA</span>
              <span className="text-[10px] uppercase font-bold tracking-widest bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full px-2 py-0.5">
                Pro
              </span>
            </h1>
          </div>
        </div>

        {/* Top Navigation Steps */}
        <div className="flex items-center gap-2 bg-[#1E293B]/80 p-1 rounded-xl border border-[#334155]">
          <button
            onClick={() => setStep('capture')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              step === 'capture'
                ? 'bg-[#0284C7] text-white shadow-md'
                : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            1. Mesures & IA
          </button>
          <button
            onClick={() => {
              if (result) setStep('results');
              else handleRunOptimization();
            }}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              step === 'results'
                ? 'bg-[#F5A623] text-black shadow-md'
                : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            2. Schéma de Découpe
          </button>
        </div>

        {/* User Credits / Status */}
        <div className="flex items-center gap-3">
          <Link
            href="/credits"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-[#F5A623]" />
            <span>{userProfile ? `${userProfile.credits} Crédits` : '5 Crédits IA'}</span>
          </Link>

          {userProfile ? (
            <div className="flex items-center gap-2 text-xs text-[#94A3B8] font-bold bg-[#1E293B] px-3 py-1.5 rounded-xl border border-[#334155]">
              <UserIcon className="w-3.5 h-3.5 text-sky-400" />
              <span className="max-w-[120px] truncate text-white">{userProfile.email}</span>
            </div>
          ) : (
            <Link
              href="/auth/login"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Connexion</span>
            </Link>
          )}
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto p-6 md:p-8">
        {step === 'capture' ? (
          <div className="space-y-6">
            {/* Project Parameters Banner */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 rounded-2xl bg-[#1E293B]/60 border border-[#334155] backdrop-blur-sm">
              <div>
                <label className="text-xs font-bold text-[#94A3B8] uppercase">Format Panneau (cm)</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="number"
                    value={sheet.width}
                    onChange={(e) => setSheet({ ...sheet, width: Number(e.target.value) })}
                    className="w-20 bg-[#0F172A] border border-[#334155] rounded-lg px-2.5 py-1.5 text-sm font-bold text-white text-center"
                  />
                  <span className="text-[#64748B]">×</span>
                  <input
                    type="number"
                    value={sheet.height}
                    onChange={(e) => setSheet({ ...sheet, height: Number(e.target.value) })}
                    className="w-20 bg-[#0F172A] border border-[#334155] rounded-lg px-2.5 py-1.5 text-sm font-bold text-white text-center"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[#94A3B8] uppercase">Trait de Scie (Kerf)</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="number"
                    step="0.1"
                    value={sheet.kerf}
                    onChange={(e) => setSheet({ ...sheet, kerf: Number(e.target.value) })}
                    className="w-24 bg-[#0F172A] border border-[#334155] rounded-lg px-2.5 py-1.5 text-sm font-bold text-white text-center"
                  />
                  <span className="text-xs text-[#64748B]">cm (4mm)</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[#94A3B8] uppercase">Marge Débit</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="number"
                    step="0.5"
                    value={sheet.margin || 0}
                    onChange={(e) => setSheet({ ...sheet, margin: Number(e.target.value) })}
                    className="w-20 bg-[#0F172A] border border-[#334155] rounded-lg px-2.5 py-1.5 text-sm font-bold text-white text-center"
                  />
                  <span className="text-xs text-[#64748B]">cm</span>
                </div>
              </div>

              <div className="flex items-center justify-between md:justify-end gap-3 pt-4 md:pt-0">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sheet.grainDirection}
                    onChange={(e) => setSheet({ ...sheet, grainDirection: e.target.checked })}
                    className="w-4 h-4 rounded border-[#334155] text-[#F5A623] focus:ring-[#F5A623]"
                  />
                  <span className="text-xs font-bold text-[#CBD5E1]">Sens Veinage</span>
                </label>
              </div>
            </div>

            {/* Split Screen : AI Photo Upload + Extracted Table */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Photo Upload Box */}
              <div className="lg:col-span-5 rounded-2xl bg-[#1E293B]/60 border border-[#334155] p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-[#F5A623]" />
                      Capture Photo & IA Vision
                    </h2>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                      GPT-4o Vision
                    </span>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed mb-6">
                    Prends en photo ta liste de mesures manuscrite sur papier ou ton plan. L&apos;IA extrait automatiquement les cotes et quantités en un instant.
                  </p>

                  <label className="group relative flex flex-col items-center justify-center min-h-[220px] rounded-2xl border-2 border-dashed border-[#475569] hover:border-sky-400 bg-[#0F172A]/80 hover:bg-[#0F172A] p-6 text-center cursor-pointer transition-all">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 mb-3 group-hover:scale-110 transition-transform">
                      {isProcessingVision ? (
                        <RefreshCw className="w-6 h-6 animate-spin" />
                      ) : (
                        <Upload className="w-6 h-6" />
                      )}
                    </div>
                    <span className="text-sm font-bold text-white">
                      {isProcessingVision ? 'Extraction des cotes par IA...' : 'Dépose la photo de mesures'}
                    </span>
                    <span className="text-xs text-[#64748B] mt-1">
                      JPG, PNG, HEIC ou scan • 1 crédit utilisé
                    </span>
                  </label>

                  {/* Image Preview if uploaded */}
                  {previewImage && (
                    <div className="mt-4 p-3 rounded-xl bg-[#0F172A] border border-[#334155] flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewImage}
                          alt="Aperçu des mesures"
                          className="w-12 h-12 rounded-lg object-cover border border-[#475569] shrink-0"
                        />
                        <div className="truncate text-xs">
                          <p className="font-bold text-white truncate">Image de mesures chargée</p>
                          <p className="text-[#34D399] font-semibold text-[11px]">✓ Extraction IA réussie</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setPreviewImage(null)}
                        className="text-xs text-rose-400 hover:text-rose-300 font-bold px-2 py-1"
                      >
                        Changer
                      </button>
                    </div>
                  )}

                  {visionError && (
                    <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold text-center">
                      ⚠️ {visionError}
                    </div>
                  )}
                </div>

                <div className="mt-6 p-3.5 rounded-xl bg-sky-950/40 border border-sky-500/20 text-xs text-sky-200 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Astuce pro :</strong> Veille à ce que les chiffres soient bien lisibles et sans ombres portées pour une précision maximale (98%+).
                  </span>
                </div>
              </div>

              {/* Pieces Table */}
              <div className="lg:col-span-7 rounded-2xl bg-[#1E293B]/60 border border-[#334155] p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-bold text-white">Nomenclature des Pièces</h2>
                      <p className="text-xs text-[#94A3B8]">
                        {pieces.length} types de pièces • {pieces.reduce((s, p) => s + (p.quantity || 1), 0)} panneaux au total
                      </p>
                    </div>
                    <button
                      onClick={handleAddPiece}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold transition-all shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Ajouter une pièce
                    </button>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto max-h-[340px] overflow-y-auto rounded-xl border border-[#334155]">
                    <table className="w-full text-left text-xs text-[#CBD5E1]">
                      <thead className="sticky top-0 bg-[#0F172A] uppercase tracking-wider font-bold text-[#64748B] border-b border-[#334155]">
                        <tr>
                          <th className="p-3">Nom</th>
                          <th className="p-3 text-center">Longueur (cm)</th>
                          <th className="p-3 text-center">Largeur (cm)</th>
                          <th className="p-3 text-center">Qté</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#334155]/60 bg-[#1E293B]/40">
                        {pieces.map((p, idx) => (
                          <tr key={p.id || idx} className="hover:bg-[#1E293B]/80 transition-colors">
                            <td className="p-2.5">
                              <input
                                type="text"
                                value={p.name}
                                onChange={(e) => handleUpdatePiece(idx, 'name', e.target.value)}
                                className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-2.5 py-1 text-xs font-semibold text-white"
                              />
                            </td>
                            <td className="p-2.5 text-center">
                              <input
                                type="number"
                                value={p.width}
                                onChange={(e) => handleUpdatePiece(idx, 'width', Number(e.target.value))}
                                className="w-20 bg-[#0F172A] border border-[#334155] rounded-lg px-2 py-1 text-xs font-bold text-white text-center"
                              />
                            </td>
                            <td className="p-2.5 text-center">
                              <input
                                type="number"
                                value={p.height}
                                onChange={(e) => handleUpdatePiece(idx, 'height', Number(e.target.value))}
                                className="w-20 bg-[#0F172A] border border-[#334155] rounded-lg px-2 py-1 text-xs font-bold text-white text-center"
                              />
                            </td>
                            <td className="p-2.5 text-center">
                              <input
                                type="number"
                                value={p.quantity}
                                onChange={(e) => handleUpdatePiece(idx, 'quantity', Number(e.target.value))}
                                className="w-14 bg-[#0F172A] border border-[#334155] rounded-lg px-2 py-1 text-xs font-bold text-white text-center"
                              />
                            </td>
                            <td className="p-2.5 text-right">
                              <button
                                onClick={() => handleDeletePiece(idx)}
                                className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Optimize Action Button */}
                <div className="mt-6 pt-4 border-t border-[#334155] flex items-center justify-between">
                  <div className="text-xs text-[#94A3B8]">
                    Algorithme : <span className="font-bold text-sky-400">Guillotine 2D Optimisé</span>
                  </div>
                  <button
                    onClick={handleRunOptimization}
                    disabled={isOptimizing || pieces.length === 0}
                    className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#F5A623] to-[#EA580C] hover:from-[#EA580C] hover:to-[#C2410C] text-black font-extrabold text-sm tracking-wide shadow-lg shadow-orange-500/20 transition-all disabled:opacity-50"
                  >
                    {isOptimizing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Calcul du plan...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-black" />
                        GÉNÉRER LE PLAN DE DÉCOUPE
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* RESULTS & CUTTING PLAN VIEW */
          <div className="space-y-6">
            {/* Top Bar Summary */}
            {result && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-[#1E293B]/60 border border-[#334155]">
                  <p className="text-xs font-bold text-[#94A3B8]">FEUILLES UTILISÉES</p>
                  <p className="text-2xl font-black text-white mt-1">{result.sheetsUsed} Panneaux</p>
                </div>
                <div className="p-4 rounded-2xl bg-[#1E293B]/60 border border-[#334155]">
                  <p className="text-xs font-bold text-[#94A3B8]">TAUX DE CHUTE</p>
                  <p className="text-2xl font-black text-[#F5A623] mt-1">{result.wastePercentage}%</p>
                </div>
                <div className="p-4 rounded-2xl bg-[#1E293B]/60 border border-[#334155]">
                  <p className="text-xs font-bold text-[#94A3B8]">SURFACE UTILE</p>
                  <p className="text-2xl font-black text-emerald-400 mt-1">
                    {(100 - result.wastePercentage).toFixed(1)}%
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-[#1E293B]/60 border border-[#334155]">
                  <p className="text-xs font-bold text-[#94A3B8]">TOTAL PIÈCES</p>
                  <p className="text-2xl font-black text-sky-400 mt-1">{result.placedPieces.length} Découpes</p>
                </div>
              </div>
            )}

            {/* Canvas SVG Cutting Diagram + Legend */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Interactive SVG Diagram Viewport */}
              <div className="lg:col-span-8 rounded-2xl bg-[#1E293B]/60 border border-[#334155] p-6 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveSheetIndex(Math.max(0, activeSheetIndex - 1))}
                      disabled={activeSheetIndex === 0}
                      className="p-2 rounded-lg bg-[#0F172A] border border-[#334155] text-white disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-white px-2">
                      Panneau {activeSheetIndex + 1} / {result?.sheetsUsed || 1}
                    </span>
                    <button
                      onClick={() =>
                        setActiveSheetIndex(Math.min((result?.sheetsUsed || 1) - 1, activeSheetIndex + 1))
                      }
                      disabled={activeSheetIndex >= (result?.sheetsUsed || 1) - 1}
                      className="p-2 rounded-lg bg-[#0F172A] border border-[#334155] text-white disabled:opacity-40"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Zoom controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setZoomLevel(Math.max(0.6, zoomLevel - 0.15))}
                      className="p-2 rounded-lg bg-[#0F172A] border border-[#334155] text-white"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-bold text-[#94A3B8] w-12 text-center">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <button
                      onClick={() => setZoomLevel(Math.min(1.8, zoomLevel + 0.15))}
                      className="p-2 rounded-lg bg-[#0F172A] border border-[#334155] text-white"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* SVG Visual Container */}
                <div className="flex-1 min-h-[420px] rounded-xl bg-[#0B1120] border border-[#334155] p-6 flex items-center justify-center overflow-auto">
                  {result && (
                    <div
                      style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                      className="transition-transform duration-200 shadow-2xl rounded-lg overflow-hidden border-4 border-[#334155]"
                    >
                      <svg
                        width={sheet.width * 2.6}
                        height={sheet.height * 2.6}
                        viewBox={`0 0 ${sheet.width} ${sheet.height}`}
                        className="bg-[#1E293B]"
                      >
                        {/* Background Sheet Grid */}
                        <rect
                          x="0"
                          y="0"
                          width={sheet.width}
                          height={sheet.height}
                          fill="#1E293B"
                          stroke="#475569"
                          strokeWidth="0.5"
                        />

                        {/* Placed Pieces for current Sheet */}
                        {result.sheets[activeSheetIndex]?.pieces.map((piece, i) => {
                          const color = PIECE_COLORS[(piece.pieceNumber - 1) % PIECE_COLORS.length];
                          return (
                            <g key={i}>
                              <rect
                                x={piece.x}
                                y={piece.y}
                                width={piece.width}
                                height={piece.height}
                                fill={color}
                                fillOpacity="0.85"
                                stroke="#0F172A"
                                strokeWidth="0.6"
                                rx="1"
                              />
                              <text
                                x={piece.x + piece.width / 2}
                                y={piece.y + piece.height / 2 - 2}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="#000000"
                                fontSize={Math.min(12, Math.max(6, piece.height / 3.5))}
                                fontWeight="900"
                              >
                                #{piece.pieceNumber}
                              </text>
                              <text
                                x={piece.x + piece.width / 2}
                                y={piece.y + piece.height / 2 + 8}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="#000000"
                                fontSize={Math.min(8, Math.max(4, piece.height / 5))}
                                fontWeight="bold"
                              >
                                {piece.width}×{piece.height}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {/* Pieces Breakdown & Export Panel */}
              <div className="lg:col-span-4 rounded-2xl bg-[#1E293B]/60 border border-[#334155] p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-white mb-3">Détail des Pièces du Panneau</h3>
                  <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                    {result?.sheets[activeSheetIndex]?.pieces.map((p, idx) => {
                      const color = PIECE_COLORS[(p.pieceNumber - 1) % PIECE_COLORS.length];
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-2.5 rounded-xl bg-[#0F172A] border border-[#334155]"
                        >
                          <div
                            style={{ backgroundColor: color }}
                            className="w-7 h-7 rounded-lg text-black font-black text-xs flex items-center justify-center shrink-0"
                          >
                            {p.pieceNumber}
                          </div>
                          <div className="flex-1 truncate">
                            <p className="text-xs font-bold text-white truncate">{p.name}</p>
                            <p className="text-[11px] text-[#94A3B8]">
                              {p.width} × {p.height} cm {p.rotated && '• (Tourné)'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Export Options */}
                <div className="mt-6 pt-4 border-t border-[#334155] space-y-2.5">
                  <button
                    onClick={handleDownloadPdf}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#F5A623] hover:bg-[#D97706] text-black font-extrabold text-xs tracking-wide shadow-md transition-all"
                  >
                    <Download className="w-4 h-4" />
                    TÉLÉCHARGER LE PLAN PDF COMPLET (A4)
                  </button>
                  <button
                    onClick={() => setStep('capture')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#475569] hover:bg-[#334155] text-[#CBD5E1] font-bold text-xs transition-all"
                  >
                    <Layers className="w-4 h-4" />
                    Modifier les cotes & recalculer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
