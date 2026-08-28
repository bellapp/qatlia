'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Layers,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Zap,
  AlertTriangle,
  Camera,
  Image as ImageIcon,
  History,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  FileCode2,
  FileText,
  TrendingUp,
  Scissors,
} from 'lucide-react';
import {
  Sheet,
  Piece,
  OptimizationResult,
  OptimizationOptions,
  OPTIONS_DEFAULTS,
  MaterialType,
} from '@/lib/cutting/binpacking';
import { OptionsPanel } from '@/components/OptionsPanel';
import { PiecesManager } from '@/components/PiecesManager';
import { AuthModal } from '@/components/AuthModal';
import { AccountMenu } from '@/components/AccountMenu';
import { writeLocalHistoryItem, type LocalHistoryItem } from '@/lib/history';

const DEFAULT_SHEET: Sheet = {
  height: 278,
  width: 208,
  kerf: 0.3,
  margin: 1.0,
  grainDirection: false,
  material: 'mdf',
};

const INITIAL_PIECES: Piece[] = [
  { id: '1', name: 'Panneau Latéral G', height: 230, width: 120, quantity: 2, material: 'mdf', rotatable: true },
  { id: '2', name: 'Panneau Latéral D', height: 118, width: 48, quantity: 1, material: 'mdf', rotatable: true },
  { id: '3', name: 'Étagère Mobile', height: 41.8, width: 38, quantity: 7, material: 'mdf', rotatable: true },
  { id: '4', name: 'Séparation Centrale', height: 53.1, width: 48, quantity: 4, material: 'mdf', rotatable: true },
  { id: '5', name: 'Socle Bas', height: 51.3, width: 48, quantity: 2, material: 'mdf', rotatable: true },
];

