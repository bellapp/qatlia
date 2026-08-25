'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Upload,
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
} from 'lucide-react';
import {
  Piece,
  Sheet,
  OptimizationResult,
  OptimizationOptions,
  OPTIONS_DEFAULTS,
  MaterialType,
} from '@/lib/cutting/binpacking';
import { OptionsPanel } from '@/components/OptionsPanel';
import { PiecesManager } from '@/components/PiecesManager';

const DEFAULT_SHEET: Sheet = {
  height: 278, // Hauteur panneau brut vertical (cm)
  width: 208, // Largeur panneau brut horizontal (cm)
  kerf: 0.3, // cm = 3mm
  margin: 1.0, // cm
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

  // Sync Supabase User & Credits
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
          // Normalisation intelligente : si les dimensions sont > 500, elles sont en mm et converties en cm pour cohérence avec le panneau
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
              height: h,
              width: w,
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
      console.error(err);
    }
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    try {
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'Cuisine Moderne Pro',
          material: sheet.material || 'MDF',
          sheet: {
            width: sheet.width,
            height: sheet.height,
            kerf: options.kerfWidth / 10,
            grainDirection: options.grainDirection,
          },
          result,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qatlia_schema_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        window.print();
      }
    } catch (err) {
      console.error(err);
      window.print();
    }
  };

  const currentSheet = result?.sheets[activeSheetIndex] || (result ? {
    index: 0,
    material: sheet.material || 'mdf',
    width: sheet.width,
    height: sheet.height,
    pieces: result.placedPieces.filter((p) => p.sheetIndex === activeSheetIndex),
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
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0F172A]/90 border-b border-[#334155]/80 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1E3A5F] to-[#F5A623] flex items-center justify-center font-black text-xl text-white shadow-lg shadow-amber-500/10">
            Q
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-lg text-white">QatlIA</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-[#F5A623] font-bold border border-amber-500/20">
                PRO 2026
              </span>
            </div>
            <p className="text-[11px] text-[#94A3B8]">Optimisation de découpe de panneaux & Débit IA</p>
          </div>
        </div>

        {/* User Credits / Status */}
        <div className="flex items-center gap-3">
          <Link
            href="/credits"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[#F5A623] text-xs font-bold hover:bg-amber-500/20 transition-all shadow-sm"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{userCredits} crédits IA</span>
          </Link>

          {userEmail ? (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B] border border-[#334155] text-xs text-[#94A3B8]">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="truncate max-w-[130px]">{userEmail}</span>
            </div>
          ) : (
            <Link
              href="/auth/login"
              className="px-3.5 py-1.5 rounded-xl bg-[#1E3A5F] hover:bg-[#2A4F82] text-xs font-bold text-white transition-all shadow-sm"
            >
              Connexion
            </Link>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 pt-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT COLUMN: Input & AI & Options (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Options Panel (F10, F11, F12) */}
            <OptionsPanel
              options={options}
              onChange={handleOptionsChange}
              disabled={isOptimizing}
            />

            {/* Panel Stock Setup */}
            <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Dimensions du Panneau Brut
                  </h2>
                </div>
                <span className="text-xs text-[#94A3B8] font-mono">cm</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="sheetHeightInput" className="block text-[#94A3B8] font-medium mb-1">Hauteur (Y) [Vertical]</label>
                  <input
                    id="sheetHeightInput"
                    type="number"
                    value={sheet.height}
                    onChange={(e) => setSheet({ ...sheet, height: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-white font-mono font-bold focus:border-amber-400 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="sheetWidthInput" className="block text-[#94A3B8] font-medium mb-1">Largeur (X) [Horizontal]</label>
                  <input
                    id="sheetWidthInput"
                    type="number"
                    value={sheet.width}
                    onChange={(e) => setSheet({ ...sheet, width: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-white font-mono font-bold focus:border-amber-400 outline-none"
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

            {/* AI Vision Extraction Card */}
            <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Capture Photo & IA Vision
                  </h2>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  Vision IA
                </span>
              </div>
              <p className="text-xs text-[#94A3B8] mb-4">
                Photographiez votre carnet de mesures manuscrites. L&apos;IA extrait automatiquement les cotes et quantités.
              </p>

              <label className="group relative flex flex-col items-center justify-center min-h-[140px] rounded-2xl border-2 border-dashed border-[#475569] hover:border-sky-400 bg-[#0F172A]/80 hover:bg-[#0F172A] transition-all cursor-pointer p-4 text-center">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isProcessingVision}
                  className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
                {isProcessingVision ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
                    <span className="text-xs font-bold text-sky-300">Analyse de l&apos;image en cours...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-400 group-hover:scale-110 transition-transform">
                      <Upload className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-white">Importer ou Scanner une fiche de mesures</span>
                    <span className="text-[10px] text-[#64748B]">Photo, scan ou capture de notes</span>
                  </div>
                )}
              </label>

              {previewImage && (
                <div className="mt-3 p-2.5 rounded-xl bg-[#0F172A] border border-[#334155] flex items-center justify-between">
                  <div className="flex items-center gap-2.5 truncate">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewImage} alt="Aperçu" className="w-10 h-10 rounded-lg object-cover border border-[#475569]" />
                    <div className="truncate text-xs">
                      <p className="font-bold text-white truncate">Photo de mesures</p>
                      <p className="text-emerald-400 font-semibold text-[10px]">✓ Extraction réussie</p>
                    </div>
                  </div>
                  <button onClick={() => setPreviewImage(null)} className="text-xs text-rose-400 font-bold px-2 py-1">
                    Changer
                  </button>
                </div>
              )}

              {visionError && (
                <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold text-center">
                  ⚠️ {visionError}
                </div>
              )}
            </div>

            {/* Pieces Table Input (Norme Industrielle Hauteur Y × Largeur X) */}
            <PiecesManager
              pieces={pieces}
              onUpdatePieces={setPieces}
              defaultMaterial={sheet.material || 'mdf'}
              showMaterialCol={options.considerMaterial}
              disabled={isOptimizing}
            />

            <button
              onClick={handleRunOptimization}
              disabled={isOptimizing || pieces.length === 0}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#F5A623] to-[#E09015] hover:brightness-110 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isOptimizing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
              <span>GÉNÉRER LE PLAN DE DÉCOUPE OPTIMAL</span>
            </button>
          </div>

          {/* RIGHT COLUMN: Interactive 2D Visualizer & Results (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {result && (
              <>
                {/* Unplaced Pieces Warning */}
                {result.unplacedPieces && result.unplacedPieces.length > 0 && (
                  <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-rose-300 mb-1">
                        {result.unplacedPieces.length} Pièce(s) non placée(s)
                      </p>
                      <p className="text-rose-200/90 leading-relaxed mb-2">
                        Certaines pièces dépassent la surface restante ou les dimensions du panneau.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.unplacedPieces.map((up, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/50 font-mono text-[11px]">
                            {up.name || `Pièce ${idx + 1}`} ({up.width}×{up.height} cm)
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Warning Single Sheet */}
                {result.singleSheetWarning && !result.unplacedPieces?.length && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-[#F5A623] shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-white mb-1">Avertissement Mode &quot;1 Feuille&quot;</p>
                      <p className="text-amber-200/90 leading-relaxed">{result.singleSheetWarning}</p>
                    </div>
                  </div>
                )}
              </>
            )}

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
                    <span className="text-[10px] text-[#64748B]">{sheet.width} × {sheet.height} cm</span>
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
                      <span className="text-xs font-mono font-bold text-white px-2">
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

                  <div className="flex items-center bg-[#0F172A] rounded-xl border border-[#334155] p-1">
                    <button
                      onClick={() => setZoomLevel(Math.max(0.6, zoomLevel - 0.2))}
                      className="p-1 rounded-lg hover:bg-[#1E293B] text-white"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono text-[#94A3B8] px-1.5">{Math.round(zoomLevel * 100)}%</span>
                    <button
                      onClick={() => setZoomLevel(Math.min(2.0, zoomLevel + 0.2))}
                      className="p-1 rounded-lg hover:bg-[#1E293B] text-white"
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
                      {/* Panneau Brut Background (Orientation Verticale Réelle d'Atelier) */}
                      <rect x="0" y="0" width={sheet.width} height={sheet.height} fill="#1E293B" stroke="#475569" strokeWidth="0.5" />

                      {/* Dessin des Chutes Réutilisables / Offcuts */}
                      {result.offcuts && result.offcuts
                        .filter((o) => o.sheetIndex === activeSheetIndex)
                        .map((off, oIdx) => {
                          const isMm = sheet.width > 500;
                          const dispW = isMm ? Math.round(off.width) : Math.round(off.width * 10);
                          const dispH = isMm ? Math.round(off.height) : Math.round(off.height * 10);

                          return (
                            <g key={`off_${oIdx}`}>
                              <rect
                                x={off.x}
                                y={off.y}
                                width={off.width}
                                height={off.height}
                                fill="#243248"
                                stroke="#0F172A"
                                strokeWidth={0.4}
                                opacity="0.85"
                              />
                              {off.width >= 15 && off.height >= 12 && (
                                <text
                                  x={off.x + off.width / 2}
                                  y={off.y + off.height / 2}
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fill="#94A3B8"
                                  fontSize={Math.min(10, Math.max(5, Math.min(off.width, off.height) / 3.5))}
                                  fontStyle="italic"
                                  fontWeight="bold"
                                  fontFamily="sans-serif"
                                >
                                  {dispW}×{dispH}
                                </text>
                              )}
                            </g>
                          );
                        })}

                      {/* Placed Pieces on this sheet */}
                      {result.placedPieces
                        .filter((p) => p.sheetIndex === activeSheetIndex)
                        .map((p) => {
                          const colors = [
                            '#F59E0B', '#38BDF8', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6', '#6366F1'
                          ];
                          const color = colors[(p.pieceNumber - 1) % colors.length];
                          const isMm = sheet.width > 500;
                          const dispW = isMm ? Math.round(p.width) : Math.round(p.width * 10);
                          const dispH = isMm ? Math.round(p.height) : Math.round(p.height * 10);
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
                                strokeWidth={Math.max(0.4, options.kerfWidth / 5)}
                                rx={0.5}
                              />
                              {options.showLabels && (
                                <>
                                  {/* Numéro de pièce */}
                                  <text
                                    x={p.x + p.width / 2}
                                    y={p.y + p.height / 2 - (p.height >= 25 ? 5 : 0)}
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fill="#000000"
                                    fontSize={Math.min(14, Math.max(6, minSide / 4))}
                                    fontWeight="900"
                                    fontFamily="sans-serif"
                                  >
                                    #{p.pieceNumber} {p.name && minSide >= 30 ? `• ${p.name}` : ''}
                                  </text>
                                  {/* Cotes en millimètres */}
                                  {p.height >= 14 && p.width >= 14 && (
                                    <text
                                      x={p.x + p.width / 2}
                                      y={p.y + p.height / 2 + (p.height >= 25 ? 6 : 0)}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      fill="#000000"
                                      fontSize={Math.min(11, Math.max(5, minSide / 5.5))}
                                      fontWeight="bold"
                                      fontFamily="monospace"
                                    >
                                      {dispW} × {dispH}
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

              {/* Download & Actions Footer (F5: Export Multi-Format) */}
              {result && (
                <div className="mt-5 pt-4 border-t border-[#334155] flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-[#94A3B8]">
                    <span className="font-semibold text-white">Chute panneau actuel : </span>
                    <span className="font-mono font-bold text-amber-400">{currentSheet?.wasteRate || 0}%</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownloadDxf}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#0F172A] hover:bg-[#283548] text-slate-200 font-bold text-xs shadow-md transition-all border border-[#334155]"
                      title="Télécharger le fichier DXF pour machine CNC"
                    >
                      <Download className="w-4 h-4 text-emerald-400" />
                      <span>DXF (CNC)</span>
                    </button>

                    <button
                      onClick={handleDownloadPdf}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#1E3A5F] to-[#2563EB] hover:brightness-110 text-white font-bold text-xs shadow-md transition-all border border-sky-400/30"
                    >
                      <Download className="w-4 h-4 text-sky-400" />
                      <span>RAPPORT INDUSTRIEL QATLIA (PDF)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Pieces breakdown list on current sheet */}
            {result && currentSheet && (
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
                      <span className="font-mono text-[#94A3B8] shrink-0 font-semibold">{p.width} × {p.height} cm</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
