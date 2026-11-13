'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
  FileSpreadsheet,
  FileText,
  PackageOpen,
  BookmarkPlus,
  Trash2,
  TrendingUp,
  Scissors,
  Boxes,
  LayoutGrid,
  Settings2,
  ClipboardList,
  CheckCircle2,
} from 'lucide-react';
import {
  Sheet,
  Piece,
  OptimizationResult,
  OptimizationOptions,
  OPTIONS_DEFAULTS,
  DEFAULT_STOCK_SHEET,
  MaterialType,
  CutMode,
  getMaterialDef,
  repriceCostingInput,
  type EdgePriceMap,
} from '@/lib/cutting/binpacking';
import { computeCostBreakdown } from '@/lib/costing';
import {
  loadDeviceEdgePrices,
  saveDeviceEdgePrices,
  fetchAccountEdgePrices,
  saveAccountEdgePrices,
} from '@/lib/edge-prices';
import { isSamePanel } from '@/lib/panel-preset-rules';
import { PIECE_COLOR_PALETTE, getResolvedPieceColor } from '@/lib/pieces/catalog';
import {
  BUILT_IN_PRESETS,
  loadSavedPresets,
  savePreset,
  deletePreset,
  findDuplicatePreset,
  fetchAccountPresets,
  createAccountPresets,
  deleteAccountPreset,
  importDevicePresetsOnce,
  setDevicePresetPrice,
  setAccountPresetPrice,
  isPanelPrice,
  type PanelPreset,
} from '@/lib/panel-presets';
import { OptionsPanel } from '@/components/OptionsPanel';
import { PiecesManager } from '@/components/PiecesManager';
import { AuthModal } from '@/components/AuthModal';
import {
  savePendingWork,
  loadPendingWork,
  isFromThisTab,
  shouldOfferPendingWork,
  clearPendingWork,
  type PendingAction,
  type PendingWork,
} from '@/lib/pending-work';
import { QuotationDialog } from '@/components/QuotationDialog';
import { EmptyState } from '@/components/EmptyState';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';
import { OnboardingTour } from '@/components/OnboardingTour';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';
import { edgeBandingLabelKey, materialLabelKey, visionErrorKey } from '@/i18n/domain';
import { buildCostDetail, hasLaborCharge } from '@/lib/cost-detail';
import { writeLocalHistoryItem, type LocalHistoryItem } from '@/lib/history';
import { deriveQuotationPanels, deriveQuotationPieces } from '@/lib/quotation-items';
import { buildPdfPayload } from '@/lib/pdf-payload';
import { buildPersistedProjectPayload } from '@/lib/projects/persistence-payload';
import { downscaleDataUrl } from '@/lib/image-downscale';
import { readAnalysisPass, storeAnalysisPass } from '@/lib/billing/analysis-pass-store';
import {
  type DisplayUnit,
  DEFAULT_DISPLAY_UNIT,
  parseDisplayInputToCanonical,
  formatDisplayValue,
  readStoredDisplayUnit,
  writeStoredDisplayUnit,
  resolveProjectUnitMetadata,
} from '@/lib/units';

const DEFAULT_SHEETS: Sheet[] = [DEFAULT_STOCK_SHEET];

/**
 * The French name the default panel used to carry. It described the 278×208
 * size only, so it went stale as soon as the artisan typed another size (and
 * never followed the locale). A restored sheet still carrying it is unnamed:
 * its dimensions stand in, like any panel the artisan did not name.
 */
const LEGACY_DEFAULT_PANEL_LABEL = 'Panneau standard 278×208';
const withoutLegacyPanelLabel = (sheet: Sheet): Sheet =>
  sheet.label === LEGACY_DEFAULT_PANEL_LABEL ? { ...sheet, label: undefined } : sheet;

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

/** The edge sides /api/vision read for a scanned piece, or undefined when it
 *  has none. Only literal `true` counts, so a malformed reply bands nothing. */
