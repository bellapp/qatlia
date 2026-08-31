'use client';

import React, { useState, useEffect, useLayoutEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Layers,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Zap,
  AlertTriangle,
  Camera,
  Image as ImageIcon,
  History,
  SlidersHorizontal,
  ChevronDown,
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
  CutMode,
  optimizeCutting1D,
  optimizeCutting2D,
} from '@/lib/cutting/binpacking';
import { PIECE_COLOR_PALETTE, getResolvedPieceColor } from '@/lib/pieces/catalog';
import { OptionsPanel } from '@/components/OptionsPanel';
import { PiecesManager } from '@/components/PiecesManager';
import { AuthModal } from '@/components/AuthModal';
import { EmptyState } from '@/components/EmptyState';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';
import { OnboardingTour } from '@/components/OnboardingTour';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';
import { materialLabelKey, visionErrorKey } from '@/i18n/domain';
import { writeLocalHistoryItem, type LocalHistoryItem } from '@/lib/history';
import { buildPdfPayload } from '@/lib/pdf-payload';
import { buildPersistedProjectPayload } from '@/lib/projects/persistence-payload';
import {
  type DisplayUnit,
  DEFAULT_DISPLAY_UNIT,
  parseDisplayInputToCanonical,
  formatDisplayValue,
  readStoredDisplayUnit,
  writeStoredDisplayUnit,
  resolveProjectUnitMetadata,
} from '@/lib/units';

const DEFAULT_SHEETS: Sheet[] = [
  { id: 's0', height: 278, width: 208, kerf: 0.3, margin: 1.0, grainDirection: false, material: 'mdf', quantity: 1, label: 'Panneau standard 278×208' },
];

/**
 * The stock materials offered in the workshop's quick selector. These are the
 * stable `MaterialType` payload values — the optimizer, `/api/optimize` and every
 * saved project carry them verbatim; only their labels come from the catalog.
 */
const STOCK_MATERIAL_VALUES: readonly MaterialType[] = ['mdf', 'aluminium', 'verre', 'contreplaques'];

/**
 * Vision extraction returns raw, unverified numbers from a model response.
 * Only a finite, strictly positive number is trusted; anything else (missing,
 * NaN, `Infinity`, a negative or zero value) falls back deterministically to
 * `fallback` instead of propagating a value that would silently corrupt
 * placed-piece geometry downstream (`Math.round(Infinity * 10) / 10` stays
 * `Infinity`, no throw, but a broken piece). No magnitude-based unit
 * conversion is ever applied here — see the comment at the call site.
 */
function safeFinitePositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizePiecesWithColors(sourcePieces: Piece[]): Piece[] {
  return sourcePieces.map((piece, index) => ({
    ...piece,
    color: getResolvedPieceColor({
      color: piece.color,
      id: piece.id,
      name: piece.name,
      height: piece.height,
      width: piece.width,
      quantity: piece.quantity,
      index,
    }),
  }));
}

const INITIAL_PIECES: Piece[] = normalizePiecesWithColors([
  { id: '1', name: 'Panneau Latéral G', height: 230, width: 120, quantity: 2, material: 'mdf', rotatable: true },
  { id: '2', name: 'Panneau Latéral D', height: 118, width: 48, quantity: 1, material: 'mdf', rotatable: true },
  { id: '3', name: 'Étagère Mobile', height: 41.8, width: 38, quantity: 7, material: 'mdf', rotatable: true },
  { id: '4', name: 'Séparation Centrale', height: 53.1, width: 48, quantity: 4, material: 'mdf', rotatable: true },
  { id: '5', name: 'Socle Bas', height: 51.3, width: 48, quantity: 2, material: 'mdf', rotatable: true },
]);