export default function Dashboard() {
  const [sheet, setSheet] = useState<Sheet>(DEFAULT_SHEET);
  const [pieces, setPieces] = useState<Piece[]>(INITIAL_PIECES);
  const [options, setOptions] = useState<OptimizationOptions>(OPTIONS_DEFAULTS);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isProcessingVision, setIsProcessingVision] = useState(false);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [userCredits, setUserCredits] = useState<number>(5);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);

  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserEmail(user.email || null);
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('credits')
              .eq('id', user.id)
              .single();
            if (profile) setUserCredits(profile.credits);
          } catch {
            /* table profiles pas encore créée — crédits en local */
          }
        }
      } catch (err) {
        console.error('Erreur profil:', err);
      }
    }
    loadUser();

    if (typeof window !== 'undefined') {
      const savedProj = sessionStorage.getItem('qatlia_saved_project');
      if (savedProj) {
        try {
          const parsed = JSON.parse(savedProj);
          if (parsed.sheet) setSheet(parsed.sheet);
          if (Array.isArray(parsed.pieces)) setPieces(parsed.pieces);
          if (parsed.options) setOptions((prev) => ({ ...prev, ...parsed.options }));
          sessionStorage.removeItem('qatlia_saved_project');
        } catch (e) {
          console.error('Erreur restauration projet:', e);
        }
      }
    }
  }, []);

  const handleOptionsChange = (newOpts: OptimizationOptions) => {
    setOptions(newOpts);
    setSheet((prev) => ({
      ...prev,
      kerf: newOpts.kerfWidth / 10,
      grainDirection: newOpts.grainDirection,
    }));
  };

  const persistProject = async (
    nextResult: OptimizationResult,
    source: 'optimize' | 'pdf'
  ) => {
    const payload = {
      name: `Débit ${(sheet.material || 'MDF').toUpperCase()} — ${pieces.reduce((s, p) => s + (p.quantity || 1), 0)} pcs`,
      sheet,
      pieces,
      options,
      result: nextResult,
    };

    writeLocalHistoryItem({
      id: `${source}_${Date.now()}`,
      name: payload.name,
      material: sheet.material || 'mdf',
      sheet_width: sheet.width,
      sheet_height: sheet.height,
      kerf: sheet.kerf,
      grain_direction: !!sheet.grainDirection,
      status: 'optimized',
      created_at: new Date().toISOString(),
      options_json: payload as unknown as LocalHistoryItem['options_json'],
    });

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('Erreur auto-save projet:', err);
    }
  };

  const handleRunOptimization = async () => {
    setIsOptimizing(true);
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet,
          pieces,
          options,
        }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setResult(data.result);
        setActiveSheetIndex(0);
        void persistProject(data.result, 'optimize');
      }
    } catch (err) {
      console.error('Erreur optimisation:', err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingVision(true);
    setVisionError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            sheetMaterial: sheet.material || 'mdf',
          }),
        });

        const data = await res.json();
        if (data.success && Array.isArray(data.pieces) && data.pieces.length > 0) {
          setPreviewImage(base64);
          const newPieces: Piece[] = data.pieces.map((p: { name?: string; width?: number | string; height?: number | string; quantity?: number | string; material?: string }, i: number) => {
            let h = Number(p.height) || 10;
            let w = Number(p.width) || 10;
            if (h > 500 || w > 500) {
              h = h / 10;
              w = w / 10;
            }
            return {
              id: `ext_${Date.now()}_${i}`,
              name: p.name || `Pièce ${i + 1}`,
              height: Math.round(h * 10) / 10,
              width: Math.round(w * 10) / 10,
              quantity: Number(p.quantity) || 1,
              material: (p.material as MaterialType) || (sheet.material || 'mdf'),
              rotatable: true,
            };
          });
          setPieces(newPieces);
        } else {
          setVisionError(data.message || 'Aucune mesure détectée dans l\'image.');
        }
      } catch (err) {
        setVisionError('Erreur réseau lors de l\'analyse de l\'image.');
        console.error(err);
      } finally {
        setIsProcessingVision(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadDxf = async () => {
    if (!result) return;
    try {
      const res = await fetch('/api/export-dxf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'QatlIA_CNC_Plan',
          sheet: {
            width: sheet.width,
            height: sheet.height,
          },
          placedPieces: result.placedPieces,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qatlia_cnc_${Date.now()}.dxf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Erreur DXF:', err);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result) return;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    setIsDownloadingPdf(true);
    try {
      // 1. Déduire 1 crédit si configuré
      try {
        const consumeRes = await fetch('/api/credits/consume', {
          method: 'POST',
        });
        const consumeData = await consumeRes.json();
        if (consumeData.creditsRemaining !== undefined) {
          setUserCredits(consumeData.creditsRemaining);
          try {
            const key = 'qatlia_credit_tx_v1';
            const prev = JSON.parse(localStorage.getItem(key) || '[]');
            const next = [
              {
                id: `tx_${Date.now()}`,
                type: 'usage',
                amount: -1,
                balance_after: consumeData.creditsRemaining,
                description: 'Export rapport PDF',
                created_at: new Date().toISOString(),
              },
              ...(Array.isArray(prev) ? prev : []),
            ].slice(0, 50);
            localStorage.setItem(key, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        console.warn('Crédit consume warning:', e);
      }

      // 2. Générer le PDF
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'Plan Découpe QatlIA',
          sheet: {
            width: sheet.width,
            height: sheet.height,
            material: sheet.material || 'mdf',
          },
          pieces,
          result,
        }),
      });

      if (res.ok) {
        await persistProject(result, 'pdf');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qatlia_rapport_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Erreur téléchargement PDF:', err);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const currentSheet = result?.sheets[activeSheetIndex] || (result ? {
    index: 0,
    material: sheet.material || 'mdf',
    width: sheet.width,
    height: sheet.height,
    pieces: result.placedPieces.filter((p) => p.sheetIndex === activeSheetIndex),
    offcuts: result.offcuts.filter((o) => o.sheetIndex === activeSheetIndex),
    wasteRate: result.wastePercentage,
    usedArea: result.totalAreaUsed,
  } : null);

  return (
    <div className="min-h-screen bg-[#070C18] text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-black">
      {/* Top Navbar Studio */}
      <header className="sticky top-0 z-40 bg-[#070C18]/90 backdrop-blur-xl border-b border-slate-800/80 px-4 sm:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center text-slate-950 font-black text-lg shadow-md shadow-amber-500/20">
              Q
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-white">QatlIA</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
                  PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">Atelier de Découpe & Calepinage Industriel</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/history"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-800 transition-colors"
            >
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Historique</span>
            </Link>

            <Link
              href="/credits"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-colors"
            >
              <Zap className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="font-mono font-bold">{userCredits}</span>
              <span className="text-[10px] opacity-80 hidden sm:inline">crédits</span>
            </Link>

            {userEmail ? (
              <AccountMenu email={userEmail} />
            ) : (
              <Link
                href="/auth/login"
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-xs transition-colors shadow-sm"
              >
                Connexion
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT COLUMN: Controls & Input Studio (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Quick Actions Header: Camera & Import */}
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 hover:border-sky-500/50 cursor-pointer group transition-all">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleImageUpload}
                  disabled={isProcessingVision}
                />
                <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform shrink-0">
                  <Camera className="w-4 h-4" />
                </div>
                <div className="overflow-hidden">
                  <span className="text-xs font-bold text-slate-200 block truncate">Prendre photo</span>
                  <span className="text-[10px] text-slate-500 block truncate">Scan manuscrit IA</span>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-slate-800 hover:border-amber-500/50 cursor-pointer group transition-all">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                  disabled={isProcessingVision}
                />
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform shrink-0">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div className="overflow-hidden">
                  <span className="text-xs font-bold text-slate-200 block truncate">Importer image</span>
                  <span className="text-[10px] text-slate-500 block truncate">Galerie / Fichier</span>
                </div>
              </label>
            </div>

            {/* Preview scan if present */}
            {previewImage && (
              <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-900/60 border border-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewImage} alt="Scan preview" className="w-10 h-10 object-cover rounded-lg border border-slate-700" />
                <div className="text-xs">
                  <span className="text-emerald-400 font-bold block">Fiche manuscrite analysée</span>
                  <span className="text-[10px] text-slate-400">{pieces.length} cotes chargées</span>
                </div>
              </div>
            )}

            {/* Processing Banner */}
            {isProcessingVision && (
              <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center gap-3 text-sky-300 text-xs font-medium animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                <span>Analyse intelligente des mesures en cours...</span>
              </div>
            )}

            {visionError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{visionError}</span>
              </div>
            )}

            {/* Stock Panel Dimensions (Compact Card) */}
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/90 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Panneau Brut en Stock
                  </h2>
                </div>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                  Unité : cm
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Hauteur (Y)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={sheet.height}
                    onChange={(e) => setSheet({ ...sheet, height: parseFloat(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono font-bold text-right outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Largeur (X)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={sheet.width}
                    onChange={(e) => setSheet({ ...sheet, width: parseFloat(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono font-bold text-right outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Matériau</label>
                  <select
                    value={sheet.material || 'mdf'}
                    onChange={(e) => setSheet({ ...sheet, material: e.target.value as MaterialType })}
                    className="w-full px-2 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none focus:border-amber-500/50"
                  >
                    <option value="mdf">MDF / Bois</option>
                    <option value="aluminium">Aluminium</option>
                    <option value="verre">Verre</option>
                    <option value="contreplaques">Contreplaqué</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Pieces Manager Component */}
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/90 shadow-sm">
              <PiecesManager
                pieces={pieces}
                onUpdatePieces={setPieces}
                defaultMaterial={sheet.material || 'mdf'}
                showMaterialCol={options.considerMaterial}
                disabled={isOptimizing}
              />
            </div>

            {/* Collapsible Advanced Options */}
            <div className="rounded-2xl bg-slate-900/40 border border-slate-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="w-full p-3.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                  <span>Options avancées de coupe & Kerf</span>
                </div>
                {showAdvancedOptions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvancedOptions && (
                <div className="p-4 pt-0 border-t border-slate-800/60 animate-in fade-in duration-150">
                  <OptionsPanel
                    options={options}
                    onChange={handleOptionsChange}
                    disabled={isOptimizing}
                  />
                </div>
              )}
            </div>

            {/* Primary CTA Button */}
            <button
              onClick={handleRunOptimization}
              disabled={isOptimizing || pieces.length === 0}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:opacity-95 text-slate-950 font-black text-sm tracking-wider uppercase shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer active:scale-[0.99]"
            >
              {isOptimizing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Calcul d&apos;optimisation...</span>
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  <span>Générer le plan de débit</span>
                </>
              )}
            </button>
          </div>

          {/* RIGHT COLUMN: Visual Studio & Results (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            
            {result ? (
              <>
                {/* Financial Gain Banner */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-slate-900/80 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3 shadow-md">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold shrink-0">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        Gain Économique Estimé (Débit Optimisé)
                      </span>
                      <p className="text-xl font-black text-white">
                        + {result.moneySavedMad?.toLocaleString('fr-FR') || 0} MAD Économisés
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400">Linéaire de coupe</span>
                    <p className="text-xs font-mono font-bold text-slate-200">{result.totalLinearCutMeters || 0} m de passes</p>
                  </div>
                </div>

                {/* Performance Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-medium block">Feuilles requises</span>
                    <p className="text-xl font-black text-white font-mono mt-0.5">{result.sheetsUsed}</p>
                    <span className="text-[10px] text-slate-500">{sheet.height} × {sheet.width} cm</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-medium block">Surface utile</span>
                    <p className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                      {(100 - result.wastePercentage).toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-emerald-500/80">Efficacité de coupe</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-medium block">Taux de chute</span>
                    <p className="text-xl font-black text-amber-400 font-mono mt-0.5">
                      {result.wastePercentage.toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-amber-500/80">Chute résiduelle</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-medium block">Pièces placées</span>
                    <p className="text-xl font-black text-sky-400 font-mono mt-0.5">
                      {result.placedPieces.length} pcs
                    </p>
                    <span className="text-[10px] text-sky-400/80">100% complété</span>
                  </div>
                </div>

                {/* 2D Visualizer Canvas Studio */}
                <div className="rounded-3xl bg-slate-900/70 border border-slate-800/90 p-5 shadow-lg space-y-4">
                  {/* Canvas Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                        Schéma de Coupe — Panneau {activeSheetIndex + 1} / {result.sheetsUsed}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      {result.sheetsUsed > 1 && (
                        <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5">
                          <button
                            onClick={() => setActiveSheetIndex(Math.max(0, activeSheetIndex - 1))}
                            disabled={activeSheetIndex === 0}
                            className="p-1 rounded-lg hover:bg-slate-800 text-white disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="text-xs font-mono font-bold px-2 text-slate-300">
                            {activeSheetIndex + 1} / {result.sheetsUsed}
                          </span>
                          <button
                            onClick={() => setActiveSheetIndex(Math.min(result.sheetsUsed - 1, activeSheetIndex + 1))}
                            disabled={activeSheetIndex === result.sheetsUsed - 1}
                            className="p-1 rounded-lg hover:bg-slate-800 text-white disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5 text-slate-300">
                        <button
                          onClick={() => setZoomLevel(Math.max(0.6, zoomLevel - 0.2))}
                          className="p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </button>
                        <span className="text-[10px] font-mono px-1.5">{Math.round(zoomLevel * 100)}%</span>
                        <button
                          onClick={() => setZoomLevel(Math.min(2.5, zoomLevel + 0.2))}
                          className="p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SVG Drawing Canvas */}
                  <div className="w-full rounded-2xl bg-[#040812] border border-slate-800/80 p-4 flex items-center justify-center min-h-[420px] overflow-auto">
                    <div
                      style={{
                        transform: `scale(${zoomLevel})`,
                        transformOrigin: 'center center',
                        transition: 'transform 0.15s ease',
                      }}
                      className="flex flex-col items-center"
                    >
                      <svg
                        viewBox={`0 0 ${sheet.width} ${sheet.height}`}
                        className="w-full max-w-[460px] max-h-[580px] aspect-[208/278] bg-slate-950 rounded-lg shadow-2xl border-2 border-slate-700"
                      >
                        {/* Fond Panneau */}
                        <rect x="0" y="0" width={sheet.width} height={sheet.height} fill="#0B132B" stroke="#334155" strokeWidth="0.5" />

                        {/* Chutes Réutilisables Grisées avec Bordure */}
                        {result.offcuts && result.offcuts
                          .filter((o) => o.sheetIndex === activeSheetIndex)
                          .map((off, oIdx) => {
                            const dispH = Math.round(off.height * 10) / 10;
                            const dispW = Math.round(off.width * 10) / 10;

                            return (
                              <g key={`off_${oIdx}`}>
                                <rect
                                  x={off.x}
                                  y={off.y}
                                  width={off.width}
                                  height={off.height}
                                  fill="#162238"
                                  stroke="#0A0F1D"
                                  strokeWidth={0.4}
                                  opacity="0.95"
                                />
                                {off.width >= 10 && off.height >= 7 && (
                                  <text
                                    x={off.x + off.width / 2}
                                    y={off.y + off.height / 2}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fill="#7E8FA6"
                                    fontSize={Math.min(5, Math.max(2, Math.min(off.width, off.height) / 10))}
                                    fontStyle="normal"
                                    fontFamily="sans-serif"
                                  >
                                    {dispH} × {dispW} cm
                                  </text>
                                )}
                              </g>
                            );
                          })}

                        {/* Pièces Placée Utiles */}
                        {result.placedPieces
                          .filter((p) => p.sheetIndex === activeSheetIndex)
                          .map((p) => {
                            const colors = [
                              '#F59E0B', '#38BDF8', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6', '#6366F1'
                            ];
                            const color = colors[(p.pieceNumber - 1) % colors.length];
                            const dispH = Math.round(p.height * 10) / 10;
                            const dispW = Math.round(p.width * 10) / 10;
                            const minSide = Math.min(p.width, p.height);

                            return (
                              <g key={`${p.sheetIndex}_${p.pieceNumber}`}>
                                <rect
                                  x={p.x}
                                  y={p.y}
                                  width={p.width}
                                  height={p.height}
                                  fill={color}
                                  stroke="#070C18"
                                  strokeWidth={Math.max(0.3, options.kerfWidth / 10)}
                                  rx={0.5}
                                />
                                {options.showLabels && (
                                  <>
                                    <text
                                      x={p.x + p.width / 2}
                                      y={p.y + p.height / 2 - (p.height >= 25 ? 3 : 0)}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      fill="#000000"
                                      fontSize={Math.min(6, Math.max(2.2, minSide / 10))}
                                      fontWeight="bold"
                                      fontFamily="sans-serif"
                                    >
                                      #{p.pieceNumber} {p.name && minSide >= 30 ? `• ${p.name}` : ''}
                                    </text>
                                    {p.height >= 12 && p.width >= 12 && (
                                      <text
                                        x={p.x + p.width / 2}
                                        y={p.y + p.height / 2 + (p.height >= 25 ? 3.5 : 0)}
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        fill="#000000"
                                        fontSize={Math.min(5, Math.max(1.8, minSide / 12))}
                                        fontWeight="bold"
                                        fontFamily="monospace"
                                      >
                                        {dispH} × {dispW} cm
                                      </text>
                                    )}
                                  </>
                                )}
                              </g>
                            );
                          })}
                      </svg>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <span className="text-xs text-slate-400">
                      Chute panneau : <strong className="text-amber-400">{currentSheet?.wasteRate || 0}%</strong>
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleDownloadDxf}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-800 transition-colors cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
                        <span>DXF (CNC)</span>
                      </button>

                      <button
                        onClick={handleDownloadPdf}
                        disabled={isDownloadingPdf}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-bold text-xs tracking-wide shadow-lg shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isDownloadingPdf ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        <span>{isDownloadingPdf ? 'GÉNÉRATION DU PDF...' : 'RAPPORT PDF QATLIA'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Current Sheet Breakdown Cards */}
                {currentSheet && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Pieces on Sheet */}
                    <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/90 space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                        Pièces du Panneau ({currentSheet.pieces.length})
                      </span>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {currentSheet.pieces.map((p) => (
                          <div key={p.pieceNumber} className="p-2 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 truncate">
                              <span className="font-bold text-amber-400 font-mono">#{p.pieceNumber}</span>
                              <span className="text-slate-200 truncate">{p.name}</span>
                            </div>
                            <span className="font-mono text-slate-400 shrink-0">{Math.round(p.height * 10) / 10} × {Math.round(p.width * 10) / 10} cm</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Offcuts on Sheet */}
                    <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/90 space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                        Chutes Réutilisables ({currentSheet.offcuts.length})
                      </span>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {currentSheet.offcuts.map((off, idx) => (
                          <div key={idx} className="p-2 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-mono text-[11px]">Chute #{idx + 1}</span>
                            <span className="font-mono text-amber-400 font-bold">{Math.round(off.height * 10) / 10} × {Math.round(off.width * 10) / 10} cm</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Empty State Preview */
              <div className="p-12 rounded-3xl bg-slate-900/40 border border-dashed border-slate-800 text-center flex flex-col items-center justify-center gap-3 min-h-[460px]">
                <div className="w-14 h-14 rounded-2xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-center text-slate-400 mb-1">
                  <Scissors className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-sm font-bold text-slate-200">Prêt pour l&apos;optimisation</h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  Renseignez vos dimensions dans la liste ou scannez une fiche manuscrite, puis lancez le calcul pour visualiser le plan de coupe 2D.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          setIsAuthModalOpen(false);
          const supabase = createClient();
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) {
              setUserEmail(user.email || null);
              handleDownloadPdf();
            }
          });
        }}
      />
    </div>
  );
}