function scannedEdges(piece: unknown): Piece['edges'] | undefined {
  const edges = (piece as { edges?: Record<string, unknown> } | null)?.edges;
  if (!edges || typeof edges !== 'object') return undefined;
  const sides = {
    left: edges.left === true,
    right: edges.right === true,
    top: edges.top === true,
    bottom: edges.bottom === true,
  };
  return sides.left || sides.right || sides.top || sides.bottom ? sides : undefined;
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
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
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
  // Lightweight thumbnail persisted with the project (history card preview).
  const [scanThumb, setScanThumb] = useState<string | null>(null);
  const [pdfGeneratedAt, setPdfGeneratedAt] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  // Which action opened the (shared) auth modal, so its onSuccess handler
  // resumes the right one instead of always re-triggering the PDF export.
  const [pendingAuthAction, setPendingAuthAction] = useState<'pdf' | 'quotation' | PendingAction | null>(null);
  // Work kept across a sign-in (src/lib/pending-work.ts): offered with a
  // button when it comes back in another tab, and the action to run once the
  // kept state is back on screen.
  const [resumeOffer, setResumeOffer] = useState<PendingWork | null>(null);
  const [resumeRequest, setResumeRequest] = useState<{ action: PendingAction; image?: string; resumed: boolean } | null>(null);
  // A resumed scan or run spends a credit: at most one per page load.
  const resumingRef = useRef(false);
  // A project opened from history wins over older kept work.
  const openedFromHistoryRef = useRef(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [isQuotationDialogOpen, setIsQuotationDialogOpen] = useState<boolean>(false);
  // The id /api/projects last confirmed saving, if any — the quotation
  // dialog merges its metadata into that same project's options_json.
  // Never client-guessed; only ever set from a successful save response.
  const [lastSavedProjectId, setLastSavedProjectId] = useState<string | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);
  const advancedOptionsRef = useRef<HTMLDivElement>(null);

  /** Opens the cutting-settings panel and scrolls it into view. */
  const openAdvancedOptions = () => {
    setShowAdvancedOptions(true);
    // Wait one frame so the panel is rendered before measuring where to scroll.
    requestAnimationFrame(() => {
      advancedOptionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
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
  // Panel presets: artisan-saved stock panels + management UI state. A
  // signed-in artisan's list lives in their account; the device list is for
  // anonymous use and is the fallback while the account store is unavailable.
  const [savedPresets, setSavedPresets] = useState<PanelPreset[]>([]);
  const [presetSource, setPresetSource] = useState<'device' | 'account'>('device');
  const [isPresetManageOpen, setIsPresetManageOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSavedPresets(loadSavedPresets());
    (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) return;
        let account = await fetchAccountPresets();
        if (account === null) return;
        // First signed-in visit on this device: copy its presets into the
        // account so nothing saved before is lost.
        if (await importDevicePresetsOnce(user.id)) account = (await fetchAccountPresets()) ?? account;
        if (cancelled) return;
        setSavedPresets(account);
        setPresetSource('account');
      } catch {
        /* the device list stays in use */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allPresets = [...BUILT_IN_PRESETS, ...savedPresets];

  // The artisan's price per metre for each edge-banding colour: in the
  // account when signed in (migration 015), on the device otherwise. A colour
  // without one keeps the catalog price.
  const [edgePrices, setEdgePrices] = useState<EdgePriceMap>({});
  const [edgePriceSource, setEdgePriceSource] = useState<'device' | 'account'>('device');
  const [edgePriceSaveFailed, setEdgePriceSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEdgePrices(loadDeviceEdgePrices());
    (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) return;
        let account = await fetchAccountEdgePrices();
        if (account === null) return;
        // First signed-in use: the prices set on this device become the account's.
        const device = loadDeviceEdgePrices();
        if (Object.keys(account).length === 0 && Object.keys(device).length > 0) {
          if (await saveAccountEdgePrices(device as Record<string, number>)) account = device;
        }
        if (cancelled) return;
        setEdgePrices(account);
        setEdgePriceSource('account');
      } catch {
        /* the device prices stay in use */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

    const activeSheet = sheets[0] || DEFAULT_SHEETS[0];
// Panel naming: the artisan can name a stock panel; without a name the
  // dimensions stand in. The draft syncs when the panel itself changes.
  const [panelNameDraft, setPanelNameDraft] = useState<string>('');

  // Custom project name (audit feature): empty means auto-name fallback.
  const [projectName, setProjectName] = useState<string>('');
  const [projectNameDraft, setProjectNameDraft] = useState<string>('');  const [presetNameDraft, setPresetNameDraft] = useState<string>('');
  // Price of the stock panel (MAD per panel), as typed; committed on blur.
  const [panelPriceDraft, setPanelPriceDraft] = useState<string>('');
  const [presetFeedback, setPresetFeedback] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    setPanelNameDraft(activeSheet.label || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet.id, activeSheet.label]);

  useEffect(() => {
    setPanelPriceDraft(isPanelPrice(activeSheet.pricePerSheet) ? String(activeSheet.pricePerSheet) : '');
  }, [activeSheet.pricePerSheet]);

  /** Applies the typed name to the current stock panel (payload `label`). */
const commitPanelName = () => {
    const name = panelNameDraft.trim();
    // Two panels must not carry the same name: uniqueness guard.
    const duplicate = sheets.some((s) => s.id !== activeSheet.id && (s.label || '') === name && name !== '');
    if (duplicate) {
      setPresetFeedback({ tone: 'warning', text: t('atelier.stock.nameDuplicate') });
      return;
    }
    setSheets([{ ...activeSheet, label: name || undefined }]);
    setPresetFeedback(null);
  };

  /** Saves the current stock panel as a reusable named preset. Panels of the
   *  same size are distinct when their material, colour or grain differ; only
   *  an identical panel is refused (see src/lib/panel-preset-rules.ts). */
  const handleSavePreset = async () => {
    const name = presetNameDraft.trim()
      || `${formatDisplayValue(activeSheet.height, displayUnit)}×${formatDisplayValue(activeSheet.width, displayUnit)} ${displayUnit}`;
    const preset = {
      name,
      height: activeSheet.height,
      width: activeSheet.width,
      material: activeSheet.material ?? undefined,
      color: activeSheet.color?.trim() || undefined,
      hasGrain: !!activeSheet.hasGrain,
      grainOrientation: activeSheet.hasGrain ? (activeSheet.grainOrientation ?? 'vertical') : undefined,
      ...(isPanelPrice(activeSheet.pricePerSheet) ? { pricePerSheet: activeSheet.pricePerSheet } : {}),
    };
    const duplicate = findDuplicatePreset(preset, savedPresets);
    if (duplicate) {
      setPresetFeedback({ tone: 'warning', text: t('atelier.stock.presetDuplicate', { name: duplicate.name }) });
      return;
    }
    if (presetSource === 'account') {
      const saved = await createAccountPresets([preset]);
      if (!saved.ok) {
        setPresetFeedback({ tone: 'warning', text: t(saved.error === 'PRESET_LIMIT' ? 'atelier.stock.presetLimit' : 'atelier.stock.presetSaveFailed') });
        return;
      }
      if (saved.duplicates.length > 0) {
        setPresetFeedback({ tone: 'warning', text: t('atelier.stock.presetDuplicate', { name: saved.duplicates[0].existingName }) });
        return;
      }
      setSavedPresets((current) => [...current, ...saved.created]);
    } else {
      savePreset(preset);
      setSavedPresets(loadSavedPresets());
    }
    setPresetNameDraft('');
    setPresetFeedback({ tone: 'success', text: t('atelier.stock.presetSavedOk', { name }) });
  };

  /** Removes a saved panel preset from the workshop's list. */
  const handleDeletePreset = async (id: string) => {
    if (presetSource === 'account') {
      if (!(await deleteAccountPreset(id))) {
        setPresetFeedback({ tone: 'warning', text: t('atelier.stock.presetSaveFailed') });
        return;
      }
      setSavedPresets((current) => current.filter((p) => p.id !== id));
    } else {
      deletePreset(id);
      setSavedPresets(loadSavedPresets());
    }
    setPresetFeedback({ tone: 'success', text: t('atelier.stock.presetDeleted') });
  };

  /** Colour and grain next to a saved preset's name, so two panels of the
   *  same size can be told apart in the list. */
  const presetDetails = (p: PanelPreset) =>
    [
      p.color?.trim(),
      p.hasGrain ? t(p.grainOrientation === 'horizontal' ? 'atelier.stock.grainHorizontal' : 'atelier.stock.grainVertical') : null,
      isPanelPrice(p.pricePerSheet) ? t('atelier.stock.presetPriceTag', { price: n(p.pricePerSheet) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  /**
   * Prices the plan on screen again after a price change, without a new
   * optimization: same pieces, same panels, new rates (see
   * repriceCostingInput). The PDF and the quote read this same result.
   */
  const repriceResult = (next: { sheet?: Sheet; edgePrices?: EdgePriceMap }) => {
    setResult((current) => {
      if (!current?.costingInput) return current;
      const costingInput = repriceCostingInput(current.costingInput, {
        edgePricesPerM: next.edgePrices ?? edgePrices,
        sheet: next.sheet ?? activeSheet,
        stockPricingOverrides: options.stockPricingOverrides,
      });
      return { ...current, costingInput, costBreakdown: computeCostBreakdown(costingInput) };
    });
  };

  /** Reads a typed price: '' clears it, '450', '450,5' or '450.5' set it, anything else is refused. */
  const parsePriceInput = (raw: string): number | null | 'invalid' => {
    const text = raw.trim().replace(',', '.');
    if (text === '') return null;
    const value = Number(text);
    return isPanelPrice(value) ? Math.round(value * 100) / 100 : 'invalid';
  };

  /** Applies the typed panel price to the stock panel (MAD per panel). */
  const commitPanelPrice = () => {
    const parsed = parsePriceInput(panelPriceDraft);
    if (parsed === 'invalid') {
      setPanelPriceDraft(isPanelPrice(activeSheet.pricePerSheet) ? String(activeSheet.pricePerSheet) : '');
      return;
    }
    if ((parsed ?? undefined) === activeSheet.pricePerSheet) return;
    const { pricePerSheet: _previous, ...rest } = activeSheet;
    void _previous;
    const nextSheet: Sheet = parsed === null ? rest : { ...rest, pricePerSheet: parsed };
    setSheets([nextSheet]);
    repriceResult({ sheet: nextSheet });
  };

  /** Sets (or, with null, resets to the catalog) the price per metre of one edge colour. */
  const handleEdgePriceChange = async (edgeId: string, price: number | null) => {
    const next: EdgePriceMap = { ...edgePrices };
    if (price === null) delete next[edgeId];
    else next[edgeId] = price;
    setEdgePrices(next);
    repriceResult({ edgePrices: next });
    if (edgePriceSource === 'account') {
      setEdgePriceSaveFailed(!(await saveAccountEdgePrices({ [edgeId]: price })));
    } else {
      saveDeviceEdgePrices(next);
    }
  };

  /** Changes the price of a saved panel; the stock panel follows when it is that panel. */
  const handlePresetPrice = async (preset: PanelPreset, raw: string) => {
    const parsed = parsePriceInput(raw);
    if (parsed === 'invalid' || (parsed ?? undefined) === preset.pricePerSheet) return;
    const updated = presetSource === 'account'
      ? await setAccountPresetPrice(preset.id, parsed)
      : setDevicePresetPrice(preset.id, parsed);
    if (!updated) {
      setPresetFeedback({ tone: 'warning', text: t('atelier.stock.presetSaveFailed') });
      return;
    }
    setSavedPresets((current) => current.map((p) => (p.id === preset.id ? { ...updated, builtIn: false } : p)));
    setPresetFeedback({ tone: 'success', text: t('atelier.stock.presetPriceSaved', { name: preset.name }) });
    const current = {
      height: activeSheet.height,
      width: activeSheet.width,
      material: activeSheet.material,
      color: activeSheet.color,
      hasGrain: activeSheet.hasGrain,
      grainOrientation: activeSheet.grainOrientation,
    };
    if (isSamePanel(current, preset)) {
      const { pricePerSheet: _previous, ...rest } = activeSheet;
      void _previous;
      const nextSheet: Sheet = parsed === null ? rest : { ...rest, pricePerSheet: parsed };
      setSheets([nextSheet]);
      repriceResult({ sheet: nextSheet });
    }
  };


  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { t, tn, n, locale } = useLocale();

  /** Commits the typed project name (no uniqueness constraint — several
   *  projects may share a name). Empty reverts to the auto-name fallback. */
  const commitProjectName = () => {
    const name = projectNameDraft.trim();
    setProjectName(name);
  };

  /** The name a saved project carries: custom > panel label > auto. */
  const derivedProjectName = projectName.trim()
    || activeSheet.label?.trim()
    || t(cutMode === '1d' ? 'atelier.project.nameBars' : 'atelier.project.nameSheets', {
      material: (activeSheet.material || 'mdf').toUpperCase(),
      count: pieces.reduce((s, p) => s + (p.quantity || 1), 0),
    });

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
    openedFromHistoryRef.current = !!savedProj;
    // Set alongside 'qatlia_saved_project' when a project is opened from
    // history (see history/page.tsx's handleLoadProject) — without this,
    // QuotationDialog only ever knew about the *last auto-saved* project
    // (lastSavedProjectId below), never the one the artisan actually
    // re-opened, so a quote generated right after opening a past project
    // would silently merge into the wrong project's options_json.
    // Re-validated here too (defense in depth against a stale/tampered
    // sessionStorage value) — /api/export-quotation's `projectId` must be a
    // genuine UUID or the whole quote request 400s.
    const restoredProjectIdRaw = sessionStorage.getItem('qatlia_restored_project_id');
    const restoredProjectId =
      restoredProjectIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restoredProjectIdRaw)
        ? restoredProjectIdRaw
        : null;
    if (savedProj) {
      try {
        const parsed = JSON.parse(savedProj);
        if (parsed.sheet) setSheets([withoutLegacyPanelLabel(parsed.sheet)]);
        if (Array.isArray(parsed.sheets)) setSheets(parsed.sheets.map(withoutLegacyPanelLabel));
        if (Array.isArray(parsed.pieces)) setPieces(normalizePiecesWithColors(parsed.pieces));
        if (typeof parsed.projectName === 'string' && parsed.projectName.trim()) {
          setProjectName(parsed.projectName.trim());
          setProjectNameDraft(parsed.projectName.trim());
        }
        setScanThumb(typeof parsed.scanThumb === 'string' ? parsed.scanThumb : null);
        setPdfGeneratedAt(typeof parsed.pdfGeneratedAt === 'string' ? parsed.pdfGeneratedAt : null);
        if (parsed.options) setOptions((prev) => ({ ...prev, ...parsed.options }));
        if (restoredProjectId) setLastSavedProjectId(restoredProjectId);
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
        window.setTimeout(() => {
          sessionStorage.removeItem('qatlia_saved_project');
          sessionStorage.removeItem('qatlia_restored_project_id');
        }, 0);
      } catch (e) {
        console.error('Erreur restauration projet:', e);
        // Malformed JSON will never parse successfully, so don't leave it
        // sitting in sessionStorage forever — clear it right away.
        sessionStorage.removeItem('qatlia_saved_project');
        sessionStorage.removeItem('qatlia_restored_project_id');
      }
    }
  }, []);

  const handleDisplayUnitChange = (unit: DisplayUnit) => {
    setDisplayUnit(unit);
    if (typeof window !== 'undefined') {
      writeStoredDisplayUnit(window.localStorage, unit);
    }
  };


  /** The edge margin is kept on the panel, in cm; the setting is in mm like the kerf. */
  const handleEdgeMarginChange = (marginMm: number) => {
    setSheets(prev => prev.map(s => ({ ...s, margin: marginMm / 10 })));
  };

  const handleOptionsChange = (newOpts: OptimizationOptions) => {
    setOptions(newOpts);
    setSheets(prev => prev.map(s => ({ ...s, kerf: newOpts.kerfWidth / 10, grainDirection: newOpts.grainDirection })));
  };

  const persistProject = async (
    nextResult: OptimizationResult,
    source: 'optimize' | 'pdf',
    // Values set in this same event handler, which the state above does not
    // carry yet (React applies setState on the next render).
    overrides: { pdfGeneratedAt?: string } = {}
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
      // Custom project name (when the artisan named it) > panel label > auto.
      name: derivedProjectName,
      projectName: projectName.trim() || undefined,
      scanThumb: scanThumb || undefined,
      pdfGeneratedAt: overrides.pdfGeneratedAt || pdfGeneratedAt || undefined,
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

        // The local history entry above now carries explicit unit metadata, so
    // this project no longer owes a migration rewrite on its next save —
    // but the historical marker itself is carried forward, not reset.
    setPendingUnitMigration(false);
    setMigratedFromLegacyUnit(persistedMigratedFromLegacyUnit);

    // History duplication fix: a signed-in save goes to the cloud ONLY —
    // the local entry was previously written too, and the merge could show
    // the same run twice. Local history is now the fallback for anonymous
    // users and failed uploads, never an addition to a successful cloud save.
    let savedToCloud = false;
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          savedToCloud = true;
          const data = await res.json().catch(() => null);
          // The quotation dialog merges its metadata into *this* saved
          // project's options_json (see /api/export-quotation) — only once
          // the server confirms the save, never a client-guessed id.
          if (data?.success && typeof data.projectId === 'string') setLastSavedProjectId(data.projectId);
        }
      }
    } catch (err) {
      console.error('Erreur auto-save projet:', err);
    }
    if (!savedToCloud) {
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
    }
  };

  /**
   * Marks the saved project as having a PDF. When the plan was already saved
   * (by the optimization, or reopened from history), only that project's
   * marker is updated: saving the whole project again would add a duplicate
   * entry to the history. A new save remains the fallback when there is no
   * saved project to update.
   */
  const recordPdfGenerated = async (generatedAt: string) => {
    if (!result) return;
    if (lastSavedProjectId) {
      try {
        const res = await fetch(`/api/projects/${lastSavedProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfGeneratedAt: generatedAt }),
        });
        if (res.ok) return;
      } catch (err) {
        console.error('Erreur enregistrement PDF dans l’historique:', err);
      }
    }
    await persistProject(result, 'pdf', { pdfGeneratedAt: generatedAt });
  };

  /**
   * A signed-out visitor asked for a scan or a run: keep their work (photo,
   * pieces, panel, settings) and ask them to sign in. The action resumes on
   * its own right after, even through the Google round trip.
   */
  const askSignInKeepingWork = (action: PendingAction, image?: string) => {
    try {
      savePendingWork(window.localStorage, window.sessionStorage, {
        action,
        image,
        pieces,
        sheets,
        options: options as unknown as Record<string, unknown>,
        cutMode,
        projectName: projectName.trim() || undefined,
      });
    } catch {
      /* the modal still opens; only the automatic resume is lost */
    }
    // Nothing was spent: the resume after this sign-in may run.
    resumingRef.current = false;
    setPendingAuthAction(action);
    setIsAuthModalOpen(true);
  };

  /** Puts kept work back on screen. */
  const applyPendingWork = (work: PendingWork) => {
    if (work.pieces.length > 0) setPieces(normalizePiecesWithColors(work.pieces as Piece[]));
    if (work.sheets.length > 0) setSheets(work.sheets as Sheet[]);
    if (work.options) setOptions((prev) => ({ ...prev, ...(work.options as Partial<OptimizationOptions>) }));
    if (work.cutMode) setCutMode(work.cutMode);
    if (work.projectName) {
      setProjectName(work.projectName);
      setProjectNameDraft(work.projectName);
    }
    // The photo is not put in the scan preview: that card reads "analysed",
    // and it has not been yet. The resume banner shows it instead.
  };

  /**
   * Runs the kept action. The entry is cleared before anything is sent, and
   * a ref allows one resume per page, so a credit is never spent twice.
   */
  const resumePendingWork = (work: PendingWork, { resumed }: { resumed: boolean }) => {
    if (resumingRef.current) return;
    resumingRef.current = true;
    clearPendingWork(window.localStorage, window.sessionStorage);
    setResumeOffer(null);
    applyPendingWork(work);
    setResumeRequest({ action: work.action, image: work.image, resumed });
  };

  const handleRunOptimization = async ({ resumed = false }: { resumed?: boolean } = {}) => {
    setIsOptimizing(true);
    setOptimizeError(null);
    try {
      // Credit-metered run: 1 credit per complete analysis. The server debits
      // atomically before computing unless the stored analysis pass (from the
      // scan or the last paid run) still covers this re-optimization. The
      // client-side optimizer remains only as a display fallback.
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: { ...activeSheet, kerf: options.kerfWidth },
          sheets,
          pieces,
          options: { ...options, edgePricesPerM: edgePrices },
          cutMode,
          analysisPass: readAnalysisPass() ?? undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        if (res.status === 401 && !resumed) {
          // Keep the pieces and run again right after sign-in.
          askSignInKeepingWork('optimize');
        } else if (res.status === 401) {
          setOptimizeError(t('atelier.optimize.authRequired'));
        } else if (res.status === 402) {
          setOptimizeError(t('atelier.optimize.noCredits'));
        } else if (data?.error === 'WORKLOAD_TOO_LARGE') {
          // Rejected before the debit — no credit was spent on this run.
          setOptimizeError(t('atelier.optimize.tooLarge', { max: String(data.maxPieces ?? '') }));
        } else {
          setOptimizeError(t('atelier.optimize.failed'));
        }
        return;
      }

      storeAnalysisPass(data.analysisPass);
      const optResult = data.result as OptimizationResult;
      setResult(optResult);
      setActiveSheetIndex(0);
      if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
      void persistProject(optResult, 'optimize');
    } catch {
      setOptimizeError(t('atelier.optimize.network'));
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Lets the same photo be picked again, which onChange would otherwise ignore.
    e.target.value = '';

    setIsProcessingVision(true);
    setVisionError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        // A phone photo is 1–4 MB of base64; Gemini reads a cut list fine at
        // 1600px, so shrink before the upload — it is the slowest leg of the
        // scan on a workshop connection. A failed downscale (no canvas, exotic
        // codec) must never block a scan: fall back to the original bytes.
        const scanImage = (await downscaleDataUrl(base64, 1600, 0.8)) ?? base64;
        await runScan(scanImage);
      } catch (err) {
        setVisionError('atelier.visionError.network');
        setIsProcessingVision(false);
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  };

  /**
   * Analyses a (downscaled) cut-list photo. A signed-out visitor is asked to
   * sign in first, with the photo kept; `resumed` marks the automatic run
   * after that sign-in, which never asks again.
   */
  const runScan = async (scanImage: string, { resumed = false }: { resumed?: boolean } = {}) => {
    setIsProcessingVision(true);
    setVisionError(null);
    try {
      if (!resumed) {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) {
          askSignInKeepingWork('scan', scanImage);
          return;
        }
      }
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: scanImage,
          sheetMaterial: activeSheet.material || 'mdf',
        }),
      });

      const data = await res.json();
      if (data.success && Array.isArray(data.pieces) && data.pieces.length > 0) {
        // The thumbnail is saved with the project and shown in history:
        // 600px keeps the cut list readable while staying well under the
        // server's size cap (SCAN_THUMB_MAX_CHARS), since the history page
        // loads every project's thumbnail at once.
        setPreviewImage(scanImage);
        void downscaleDataUrl(scanImage, 600, 0.7).then(setScanThumb);
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
            name: p.name || t('pieces.defaultName', { index: i + 1 }),
            height: Math.round(h * 10) / 10,
            width: Math.round(w * 10) / 10,
            quantity,
            material: (p.material as MaterialType) || (activeSheet.material || 'mdf'),
            rotatable: true,
            // Chants read from the sheet's edge column, like a manual
            // toggle: sides only, no banding type chosen yet.
            ...(scannedEdges(p) ? { edges: scannedEdges(p) } : {}),
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
        storeAnalysisPass(data.analysisPass);
        // The server is the only authority on the balance; it is echoed back
        // only when a credit was actually debited.
        if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
      } else {
        if (res.status === 401 && !resumed) {
          // Signed out since the check above: keep the photo, ask again.
          askSignInKeepingWork('scan', scanImage);
          return;
        }
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

  // Runs a resumed action once the kept pieces and panel are on screen.
  useEffect(() => {
    if (!resumeRequest) return;
    const request = resumeRequest;
    setResumeRequest(null);
    if (request.action === 'scan' && request.image) void runScan(request.image, { resumed: request.resumed });
    else if (request.action === 'optimize') void handleRunOptimization({ resumed: request.resumed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeRequest]);

  // Work kept before a sign-in. Back in the tab that asked for it (Google
  // round trip, reload): resume on its own once signed in. In another tab
  // (the email-confirmation link): show it once and offer a button, since a
  // resumed action spends a credit.
  useEffect(() => {
    if (openedFromHistoryRef.current) return;
    const work = loadPendingWork(window.localStorage);
    if (!work) return;
    let cancelled = false;
    const sameTab = isFromThisTab(window.sessionStorage, work);
    (async () => {
      let signedIn = false;
      try {
        const { data: { user } } = await createClient().auth.getUser();
        signedIn = !!user;
      } catch {
        /* treated as signed out */
      }
      if (cancelled) return;
      if (sameTab) {
        if (signedIn) {
          resumePendingWork(work, { resumed: true });
        } else {
          // Came back without signing in: the work is shown with its button,
          // which asks for the sign-in again; signing in finishes it.
          applyPendingWork(work);
          setPendingAuthAction(work.action);
          setResumeOffer(work);
        }
        return;
      }
      if (!shouldOfferPendingWork(window.localStorage, window.sessionStorage, work)) return;
      applyPendingWork(work);
      setResumeOffer(work);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleDownloadCsv = () => {
    if (!result) return;
    // Measurements CSV: one row per piece from the cut list, dimensions in
    // canonical cm (same convention as the JSON export). Client-side like
    // the JSON/PNG exports — no API route, no auth, exports stay free.
    const header = ['#', 'name', 'quantity', 'height_cm', 'width_cm', 'material', 'rotatable'];
    const rows = pieces.map((piece, index) => [
      String(index + 1),
      piece.name ?? '',
      String(piece.quantity),
      String(piece.height),
      String(piece.width),
      piece.material ?? '',
      piece.rotatable === false ? '0' : '1',
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            // RFC 4180: quote fields containing separator, quote, or newline
            const needsQuotes = /[",\n\r]/.test(cell);
            const escaped = cell.replace(/"/g, '""');
            return needsQuotes ? `"${escaped}"` : cell;
          })
          .join(','),
      )
      .join('\r\n');
    // UTF-8 BOM so Excel opens accents and Arabic names correctly.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qatlia_pieces_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
          projectName: 'QatliA_CNC_Plan',
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
      setPendingAuthAction('pdf');
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
          buildPdfPayload(derivedProjectName, activeSheet, pieces, result, displayUnit, locale)
        ),
      });

      if (res.ok) {
        const generatedAt = new Date().toISOString();
        setPdfGeneratedAt(generatedAt);
        await recordPdfGenerated(generatedAt);

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

  // What each cost total is made of, regrouped from the input the optimizer
  // priced (src/lib/cost-detail.ts) — the same detail the PDF report prints.
  const costDetail = result?.costingInput ? buildCostDetail(result.costingInput) : null;
  /** At most `decimals` decimals, in the reader's locale (2,9768 ; 6,3 ; 8). */
  const detailNumber = (value: number, decimals: number) => n(value, { maximumFractionDigits: decimals });
  const detailMoney = (value: number) => n(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Derived straight from the optimizer's own result (every sheet actually
  // used, every piece actually placed) — never from a user-editable total —
  // so the quotation's detail table can only ever show what the plan
  // actually produced (Task 8 remediation — item 1). Tagged `{ ok }` results:
  // a plan that genuinely aggregates to more distinct groups than the
  // schema-bounded maximum is surfaced as a visible, localized error below
  // rather than silently truncated (Task 8 remediation — re-review, item 5).
  // `useMemo`, never a conditional hook, so this always runs on every render
  // regardless of whether `result` is set yet.
  const panelsResult = useMemo(
    () => (result ? deriveQuotationPanels(result) : { ok: true as const, panels: [] }),
    [result]
  );
  const piecesResult = useMemo(
    () => (result ? deriveQuotationPieces(result) : { ok: true as const, pieces: [] }),
    [result]
  );
  const quotationPanels = panelsResult.ok ? panelsResult.panels : [];
  const quotationPieces = piecesResult.ok ? piecesResult.pieces : [];
  // Visible, localized item-limit error — non-null disables quote generation
  // in QuotationDialog rather than ever shipping a document silently missing
  // panels/pieces.
  const quotationItemLimitError: string | null = !panelsResult.ok
    ? t('quotation.errors.tooManyPanelGroups', { count: panelsResult.distinctCount, max: panelsResult.max })
    : !piecesResult.ok
    ? t('quotation.errors.tooManyPieceGroups', { count: piecesResult.distinctCount, max: piecesResult.max })
    : null;

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased selection:bg-brand-400 selection:text-black">
      {/* Top Navbar Studio */}
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-500/[0.04] to-transparent pointer-events-none" />
        {/* No overflow clipping on this row: the account menu's dropdown is
            absolutely positioned under its chip and must escape the header. */}
        <div className="max-w-7xl mx-auto flex min-w-0 items-center justify-between px-4 sm:px-8 h-16">
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-brand-400">
              <QatlIALogo size="md" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-[17px] tracking-tight text-slate-900 dark:text-white">QatliA</span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-brand-400/10 text-brand-400 border border-brand-500/20 tracking-wide">
                  PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 hidden sm:block -mt-0.5">{t('atelier.header.tagline')}</p>
            </div>
          </div>

          <div role="group" aria-label={t('atelier.header.actionsAria')} className="flex min-w-0 items-center gap-2">
            {/* Only the toolbar itself scrolls sideways on a narrow screen. The
                account menu stays outside this container: `overflow-x-auto`
                computes `overflow-y` to `auto` too, which would clip its
                dropdown just as the row's old `overflow-hidden` did. */}
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain">
              {/* Mode Toggle: 2D / 1D — the two labels are domain notation, not
                  prose, so the pair keeps its LTR order in every locale; only the
                  tooltip that explains them is translated. */}
              <div dir="ltr" className="flex items-center p-0.5 rounded-lg bg-studio-field border border-studio-border">
                <button type="button" onClick={() => setCutMode('2d')} aria-pressed={cutMode === '2d'} title={t('atelier.header.cutMode2dAria')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${cutMode === '2d' ? 'bg-brand-400 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}>
                  2D
                </button>
                <button type="button" onClick={() => setCutMode('1d')} aria-pressed={cutMode === '1d'} title={t('atelier.header.cutMode1dAria')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${cutMode === '1d' ? 'bg-brand-400 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}>
                  1D
                </button>
              </div>

              <Link
                href="/history"
                aria-label={t('atelier.header.history')}
                className="group relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:text-white hover:bg-studio-panel transition-all"
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
                className="group relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-400/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 hover:border-brand-500/40 text-xs font-semibold transition-all"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-400" />
                </span>
                <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" />
                <span className="font-mono font-bold" dir="ltr">{userCredits === null ? '—' : n(userCredits)}</span>
                <span className="text-[10px] opacity-80 hidden sm:inline">{t('atelier.header.credits')}</span>
              </Link>
            </div>

            {userEmail ? (
              <AccountMenu email={userEmail} />
            ) : (
              <Link
                href="/auth/login"
                className="px-4 py-2 rounded-lg bg-white dark:bg-studio-field hover:bg-slate-100 text-slate-950 font-bold text-xs whitespace-nowrap transition-all shadow-sm hover:shadow-md"
              >
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6">
        <div className="space-y-4">

          {/* Pilotage bar — the workspace navigation, back on top: as a left
              rail it ate 14rem of every row below, which is what squeezed the
              pieces table. It sticks under the header (h-16 = top-16) and is the
              only element allowed to scroll sideways on a narrow screen. */}
          <nav
            aria-label={t('atelier.sidebar.title')}
            className="sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 border-b border-studio-border bg-studio-canvas/85 backdrop-blur-xl"
          >
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain">
              <p className="hidden xl:block shrink-0 pe-3 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
                {t('atelier.sidebar.title')}
              </p>

              <a href="#plan-top" className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors bg-brand-400/10 text-brand-500 dark:text-brand-400">
                <LayoutGrid className="w-4 h-4" />
                {t('atelier.sidebar.navOptimization')}
              </a>
              <a href="#stock-card" className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors text-slate-600 dark:text-slate-300 hover:bg-studio-panel hover:text-slate-900 dark:hover:text-white">
                <PackageOpen className="w-4 h-4" />
                {t('atelier.sidebar.navMaterials')}
              </a>
              <Link href="/history" className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors text-slate-600 dark:text-slate-300 hover:bg-studio-panel hover:text-slate-900 dark:hover:text-white">
                <History className="w-4 h-4" />
                {t('atelier.header.history')}
              </Link>
              <button
                type="button"
                onClick={() => setIsQuotationDialogOpen(true)}
                disabled={!result?.costingInput}
                className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors text-slate-600 dark:text-slate-300 hover:bg-studio-panel hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <FileText className="w-4 h-4" />
                {t('atelier.sidebar.navQuotation')}
              </button>
              {/* The settings panel sits under the pieces list, far below the
                  fold: this entry opens it and brings it into view, never
                  toggles it shut out of sight. */}
              <button
                type="button"
                onClick={openAdvancedOptions}
                aria-controls="advanced-cutting-options"
                className="inline-flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors text-slate-600 dark:text-slate-300 hover:bg-studio-panel hover:text-slate-900 dark:hover:text-white"
              >
                <Settings2 className="w-4 h-4" />
                {t('atelier.sidebar.navCutSettings')}
              </button>

              {/* Machine setup figures, pushed to the trailing edge. */}
              <div className="ms-auto flex shrink-0 items-center gap-2 ps-3">
                <p className="hidden lg:block font-mono text-[10px] text-slate-500" dir="ltr">
                  {formatDisplayValue(activeSheet.height, displayUnit)} × {formatDisplayValue(activeSheet.width, displayUnit)} {displayUnit}
                </p>
                {/* Kerf chip (Stitch header pattern): the blade width is a technical
                    figure — mono, amber-tinted, always visible for machine setup. */}
                <div
                  dir="ltr"
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-400/10 border border-brand-500/25 text-brand-500 dark:text-brand-400 text-xs font-mono font-bold"
                  title={t('options.kerf.title')}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400" aria-hidden="true" />
                  {t('options.kerf.chip', { value: n(options.kerfWidth, { maximumFractionDigits: 1 }) })}
                </div>
              </div>
            </div>
          </nav>

          <div className="min-w-0 w-full space-y-4">

            {/* Project strip — always visible, independent of the result state. */}
            <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
              <span className="w-8 h-8 rounded-lg bg-brand-400/10 border border-brand-500/25 flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-brand-500 dark:text-brand-400" />
              </span>
              {/* The job name is saved as the project's name in history, so it
                  reads as a labelled field rather than a title nobody edits. */}
              <div className="min-w-0 flex-1 sm:flex-none">
                <label htmlFor="project-name-input" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('atelier.project.nameLabel')}
                </label>
                <input
                  id="project-name-input"
                  value={projectNameDraft}
                  onChange={(e) => setProjectNameDraft(e.target.value)}
                  onBlur={commitProjectName}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder={t('atelier.project.namePlaceholder')}
                  maxLength={120}
                  data-testid="project-name-input"
                  className="mt-0.5 block w-full sm:w-[260px] rounded-lg bg-studio-field border border-studio-border px-2.5 py-1.5 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 placeholder:font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                {/* Same figures as the cut-list chip: pieces are quantities summed,
                    lines are rows (counting distinct names merged same-named rows). */}
                <p className="text-[10px] text-slate-500 font-mono">
                  {t('pieces.counts', {
                    qty: pieces.reduce((sum, p) => sum + (p.quantity || 1), 0),
                    rows: tn('pieces.rowCount', pieces.length),
                  })}
                </p>
              </div>
              {result && (
                <span className="ms-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3" /> {t('atelier.project.optimized')}
                </span>
              )}
            </div>

            <div id="plan-top" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* LEFT COLUMN: Controls & Input Studio (5 cols — widened once the
              pilotage rail moved to the top bar: the pieces table lives here and
              was truncating piece names and the "Chants" header at 4 cols. The
              visualizer keeps the wider stage at 7 cols. */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Work kept across a sign-in, back in another tab: one explicit
                click resumes it (it spends a credit), or it is dismissed. */}
            {resumeOffer && (
              <div role="status" className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl bg-brand-400/10 border border-brand-500/30">
                {resumeOffer.image && (
                  <img src={resumeOffer.image} alt="" className="w-12 h-12 object-cover rounded-lg border border-studio-border" />
                )}
                <p className="flex-1 min-w-[140px] text-xs font-bold text-slate-800 dark:text-slate-100">
                  {t(resumeOffer.action === 'scan' ? 'atelier.resume.scan' : 'atelier.resume.optimize')}
                </p>
                <button
                  type="button"
                  onClick={() => resumePendingWork(resumeOffer, { resumed: false })}
                  className="px-3 py-2 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-black transition-colors"
                >
                  {t(resumeOffer.action === 'scan' ? 'atelier.resume.runScan' : 'atelier.resume.runOptimize')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearPendingWork(window.localStorage, window.sessionStorage);
                    setResumeOffer(null);
                  }}
                  className="px-2.5 py-2 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  {t('atelier.resume.dismiss')}
                </button>
              </div>
            )}

            {/* Quick Actions: Hero Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Take Photo Card */}
              <label className="group relative flex flex-col gap-3 p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm hover:border-sky-500/40 hover:bg-studio-field cursor-pointer transition-all duration-200 overflow-hidden">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} disabled={isProcessingVision} />
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center group-hover:scale-105 group-hover:bg-sky-500/15 transition-all">
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
              <label className="group relative flex flex-col gap-3 p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm hover:border-brand-500/40 hover:bg-studio-field cursor-pointer transition-all duration-200 overflow-hidden">
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isProcessingVision} />
                <div className="absolute inset-0 bg-gradient-to-br from-brand-500/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-lg bg-brand-400/10 border border-brand-500/20 flex items-center justify-center group-hover:scale-105 group-hover:bg-brand-500/15 transition-all">
                    <ImageIcon className="w-5 h-5 text-brand-400" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:text-white transition-colors">{t('atelier.scan.uploadTitle')}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{t('atelier.scan.uploadDesc')}</p>
                  </div>
                </div>
                <span className="self-start px-2 py-0.5 rounded-md bg-brand-400/10 text-brand-400 text-[10px] font-bold font-mono border border-brand-500/20">JPG PNG WebP</span>
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
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewImage} alt={t('atelier.scan.previewAlt')} className="w-12 h-12 object-cover rounded-lg border border-emerald-500/30 shadow-sm" />
                <div className="text-xs">
                  <span className="text-emerald-400 font-bold block">{t('atelier.scan.analyzedTitle')}</span>
                  <span className="text-[11px] text-emerald-300/70 font-mono">{tn('atelier.scan.analyzedCount', pieces.length)}</span>
                </div>
              </div>
            )}

            {/* Processing Banner */}
            {isProcessingVision && (
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                <div className="text-xs">
                  <span className="text-sky-300 font-bold block">{t('atelier.scan.processingTitle')}</span>
                  <span className="text-[11px] text-sky-400/60">{t('atelier.scan.processingDesc')}</span>
                </div>
              </div>
            )}

            {visionError && (
              <div role="alert" className="flex items-center gap-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-xs text-rose-300 font-medium">{t(visionError)}</span>
              </div>
            )}

            {/* Stock Panel Card */}
            <div id="stock-card" className="overflow-hidden rounded-xl bg-studio-panel border border-studio-border shadow-sm">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-studio-border">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-brand-400/10 border border-brand-500/20 flex items-center justify-center">
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
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${displayUnit === unit ? 'bg-brand-400 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              <div className={cutMode === '1d' ? 'p-4 grid grid-cols-2 gap-3' : 'p-4 grid grid-cols-3 gap-3'}>
                {cutMode === '1d' ? null : <div className="rounded-lg bg-studio-field border border-studio-border px-3 py-2 space-y-0.5 focus-within:border-brand-500/50 focus-within:ring-1 focus-within:ring-brand-500/20 transition-all">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.stock.heightLabel', { unit: displayUnit })}</label>
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
                    className="w-full bg-transparent text-slate-900 dark:text-white font-mono font-black text-xl tracking-tight text-end outline-none border-none p-0 focus:ring-0"
                  />
                </div>}
                <div className="rounded-lg bg-studio-field border border-studio-border px-3 py-2 space-y-0.5 focus-within:border-brand-500/50 focus-within:ring-1 focus-within:ring-brand-500/20 transition-all">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t(cutMode === '1d' ? 'atelier.stock.lengthLabel' : 'atelier.stock.widthLabel', { unit: displayUnit })}</label>
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
                    className="w-full bg-transparent text-slate-900 dark:text-white font-mono font-black text-xl tracking-tight text-end outline-none border-none p-0 focus:ring-0"
                  />
                </div>
                <div className="rounded-lg bg-studio-field border border-studio-border px-3 py-2 space-y-0.5">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.stock.materialLabel')}</label>
                  <select
                    value={activeSheet.material || 'mdf'}
                    aria-label={t('atelier.stock.materialAria')}
                    onChange={(e) => { setSheets([{ ...activeSheet, material: e.target.value as MaterialType }]); }}
                    className="w-full bg-transparent text-brand-500 dark:text-brand-400 font-bold text-sm outline-none border-none p-0 focus:ring-0"
                  >
                    {STOCK_MATERIAL_VALUES.map((material) => (
                      <option key={material} value={material}>{t(materialLabelKey(material))}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Grain (ramage): declare the panel as grained and its grain
                  direction; constrained pieces then follow it. */}
              <div className="flex flex-wrap items-center gap-3 px-4 pb-3 -mt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!activeSheet.hasGrain}
                    onChange={(e) => setSheets([{ ...activeSheet, hasGrain: e.target.checked }])}
                    aria-label={t('atelier.stock.grainToggleAria')}
                    className="rounded text-brand-500 bg-studio-field border-studio-border-hover w-3.5 h-3.5"
                  />
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{t('atelier.stock.grainToggle')}</span>
                </label>
                {activeSheet.hasGrain && (
                  <div role="group" aria-label={t('atelier.stock.grainOrientationAria')} className="flex items-center p-0.5 rounded-lg bg-studio-field border border-studio-border">
                    {(['vertical', 'horizontal'] as const).map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => setSheets([{ ...activeSheet, grainOrientation: dir }])}
                        aria-pressed={activeSheet.grainOrientation === dir}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${activeSheet.grainOrientation === dir ? 'bg-brand-400 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {t(`atelier.stock.grain${dir === 'vertical' ? 'Vertical' : 'Horizontal'}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Panel presets: pick a stock size, name it, save or delete it */}
              <div className="flex flex-wrap items-center gap-2 px-4 pb-2 -mt-1">
                <div className="relative flex-1 min-w-[180px]">
                  <PackageOpen className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 z-10" aria-hidden="true" />
                  <select
                    value=""
                    aria-label={t('atelier.stock.presetAria')}
                    onChange={(e) => {
                      const preset = allPresets.find((p) => p.id === e.target.value);
                      if (!preset) return;
                      // A saved panel brings its grain back; a standard size
                      // leaves the current grain setting alone.
                      const grain = preset.builtIn
                        ? {}
                        : { hasGrain: !!preset.hasGrain, grainOrientation: preset.hasGrain ? preset.grainOrientation ?? 'vertical' : undefined };
                      // A saved panel also brings its colour and its price; a
                      // standard size has no price of its own (catalog price).
                      const { pricePerSheet: _previousPrice, ...withoutPrice } = activeSheet;
                      void _previousPrice;
                      const nextSheet: Sheet = {
                        ...withoutPrice,
                        height: preset.height,
                        width: preset.width,
                        material: (preset.material as MaterialType) || activeSheet.material,
                        ...grain,
                        ...(preset.builtIn ? {} : { color: preset.color || undefined }),
                        ...(isPanelPrice(preset.pricePerSheet) ? { pricePerSheet: preset.pricePerSheet } : {}),
                      };
                      setSheets([nextSheet]);
                      setActiveSheetIndex(0);
                      repriceResult({ sheet: nextSheet });
                    }}
                    className="w-full appearance-none bg-studio-field border border-studio-border hover:border-studio-border-hover rounded-lg py-2 ps-8 pe-3 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50 cursor-pointer transition-colors [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                  >
                    <option value="" disabled>{t('atelier.stock.presetPlaceholder')}</option>
                    <optgroup label={t('atelier.stock.presetBuiltIn')}>
                      {BUILT_IN_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                    {savedPresets.length > 0 && (
                      <optgroup label={t('atelier.stock.presetSaved')}>
                        {savedPresets.map((p) => {
                          const details = presetDetails(p);
                          return (
                            <option key={p.id} value={p.id}>{details ? `${p.name} — ${details}` : p.name}</option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                  <svg className="w-3 h-3 text-slate-400 pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
                  </svg>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSavePreset()}
                  aria-label={t('atelier.stock.savePresetAria')}
                  className="px-3 py-2 rounded-lg bg-studio-field border border-studio-border hover:border-brand-500/50 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-brand-500 dark:hover:text-brand-400 flex items-center gap-1.5 transition-colors"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  {t('atelier.stock.savePreset')}
                </button>
                {savedPresets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsPresetManageOpen((v) => !v)}
                    className="px-2.5 py-2 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    aria-expanded={isPresetManageOpen}
                  >
                    {t('atelier.stock.managePresets')}
                  </button>
                )}
              </div>

              {/* Panel name + preset name: the panel's own identity and the
                  name under which "Sauvegarder" stores it. */}
              <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
                <div className="flex-1 min-w-[160px] space-y-1">
                  <label htmlFor="panel-name-input" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                    {t('atelier.stock.panelNameLabel')}
                  </label>
                  <input
                    id="panel-name-input"
                    type="text"
                    value={panelNameDraft}
                    onChange={(e) => setPanelNameDraft(e.target.value)}
                    onBlur={commitPanelName}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    placeholder={t('atelier.stock.panelNamePlaceholder')}
                    aria-label={t('atelier.stock.panelNameLabel')}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  />
                </div>
                <div className="flex-1 min-w-[160px] space-y-1">
                  <label htmlFor="preset-name-input" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                    {t('atelier.stock.presetNameLabel')}
                  </label>
                  <input
                    id="preset-name-input"
                    type="text"
                    value={presetNameDraft}
                    onChange={(e) => setPresetNameDraft(e.target.value)}
                    placeholder={t('atelier.stock.presetNamePlaceholder')}
                    aria-label={t('atelier.stock.presetNameLabel')}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  />
                </div>
                <div className="flex-1 min-w-[160px] space-y-1">
                  <label htmlFor="preset-color-input" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                    {t('atelier.stock.presetColorLabel')}
                  </label>
                  <input
                    id="preset-color-input"
                    type="text"
                    value={activeSheet.color ?? ''}
                    onChange={(e) => setSheets([{ ...activeSheet, color: e.target.value || undefined }])}
                    onBlur={() => repriceResult({ sheet: activeSheet })}
                    maxLength={60}
                    placeholder={t('atelier.stock.presetColorPlaceholder')}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                  />
                </div>
                {cutMode === '2d' && (
                  <div className="flex-1 min-w-[160px] space-y-1">
                    <label htmlFor="panel-price-input" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                      {t('atelier.stock.panelPriceLabel')}
                    </label>
                    <input
                      id="panel-price-input"
                      data-testid="panel-price-input"
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={panelPriceDraft}
                      onChange={(e) => setPanelPriceDraft(e.target.value)}
                      onBlur={commitPanelPrice}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      placeholder={t('atelier.stock.panelPricePlaceholder', { price: n(getMaterialDef(activeSheet.material).pricePerM2) })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs font-mono outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                    />
                  </div>
                )}
              </div>

              {presetFeedback && (
                <div role="status" className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] font-semibold ${presetFeedback.tone === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'}`}>
                  {presetFeedback.text}
                </div>
              )}

              {isPresetManageOpen && savedPresets.length > 0 && (
                <div className="px-4 pb-4 space-y-1" data-testid="preset-manager">
                  {savedPresets.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-studio-field border border-studio-border">
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                        {p.name}
                        <span className="ms-2 font-mono text-[10px] text-slate-500" dir="ltr">{formatDisplayValue(p.height, displayUnit)}×{formatDisplayValue(p.width, displayUnit)} {displayUnit}</span>
                        {presetDetails(p) && (
                          <span className="ms-2 text-[10px] font-normal text-slate-500 dark:text-slate-400">{presetDetails(p)}</span>
                        )}
                      </span>
                      <span className="ms-auto me-2 flex items-center gap-1 shrink-0">
                        <input
                          key={`${p.id}-${p.pricePerSheet ?? ''}`}
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          defaultValue={isPanelPrice(p.pricePerSheet) ? String(p.pricePerSheet) : ''}
                          onBlur={(e) => void handlePresetPrice(p, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          placeholder={t('atelier.stock.presetPricePlaceholder')}
                          aria-label={t('atelier.stock.presetPriceAria', { name: p.name })}
                          className="w-20 px-2 py-1 rounded-md bg-studio-panel border border-studio-border text-[11px] font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500/50"
                        />
                        <span className="text-[10px] text-slate-500">{t('atelier.cost.currency')}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDeletePreset(p.id)}
                        aria-label={t('atelier.stock.deletePresetAria')}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pieces Manager Component */}
            <div className="p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
              <PiecesManager
                pieces={pieces}
                onUpdatePieces={setPieces}
                defaultMaterial={activeSheet.material || 'mdf'}
                displayUnit={displayUnit}
                showMaterialCol={options.considerMaterial}
                disabled={isOptimizing}
                edgePrices={edgePrices}
              />
            </div>

            {/* Collapsible Advanced Options. scroll-mt clears the sticky header
                and the section nav when the nav entry scrolls here. */}
            <div ref={advancedOptionsRef} className="rounded-xl overflow-hidden scroll-mt-32">
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
                    edgeMarginMm={Math.round((activeSheet.margin ?? 0) * 100) / 10}
                    onEdgeMarginChange={handleEdgeMarginChange}
                    edgePrices={edgePrices}
                    onEdgePriceChange={(edgeId, price) => void handleEdgePriceChange(edgeId, price)}
                    edgePriceSaveFailed={edgePriceSaveFailed}
                  />
                </div>
              )}
            </div>

            {optimizeError && (
              <p role="alert" className="flex items-center gap-2 text-xs font-semibold text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {optimizeError}
                {(optimizeError === t('atelier.optimize.noCredits')) && (
                  <a href="/credits" className="ms-auto font-black underline hover:no-underline">{t('atelier.optimize.recharge')}</a>
                )}
              </p>
            )}
            {/* Primary CTA Button */}
            <button
              onClick={() => void handleRunOptimization()}
              disabled={isOptimizing || pieces.length === 0}
              className="w-full py-3.5 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-bold text-sm tracking-[0.08em] uppercase shadow-xl shadow-brand-500/30 ring-1 ring-brand-600/40 transition-all flex items-center justify-center gap-2.5 disabled:opacity-30 disabled:shadow-none disabled:ring-0 active:scale-[0.98]"
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

          {/* RIGHT COLUMN: Visual Studio & Results (8 cols — the 2D plan is
              the hero of the atelier) */}
          <div className="lg:col-span-7 space-y-4">
            
            {result ? (
              <>
                {/* Cost Summary Banner — the subtotal comes from result.costBreakdown
                    (src/lib/costing.ts), the same figure shown in the cost
                    breakdown below and rendered in the PDF export. No estimated
                    "savings" claim is shown here. */}
                {/* MIX: deep-navy summary banner, mono figure, amber currency */}
                <div className="relative overflow-hidden rounded-xl bg-[#0F172A] dark:bg-[#060B14] border border-[#1E3A5F] p-5 shadow-sm">
                  <div className="absolute top-0 end-0 w-48 h-48 bg-brand-400/10 rounded-full blur-3xl -translate-y-1/2 pointer-events-none" />
                  <div className="relative flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-400 mb-1 font-mono">{t('atelier.cost.bannerLabel')}</p>
                      <p className="text-3xl font-black font-mono text-white tracking-tight" dir="ltr">
                        {result.costBreakdown ? n(result.costBreakdown.subtotal) : '—'} <span className="text-brand-400">{t('atelier.cost.currency')}</span>
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {t('atelier.cost.bannerMeta', {
                          meters: n(result.totalLinearCutMeters || 0),
                          sheets: tn('atelier.cost.sheetsCount', result.sheetsUsed),
                        })}
                      </p>
                    </div>
                    <div className="shrink-0 w-14 h-14 rounded-xl bg-brand-400/10 border border-brand-500/30 flex items-center justify-center">
                      <TrendingUp className="w-6 h-6 text-brand-400" />
                    </div>
                  </div>
                </div>

                {/* Unplaced pieces alert — an oversize piece (larger than the
                    stock panel even rotated) must be impossible to miss, and
                    any other structural rejection is named too. */}
                {result.unplacedPieces.length > 0 && (
                  <div
                    role="alert"
                    data-testid="unplaced-alert"
                    className={`p-3.5 rounded-xl border space-y-2 ${result.unplacedPieces.some((u) => u.unplacedReasonCode === 'oversize')
                      ? 'bg-rose-500/10 border-rose-500/40'
                      : 'bg-amber-500/10 border-amber-500/40'}`}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`w-4 h-4 shrink-0 ${result.unplacedPieces.some((u) => u.unplacedReasonCode === 'oversize') ? 'text-rose-400' : 'text-amber-400'}`} />
                      <p className={`text-xs font-black ${result.unplacedPieces.some((u) => u.unplacedReasonCode === 'oversize') ? 'text-rose-400' : 'text-amber-400'}`}>
                        {tn('atelier.unplaced.count', result.unplacedPieces.length)}
                      </p>
                    </div>
                    <ul className="space-y-1">
                      {result.unplacedPieces.slice(0, 8).map((u, i) => (
                        <li key={u.id || i} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                          <span className="font-mono font-bold text-slate-500 shrink-0">{formatDisplayValue(u.height, displayUnit)}×{formatDisplayValue(u.width, displayUnit)}{displayUnit}</span>
                          <span className="truncate">{u.baseName || t('atelier.unplaced.fallbackName', { index: u.originalIndex + 1 })} — {u.unplacedReason || t('atelier.unplaced.noStock')}</span>
                        </li>
                      ))}
                      {result.unplacedPieces.length > 8 && (
                        <li className="text-[11px] text-slate-500 font-semibold">
                          {t('atelier.unplaced.more', { count: result.unplacedPieces.length - 8 })}
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* 2D Visualizer — the hero of the workshop: framed blueprint
                    panel with a stronger shadow so it reads as the primary
                    instrument, not just another card. */}
                <div className="overflow-hidden rounded-xl border border-studio-border shadow-xl shadow-black/[0.06] dark:shadow-black/30">
                  {/* Tabs for sheets — opaque toolbar: the plan scrolls under it
                      when zoomed, translucency made that read as an overlap bug */}
                  <div data-testid="cut-plan-toolbar" className="relative z-20 flex flex-wrap items-center gap-2 px-4 py-2.5 bg-studio-panel border-b border-studio-border/60">
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
                  </div>

                  {/* SVG Canvas — the plan is geometry, not prose: its origin is
                      the sheet's top-left corner and its labels are cm/mm
                      figures, so it stays LTR even when the workshop is RTL. */}
                  <div dir="ltr" data-testid="cut-plan-viewport" className={`relative min-h-[420px] max-h-[70vh] overflow-auto overscroll-contain p-5 flex ${isDark ? 'bg-[#040812]' : 'bg-[#F1F5F9]'}`}>
                    {/* Zoom controls — floating instrument control, pinned to the
                        viewport itself (not the toolbar) so it stays reachable
                        while the plan underneath scrolls. Reads out/in like the
                        plan it drives, so it keeps LTR order in every locale. */}
                    <div dir="ltr" className="absolute bottom-3 end-3 z-10 flex items-center gap-1.5 bg-studio-panel/90 backdrop-blur rounded-lg border border-studio-border p-0.5 shadow-sm">
                      <button aria-label={t('atelier.plan.zoomOut')} onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))} disabled={zoomLevel <= 0.5} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span title={t('atelier.plan.zoomLevelAria')} className="text-[10px] font-mono text-slate-600 dark:text-slate-400 tabular-nums px-1 w-10 text-center">{Math.round(zoomLevel*100)}%</span>
                      <button aria-label={t('atelier.plan.zoomIn')} onClick={() => setZoomLevel(Math.min(2.5, zoomLevel + 0.25))} disabled={zoomLevel >= 2.5} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {/* Technical corner readout — decorative blueprint annotation
                        (sheet size + kerf), pinned to the viewport itself so it
                        stays put while the plan underneath scrolls/zooms. Sits
                        at the opposite corner from the zoom controls above. */}
                    <div aria-hidden="true" dir="ltr" className="pointer-events-none absolute bottom-3 start-3 z-10 flex items-center gap-2 rounded-lg border border-studio-border/70 bg-studio-panel/90 backdrop-blur px-2.5 py-1.5 font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400 shadow-sm">
                      <span className="flex items-center gap-1">
                        <Boxes className="w-3 h-3 text-sky-400" />
                        {formatDisplayValue(activeSheet.height, displayUnit)}×{formatDisplayValue(activeSheet.width, displayUnit)} {displayUnit}
                      </span>
                      <span className="h-3 w-px bg-studio-border" />
                      <span className="flex items-center gap-1">
                        <Scissors className="w-3 h-3 text-brand-400" />
                        {options.kerfWidth} mm
                      </span>
                    </div>
                    {/* m-auto (not justify-center): when the zoomed plan is wider
                        than the viewport, auto margins clamp to 0 and BOTH edges
                        stay reachable by scrolling — centered overflow via
                        justify-center would clip the left edge under the padding
                        and visually slide the plan under the toolbar. */}
                    <div
                      className="m-auto transition-[width,max-width] duration-200 ease-out"
                      style={{
                        width: `${Math.round(560 * zoomLevel)}px`,
                        maxWidth: zoomLevel <= 1 ? '100%' : undefined,
                      }}
                    >
                      <svg
                        data-testid="cut-plan-svg"
                        viewBox={`0 0 ${activeSheet.width} ${activeSheet.height}`}
                        className="block w-full rounded-xl"
                        style={{
                          aspectRatio: `${activeSheet.width} / ${activeSheet.height}`,
                          filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))',
                        }}
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
                          {/* Wood grain (ramage) textures: soft wavy strokes along the
                              grain axis, one per theme. Pieces reference these by
                              axis via grainV / grainH. */}
                          <pattern id="grainV" patternUnits="userSpaceOnUse" width="6" height="14">
                            <path d="M1 0 Q4 3.5 1 7 T1 14" fill="none" stroke={isDark ? '#8A6A3B' : '#C9A464'} strokeWidth="0.45" opacity="0.55" />
                            <path d="M4 0 Q7 3.5 4 7 T4 14" fill="none" stroke={isDark ? '#6E5228' : '#B08A4F'} strokeWidth="0.35" opacity="0.4" />
                          </pattern>
                          <pattern id="grainH" patternUnits="userSpaceOnUse" width="14" height="6">
                            <path d="M0 1 Q3.5 4 7 1 T14 1" fill="none" stroke={isDark ? '#8A6A3B' : '#C9A464'} strokeWidth="0.45" opacity="0.55" />
                            <path d="M0 4 Q3.5 7 7 4 T14 4" fill="none" stroke={isDark ? '#6E5228' : '#B08A4F'} strokeWidth="0.35" opacity="0.4" />
                          </pattern>
                        </defs>

                        <rect x="0" y="0" width={activeSheet.width} height={activeSheet.height}
                          fill={isDark ? 'url(#sheetBgD)' : 'url(#sheetBgL)'}
                          stroke={isDark ? '#4A5568' : '#94A3B8'} strokeWidth={isDark ? 1 : 1.5} rx="0.5" />

                        {/* Panel grain (ramage): wavy lines OVER the sheet background,
                            UNDER the pieces — shows the stock veining direction.
                            Pieces without their own grain stay plain so the panel
                            grain reads as the panel's, as on real MDF/plywood. */}
                        {activeSheet.hasGrain && (
                          <rect
                            data-testid="sheet-grain-overlay"
                            x="0" y="0" width={activeSheet.width} height={activeSheet.height}
                            fill={activeSheet.grainOrientation === 'horizontal' ? 'url(#grainH)' : 'url(#grainV)'}
                            pointerEvents="none"
                          />
                        )}

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
                <div className="grid grid-cols-5 gap-1.5">
                  {/* The file-format labels are the formats themselves, so
                      they stay verbatim; the accessible name carries the
                      translated sentence. */}
                  <button onClick={handleDownloadCsv} aria-label={t('atelier.exports.csvAria')} className="py-2.5 rounded-lg bg-studio-field border border-studio-border hover:border-brand-500/40 text-slate-700 dark:text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
                    {t('atelier.exports.csv')}
                  </button>
                  <button onClick={handleDownloadJson} aria-label={t('atelier.exports.jsonAria')} className="py-2.5 rounded-lg bg-studio-field border border-studio-border hover:border-brand-500/40 text-slate-700 dark:text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
                    {t('atelier.exports.json')}
                  </button>
                  <button onClick={handleDownloadPng} aria-label={t('atelier.exports.pngAria')} className="py-2.5 rounded-lg bg-studio-field border border-studio-border hover:border-brand-500/40 text-slate-700 dark:text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileCode2 className="w-3.5 h-3.5 text-purple-400" />
                    {t('atelier.exports.png')}
                  </button>
                  <button onClick={handleDownloadDxf} aria-label={t('atelier.exports.dxfAria')} className="py-2.5 rounded-lg bg-studio-field border border-studio-border hover:border-brand-500/40 text-slate-700 dark:text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all">
                    <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
                    {t('atelier.exports.dxf')}
                  </button>
                  <button onClick={handleDownloadPdf} disabled={isDownloadingPdf} className="col-span-4 mt-1 py-3 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20 transition-all disabled:opacity-40">
                    {isDownloadingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {isDownloadingPdf ? t('atelier.exports.pdfGenerating') : t('atelier.exports.pdf')}
                  </button>
                  {/* No costingInput (e.g. legacy 1D mode with no configured
                      pricing) means there is nothing real to quote a client for. */}
                  {result?.costingInput && (
                    <button
                      onClick={() => setIsQuotationDialogOpen(true)}
                      aria-label={t('quotation.openButtonAria')}
                      className="col-span-4 py-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 font-black text-xs flex items-center justify-center gap-2 transition-all"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {t('quotation.openButton')}
                    </button>
                  )}
                </div>

                {/* Sheet Breakdown */}
                {currentSheet && (
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)] gap-2.5">
                    <section className="p-3.5 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
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
                                <td className="py-2 pe-3 font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr">
                                  {formatDisplayValue(piece.height, displayUnit)} × {formatDisplayValue(piece.width, displayUnit)} {displayUnit}
                                </td>
                                <td className="py-2 text-slate-600 dark:text-slate-300">{t(piece.rotated ? 'atelier.cutOrder.rotated' : 'atelier.cutOrder.notRotated')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <div data-testid="offcuts-list" className="p-3.5 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
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
                  <div className="p-3.5 rounded-xl bg-studio-panel border border-studio-border shadow-sm space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('atelier.cost.breakdownTitle')}</p>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.panels')}</span>
                        <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.materialCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.edges')}</span>
                        <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.edgeCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.labor')}</span>
                        <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.laborCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.total')}</span>
                        <span className="font-mono font-black text-brand-400" dir="ltr">{t('atelier.cost.amount', { value: n(result.costBreakdown?.subtotal ?? 0) })}</span>
                      </div>
                    </div>
                    {costDetail && (costDetail.panels.length > 0 || costDetail.edges.length > 0) && (
                      <div data-testid="cost-detail" className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">{t('atelier.cost.detail.title')}</p>
                        <ul className="divide-y divide-studio-border/50 text-[11px]">
                          {costDetail.panels.map((panel, i) => (
                            <li key={`panel-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                              <span className="text-slate-700 dark:text-slate-200 min-w-0">
                                {[
                                  t('atelier.cost.detail.panel'),
                                  panel.label,
                                  t(materialLabelKey(panel.material ?? activeSheet.material)),
                                  panel.color,
                                ].filter(Boolean).join(' · ')}
                                <span className="ms-1.5 font-mono text-[10px] text-slate-500" dir="ltr">
                                  {formatDisplayValue(panel.heightCm ?? activeSheet.height, displayUnit)} × {formatDisplayValue(panel.widthCm ?? activeSheet.width, displayUnit)} {displayUnit}
                                </span>
                              </span>
                              <span className="ms-auto flex items-baseline gap-3">
                                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr">
                                  {panel.pricing.mode === 'per_sheet'
                                    ? t('atelier.cost.detail.perPanel', { count: panel.count, price: detailMoney(panel.pricing.value) })
                                    : t('atelier.cost.detail.perM2', { count: panel.count, area: detailNumber(panel.areaM2, 4), price: detailNumber(panel.pricing.value, 2) })}
                                </span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr">{t('atelier.cost.amount', { value: detailMoney(panel.total) })}</span>
                              </span>
                            </li>
                          ))}
                          {costDetail.edges.map((edge, i) => (
                            <li key={`edge-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                              <span className="text-slate-700 dark:text-slate-200">
                                {edge.edgeId ? `${t('atelier.cost.detail.edge')} · ${t(edgeBandingLabelKey(edge.edgeId))}` : t('atelier.cost.detail.edge')}
                              </span>
                              <span className="ms-auto flex items-baseline gap-3">
                                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr">
                                  {t('atelier.cost.detail.perMeter', { length: detailNumber(edge.lengthM, 2), price: detailNumber(edge.pricePerMeter, 2) })}
                                </span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr">{t('atelier.cost.amount', { value: detailMoney(edge.total) })}</span>
                              </span>
                            </li>
                          ))}
                          {hasLaborCharge(costDetail.labor) && (
                            <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                              <span className="text-slate-700 dark:text-slate-200">
                                {t(costDetail.labor.pricing.mode === 'per_meter' ? 'atelier.cost.detail.laborPerMeter' : 'atelier.cost.detail.laborFixed')}
                              </span>
                              <span className="ms-auto flex items-baseline gap-3">
                                {costDetail.labor.pricing.mode === 'per_meter' && (
                                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr">
                                    {t('atelier.cost.detail.perMeter', { length: detailNumber(costDetail.labor.cutLengthM ?? 0, 2), price: detailNumber(costDetail.labor.pricing.value, 2) })}
                                  </span>
                                )}
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr">{t('atelier.cost.amount', { value: detailMoney(costDetail.labor.total) })}</span>
                              </span>
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <EmptyState type="ready" />
            )}
          </div>
            </div>

            {/* Performance Metrics Row — Stitch metric-card skeleton with a
                progress ring on the headline card. All figures come straight
                from `result`/`options`; nothing here is a new computation. */}
            {result && (() => {
              // wastePercentage already carries binpacking.ts's own
              // divide-by-zero guard, so the usable ("rendement") share
              // reuses it rather than re-deriving totalAreaUsed/totalAreaAvailable.
              const usablePct = Math.max(0, Math.min(100, Math.round(100 - result.wastePercentage)));
              const wastePct = Math.max(0, Math.min(100, Math.round(result.wastePercentage)));
              const ringCircumference = 2 * Math.PI * 20;
              const totalCuts = result.sheets.reduce((sum, s) => sum + (s.cuts?.length || 0), 0);
              return (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* RENDEMENT — progress ring */}
                    <div className="p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm flex flex-col gap-2">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                        <span className="text-[10px] font-bold uppercase tracking-wider">{t('atelier.metrics.efficiency')}</span>
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <div className="flex items-center gap-3">
                        <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90 shrink-0">
                          <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" className="text-studio-field" strokeWidth="5" />
                          <circle
                            cx="24" cy="24" r="20" fill="none" stroke="currentColor" className="text-emerald-500" strokeWidth="5" strokeLinecap="round"
                            strokeDasharray={`${ringCircumference}`}
                            strokeDashoffset={`${ringCircumference * (1 - usablePct / 100)}`}
                          />
                        </svg>
                        <div>
                          <p className="text-3xl font-black font-mono text-slate-900 dark:text-white tabular-nums tracking-tight" dir="ltr">{usablePct}%</p>
                          <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                            <span className="sr-only">{t('atelier.metrics.usable')} — </span>
                            {t('atelier.metrics.usableSub', { value: n(result.totalAreaUsed / 10000, { maximumFractionDigits: 2 }) })}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* PERTE / CHUTE */}
                    <div className="p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm flex flex-col gap-2">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                        <span className="text-[10px] font-bold uppercase tracking-wider">{t('atelier.metrics.waste')}</span>
                        <Trash2 className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-3xl font-black font-mono text-rose-600 dark:text-rose-400 tabular-nums tracking-tight" dir="ltr">{wastePct}%</p>
                        <div className="mt-1.5 w-full h-1.5 rounded-full bg-studio-field overflow-hidden">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${wastePct}%` }} />
                        </div>
                        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1.5">{t('atelier.metrics.wasteSub', { kerf: n(options.kerfWidth) })}</p>
                      </div>
                    </div>

                    {/* COUPES SCIE */}
                    <div className="p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm flex flex-col gap-2">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                        <span className="text-[10px] font-bold uppercase tracking-wider">{t('atelier.metrics.cuts')}</span>
                        <Scissors className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-3xl font-black font-mono text-slate-900 dark:text-white tabular-nums tracking-tight" dir="ltr">{totalCuts}</p>
                        <p className="text-[10px] font-mono text-brand-500 dark:text-brand-400 font-semibold mt-1.5">
                          {t('atelier.cost.bannerMeta', {
                            meters: n(result.totalLinearCutMeters || 0),
                            sheets: tn('atelier.cost.sheetsCount', result.sheetsUsed),
                          })}
                        </p>
                      </div>
                    </div>

                    {/* PANNEAUX REQUIS */}
                    <div className="p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm flex flex-col gap-2">
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                        <span className="text-[10px] font-bold uppercase tracking-wider">{t('atelier.metrics.sheets')}</span>
                        <PackageOpen className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-3xl font-black font-mono text-slate-900 dark:text-white tabular-nums tracking-tight" dir="ltr">{result.sheetsUsed}</p>
                        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1.5">
                          <span className="sr-only">{t('atelier.metrics.pieces')} — </span>
                          {result.placedPieces.length} {t('atelier.metrics.piecesSub')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Bottom action bar — the 5-button export row below stays
                      untouched; these two are quick top-level shortcuts. */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      onClick={() => void handleRunOptimization()}
                      disabled={isOptimizing || pieces.length === 0}
                      className="flex-1 min-w-[200px] py-3.5 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-30 transition-all"
                    >
                      <RefreshCw className={`w-4 h-4 ${isOptimizing ? 'animate-spin' : ''}`} />
                      {t('atelier.project.rerun')}
                    </button>
                    <button
                      onClick={handleDownloadPdf}
                      disabled={isDownloadingPdf}
                      className="flex-1 min-w-[200px] py-3.5 rounded-xl border border-studio-border hover:border-brand-500/40 bg-studio-panel text-slate-800 dark:text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
                    >
                      {isDownloadingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      {isDownloadingPdf ? t('atelier.exports.pdfGenerating') : t('atelier.exports.pdf')}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </main>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        purpose={pendingAuthAction === 'scan' || pendingAuthAction === 'optimize' ? pendingAuthAction : 'pdf'}
        title={pendingAuthAction === 'quotation' ? t('quotation.title') : undefined}
        subtitle={pendingAuthAction === 'quotation' ? t('quotation.authRequired') : undefined}
        onSuccess={() => {
          setIsAuthModalOpen(false);
          const supabase = createClient();
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) {
              setUserEmail(user.email || null);
              if (pendingAuthAction === 'pdf') handleDownloadPdf();
              // A kept scan or run picks up where the visitor left it.
              if (pendingAuthAction === 'scan' || pendingAuthAction === 'optimize') {
                const work = loadPendingWork(window.localStorage);
                if (work) resumePendingWork(work, { resumed: true });
              }
              // 'quotation': the dialog itself stays open with the artisan's
              // filled-in fields intact — they just click "Generate" again.
            }
            setPendingAuthAction(null);
          });
        }}
      />

      {/* No costingInput (e.g. legacy 1D mode with no configured pricing) means
          there is nothing real to quote — never fabricate a zero-cost basis. */}
      {result?.costingInput && (
        <QuotationDialog
          isOpen={isQuotationDialogOpen}
          onClose={() => setIsQuotationDialogOpen(false)}
          onRequireAuth={() => {
            setPendingAuthAction('quotation');
            setIsAuthModalOpen(true);
          }}
          costingInput={result.costingInput}
          panels={quotationPanels}
          pieces={quotationPieces}
          itemLimitError={quotationItemLimitError}
          projectId={lastSavedProjectId}
        />
      )}
    </div>
  );
}
