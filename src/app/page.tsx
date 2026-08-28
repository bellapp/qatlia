'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Layers,
  Sparkles,
  Play,
  RefreshCw,
  Download,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Zap,
  AlertTriangle,
  Info,
  Camera,
  Image as ImageIcon,
  History,
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

const DEFAULT_SHEET: Sheet = {
  height: 278, // Hauteur panneau brut vertical en cm
  width: 208,  // Largeur panneau brut horizontal en cm
  kerf: 0.3,   // cm (3mm)
  margin: 1.0, // cm
  grainDirection: false,
  material: 'mdf',
};

const INITIAL_PIECES: Piece[] = [
  { id: '1', name: 'Pièce 1', height: 230, width: 120, quantity: 2, material: 'mdf', rotatable: true },
  { id: '2', name: 'Pièce 2', height: 118, width: 48, quantity: 1, material: 'mdf', rotatable: true },
  { id: '3', name: 'Pièce 3', height: 41.8, width: 38, quantity: 7, material: 'mdf', rotatable: true },
  { id: '4', name: 'Pièce 4', height: 53.1, width: 48, quantity: 4, material: 'mdf', rotatable: true },
  { id: '5', name: 'Pièce 5', height: 51.3, width: 48, quantity: 2, material: 'mdf', rotatable: true },
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

  // Sync Supabase User & Credits + Restore saved project from history if present
  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserEmail(user.email || null);
          const { data: profile } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', user.id)
            .single();
          if (profile) {
            setUserCredits(profile.credits);
          }
        }
      } catch (err) {
        console.error('Erreur chargement profil Supabase:', err);
      }
    }
    loadUser();

    // Vérifier si un projet a été chargé depuis la page Historique
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

  // Sync options.kerfWidth and options.grainDirection with sheet
  const handleOptionsChange = (newOpts: OptimizationOptions) => {
    setOptions(newOpts);
    setSheet((prev) => ({
      ...prev,
      kerf: newOpts.kerfWidth / 10,
      grainDirection: newOpts.grainDirection,
    }));
  };

  // Run Optimization
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
      }
    } catch (err) {
      console.error('Erreur optimisation:', err);
    } finally {
      setIsOptimizing(false);
    }
  };

  // Vision IA Upload handler
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
          // Normalisation universelle vers le CENTIMÈTRE (cm)
          const newPieces: Piece[] = data.pieces.map((p: { name?: string; width?: number | string; height?: number | string; quantity?: number | string; material?: string }, i: number) => {
            let h = Number(p.height) || 10;
            let w = Number(p.width) || 10;
            // Si l'extraction donne des mm manifestes (> 500), convertir en cm
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
      } else {
        alert('Erreur lors de la génération du fichier DXF.');
      }
    } catch (err) {
      console.error('Erreur DXF:', err);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result) return;

    // 1. Vérifier si l'utilisateur est connecté
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      // Ouvrir la modale d'inscription / connexion avec Google ou Email (+ 5 crédits offerts)
      setIsAuthModalOpen(true);
      return;
    }

    // 2. Vérifier et déduire 1 crédit
    setIsDownloadingPdf(true);
    try {
      const consumeRes = await fetch('/api/credits/consume', {
        method: 'POST',
      });
      const consumeData = await consumeRes.json();

      if (!consumeRes.ok) {
        if (consumeRes.status === 402 || consumeData.error === 'INSUFFICIENT_CREDITS') {
          // Solde épuisé : Redirection vers la page d'achat de crédits Stripe
          alert('Votre solde de crédits est épuisé (0 crédit restant). Rechargez vos crédits pour télécharger le rapport PDF complet.');
          window.location.href = '/credits';
          return;
        } else if (consumeRes.status === 401) {
          setIsAuthModalOpen(true);
          return;
        }
      } else if (consumeData.creditsRemaining !== undefined) {
        setUserCredits(consumeData.creditsRemaining);
      }

      // 3. Télécharger le PDF
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
        // Sauvegarder automatiquement le projet dans l'historique de l'utilisateur
        fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Débit ${sheet.material?.toUpperCase() || 'MDF'} (${pieces.length} pièces)`,
            sheet,
            pieces,
            options,
            result,
          }),
        }).catch((err) => console.error('Erreur auto-save projet:', err));

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qatlia_rapport_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        window.print();
      }
    } catch (err) {
      console.error('Erreur téléchargement PDF:', err);
      window.print();
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

  const getMaterialBadge = (mat?: MaterialType | null) => {
    switch (mat) {
      case 'aluminium':
        return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-300 border border-slate-500/30">Aluminium</span>;
      case 'verre':
        return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">Verre</span>;
      case 'contreplaques':
        return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-300 border border-amber-600/30">Contreplaqué</span>;
      default:
        return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">MDF</span>;
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F1F5F9] font-sans antialiased selection:bg-amber-500 selection:text-black pb-16">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-[#0F172A]/90 backdrop-blur-md border-b border-[#334155]/60 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/20">
              Q
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-lg text-white tracking-tight">QatlIA</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">
                  PRO 2026
                </span>
              </div>
              <p className="text-[11px] text-[#94A3B8]">Optimisation de découpe de panneaux & Débit IA</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/history"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1E293B] hover:bg-[#283548] border border-[#334155] text-xs font-bold text-slate-200 transition-all"
              title="Historique de mes débits"
            >
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Historique</span>
            </Link>

            <Link
              href="/credits"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B] hover:bg-[#283548] border border-[#334155] transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span className="text-xs font-bold text-white font-mono">{userCredits}</span>
              <span className="text-[11px] text-[#94A3B8] hidden sm:inline">crédits IA</span>
            </Link>

            {userEmail ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B] border border-[#334155]">
                <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                <span className="text-xs text-slate-200 font-medium truncate max-w-[120px]">{userEmail}</span>
              </div>
            ) : (
              <Link
                href="/auth/login"
                className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors"
              >
                Connexion
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* LEFT COLUMN: Input Forms, AI Vision & Pieces Manager (5 cols) */}
          <div className="lg:col-span-5 space-y-5">

            {/* Options Panel Component */}
            <OptionsPanel
              options={options}
              onChange={handleOptionsChange}
              disabled={isOptimizing}
            />

            {/* Sheet Dimensions Input (Unité : cm) */}
            <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Dimensions du Panneau Brut
                  </h2>
                </div>
                <span className="text-xs text-amber-400 font-mono font-bold">Unité : cm</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="sheetHeightInput" className="block text-[#94A3B8] font-medium mb-1">Hauteur (Y cm)</label>
                  <input
                    id="sheetHeightInput"
                    type="number"
                    step="0.1"
                    value={sheet.height}
                    onChange={(e) => setSheet({ ...sheet, height: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-white font-mono font-bold focus:border-amber-400 outline-none text-right"
                  />
                </div>
                <div>
                  <label htmlFor="sheetWidthInput" className="block text-[#94A3B8] font-medium mb-1">Largeur (X cm)</label>
                  <input
                    id="sheetWidthInput"
                    type="number"
                    step="0.1"
                    value={sheet.width}
                    onChange={(e) => setSheet({ ...sheet, width: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-white font-mono font-bold focus:border-amber-400 outline-none text-right"
                  />
                </div>
                <div>
                  <label htmlFor="sheetMaterialSelect" className="block text-[#94A3B8] font-medium mb-1">Matériau</label>
                  <select
                    id="sheetMaterialSelect"
                    value={sheet.material || 'mdf'}
                    onChange={(e) => setSheet({ ...sheet, material: e.target.value as MaterialType })}
                    className="w-full px-2.5 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-white text-xs outline-none focus:border-amber-400"
                  >
                    <option value="mdf">MDF / Bois</option>
                    <option value="aluminium">Aluminium</option>
                    <option value="verre">Verre</option>
                    <option value="contreplaques">Contreplaqué</option>
                  </select>
                </div>
              </div>
            </div>

            {/* AI Vision Card */}
            <div className="rounded-2xl bg-gradient-to-b from-[#1E293B] to-[#1E293B]/70 border border-sky-500/30 p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Capture Photo & Débit IA
                  </h2>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  Vision IA
                </span>
              </div>

              <p className="text-xs text-[#94A3B8] mb-4">
                Photographiez votre carnet de mesures ou importez un fichier depuis votre galerie/ordinateur. L&apos;IA extrait automatiquement les cotes.
              </p>

              {isProcessingVision ? (
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-sky-500/40 rounded-xl p-6 bg-sky-950/20 text-center">
                  <RefreshCw className="w-6 h-6 text-sky-400 animate-spin mb-2" />
                  <span className="text-xs font-bold text-sky-400">Analyse de l&apos;image en cours par Vision IA...</span>
                  <span className="text-[10px] text-[#94A3B8] mt-1">Extraction des hauteurs, largeurs et quantités</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Bouton 1 : Prendre une photo directe (Caméra Mobile) */}
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-sky-500/40 hover:border-sky-400 rounded-xl p-4 cursor-pointer bg-sky-950/20 hover:bg-sky-900/30 transition-all text-center group">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={isProcessingVision}
                    />
                    <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform mb-2">
                      <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-white">Prendre une photo</span>
                    <span className="text-[10px] text-sky-300/80 mt-0.5">Ouvre l&apos;appareil photo</span>
                  </label>

                  {/* Bouton 2 : Charger depuis Galerie / Fichiers */}
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#334155] hover:border-amber-400/60 rounded-xl p-4 cursor-pointer bg-[#0F172A] hover:bg-[#1E293B] transition-all text-center group">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/jpg"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={isProcessingVision}
                    />
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform mb-2">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-white">Charger une image</span>
                    <span className="text-[10px] text-[#94A3B8] mt-0.5">Galerie, PDF ou fichier</span>
                  </label>
                </div>
              )}

              {visionError && (
                <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{visionError}</span>
                </div>
              )}

              {previewImage && (
                <div className="mt-3 flex items-center gap-3 p-2 rounded-xl bg-[#0F172A] border border-[#334155]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewImage} alt="Scan preview" className="w-12 h-12 object-cover rounded-lg border border-[#334155]" />
                  <div className="text-xs">
                    <p className="text-emerald-400 font-bold">Extraction réussie</p>
                    <p className="text-[11px] text-[#94A3B8]">{pieces.length} pièces chargées dans la liste</p>
                  </div>
                </div>
              )}
            </div>

            {/* Pieces Manager Input (Unité : cm) */}
            <PiecesManager
              pieces={pieces}
              onUpdatePieces={setPieces}
              defaultMaterial={sheet.material || 'mdf'}
              showMaterialCol={options.considerMaterial}
              disabled={isOptimizing}
            />

            {/* Run Button */}
            <button
              onClick={handleRunOptimization}
              disabled={isOptimizing || pieces.length === 0}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm tracking-wider uppercase shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isOptimizing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Calcul d&apos;optimisation en cours...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>Générer le plan de découpe optimal</span>
                </>
              )}
            </button>
          </div>

          {/* RIGHT COLUMN: Interactive 2D Visualizer & Results (7 cols) */}
          <div className="lg:col-span-7 space-y-6">

            {/* Results Summary Bar */}
            {result && (
              <>
                {/* Banner Gain Économique Réalisé (MAD) */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-[#1E293B] to-[#1E293B] border border-emerald-500/30 shadow-lg flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
                      MAD
                    </div>
                    <div>
                      <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                        Gain Économique Estimé Après Optimisation QatlIA
                      </span>
                      <p className="text-xl font-black text-white">
                        + {result.moneySavedMad?.toLocaleString('fr-FR') || 0} MAD Économisés
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#94A3B8]">Linéaire de coupe</span>
                    <p className="text-xs font-mono font-bold text-slate-200">{result.totalLinearCutMeters || 0} m de passes</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-2xl bg-[#1E293B] border border-[#334155] shadow-lg">
                    <span className="text-[11px] text-[#94A3B8] uppercase font-bold">Feuilles Requises</span>
                    <p className="text-2xl font-black text-white font-mono mt-1">{result.sheetsUsed}</p>
                    <span className="text-[10px] text-amber-400 font-mono font-bold">{sheet.height} × {sheet.width} cm</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#1E293B] border border-[#334155] shadow-lg">
                    <span className="text-[11px] text-[#94A3B8] uppercase font-bold">Surface Utile</span>
                    <p className="text-2xl font-black text-emerald-400 font-mono mt-1">
                      {(100 - result.wastePercentage).toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-emerald-500/80">Efficacité de coupe</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#1E293B] border border-[#334155] shadow-lg">
                    <span className="text-[11px] text-[#94A3B8] uppercase font-bold">Taux de Chute</span>
                    <p className="text-2xl font-black text-amber-400 font-mono mt-1">
                      {result.wastePercentage.toFixed(1)}%
                    </p>
                    <span className="text-[10px] text-amber-500/80">Pertes résiduelles</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#1E293B] border border-[#334155] shadow-lg">
                    <span className="text-[11px] text-[#94A3B8] uppercase font-bold">Coupe Linéaire</span>
                    <p className="text-2xl font-black text-sky-400 font-mono mt-1">
                      {result.placedPieces.length} pcs
                    </p>
                    <span className="text-[10px] text-sky-400/80">Passes traversantes</span>
                  </div>
                </div>
              </>
            )}

            {/* Material breakdown if active */}
            {result?.materialStats && result.materialStats.length > 0 && (
              <div className="p-4 rounded-2xl bg-[#1E293B] border border-[#334155] shadow-lg">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-sky-400" />
                  Répartition Multi-Matériaux
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {result.materialStats.map((ms) => (
                    <div key={ms.material} className="p-2.5 rounded-xl bg-[#0F172A] border border-[#334155] flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {getMaterialBadge(ms.material)}
                        </div>
                        <p className="text-[11px] text-[#94A3B8]">{ms.totalPieces} pièces • {ms.usedArea} m²</p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-white text-sm">{ms.sheetsUsed} f.</span>
                        <p className="text-[10px] text-amber-400">{ms.wasteRate}% chute</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Interactive 2D SVG Cutting Plan Visualizer */}
            <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Plan de Coupe Interactif {result && `— Panneau ${activeSheetIndex + 1} / ${result.sheetsUsed}`}
                  </h3>
                  {currentSheet && getMaterialBadge(currentSheet.material)}
                </div>

                {/* Sheet Selector & Zoom Controls */}
                <div className="flex items-center gap-2">
                  {result && result.sheetsUsed > 1 && (
                    <div className="flex items-center bg-[#0F172A] rounded-xl border border-[#334155] p-1">
                      <button
                        onClick={() => setActiveSheetIndex(Math.max(0, activeSheetIndex - 1))}
                        disabled={activeSheetIndex === 0}
                        className="p-1 rounded-lg hover:bg-[#1E293B] text-white disabled:opacity-30"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-xs font-mono font-bold px-2.5 text-slate-200">
                        {activeSheetIndex + 1} / {result.sheetsUsed}
                      </span>
                      <button
                        onClick={() => setActiveSheetIndex(Math.min(result.sheetsUsed - 1, activeSheetIndex + 1))}
                        disabled={activeSheetIndex === result.sheetsUsed - 1}
                        className="p-1 rounded-lg hover:bg-[#1E293B] text-white disabled:opacity-30"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center bg-[#0F172A] rounded-xl border border-[#334155] p-1 text-slate-300">
                    <button
                      onClick={() => setZoomLevel(Math.max(0.6, zoomLevel - 0.2))}
                      className="p-1 rounded-lg hover:bg-[#1E293B]"
                      title="Zoom arrière"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-mono px-1.5">{Math.round(zoomLevel * 100)}%</span>
                    <button
                      onClick={() => setZoomLevel(Math.min(2.5, zoomLevel + 0.2))}
                      className="p-1 rounded-lg hover:bg-[#1E293B]"
                      title="Zoom avant"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* SVG Canvas */}
              <div className="relative w-full rounded-xl bg-[#0F172A] border border-[#334155] p-4 flex items-center justify-center min-h-[380px] overflow-auto">
                {result ? (
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
                      className="w-full max-w-[480px] max-h-[600px] aspect-[208/278] bg-slate-900 rounded-lg shadow-2xl border-2 border-slate-600"
                    >
                      {/* Panneau Brut Background (Orientation Verticale en cm) */}
                      <rect x="0" y="0" width={sheet.width} height={sheet.height} fill="#1E293B" stroke="#475569" strokeWidth="0.5" />

                      {/* Dessin des Chutes Réutilisables / Offcuts (en cm) */}
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
                                fill="#1E293B"
                                stroke="#0F172A"
                                strokeWidth={0.4}
                                opacity="0.95"
                              />
                              {off.width >= 10 && off.height >= 7 && (
                                <text
                                  x={off.x + off.width / 2}
                                  y={off.y + off.height / 2}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fill="#94A3B8"
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

                      {/* Placed Pieces on this sheet (en cm) */}
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
                                stroke="#0F172A"
                                strokeWidth={Math.max(0.3, options.kerfWidth / 10)}
                                rx={0.5}
                              />
                              {options.showLabels && (
                                <>
                                  {/* Numéro de pièce */}
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
                                  {/* Cotes en cm : Hauteur x Largeur */}
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
                ) : (
                  <div className="flex flex-col items-center justify-center text-center p-8 text-[#64748B]">
                    <Layers className="w-12 h-12 stroke-[1.5] mb-3 text-[#475569]" />
                    <p className="font-bold text-white text-sm">Aucun plan de coupe généré</p>
                    <p className="text-xs text-[#94A3B8] max-w-sm mt-1">
                      Renseignez vos pièces ou scannez une photo, puis cliquez sur &quot;Générer le plan de découpe optimal&quot;.
                    </p>
                  </div>
                )}
              </div>

              {/* Download & Actions Footer */}
              {result && (
                <div className="mt-5 pt-4 border-t border-[#334155] flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-[#94A3B8]">
                    Chute panneau actuel : <span className="font-bold text-amber-400">{currentSheet?.wasteRate || 0}%</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownloadDxf}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#283548] text-slate-200 text-xs font-bold border border-[#334155] transition-all"
                    >
                      <Download className="w-3.5 h-3.5 text-sky-400" />
                      <span>DXF (CNC)</span>
                    </button>

                    <button
                      onClick={handleDownloadPdf}
                      disabled={isDownloadingPdf}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-black text-xs tracking-wide shadow-lg shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isDownloadingPdf ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{isDownloadingPdf ? 'GÉNÉRATION DU PDF...' : 'RAPPORT INDUSTRIEL QATLIA (PDF)'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Nomenclature du Panneau Actuel (en cm) */}
            {currentSheet && (
              <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
                  Nomenclature du Panneau {activeSheetIndex + 1} ({currentSheet.pieces.length} pièces)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {currentSheet.pieces.map((p) => (
                    <div key={p.pieceNumber} className="p-2.5 rounded-xl bg-[#0F172A] border border-[#334155] flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-bold text-amber-400 font-mono">#{p.pieceNumber}</span>
                        <span className="text-white font-medium truncate">{p.name}</span>
                      </div>
                      <span className="font-mono text-[#94A3B8] shrink-0 font-semibold">{Math.round(p.height * 10) / 10} × {Math.round(p.width * 10) / 10} cm</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chutes du Panneau Actuel (en cm) */}
            {currentSheet && currentSheet.offcuts && currentSheet.offcuts.length > 0 && (
              <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded bg-slate-500"></span>
                  Chutes du Panneau {activeSheetIndex + 1} ({currentSheet.offcuts.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {currentSheet.offcuts.map((off, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#0F172A] border border-[#334155] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[#94A3B8] font-bold font-mono">Chute {idx + 1}</span>
                        {off.isReusable && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                            Réutilisable
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-amber-400 font-bold">{Math.round(off.height * 10) / 10} × {Math.round(off.width * 10) / 10} cm</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modale d'Authentification Intelligente (Google OAuth / Email) lors du téléchargement */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          setIsAuthModalOpen(false);
          // Recharger le profil utilisateur et déclencher le téléchargement
          const supabase = createClient();
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) {
              setUserEmail(user.email || null);
              supabase.from('profiles').select('credits').eq('id', user.id).single().then(({ data }) => {
                if (data) setUserCredits(data.credits);
              });
              handleDownloadPdf();
            }
          });
        }}
      />
    </div>
  );
}