export default function Dashboard() {
  const [cutMode, setCutMode] = useState<CutMode>('2d');
  const [sheets, setSheets] = useState<Sheet[]>(DEFAULT_SHEETS);
  const [pieces, setPieces] = useState<Piece[]>(INITIAL_PIECES);
  const [options, setOptions] = useState<OptimizationOptions>(OPTIONS_DEFAULTS);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isProcessingVision, setIsProcessingVision] = useState(false);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  // null until the signed-in artisan's real balance is loaded — never a
  // hardcoded placeholder the customer could mistake for their actual solde.
  const [userCredits, setUserCredits] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // The failure is held as a catalog key, not as rendered prose: the server
  // answers with a machine-readable code, and holding the key means an artisan
  // who switches language after a failed scan sees the message follow them.
  const [visionError, setVisionError] = useState<TranslationKey | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>(DEFAULT_DISPLAY_UNIT);
  // True while the restored/current project still owes its next save an
  // explicit unit-metadata rewrite (legacy project with no metadata at all).
  // Fresh projects (no restore) start false; cleared once a save/local
  // history rewrite has stamped explicit metadata.
  const [pendingUnitMigration, setPendingUnitMigration] = useState<boolean>(false);
  // Free-typed string drafts for the sheet height/width inputs. Kept
  // separate from canonical state so an artisan can type a decimal
  // ("27.5") without every keystroke being immediately reformatted to
  // `toFixed(1)` — that only happens once the value is committed (blur /
  // Enter) or when the source (`activeSheet`/`displayUnit`) changes under
  // the draft, e.g. after a cm↔mm toggle or a fresh optimization run.
  const [sheetHeightDraft, setSheetHeightDraft] = useState<string>('');
  const [sheetWidthDraft, setSheetWidthDraft] = useState<string>('');
  // Persisted historical marker: does this project's unit metadata trace
  // back to a legacy (pre-metadata) record? Unlike `pendingUnitMigration`,
  // this never resets to false once true — a rewritten legacy record keeps
  // this `true` forever even after its pending rewrite is done. Fresh
  // projects (no restore) start false.
  const [migratedFromLegacyUnit, setMigratedFromLegacyUnit] = useState<boolean>(false);

  const activeSheet = sheets[0] || DEFAULT_SHEETS[0];
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { t, tn, n, locale } = useLocale();

  // Re-sync the free-typed drafts whenever the canonical sheet dimensions or
  // the display unit change from *outside* the draft itself (a cm↔mm toggle,
  // a fresh optimization, a restored project). This never fires on every
  // keystroke — only on these external changes — so mid-typing values are
  // never clobbered.
  useEffect(() => {
    setSheetHeightDraft(formatDisplayValue(activeSheet.height, displayUnit));
    setSheetWidthDraft(formatDisplayValue(activeSheet.width, displayUnit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet.height, activeSheet.width, displayUnit]);

  /**
   * Commits a sheet height/width draft on blur/Enter. Invalid input (empty,
   * non-finite like `1e400`/`Infinity`, or <= 0) is rejected without ever
   * touching canonical state — the draft is simply reverted to the
   * last-known-good canonical value formatted in the current display unit.
   */
  const commitSheetDimension = (field: 'height' | 'width', raw: string) => {
    const canonical = parseDisplayInputToCanonical(raw, displayUnit);
    const setDraft = field === 'height' ? setSheetHeightDraft : setSheetWidthDraft;
    if (canonical === null || canonical <= 0) {
      setDraft(formatDisplayValue(activeSheet[field], displayUnit));
      return;
    }
    setSheets([{ ...activeSheet, [field]: canonical }]);
    setDraft(formatDisplayValue(canonical, displayUnit));
  };

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
            if (profile && typeof profile.credits === 'number') setUserCredits(profile.credits);
          } catch {
            /* profil indisponible — le solde reste inconnu plutôt qu'inventé */
          }
        }
      } catch (err) {
        console.error('Erreur profil:', err);
      }
    }
    loadUser();
  }, []);

  // Runs synchronously before paint so the restored sheets/pieces/options,
  // display unit, and migration markers all land in the same commit — no
  // frame is ever painted with default state before the restore applies.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    setDisplayUnit(readStoredDisplayUnit(window.localStorage));

    const savedProj = sessionStorage.getItem('qatlia_saved_project');
    if (savedProj) {
      try {
        const parsed = JSON.parse(savedProj);
        if (parsed.sheet) setSheets([parsed.sheet]);
        if (parsed.sheets) setSheets(parsed.sheets);
        if (Array.isArray(parsed.pieces)) setPieces(normalizePiecesWithColors(parsed.pieces));
        if (parsed.options) setOptions((prev) => ({ ...prev, ...parsed.options }));
        // Legacy saved projects carry no unit metadata at all; they predate
        // this feature and were always canonical cm. `resolveProjectUnitMetadata`
        // assumes cm in that case and flags it `migrated` so the next save
        // (persistProject below) rewrites the project with explicit metadata.
        // `migratedFromLegacyUnit` is the separate, persisted historical
        // marker: it stays true forever once a record's metadata traces
        // back to a legacy save, even after that pending rewrite is done.
        const unitMeta = resolveProjectUnitMetadata(parsed);
        setDisplayUnit(unitMeta.displayUnit);
        setPendingUnitMigration(unitMeta.migrated);
        setMigratedFromLegacyUnit(unitMeta.migratedFromLegacyUnit);
        // Defer the removal to a macrotask instead of clearing it inline:
        // React (StrictMode/dev, or concurrent double-invoke) can run this
        // effect twice before either pass's state updates commit, so an
        // immediate removeItem here lets the first pass consume the key
        // while the second pass finds it already gone and silently keeps
        // the default state. Pushing the removal past the current
        // microtask/render lets every duplicate pass read the same
        // sessionStorage value before it disappears.
        window.setTimeout(() => sessionStorage.removeItem('qatlia_saved_project'), 0);
      } catch (e) {
        console.error('Erreur restauration projet:', e);
        // Malformed JSON will never parse successfully, so don't leave it
        // sitting in sessionStorage forever — clear it right away.
        sessionStorage.removeItem('qatlia_saved_project');
      }
    }
  }, []);

  const handleDisplayUnitChange = (unit: DisplayUnit) => {
    setDisplayUnit(unit);
    if (typeof window !== 'undefined') {
      writeStoredDisplayUnit(window.localStorage, unit);
    }
  };


  const handleOptionsChange = (newOpts: OptimizationOptions) => {
    setOptions(newOpts);
    setSheets(prev => prev.map(s => ({ ...s, kerf: newOpts.kerfWidth / 10, grainDirection: newOpts.grainDirection })));
  };

  const persistProject = async (
    nextResult: OptimizationResult,
    source: 'optimize' | 'pdf'
  ) => {
    // The persisted historical marker stays true forever once true: either
    // this save is itself the rewrite of a legacy record (pendingUnitMigration),
    // or a prior save already carried that historical origin forward.
    const persistedMigratedFromLegacyUnit = pendingUnitMigration || migratedFromLegacyUnit;
    const payload = buildPersistedProjectPayload({
      // `{material}` stays the stable payload value upper-cased (MDF, VERRE, …)
      // rather than a translated label, so a project keeps the same identity in
      // history whatever language it was saved in; only the wording around it
      // follows the artisan's locale.
      name: t(cutMode === '1d' ? 'atelier.project.nameBars' : 'atelier.project.nameSheets', {
        material: (activeSheet.material || 'mdf').toUpperCase(),
        count: pieces.reduce((s, p) => s + (p.quantity || 1), 0),
      }),
      sheets,
      sheet: activeSheet,
      pieces,
      options,
      result: nextResult,
      // Geometry above (sheets/pieces) always stays canonical cm; the unit
      // fields are metadata only, so history/atelier can restore the
      // artisan's chosen display unit instead of re-defaulting to cm, and
      // know whether this record still owes a rewrite with explicit unit
      // metadata.
      displayUnit,
      migratedFromLegacyUnit: persistedMigratedFromLegacyUnit,
    });

    writeLocalHistoryItem({
      id: `${source}_${Date.now()}`,
      name: payload.name,
      material: activeSheet.material || 'mdf',
      sheet_width: activeSheet.width,
      sheet_height: activeSheet.height,
      kerf: activeSheet.kerf,
      grain_direction: !!activeSheet.grainDirection,
      status: 'optimized',
      created_at: new Date().toISOString(),
      options_json: payload as unknown as LocalHistoryItem['options_json'],
    });
    // The local history entry above now carries explicit unit metadata, so
    // this project no longer owes a migration rewrite on its next save —
    // but the historical marker itself is carried forward, not reset.
    setPendingUnitMigration(false);
    setMigratedFromLegacyUnit(persistedMigratedFromLegacyUnit);

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
      let optResult: OptimizationResult;
      if (cutMode === '1d') {
        optResult = optimizeCutting1D(pieces, activeSheet.width, options.kerfWidth);
      } else {
        optResult = optimizeCutting2D(pieces, sheets, options);
      }
      setResult(optResult);
      setActiveSheetIndex(0);
      void persistProject(optResult, 'optimize');
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
            sheetMaterial: activeSheet.material || 'mdf',
          }),
        });

        const data = await res.json();
        if (data.success && Array.isArray(data.pieces) && data.pieces.length > 0) {
          setPreviewImage(base64);
          const newPieces: Piece[] = data.pieces.map((p: { name?: string; width?: number | string; height?: number | string; quantity?: number | string; material?: string; color?: string }, i: number) => {
            // /api/vision always extracts and returns canonical centimetres
            // (see its prompt), so no magnitude-based mm heuristic is applied
            // here — a legitimate 600 cm bar must survive untouched. Only a
            // finite, strictly positive number is trusted (see
            // `safeFinitePositive`); anything else (missing, NaN, Infinity,
            // <= 0) falls back deterministically instead of reaching
            // `Math.round` with a non-finite value.
            const h = safeFinitePositive(p.height, 10);
            const w = safeFinitePositive(p.width, 10);
            const quantity = Math.max(1, Math.round(safeFinitePositive(p.quantity, 1)));
            return {
              id: `ext_${Date.now()}_${i}`,
              name: p.name || `Pièce ${i + 1}`,
              height: Math.round(h * 10) / 10,
              width: Math.round(w * 10) / 10,
              quantity,
              material: (p.material as MaterialType) || (activeSheet.material || 'mdf'),
              rotatable: true,
              color: getResolvedPieceColor({
                color: p.color,
                id: `ext_${Date.now()}_${i}`,
                name: p.name,
                height: h,
                width: w,
                quantity,
                index: i,
              }),
            };
          });
          setPieces(normalizePiecesWithColors(newPieces));
          // The server is the only authority on the balance; it is echoed back
          // only when a credit was actually debited.
          if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
        } else {
          if (res.status === 401) setIsAuthModalOpen(true);
          if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
          // The route's own `message` stays French for non-browser callers; the
          // workshop renders the artisan's language from the `error` code, and a
          // code this build does not know degrades to the generic message.
          setVisionError(visionErrorKey(data.error));
        }
      } catch (err) {
        setVisionError('atelier.visionError.network');
        console.error(err);
      } finally {
        setIsProcessingVision(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const json = JSON.stringify({
      // Geometry below is always canonical cm; this only records which unit
      // the artisan had selected for display at export time.
      displayUnit,
      sheetsUsed: result.sheetsUsed,
      wastePercentage: result.wastePercentage,
      costBreakdown: result.costBreakdown,
      sheets: result.sheets.map(s => ({
        index: s.index, material: s.material,
        width: s.width, height: s.height,
        pieces: s.pieces.map(p => ({ name: p.name, height: p.height, width: p.width, rotated: p.rotated, x: p.x, y: p.y, color: p.color, pieceNumber: p.pieceNumber })),
        offcuts: s.offcuts.map(o => ({ height: o.height, width: o.width, x: o.x, y: o.y }))
      })),
      placedPieces: result.placedPieces.map((piece) => ({
        pieceNumber: piece.pieceNumber,
        name: piece.name,
        height: piece.height,
        width: piece.width,
        rotated: piece.rotated,
        x: piece.x,
        y: piece.y,
        sheetIndex: piece.sheetIndex,
        color: piece.color,
      })),
    }, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qatlia_plan_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleDownloadPng = async () => {
    const svg = document.querySelector('svg');
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      ctx.fillStyle = '#060B14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `qatlia_plan_${Date.now()}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }, 'image/png');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleDownloadDxf = async () => {
    if (!result) return;
    try {
      const res = await fetch('/api/export-dxf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: 'QatlIA_CNC_Plan',
          // Coordinates/dimensions below stay canonical cm; displayUnit is
          // metadata only (see src/lib/units.ts).
          displayUnit,
          sheet: {
            width: activeSheet.width,
            height: activeSheet.height,
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
      // Exports are free: only a successful photo analysis costs a credit
      // (see src/lib/billing/policy.ts). No debit happens here.
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildPdfPayload(t('atelier.exports.pdfDefaultProjectName'), activeSheet, pieces, result, displayUnit, locale)
        ),
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
    material: activeSheet.material || 'mdf',
    width: activeSheet.width,
    height: activeSheet.height,
    pieces: result.placedPieces.filter((p) => p.sheetIndex === activeSheetIndex),
    offcuts: result.offcuts.filter((o) => o.sheetIndex === activeSheetIndex),
    wasteRate: result.wastePercentage,
    usedArea: result.totalAreaUsed,
  } : null);
  const currentSheetPieces = currentSheet ? [...currentSheet.pieces].sort((a, b) => a.pieceNumber - b.pieceNumber) : [];

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased selection:bg-brand-500 selection:text-black">
      {/* Top Navbar Studio */}
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-500/[0.04] to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto flex min-w-0 items-center justify-between overflow-hidden px-4 sm:px-8 h-16">
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-brand-400">
              <QatlIALogo size="md" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-[17px] tracking-tight text-slate-900 dark:text-white">QatlIA</span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-brand-500/10 text-brand-400 border border-brand-500/20 tracking-wide">
                  PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 hidden sm:block -mt-0.5">{t('atelier.header.tagline')}</p>
            </div>
          </div>

          <div role="group" aria-label={t('atelier.header.actionsAria')} className="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain">
            {/* Mode Toggle: 2D / 1D — the two labels are domain notation, not
                prose, so the pair keeps its LTR order in every locale; only the
                tooltip that explains them is translated. */}
            <div dir="ltr" className="flex items-center p-0.5 rounded-lg bg-studio-field border border-studio-border">
              <button type="button" onClick={() => setCutMode('2d')} aria-pressed={cutMode === '2d'} title={t('atelier.header.cutMode2dAria')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${cutMode === '2d' ? 'bg-brand-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}>
                2D
              </button>
              <button type="button" onClick={() => setCutMode('1d')} aria-pressed={cutMode === '1d'} title={t('atelier.header.cutMode1dAria')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${cutMode === '1d' ? 'bg-brand-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}>
                1D
              </button>
            </div>

            <Link
              href="/history"
              aria-label={t('atelier.header.history')}
              className="group relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white hover:bg-studio-panel transition-all"
            >
              <History className="w-4 h-4 text-slate-600 dark:text-slate-400 group-hover:text-brand-400 transition-colors" />
              <span className="hidden sm:inline">{t('atelier.header.history')}</span>
            </Link>

            <LocaleSwitcher />
            <OnboardingTour />
            <ThemeToggle />
            <Link
              href="/credits"
              aria-label={t('atelier.header.creditsAria')}
              className="group relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 hover:border-brand-500/40 text-xs font-semibold transition-all"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-400" />
              </span>
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" />
              <span className="font-mono font-bold" dir="ltr">{userCredits === null ? '—' : n(userCredits)}</span>
              <span className="text-[10px] opacity-80 hidden sm:inline">{t('atelier.header.credits')}</span>
            </Link>

            {userEmail ? (
              <AccountMenu email={userEmail} />
            ) : (
              <Link
                href="/auth/login"
                className="px-4 py-2 rounded-xl bg-white dark:bg-studio-field hover:bg-slate-100 text-slate-950 font-bold text-xs whitespace-nowrap transition-all shadow-sm hover:shadow-md"
              >
                {t('nav.login')}
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
            
            {/* Quick Actions: Hero Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Take Photo Card */}
              <label className="group relative flex flex-col gap-3 p-4 rounded-2xl bg-studio-panel/60 border border-studio-border hover:border-sky-500/40 hover:bg-studio-panel/80 cursor-pointer transition-all duration-200 overflow-hidden">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} disabled={isProcessingVision} />
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center group-hover:scale-105 group-hover:bg-sky-500/15 transition-all">
                    <Camera className="w-5 h-5 text-sky-400" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:text-white transition-colors">{t('atelier.scan.cameraTitle')}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{t('atelier.scan.cameraDesc')}</p>
                  </div>
                </div>
                <span className="self-start px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-400 text-[10px] font-bold font-mono border border-sky-500/20">{t('atelier.scan.cameraBadge')}</span>
              </label>

              {/* Upload File Card */}
              <label className="group relative flex flex-col gap-3 p-4 rounded-2xl bg-studio-panel/60 border border-studio-border hover:border-brand-500/40 hover:bg-studio-panel/80 cursor-pointer transition-all duration-200 overflow-hidden">
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isProcessingVision} />
                <div className="absolute inset-0 bg-gradient-to-br from-brand-500/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center group-hover:scale-105 group-hover:bg-brand-500/15 transition-all">
                    <ImageIcon className="w-5 h-5 text-brand-400" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:text-white transition-colors">{t('atelier.scan.uploadTitle')}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{t('atelier.scan.uploadDesc')}</p>
                  </div>
                </div>
                <span className="self-start px-2 py-0.5 rounded-md bg-brand-500/10 text-brand-400 text-[10px] font-bold font-mono border border-brand-500/20">JPG PNG WebP</span>
              </label>
            </div>

            {/* Vision IA Badge — flottant entre les deux cartes */}
            <div className="flex items-center justify-center -mt-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-sky-500/10 via-brand-500/10 to-sky-500/10 border border-brand-500/20 text-[11px] font-semibold text-brand-400">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                {t('atelier.scan.visionBadge')}
              </span>
            </div>

            {/* Preview scan if present */}
            {previewImage && (
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewImage} alt={t('atelier.scan.previewAlt')} className="w-12 h-12 object-cover rounded-xl border border-emerald-500/30 shadow-sm" />
                <div className="text-xs">
                  <span className="text-emerald-400 font-bold block">{t('atelier.scan.analyzedTitle')}</span>
                  <span className="text-[11px] text-emerald-300/70 font-mono">{tn('atelier.scan.analyzedCount', pieces.length)}</span>
                </div>
              </div>
            )}

            {/* Processing Banner */}
            {isProcessingVision && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/20 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                <div className="text-xs">
                  <span className="text-sky-300 font-bold block">{t('atelier.scan.processingTitle')}</span>
                  <span className="text-[11px] text-sky-400/60">{t('atelier.scan.processingDesc')}</span>
                </div>
              </div>
            )}

            {visionError && (
              <div role="alert" className="flex items-center gap-3 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-xs text-rose-300 font-medium">{t(visionError)}</span>
              </div>
            )}

            {/* Stock Panel Card */}
            <div className="overflow-hidden rounded-2xl bg-studio-panel/60 border border-studio-border/90">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-studio-border/80">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                    <Layers className="w-4 h-4 text-brand-400" />
                  </span>
                  <div>
                    <h2 className="text-xs font-bold text-slate-900 dark:text-white tracking-wide">{t(cutMode === '1d' ? 'atelier.stock.titleBar' : 'atelier.stock.titleSheet')}</h2>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{t(cutMode === '1d' ? 'atelier.stock.subtitleBar' : 'atelier.stock.subtitleSheet')}</p>
                  </div>
                </div>
                <div role="group" aria-label={t('atelier.stock.unitGroupAria')} className="flex items-center p-0.5 rounded-lg bg-studio-field border border-studio-border">
                  {(['cm', 'mm'] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      data-testid={`unit-toggle-${unit}`}
                      onClick={() => handleDisplayUnitChange(unit)}
                      aria-pressed={displayUnit === unit}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${displayUnit === unit ? 'bg-brand-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              <div className={cutMode === '1d' ? 'p-4 grid grid-cols-2 gap-3' : 'p-4 grid grid-cols-3 gap-3'}>
                {cutMode === '1d' ? null : <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.stock.heightLabel', { unit: displayUnit })}</label>
                  <input
                    type="number"
                    step="0.1"
                    dir="ltr"
                    data-testid="sheet-height-input"
                    aria-label={t('atelier.stock.heightAria', { unit: displayUnit })}
                    value={sheetHeightDraft}
                    onChange={(e) => setSheetHeightDraft(e.target.value)}
                    onBlur={(e) => commitSheetDimension('height', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="w-full px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-slate-900 dark:text-slate-100 font-mono font-bold text-end outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  />
                </div>}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t(cutMode === '1d' ? 'atelier.stock.lengthLabel' : 'atelier.stock.widthLabel', { unit: displayUnit })}</label>
                  <input
                    type="number"
                    step="0.1"
                    dir="ltr"
                    data-testid="sheet-width-input"
                    aria-label={t(cutMode === '1d' ? 'atelier.stock.lengthAria' : 'atelier.stock.widthAria', { unit: displayUnit })}
                    value={sheetWidthDraft}
                    onChange={(e) => setSheetWidthDraft(e.target.value)}
                    onBlur={(e) => commitSheetDimension('width', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="w-full px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-slate-900 dark:text-slate-100 font-mono font-bold text-end outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.stock.materialLabel')}</label>
                  <select
                    value={activeSheet.material || 'mdf'}
                    aria-label={t('atelier.stock.materialAria')}
                    onChange={(e) => { setSheets([{ ...activeSheet, material: e.target.value as MaterialType }]); }}
                    className="w-full px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  >
                    {STOCK_MATERIAL_VALUES.map((material) => (
                      <option key={material} value={material}>{t(materialLabelKey(material))}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Pieces Manager Component */}
            <div className="p-4 rounded-2xl bg-studio-panel/60 border border-studio-border/90 shadow-sm">
              <PiecesManager
                pieces={pieces}
                onUpdatePieces={setPieces}
                defaultMaterial={activeSheet.material || 'mdf'}
                displayUnit={displayUnit}
                showMaterialCol={options.considerMaterial}
                disabled={isOptimizing}
              />
            </div>

            {/* Collapsible Advanced Options */}
            <div className="rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                aria-expanded={showAdvancedOptions}
                aria-controls="advanced-cutting-options"
                className="w-full px-4 py-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-brand-400" />
                  <span>{t('atelier.advanced.toggle')}</span>
                </div>
                <span className={`transition-transform duration-200 ${showAdvancedOptions ? 'rotate-180' : ''}`}>
                  <ChevronDown className="w-4 h-4" />
                </span>
              </button>

              {showAdvancedOptions && (
                <div id="advanced-cutting-options" className="px-1 pb-2 animate-in fade-in slide-in-from-top-1 duration-200">
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
              className="w-full py-4 rounded-2xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-sm tracking-wider uppercase shadow-lg shadow-brand-500/25 transition-all flex items-center justify-center gap-2.5 disabled:opacity-30 disabled:shadow-none active:scale-[0.98]"
            >
              {isOptimizing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{t('atelier.optimize.running')}</span>
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  <span>{t('atelier.optimize.cta')}</span>
                </>
              )}
            </button>
          </div>

          {/* RIGHT COLUMN: Visual Studio & Results (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            
            {result ? (
              <>
                {/* Cost Summary Banner — the subtotal comes from result.costBreakdown
                    (src/lib/costing.ts), the same figure shown in the cost
                    breakdown below and rendered in the PDF export. No estimated
                    "savings" claim is shown here. */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950/60 via-studio-panel/80 to-studio-panel border border-emerald-500/20 p-5">
                  <div className="absolute top-0 end-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 pointer-events-none" />
                  <div className="relative flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-400 mb-1">{t('atelier.cost.bannerLabel')}</p>
                      <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tight" dir="ltr">
                        {result.costBreakdown ? n(result.costBreakdown.subtotal) : '—'} <span className="text-emerald-400">{t('atelier.cost.currency')}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {t('atelier.cost.bannerMeta', {
                          meters: n(result.totalLinearCutMeters || 0),
                          sheets: tn('atelier.cost.sheetsCount', result.sheetsUsed),
                        })}
                      </p>
                    </div>
                    <div className="shrink-0 w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-emerald-400" />
                    </div>
                  </div>
                </div>

                {/* Performance Metrics Grid */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-3.5 rounded-xl bg-studio-panel/60 border border-studio-border/80 flex flex-col items-center text-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.metrics.sheets')}</span>
                    <span className="text-2xl font-black font-mono text-slate-900 dark:text-white tabular-nums" dir="ltr">{result.sheetsUsed}</span>
                    <span className="text-[9px] text-slate-600 truncate" dir="ltr">
                      {formatDisplayValue(activeSheet.height, displayUnit)}×{formatDisplayValue(activeSheet.width, displayUnit)} {displayUnit}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-studio-panel/60 border border-studio-border/80 flex flex-col items-center text-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.metrics.usable')}</span>
                    <span className="text-2xl font-black font-mono text-emerald-400 tabular-nums" dir="ltr">{(100 - result.wastePercentage).toFixed(0)}%</span>
                    <span className="text-[9px] text-emerald-500/60">{t('atelier.metrics.usableSub')}</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-studio-panel/60 border border-studio-border/80 flex flex-col items-center text-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.metrics.waste')}</span>
                    <span className="text-2xl font-black font-mono text-brand-400 tabular-nums" dir="ltr">{result.wastePercentage.toFixed(0)}%</span>
                    <span className="text-[9px] text-brand-500/60">{t('atelier.metrics.wasteSub')}</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-studio-panel/60 border border-studio-border/80 flex flex-col items-center text-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.metrics.pieces')}</span>
                    <span className="text-2xl font-black font-mono text-sky-400 tabular-nums" dir="ltr">{result.placedPieces.length}</span>
                    <span className="text-[9px] text-sky-400/60">{t('atelier.metrics.piecesSub')}</span>
                  </div>
                </div>

                {/* 2D Visualizer */}
                <div className="overflow-hidden rounded-2xl border border-studio-border/80">
                  {/* Tabs for sheets */}
                  <div data-testid="cut-plan-toolbar" className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-studio-panel/40 border-b border-studio-border/60">
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                      {Array.from({length: result.sheetsUsed}).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveSheetIndex(i)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                            i === activeSheetIndex
                              ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {t('atelier.plan.sheetTab', { index: i + 1 })}
                          <span className="ms-1.5 text-[10px] text-slate-600 font-mono" dir="ltr">
                            {result.sheets[i]?.wasteRate?.toFixed(0)}%
                          </span>
                        </button>
                      ))}
                    </div>
                    {/* The zoom pair reads out/in like the plan it drives, so it
                        keeps the plan's LTR order in every locale. */}
                    <div dir="ltr" className="flex shrink-0 items-center gap-1.5 bg-studio-field rounded-lg border border-studio-border p-0.5">
                      <button aria-label={t('atelier.plan.zoomOut')} onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))} disabled={zoomLevel <= 0.5} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span title={t('atelier.plan.zoomLevelAria')} className="text-[10px] font-mono text-slate-600 dark:text-slate-400 tabular-nums px-1 w-10 text-center">{Math.round(zoomLevel*100)}%</span>
                      <button aria-label={t('atelier.plan.zoomIn')} onClick={() => setZoomLevel(Math.min(2.5, zoomLevel + 0.25))} disabled={zoomLevel >= 2.5} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* SVG Canvas — the plan is geometry, not prose: its origin is
                      the sheet's top-left corner and its labels are cm/mm
                      figures, so it stays LTR even when the workshop is RTL. */}
                  <div dir="ltr" data-testid="cut-plan-viewport" className={`relative min-h-[420px] max-h-[70vh] overflow-auto overscroll-contain p-5 ${isDark ? 'bg-[#040812]' : 'bg-[#F1F5F9]'}`}>
                    <div
                      className="mx-auto transition-[width] duration-200 ease-out"
                      style={{ width: `${zoomLevel * 100}%`, maxWidth: `${480 * zoomLevel}px` }}
                    >
                      <svg
                        data-testid="cut-plan-svg"
                        viewBox={`0 0 ${activeSheet.width} ${activeSheet.height}`}
                        className="block w-full aspect-[208/278] rounded-xl"
                        style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))' }}
                      >
                        <defs>
                          <linearGradient id="sheetBgL" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#FFFFFF" /><stop offset="100%" stopColor="#F8FAFC" />
                          </linearGradient>
                          <linearGradient id="sheetBgD" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#0D1A30" /><stop offset="100%" stopColor="#07101F" />
                          </linearGradient>
                          <pattern id="hatchL" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="8" stroke="#CBD5E1" strokeWidth="0.5" opacity="0.9"/>
                          </pattern>
                          <pattern id="hatchD" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="8" stroke="#1A2744" strokeWidth="0.5" opacity="0.7"/>
                          </pattern>
                        </defs>

                        <rect x="0" y="0" width={activeSheet.width} height={activeSheet.height}
                          fill={isDark ? 'url(#sheetBgD)' : 'url(#sheetBgL)'}
                          stroke={isDark ? '#4A5568' : '#94A3B8'} strokeWidth={isDark ? 1 : 1.5} rx="0.5" />

                        {result.offcuts && result.offcuts.filter(o => o.sheetIndex === activeSheetIndex).map((off) => {
                          const minSide = Math.min(off.width, off.height);
                          return (
                            <g key={off.id} data-testid="offcut-svg-group" data-offcut-id={off.id}>
                              <rect data-testid="offcut-svg-rect" data-offcut-id={off.id} data-offcut-width={off.width} data-offcut-height={off.height} x={off.x} y={off.y} width={off.width} height={off.height}
                                fill={isDark ? 'url(#hatchD)' : 'url(#hatchL)'}
                                stroke={isDark ? '#2D3A5C' : '#94A3B8'} strokeWidth="0.4" strokeDasharray="2 2" opacity="0.8" />
                              {off.width>=14 && off.height>=10 && (
                                <text x={off.x+off.width/2} y={off.y+off.height/2} textAnchor="middle" dominantBaseline="central"
                                  fill={isDark ? '#5B7DA6' : '#64748B'} fontSize={Math.min(4.5, Math.max(2.2, minSide/12))}
                                  fontFamily="monospace" fontWeight="bold">
                                  {formatDisplayValue(off.height, displayUnit)} × {formatDisplayValue(off.width, displayUnit)} {displayUnit}
                                </text>
                              )}
                            </g>
                          );
                        })}

                        {result.placedPieces.filter(p => p.sheetIndex === activeSheetIndex).map((p) => {
                          const col = p.color || PIECE_COLOR_PALETTE[(p.pieceNumber - 1) % PIECE_COLOR_PALETTE.length];
                          const gradId = `g_${p.sheetIndex}_${p.pieceNumber}`;
                          const minSide = Math.min(p.width, p.height);
                          return (
                            <g key={`${p.sheetIndex}_${p.pieceNumber}`}>
                              <defs>
                                <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor={col} stopOpacity="0.85"/><stop offset="100%" stopColor={col} stopOpacity="0.6"/>
                                </linearGradient>
                              </defs>
                              <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={`url(#${gradId})`}
                                stroke={isDark ? '#050A14' : '#334155'} strokeWidth={Math.max(0.4, (options.kerfWidth||3)/10)} rx="0.3" />
                              {options.showLabels && (<>
                                <text x={p.x+p.width/2} y={p.y+p.height/2-(minSide>=20?3:0)} textAnchor="middle" dominantBaseline="central"
                                  fill={isDark ? '#050A14' : '#1E293B'} fontSize={Math.min(5.5,Math.max(2.5,minSide/12))}
                                  fontWeight="black" fontFamily="monospace">#{p.pieceNumber}</text>
                                {minSide>=10 && (
                                  <text x={p.x+p.width/2} y={p.y+p.height/2+(minSide>=20?3.5:2)} textAnchor="middle" dominantBaseline="central"
                                    fill={isDark ? '#050A14' : '#1E293B'} fontSize={Math.min(4.5,Math.max(2,minSide/14))}
                                    fontWeight="bold" fontFamily="monospace">{formatDisplayValue(p.height, displayUnit)}×{formatDisplayValue(p.width, displayUnit)} {displayUnit}</text>
                                )}
                              </>)}
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Export Actions */}
                <div className="grid grid-cols-4 gap-1.5">
                  {/* The three file-format labels are the formats themselves, so
                      they stay verbatim; the accessible name carries the
                      translated sentence. */}
                  <button onClick={handleDownloadJson} aria-label={t('atelier.exports.jsonAria')} className="py-2.5 rounded-xl bg-studio-panel/60 border border-studio-border hover:border-studio-border-hover text-slate-700 dark:text-slate-300 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
                    {t('atelier.exports.json')}
                  </button>
                  <button onClick={handleDownloadPng} aria-label={t('atelier.exports.pngAria')} className="py-2.5 rounded-xl bg-studio-panel/60 border border-studio-border hover:border-studio-border-hover text-slate-700 dark:text-slate-300 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileCode2 className="w-3.5 h-3.5 text-purple-400" />
                    {t('atelier.exports.png')}
                  </button>
                  <button onClick={handleDownloadDxf} aria-label={t('atelier.exports.dxfAria')} className="py-2.5 rounded-xl bg-studio-panel/60 border border-studio-border hover:border-studio-border-hover text-slate-700 dark:text-slate-300 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
                    {t('atelier.exports.dxf')}
                  </button>
                  <button onClick={handleDownloadPdf} disabled={isDownloadingPdf} className="col-span-4 mt-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20 transition-all disabled:opacity-40">
                    {isDownloadingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {isDownloadingPdf ? t('atelier.exports.pdfGenerating') : t('atelier.exports.pdf')}
                  </button>
                </div>

                {/* Sheet Breakdown */}
                {currentSheet && (
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)] gap-2.5">
                    <section className="p-3.5 rounded-xl bg-studio-panel/50 border border-studio-border/70">
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('atelier.cutOrder.title')}</h3>
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{tn('atelier.cutOrder.count', currentSheetPieces.length)}</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table aria-label={t('atelier.cutOrder.title')} className="min-w-full text-start text-[11px]">
                          <thead>
                            <tr className="border-b border-studio-border/70 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              <th scope="col" className="py-2 pe-3 font-bold">{t('atelier.cutOrder.number')}</th>
                              <th scope="col" className="py-2 pe-3 font-bold">{t('atelier.cutOrder.piece')}</th>
                              <th scope="col" className="py-2 pe-3 font-bold">{t('atelier.cutOrder.dimensions', { unit: displayUnit })}</th>
                              <th scope="col" className="py-2 font-bold">{t('atelier.cutOrder.rotation')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentSheetPieces.map((piece) => (
                              <tr key={piece.pieceNumber} className="border-b border-studio-border/40 last:border-b-0">
                                <td className="py-2 pe-3 font-mono font-bold text-brand-400" dir="ltr">{piece.pieceNumber}</td>
                                <td className="py-2 pe-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      aria-hidden="true"
                                      className="h-2.5 w-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: piece.color || PIECE_COLOR_PALETTE[(piece.pieceNumber - 1) % PIECE_COLOR_PALETTE.length] }}
                                    />
                                    <span className="truncate text-slate-700 dark:text-slate-300">{piece.name}</span>
                                  </div>
                                </td>
                                <td className="py-2 pe-3 font-mono text-slate-600 dark:text-slate-300 tabular-nums" dir="ltr">
                                  {formatDisplayValue(piece.height, displayUnit)} × {formatDisplayValue(piece.width, displayUnit)} {displayUnit}
                                </td>
                                <td className="py-2 text-slate-600 dark:text-slate-300">{t(piece.rotated ? 'atelier.cutOrder.rotated' : 'atelier.cutOrder.notRotated')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <div data-testid="offcuts-list" className="p-3.5 rounded-xl bg-studio-panel/50 border border-studio-border/70">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">{t('atelier.offcuts.title', { count: currentSheet.offcuts?.length || 0 })}</p>
                      <div className="space-y-1 max-h-[180px] overflow-y-auto">
                        {(currentSheet.offcuts||[]).map((off, i) => {
                          return (
                            <div key={off.id} data-testid="offcut-list-item" data-offcut-id={off.id} data-offcut-width={off.width} data-offcut-height={off.height} className="flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-studio-field/40 text-[11px] transition-colors gap-1">
                              <span className="text-slate-500 dark:text-slate-400 font-mono text-[10px] truncate">{t('atelier.offcuts.item', { index: i + 1 })}</span>
                              <span className="font-mono font-bold text-brand-400 text-[10px] tabular-nums" dir="ltr">
                                {formatDisplayValue(off.height, displayUnit)}×{formatDisplayValue(off.width, displayUnit)} {displayUnit}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Cost Breakdown — all four figures come verbatim from
                    result.costBreakdown (src/lib/costing.ts); this panel
                    never recomputes them. */}
                {result && (
                  <div className="p-3.5 rounded-xl bg-studio-panel/50 border border-studio-border/70 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.cost.breakdownTitle')}</p>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="p-2 rounded-lg bg-studio-canvas/50 text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.panels')}</span>
                        <span className="font-mono font-black text-white" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.materialCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-canvas/50 text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.edges')}</span>
                        <span className="font-mono font-black text-white" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.edgeCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-canvas/50 text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.labor')}</span>
                        <span className="font-mono font-black text-white" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.laborCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-canvas/50 text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.total')}</span>
                        <span className="font-mono font-black text-brand-400" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.subtotal ?? 0) })}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <EmptyState type="ready" />
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
