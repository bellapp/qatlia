'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Layers,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Zap,
  AlertTriangle,
  Camera,
  Image as ImageIcon,
  SlidersHorizontal,
  ChevronDown,
  FileCode2,
  FileSpreadsheet,
  FileText,
  PackageOpen,
  BookmarkPlus,
  ArrowRight,
  Trash2,
  TrendingUp,
  Scissors,
  Boxes,
  ClipboardList,
  FilePlus2,
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
  catalogPanelPrice,
  repriceCostingInput,
  withLegacyStockPrice,
} from '@/lib/cutting/binpacking';
import { computeCostBreakdown } from '@/lib/costing';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import { useCurrency } from '@/components/currency-store';
import {
  loadDeviceEdgePrice,
  saveDeviceEdgePrice,
  fetchAccountEdgePrice,
  saveAccountEdgePrice,
} from '@/lib/edge-prices';
import { PIECE_COLOR_PALETTE, getResolvedPieceColor } from '@/lib/pieces/catalog';
import {
  isPanelPrice,
  type NewPanelPreset,
  type PanelPreset,
} from '@/lib/panel-presets';
import { listPanelFor, saveActionFor, typedPanelPrice } from '@/lib/atelier-panel-choice';
import { STOCK_MATERIAL_VALUES } from '@/lib/panel-form';
import { savedPriceChange } from '@/lib/panel-preset-rules';
import { usePanelPresets } from '@/lib/use-panel-presets';
import { OptionsPanel } from '@/components/OptionsPanel';
import { PiecesManager } from '@/components/PiecesManager';
import { SheetTabs } from '@/components/SheetTabs';
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
import { ScanViewer, useScanViewer } from '@/components/ScanViewer';
import { EmptyState } from '@/components/EmptyState';
import { AccountMenu } from '@/components/AccountMenu';
import { CREDIT_BADGE_TONES, useCreditLevel } from '@/components/useCreditLevel';
import { LowCreditsBanner } from '@/components/LowCreditsBanner';
import { ReferralRewardBanner } from '@/components/ReferralRewardBanner';
import { useStoreApp } from '@/components/useStoreApp';
import { isStoreAppDocument, storeAppCopyKey } from '@/lib/store-app';
import { WorkspaceNav } from '@/components/WorkspaceNav';
import { QatlIALogo } from '@/components/QatlIALogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';
import { OnboardingTour } from '@/components/OnboardingTour';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { formatDateTime, type TranslationKey } from '@/i18n';
import { edgeBandingLabelKey, materialLabelKey, visionErrorKey } from '@/i18n/domain';
import { buildCostDetail, hasLaborCharge } from '@/lib/cost-detail';
import { writeLocalHistoryItem, renameLocalHistoryItem, markLocalHistoryPdf, type LocalHistoryItem } from '@/lib/history';
import { saveProjectName, type RenameOutcome } from '@/lib/projects/rename';
import { deriveQuotationPanels, deriveQuotationPieces } from '@/lib/quotation-items';
import { buildPdfPayload } from '@/lib/pdf-payload';
import { uncountedEdgeMetres } from '@/lib/uncounted-edges';
import { readShowEdges, saveShowEdges } from '@/lib/show-edges';
import { EDGE_COLOR, EDGE_DASH_CM, EDGE_HALO, EDGE_HALO_CM, EDGE_STROKE_CM, edgeLines, hasEdgeLines } from '@/lib/cutting/edge-lines';
import { SCREEN_MEASURES, shortMeasure, sideMeasures } from '@/lib/cutting/side-measures';
import PlanMeasures from '@/components/PlanMeasures';
import { buildPersistedProjectPayload } from '@/lib/projects/persistence-payload';
import {
  adoptSavedJob,
  buildAtelierDraft,
  clearAtelierDraft,
  draftToRestore,
  readAtelierDraft,
  writeAtelierDraft,
} from '@/lib/atelier-draft';
import { pickRestorableResult, readRestoredProjectDate } from '@/lib/projects/restore';
import { downscaleDataUrl } from '@/lib/image-downscale';
import { createScanKeeper, saveProjectToCloud, settledWithin, type ScanKeeper } from '@/lib/projects/scan-upload';
import { MAX_SCAN_SHEETS, appendSheetPieces, fitThumb, readScanSheets, removeScanSheet, thumbBudgetFor, type ScanSheet } from '@/lib/projects/scan-sheets';
import { isUuid } from '@/lib/billing/grant';
import { ScanSheets } from '@/components/ScanSheets';
import { isPhotoPreview } from '@/lib/whatsapp/photo-summary';
import { photoPreviewStep, previewExportGate } from '@/lib/whatsapp/photo-preview';
import { readAnalysisPass, storeAnalysisPass } from '@/lib/billing/analysis-pass-store';
import { fileNameFromContentDisposition } from '@/lib/document-filename';
import { piecesOnlyOnScreen } from '@/lib/new-job';
import { planInputsKey, planShortcut } from '@/lib/plan-inputs';
import { PlanBar, PlanHeaderButton } from '@/components/PlanShortcut';
import { useTyping } from '@/components/WhatsAppContact';
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

/** Day and time of the save, as the history cards show it. */
const RESTORED_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/** CSS length for the whole content width of the plan viewport. Kept as the
 *  bare literal the claims audit recognises as geometry, not as a figure. */
const FULL_WIDTH = '100%';
/** The PNG of the plan, before the canvas doubles it: a 280 × 207 panel is 1656 × 2240 px. */
const PNG_PX_PER_CM = 4;
/** Width of the cutting plan at 100% zoom: 560px, or the whole viewport when
 *  that is narrower (a phone). Every zoom step multiplies this width. */
const PLAN_FIT_WIDTH = `min(560px, ${FULL_WIDTH})`;
/** The plan viewport once the plan is zoomed in: a box of its own. The plan is
 *  larger than it, a finger (or the wheel) moves the plan inside it, and
 *  reaching an edge of the plan does not drag the page along. */
const PLAN_VIEWPORT_ZOOMED = 'max-h-[70vh] overflow-auto overscroll-contain';
/** The plan viewport at 100% or less. On a phone or a tablet (one column,
 *  below lg) it is no scrolling box at all: the plan is shown whole and a
 *  finger on it scrolls the page. The two-column layout keeps its height cap,
 *  and the scroll passes on to the page at the plan's edges. Confining the
 *  scroll here is what the 2026-11-15 report was about: the plan fits the box
 *  at 100%, so there was nothing to scroll and the gesture went nowhere. */
const PLAN_VIEWPORT_FITTED = 'lg:max-h-[70vh] lg:overflow-auto';

/** How long the new-job button keeps asking before it goes back to its name. */
const NEW_JOB_CONFIRM_MS = 6000;

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
 * The cut settings no longer carry a panel price: the panel has its own
 * (see withLegacyStockPrice, which moves an old one onto the panel).
 */
const optionsWithoutStockOverride = (options: OptimizationOptions): OptimizationOptions => {
  const { stockPricingOverrides: _legacy, ...rest } = options;
  void _legacy;
  return rest;
};


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

/**
 * A cut-list sheet of the project on screen: the image read on this page (in
 * memory), its thumbnail, the kept image's path of a reopened project, and the
 * keeper of its full image (the path it is stored under, or the fresh image
 * still to send; src/lib/projects/scan-upload.ts).
 */
type ScreenSheet = { image?: string; thumb?: string; path?: string; keeper: ScanKeeper };

/** A picked photo as a data URL. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  /** The chants on the plan, its PNG and its PDF: kept on the device, read once mounted. */
  const [showEdges, setShowEdges] = useState(true);
  useEffect(() => setShowEdges(readShowEdges()), []);
  // null until the signed-in artisan's real balance is loaded — never a
  // hardcoded placeholder the customer could mistake for their actual solde.
  const [userCredits, setUserCredits] = useState<number | null>(null);
  const creditLevel = useCreditLevel(userCredits);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // The failure is held as a catalog key, not as rendered prose: the server
  // answers with a machine-readable code, and holding the key means an artisan
  // who switches language after a failed scan sees the message follow them.
  const [visionError, setVisionError] = useState<TranslationKey | null>(null);
  // The cut-list sheets read for the project on screen, in order, up to
  // MAX_SCAN_SHEETS (spec 2026-11-17). The ref mirrors the state so photos
  // read one after another each see the sheets before them.
  const [scanSheets, setScanSheetsState] = useState<ScreenSheet[]>([]);
  const scanSheetsRef = useRef<ScreenSheet[]>([]);
  const setScanSheets = (next: ScreenSheet[]) => {
    scanSheetsRef.current = next;
    setScanSheetsState(next);
  };
  // The scan group the project's photos are read in: sent with its next photo
  // so the first photo's credit covers it (src/lib/billing/scan-group.ts).
  // It belongs to the project on screen: a new job or a reopened project
  // replaces it.
  const scanGroupRef = useRef<string | null>(null);
  // Each sheet keeps its full image through its own keeper, held outside
  // React state so two saves in a row never send an image twice.
  const newKeeper = () => createScanKeeper({ fetch: (url, init) => fetch(url, init), downscale: downscaleDataUrl });
  const scanViewer = useScanViewer();
  // The last save's scan attach (a PATCH that rewrites the project's saved
  // data); a PDF marker or a rename on the same project waits for it first.
  const scanAttachRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const [pdfGeneratedAt, setPdfGeneratedAt] = useState<string | null>(null);
  // When the plan on screen was saved, set only while it is a plan reopened
  // from history as saved. A new run replaces that plan, so it clears it.
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  // The pieces the plan on screen was made from, saved with it: the list a
  // new job can drop without asking (see src/lib/new-job.ts).
  const plannedPiecesRef = useRef<Piece[] | null>(null);
  // What the plan on screen was computed from (src/lib/plan-inputs.ts); null
  // without a plan, and until a plan put back is on screen with its pieces.
  const [planKey, setPlanKey] = useState<string | null>(null);
  // The second button that computes the plan, while the main one is off the screen.
  const mainRunRef = useRef<HTMLButtonElement>(null);
  const runErrorRef = useRef<HTMLParagraphElement>(null);
  const planColumnRef = useRef<HTMLDivElement>(null);
  const shortcutRunRef = useRef(false);
  const [mainRunVisible, setMainRunVisible] = useState(true);
  const typing = useTyping();
  // The new-job button asks once before dropping pieces that are only on screen.
  const [confirmingNewJob, setConfirmingNewJob] = useState(false);
  // A tap gives a button no focus on iOS, so leaving it cannot be all that
  // takes the question back: left armed, a later tap would empty the list.
  useEffect(() => {
    if (!confirmingNewJob) return;
    const timer = window.setTimeout(() => setConfirmingNewJob(false), NEW_JOB_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmingNewJob]);
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
  // The plan on screen is the free preview of a WhatsApp link (/w/<code>):
  // signed in, the paid optimization runs once; signed out, the banner asks
  // for the free account (src/lib/whatsapp/photo-preview.ts).
  // Two roles: photoPreviewRef says the plan on screen is still the free
  // preview (cleared only by a successful paid run, it gates every export);
  // previewAutoRunRef says the automatic run is still to try (consumed before
  // it starts, so a double effect never charges twice).
  const photoPreviewRef = useRef(false);
  const previewAutoRunRef = useRef(false);
  const [showPhotoBanner, setShowPhotoBanner] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const [isQuotationDialogOpen, setIsQuotationDialogOpen] = useState<boolean>(false);
  // The id /api/projects last confirmed saving, if any — the quotation
  // dialog merges its metadata into that same project's options_json.
  // Never client-guessed; only ever set from a successful save response.
  const [lastSavedProjectId, setLastSavedProjectId] = useState<string | null>(null);
  // A project kept on this device only (no server id): reopened from the local
  // history, or saved there when the server could not be reached.
  const [localProjectId, setLocalProjectId] = useState<string | null>(null);
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
  // The panels the artisan works with, read and written where the panel page
  // (« Configuration des panneaux ») does: the card picks one and saves the one
  // just typed; the list itself is managed on that page.
  const { presets: savedPresets, add: addPreset, update: updatePreset, ready: presetsReady, signedIn: presetsSignedIn, source: presetsSource } = usePanelPresets();
  // The panel last picked from the list: it stays shown, and « Sauvegarder »
  // updates it, while its size is kept (see src/lib/atelier-panel-choice.ts).
  const [pickedPresetId, setPickedPresetId] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);

  const allPresets = savedPresets;

  // The artisan's one price per metre of edge banding: in the account when
  // signed in (migration 015), on the device otherwise. Null: each colour
  // keeps its catalog price.
  const [edgePrice, setEdgePrice] = useState<number | null>(null);
  const [edgePriceSource, setEdgePriceSource] = useState<'device' | 'account'>('device');
  const [edgePriceSaveFailed, setEdgePriceSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEdgePrice(loadDeviceEdgePrice());
    (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) return;
        let account = await fetchAccountEdgePrice();
        if (account === undefined) return;
        // First signed-in use: the price set on this device becomes the account's.
        const device = loadDeviceEdgePrice();
        if (account === null && device !== null) {
          if (await saveAccountEdgePrice(device)) account = device;
        }
        if (cancelled) return;
        setEdgePrice(account);
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
  const [projectNameDraft, setProjectNameDraft] = useState<string>('');
  // Outcome of the last name commit, shown under the field. `lastPersistedNameRef`
  // is the name the saved project already carries: re-committing it does nothing,
  // while a failed one stays different so leaving the field again retries.
  const [nameSaveState, setNameSaveState] = useState<'idle' | 'saving' | RenameOutcome>('idle');
  const lastPersistedNameRef = useRef<string>('');
  const nameSaveAttemptRef = useRef(0);
  // The committed project name, readable by an async save that started from an
  // older render (an optimization running while the name is typed).
  const projectNameRef = useRef<string>('');
  const commitName = (name: string) => {
    projectNameRef.current = name;
    setProjectName(name);
  };
  // Price of the stock panel (MAD per panel), as typed; committed on blur.
  const [panelPriceDraft, setPanelPriceDraft] = useState<string>('');
  const [presetFeedback, setPresetFeedback] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  // The panel on the card as the list would store it: its own name (the one on
  // the plan and the PDF), size, material, colour, grain and price. The name
  // and the price as typed, so « Sauvegarder » wakes up while typing.
  const cardPanel: NewPanelPreset = {
    name: panelNameDraft,
    height: activeSheet.height,
    width: activeSheet.width,
    material: activeSheet.material ?? undefined,
    color: activeSheet.color?.trim() || undefined,
    hasGrain: !!activeSheet.hasGrain,
    grainOrientation: activeSheet.hasGrain ? (activeSheet.grainOrientation ?? 'vertical') : undefined,
    pricePerSheet: typedPanelPrice(panelPriceDraft, activeSheet.pricePerSheet),
  };
  const listPanel = listPanelFor(cardPanel, savedPresets, pickedPresetId);
  const saveAction = saveActionFor(cardPanel, savedPresets, pickedPresetId);

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
    // A panel of the list kept as it is: nothing to save (the button is greyed out).
    if (saveAction.kind === 'saved') return;
    // An update keeps the list's name when the card has none; a new panel
    // without a name is named after its size.
    const name = saveAction.kind === 'update'
      ? saveAction.preset.name
      : cardPanel.name.trim() || `${formatDisplayValue(activeSheet.height, displayUnit)}×${formatDisplayValue(activeSheet.width, displayUnit)} ${displayUnit}`;
    const preset = { ...cardPanel, name };
    // Signed in, but the account list could not be read: a panel written to the
    // device now would never reach the account, and would vanish once the
    // account answers again. The panel page refuses for the same reason.
    if (presetsSignedIn && presetsSource === 'device') {
      setPresetFeedback({ tone: 'warning', text: t('panelsPage.accountUnreachable') });
      return;
    }
    setIsSavingPreset(true);
    try {
      const saved = saveAction.kind === 'update' ? await updatePreset(saveAction.target.id, saveAction.preset) : await addPreset(preset);
      if (!saved.ok) {
        const text = saved.error === 'DUPLICATE'
          ? t('atelier.stock.presetDuplicate', { name: saved.existingName ?? '' })
          : t(saved.error === 'LIMIT' ? 'atelier.stock.presetLimit' : 'atelier.stock.presetSaveFailed');
        setPresetFeedback({ tone: 'warning', text });
        return;
      }
      setPresetFeedback({ tone: 'success', text: t(saveAction.kind === 'update' ? 'atelier.stock.presetUpdatedOk' : 'atelier.stock.presetSavedOk', { name }) });
    } finally {
      setIsSavingPreset(false);
    }
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
  const repriceResult = (next: { sheet?: Sheet; edgePrice?: number | null }) => {
    setResult((current) => {
      if (!current?.costingInput) return current;
      const ownEdgePrice = next.edgePrice !== undefined ? next.edgePrice : edgePrice;
      const costingInput = repriceCostingInput(current.costingInput, {
        edgeBandPricePerM: ownEdgePrice ?? undefined,
        sheet: next.sheet ?? activeSheet,
        currency,
        placedPieces: current.placedPieces,
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

  // A saved panel whose price changed on the panel page while this one was in
  // use: its new price is offered under the price field, never applied alone.
  // Only once the list in use is read: until then the device list stands in
  // for the account one, and its prices may be other ones.
  const savedPrice = cutMode === '2d' && presetsReady ? savedPriceChange(activeSheet, savedPresets) : null;
  const savedPriceKey = savedPrice ? `${savedPrice.name}:${savedPrice.price}:${activeSheet.pricePerSheet ?? ''}` : null;
  // « Garder le prix actuel » hides the offer until a price changes again.
  const [keptPriceKey, setKeptPriceKey] = useState<string | null>(null);

  const applySavedPrice = () => {
    if (!savedPrice) return;
    const nextSheet: Sheet = { ...activeSheet, pricePerSheet: savedPrice.price };
    setSheets([nextSheet]);
    repriceResult({ sheet: nextSheet });
  };

  /** Sets (or, with null, resets to the catalog prices) the price per metre of edge banding. */
  const handleEdgePriceChange = async (price: number | null) => {
    setEdgePrice(price);
    repriceResult({ edgePrice: price });
    if (edgePriceSource === 'account') {
      setEdgePriceSaveFailed(!(await saveAccountEdgePrice(price)));
    } else {
      saveDeviceEdgePrice(price);
    }
  };



  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { t, tn, n, locale } = useLocale();
  const inApp = useStoreApp();
  // The account currency: the plan, the PDF and the quote are priced in it,
  // the catalog prices (dirham figures) converted to it.
  const currency = useCurrency().currency ?? DEFAULT_CURRENCY;

  // Something a new job would clear: without it the button has nothing to do.
  const sheetsFull = scanSheets.length >= MAX_SCAN_SHEETS;
  // Pieces a sheet gave. A project saved before sheets were numbered has its
  // one sheet and untagged pieces: they all came from it.
  const piecesAreTagged = pieces.some((piece) => typeof piece.scanIndex === 'number');
  const sheetPieceCount = (index: number) =>
    piecesAreTagged ? pieces.filter((piece) => piece.scanIndex === index + 1).length : index === 0 ? pieces.length : 0;
  const hasJobOnScreen = pieces.length > 0 || !!result || scanSheets.length > 0 || projectNameDraft.trim() !== '';

  /**
   * The new-job button. The plan on screen is already in history with its
   * pieces, so it is left without a question; pieces changed since, or never
   * optimized, exist only here, and the first click asks before dropping them.
   */
  const handleNewJob = () => {
    const kept = result ? plannedPiecesRef.current : INITIAL_PIECES;
    if (!confirmingNewJob && piecesOnlyOnScreen(pieces, kept)) {
      setConfirmingNewJob(true);
      return;
    }
    startNewJob();
  };

  /**
   * Empties the atelier for another job: pieces, name, scan and plan. The
   * panel, the cut settings and the unit stay, an artisan cuts job after job
   * in the same panel with the same blade.
   */
  const startNewJob = () => {
    setConfirmingNewJob(false);
    // Nothing of the old job waits in the tab either.
    clearAtelierDraft(window.sessionStorage);
    setPieces([]);
    setResult(null);
    setPlanKey(null);
    plannedPiecesRef.current = null;
    photoPreviewRef.current = false;
    previewAutoRunRef.current = false;
    setShowPhotoBanner(false);
    setRestoredAt(null);
    setActiveSheetIndex(0);
    setZoomLevel(1);
    setOptimizeError(null);
    setVisionError(null);
    setScanSheets([]);
    scanGroupRef.current = null;
    scanAttachRef.current = Promise.resolve(false);
    setPdfGeneratedAt(null);
    // The job on screen is no longer the saved project: the name field writes
    // to that project, and would rename the old one in history.
    setLastSavedProjectId(null);
    setLocalProjectId(null);
    commitName('');
    setProjectNameDraft('');
    lastPersistedNameRef.current = '';
    // An answer still on its way for the old name no longer owns the line.
    nameSaveAttemptRef.current += 1;
    setNameSaveState('idle');
    // A new job is a new record: it owes no rewrite of an old one's units.
    setPendingUnitMigration(false);
    setMigratedFromLegacyUnit(false);
  };

  /** Commits the typed project name (no uniqueness constraint — several
   *  projects may share a name). Empty reverts to the auto-name fallback.
   *  Leaving the field also writes the name to the saved project, if there is
   *  one; the line under the field says how that went. */
  const commitProjectName = async () => {
    const name = projectNameDraft.trim();
    commitName(name);
    if (name === lastPersistedNameRef.current) return;
    const attempt = ++nameSaveAttemptRef.current;
    setNameSaveState('saving');
    await settledWithin(scanAttachRef.current);
    const outcome = await saveProjectName(
      { cloudId: lastSavedProjectId, localId: localProjectId },
      name,
      { fetch: (input, init) => fetch(input, init), renameLocal: renameLocalHistoryItem },
    );
    // A newer commit, or a save of the whole project, owns the line and the
    // name the saved project carries now.
    if (attempt !== nameSaveAttemptRef.current) return;
    if (outcome === 'saved') lastPersistedNameRef.current = name;
    // An emptied name goes back to the automatic one: nothing to say. The
    // "saved with the plan" line is for a name typed before any plan exists.
    setNameSaveState(outcome === 'pending' && !name ? 'idle' : outcome);
  };

  /** The name a saved project carries: custom > panel label > auto. */
  const automaticProjectName = activeSheet.label?.trim()
    || t(cutMode === '1d' ? 'atelier.project.nameBars' : 'atelier.project.nameSheets', {
      material: (activeSheet.material || 'mdf').toUpperCase(),
      count: pieces.reduce((s, p) => s + (p.quantity || 1), 0),
    });
  const derivedProjectName = projectName.trim() || automaticProjectName;

  // What to keep if the atelier is left now for another screen of the app: the
  // job as a save would store it (see src/lib/atelier-draft.ts). A scan keeps
  // its thumbnail and the path of the image already stored, never the image.
  const leaveDraft = () =>
    buildAtelierDraft({
      payload: buildPersistedProjectPayload({
        name: projectNameRef.current.trim() || automaticProjectName,
        projectName: projectNameRef.current.trim() || undefined,
        scans: scanSheetsRef.current.map((sheet) => ({ thumb: sheet.thumb, path: sheet.keeper.knownPath() ?? undefined })),
        scanGroup: scanGroupRef.current,
        pdfGeneratedAt: pdfGeneratedAt || undefined,
        sheets,
        sheet: activeSheet,
        pieces,
        options,
        // Typed as a plan for the payload; the draft leaves it out when there is none.
        result: result as OptimizationResult,
        displayUnit,
        migratedFromLegacyUnit: pendingUnitMigration || migratedFromLegacyUnit,
      }),
      hasPlan: !!result,
      plannedPieces: plannedPiecesRef.current,
      planKey,
      cutMode,
      projectId: lastSavedProjectId,
      localProjectId,
      restoredAt,
      keptAt: Date.now(),
      photoPreview: photoPreviewRef.current,
    });
  // Refreshed at every render: the atelier closes long after the render that
  // set up the effect which keeps the job.
  const leaveDraftRef = useRef(leaveDraft);
  leaveDraftRef.current = leaveDraft;

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
    // The job kept when the atelier was left for another screen of the app. A
    // project opened from the history comes before it; work kept for a sign-in
    // asked from this tab too, unless the job was changed after it (see
    // draftToRestore). That older work is then dropped, never resumed later.
    const pendingWork = loadPendingWork(window.localStorage);
    const pendingFromThisTab = pendingWork && isFromThisTab(window.sessionStorage, pendingWork) ? pendingWork : null;
    const draft = draftToRestore(readAtelierDraft(window.sessionStorage), {
      openedFromHistory: !!savedProj,
      pendingWork: pendingFromThisTab,
    });
    if (draft && pendingFromThisTab) clearPendingWork(window.localStorage, window.sessionStorage);
    photoPreviewRef.current = !!draft && isPhotoPreview(draft.project);
    previewAutoRunRef.current = photoPreviewRef.current;
    // Read once: gone a tick later, so React's development double pass still finds it.
    window.setTimeout(() => clearAtelierDraft(window.sessionStorage), 0);
    // A kept job put back stands like a reopened project: work kept for a
    // sign-in in another tab is not laid over it.
    openedFromHistoryRef.current = !!savedProj || !!draft;
    // Set alongside 'qatlia_saved_project' when a project is opened from
    // history (see history/page.tsx's handleLoadProject) — without this,
    // QuotationDialog only ever knew about the *last auto-saved* project
    // (lastSavedProjectId below), never the one the artisan actually
    // re-opened, so a quote generated right after opening a past project
    // would silently merge into the wrong project's options_json.
    // Re-validated here too (defense in depth against a stale/tampered
    // sessionStorage value) — /api/export-quotation's `projectId` must be a
    // genuine UUID or the whole quote request 400s.
    const restoredProjectIdRaw = draft ? draft.projectId : sessionStorage.getItem('qatlia_restored_project_id');
    const restoredProjectId =
      restoredProjectIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restoredProjectIdRaw)
        ? restoredProjectIdRaw
        : null;
    // A project kept on this device only has no server id; its history entry id
    // lets the name typed in the atelier be written back to that entry.
    const restoredLocalIdRaw = draft ? draft.localProjectId : sessionStorage.getItem('qatlia_restored_local_id');
    const restoredLocalId = restoredLocalIdRaw && restoredLocalIdRaw.trim() ? restoredLocalIdRaw : null;
    if (savedProj || draft) {
      try {
        const parsed = draft ? draft.project : JSON.parse(savedProj ?? '');
        // A panel price once set in the cut settings becomes the panel's own price.
        const legacyStockPrices = parsed.options?.stockPricingOverrides;
        const restoreSheet = (sheet: Sheet) => withLegacyStockPrice(withoutLegacyPanelLabel(sheet), legacyStockPrices);
        if (parsed.sheet) setSheets([restoreSheet(parsed.sheet)]);
        if (Array.isArray(parsed.sheets)) setSheets(parsed.sheets.map(restoreSheet));
        const restoredPieces = Array.isArray(parsed.pieces) ? normalizePiecesWithColors(parsed.pieces) : null;
        if (restoredPieces) setPieces(restoredPieces);
        if (typeof parsed.projectName === 'string' && parsed.projectName.trim()) {
          commitName(parsed.projectName.trim());
          setProjectNameDraft(parsed.projectName.trim());
          lastPersistedNameRef.current = parsed.projectName.trim();
        }
        // The sheets come back with the plan (an old project's single scan
        // reads as one), and the next save carries them on.
        const restoredSheets = readScanSheets(parsed);
        // Each sheet's full image, when the project kept it, is reached by its
        // path; a thumbnail on screen is never sent as if it were the image.
        setScanSheets(
          restoredSheets.map((sheet) => {
            const keeper = newKeeper();
            keeper.restore(sheet.path);
            return { ...sheet, keeper };
          })
        );
        // A photo added to it rides on its own group, never on another project's.
        scanGroupRef.current = isUuid(parsed.scanGroup) ? (parsed.scanGroup as string) : null;
        // The saved plan is put back as it was saved, with no new run and no
        // new save; an old or damaged result gives null and the atelier opens
        // without a plan, as before.
        const restoredResult = pickRestorableResult(parsed.result);
        if (restoredResult) {
          setResult(restoredResult);
          setActiveSheetIndex(0);
          setPlanKey(typeof draft?.planKey === 'string' ? draft.planKey : null);
          plannedPiecesRef.current = draft?.plannedPieces ? normalizePiecesWithColors(draft.plannedPieces as Piece[]) : restoredPieces;
          // A bar plan reopens in bar mode: the header, the stock card, the
          // project name and a re-run all follow the mode, not only the viewer.
          if (restoredResult.cutMode === '1d' || restoredResult.cutMode === '2d') setCutMode(restoredResult.cutMode);
          // A plan made in this session is not a plan reopened as saved.
          setRestoredAt(draft ? draft.restoredAt : readRestoredProjectDate(sessionStorage.getItem('qatlia_restored_project_meta')));
        }
        // A kept job comes back in the mode it was left in, plan or not.
        if (draft) setCutMode(draft.cutMode);
        setPdfGeneratedAt(typeof parsed.pdfGeneratedAt === 'string' ? parsed.pdfGeneratedAt : null);
        if (parsed.options) setOptions((prev) => optionsWithoutStockOverride({ ...prev, ...parsed.options }));
        if (restoredProjectId) setLastSavedProjectId(restoredProjectId);
        else if (restoredLocalId) setLocalProjectId(restoredLocalId);
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
          sessionStorage.removeItem('qatlia_restored_project_meta');
          sessionStorage.removeItem('qatlia_restored_local_id');
        }, 0);
      } catch (e) {
        console.error('Erreur restauration projet:', e);
        // Malformed JSON will never parse successfully, so don't leave it
        // sitting in sessionStorage forever — clear it right away.
        sessionStorage.removeItem('qatlia_saved_project');
        sessionStorage.removeItem('qatlia_restored_project_id');
        sessionStorage.removeItem('qatlia_restored_project_meta');
        sessionStorage.removeItem('qatlia_restored_local_id');
      }
    }
  }, []);

  // Leaving for another screen of the app closes the atelier: its job is kept
  // in the tab, and put back by the effect above on return. Armed a tick after
  // opening: React's development double mount closes the atelier before it has
  // shown anything, a job just put back included.
  useEffect(() => {
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 0);
    return () => {
      window.clearTimeout(arm);
      if (!armed) return;
      writeAtelierDraft(window.sessionStorage, leaveDraftRef.current());
    };
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

  /**
   * The sheets as saved: each thumbnail fitted to its share of the project's
   * budget (a single sheet keeps the 600 px one it always had), and the path
   * of its kept image when its keeper knows it already.
   */
  const scansForSave = async (sheets: readonly ScreenSheet[]): Promise<ScanSheet[]> => {
    const budget = thumbBudgetFor(sheets.length);
    return Promise.all(
      sheets.map(async (sheet) => {
        const source = sheet.thumb && sheet.thumb.length <= budget ? sheet.thumb : sheet.image ?? sheet.thumb;
        const thumb = await fitThumb(source, budget, downscaleDataUrl);
        const path = sheet.keeper.knownPath() ?? undefined;
        return { ...(thumb ? { thumb } : {}), ...(path ? { path } : {}) };
      })
    );
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
    // The sheets read once: the payload and the image keepers line up by
    // position, and the images are attached by position.
    const sheetsAtSave = scanSheetsRef.current;
    // The name committed now, not the one this handler's render saw: the field
    // may have been left while the optimization was running.
    const committedName = projectNameRef.current.trim();
    const payload = buildPersistedProjectPayload({
      // `{material}` stays the stable payload value upper-cased (MDF, VERRE, …)
      // rather than a translated label, so a project keeps the same identity in
      // history whatever language it was saved in; only the wording around it
      // follows the artisan's locale.
      // Custom project name (when the artisan named it) > panel label > auto.
      name: committedName || automaticProjectName,
      projectName: committedName || undefined,
      // One entry per sheet, thumbnails within the project's budget, with the
      // paths already known (a reopened project, an earlier save); the images
      // of new sheets follow this save (see saveProjectToCloud).
      scans: await scansForSave(sheetsAtSave),
      scanGroup: scanGroupRef.current,
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
    // The record this save just wrote, for the name check at the end.
    let savedCloudId: string | null = null;
    let savedLocalId: string | null = null;
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const saved = await saveProjectToCloud(payload, sheetsAtSave.map((sheet) => sheet.keeper), (url, init) => fetch(url, init));
        // The project is saved without waiting for the scan image: a new scan's
        // image is sent afterwards and attached to it (`saved.scanAttached`,
        // never rejected); a refusal leaves the thumbnail only.
        scanAttachRef.current = saved.scanAttached;
        if (saved.ok) {
          savedToCloud = true;
          // The quotation dialog merges its metadata into *this* saved
          // project's options_json (see /api/export-quotation) — only once
          // the server confirms the save, never a client-guessed id.
          if (saved.projectId) {
            savedCloudId = saved.projectId;
            setLastSavedProjectId(saved.projectId);
            setLocalProjectId(null);
          }
        }
      }
    } catch (err) {
      console.error('Erreur auto-save projet:', err);
    }
    if (!savedToCloud) {
      const localId = `${source}_${Date.now()}`;
      savedLocalId = localId;
      setLocalProjectId(localId);
      writeLocalHistoryItem({
        id: localId,
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
    // The atelier may have been left while this save ran: the job kept in the
    // tab learns its project, then the images once stored (src/lib/atelier-draft.ts).
    adoptSavedJob(window.sessionStorage, { result: nextResult, projectId: savedCloudId, localProjectId: savedLocalId });
    void scanAttachRef.current.then(() =>
      adoptSavedJob(window.sessionStorage, { result: nextResult, scanPaths: sheetsAtSave.map((sheet) => sheet.keeper.knownPath()) })
    );
    // The saved project now carries `committedName`: the line says so, whatever
    // it said before (not saved, saved with the plan), and a late answer from an
    // earlier name commit no longer overwrites it.
    const attempt = ++nameSaveAttemptRef.current;
    lastPersistedNameRef.current = committedName;
    const currentName = projectNameRef.current.trim();
    if (currentName === committedName) {
      setNameSaveState(committedName ? 'saved' : 'idle');
      return;
    }
    // The field was left while this save was running: the new record carries
    // the previous name, so the name typed since is written to it now.
    await settledWithin(scanAttachRef.current);
    const outcome = await saveProjectName(
      { cloudId: savedCloudId, localId: savedLocalId },
      currentName,
      { fetch: (input, init) => fetch(input, init), renameLocal: renameLocalHistoryItem },
    );
    if (attempt !== nameSaveAttemptRef.current) return;
    if (outcome === 'saved') lastPersistedNameRef.current = currentName;
    setNameSaveState(outcome === 'pending' && !currentName ? 'idle' : outcome);
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
      await settledWithin(scanAttachRef.current);
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
    // A project kept on this device only is updated on its own entry too.
    if (!lastSavedProjectId && localProjectId && markLocalHistoryPdf(localProjectId, generatedAt)) return;
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
    const legacyStockPrices = (work.options as Partial<OptimizationOptions> | undefined)?.stockPricingOverrides;
    if (work.sheets.length > 0) setSheets((work.sheets as Sheet[]).map((sheet) => withLegacyStockPrice(sheet, legacyStockPrices)));
    if (work.options) setOptions((prev) => optionsWithoutStockOverride({ ...prev, ...(work.options as Partial<OptimizationOptions>) }));
    if (work.cutMode) setCutMode(work.cutMode);
    if (work.projectName) {
      commitName(work.projectName);
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

  // A plan put back without its key: it was made from its own pieces, with
  // the panel and the settings put back along with it.
  useEffect(() => {
    if (!result || planKey !== null) return;
    setPlanKey(planInputsKey({ pieces: plannedPiecesRef.current ?? pieces, sheets, options, cutMode }));
    // Only when a plan comes on screen: a later edit is what makes it old.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, planKey]);
  const inputsKey = useMemo(() => planInputsKey({ pieces, sheets, options, cutMode }), [pieces, sheets, options, cutMode]);
  const planIsStale = !!result && planKey !== null && planKey !== inputsKey;

  // The sticky header and bar (128 px) hide the button as surely as the edge of the screen.
  useEffect(() => {
    const button = mainRunRef.current;
    if (!button || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setMainRunVisible(entry.isIntersecting), { rootMargin: '-128px 0px 0px 0px' });
    observer.observe(button);
    return () => observer.disconnect();
  }, []);
  const shortcut = planShortcut({
    hasPieces: pieces.length > 0,
    sampleOnly: !piecesOnlyOnScreen(pieces, INITIAL_PIECES),
    hasPlan: !!result,
    stale: planIsStale,
    mainVisible: mainRunVisible,
    reading: isProcessingVision,
    typing,
  });
  const runFromShortcut = () => {
    shortcutRunRef.current = true;
    void handleRunOptimization();
  };
  // A run started away from the main button ends where its answer is: the
  // message by that button, or the plan.
  useEffect(() => {
    if (isOptimizing || !shortcutRunRef.current) return;
    shortcutRunRef.current = false;
    if (optimizeError) {
      runErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const top = planColumnRef.current?.getBoundingClientRect().top ?? 0;
    if (result && (top < 0 || top > window.innerHeight * 0.6)) planColumnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOptimizing]);

  const handleRunOptimization = async ({ resumed = false }: { resumed?: boolean } = {}) => {
    // Taken now: the pieces can still be edited while the answer is on its way.
    const runKey = planInputsKey({ pieces, sheets, options, cutMode });
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
          options: { ...optionsWithoutStockOverride(options), currency, ...(edgePrice !== null ? { edgeBandPricePerM: edgePrice } : {}) },
          cutMode,
          analysisPass: readAnalysisPass() ?? undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        // Any answer but 401 means the server saw a signed-in user: the
        // sign-up banner no longer applies (the preview stays gated).
        if (res.status !== 401) setShowPhotoBanner(false);
        if (res.status === 401 && !resumed) {
          // Keep the pieces and run again right after sign-in.
          askSignInKeepingWork('optimize');
        } else if (res.status === 401) {
          setOptimizeError(t('atelier.optimize.authRequired'));
        } else if (res.status === 402) {
          if (typeof data?.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
          setOptimizeError(t(storeAppCopyKey('atelier.optimize.noCredits', isStoreAppDocument())));
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
      setRestoredAt(null);
      setPlanKey(runKey);
      // A paid plan now: no longer the free preview of a WhatsApp link.
      photoPreviewRef.current = false;
      setShowPhotoBanner(false);
      plannedPiecesRef.current = pieces;
      setActiveSheetIndex(0);
      if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
      void persistProject(optResult, 'optimize');
    } catch {
      setOptimizeError(t('atelier.optimize.network'));
    } finally {
      setIsOptimizing(false);
    }
  };

  /**
   * The free preview of a WhatsApp link never leaves as a file
   * (previewExportGate): signed out, the sign-up comes first and the paid run
   * follows; signed in, the paid run starts instead of the export. True when
   * the export was stopped.
   */
  const previewBlocksExport = async (): Promise<boolean> => {
    if (!photoPreviewRef.current) return false;
    let signedIn = false;
    try {
      const { data: { user } } = await createClient().auth.getUser();
      signedIn = !!user;
    } catch {
      /* treated as signed out */
    }
    const gate = previewExportGate({ preview: photoPreviewRef.current, signedIn });
    if (gate === 'allow') return false;
    if (gate === 'run') void handleRunOptimization();
    else askSignInKeepingWork('optimize');
    return true;
  };

  /**
   * Shows the scan full size: a scan made on this page from memory, a reopened
   * project's kept image through a short signed link, else its thumbnail,
   * marked as reduced. Seeing it spends no credit.
   */
  const openScanViewer = (index: number) => {
    const sheets = scanSheetsRef.current;
    const sheet = sheets[index];
    if (!sheet) return;
    // The image read on this page, else the sheet's kept image through a
    // short signed link, else its thumbnail; arrows step through the sheets.
    void scanViewer.show(
      `atelier-${index}`,
      {
        localImage: sheet.keeper.freshImage(),
        projectId: lastSavedProjectId,
        hasFullScan: sheet.keeper.knownPath() !== null,
        thumb: sheet.thumb ?? sheet.image ?? null,
        sheet: index + 1,
      },
      t('atelier.scan.previewAlt'),
      sheets.length > 1
        ? { position: { index: index + 1, count: sheets.length }, onStep: (delta) => openScanViewer(index + delta) }
        : undefined
    );
  };

  /**
   * Removes a sheet: its image and every piece read from it, even edited
   * ones; the sheets after it move down one. The read is not given back.
   */
  const removeSheet = (index: number) => {
    const current = scanSheetsRef.current;
    if (!current[index]) return;
    setPieces((prev) => removeScanSheet(prev, index + 1));
    setScanSheets(current.filter((_, i) => i !== index));
  };

  /**
   * Reads the picked photos as the project's next sheets, one after another:
   * each sends the scan group the previous one got back, so only the first
   * photo of a project is charged. Photos past MAX_SCAN_SHEETS are ignored,
   * and the reading stops at the first one that fails.
   */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Lets the same photo be picked again, which onChange would otherwise ignore.
    e.target.value = '';
    if (files.length === 0) return;
    const room = MAX_SCAN_SHEETS - scanSheetsRef.current.length;
    if (room <= 0) return;
    const chosen = files.slice(0, room);

    setIsProcessingVision(true);
    setVisionError(null);
    try {
      let readAll = true;
      for (const file of chosen) {
        // eslint-disable-next-line no-await-in-loop
        const base64 = await readFileAsDataUrl(file);
        // A phone photo is 1–4 MB of base64; Gemini reads a cut list fine at
        // 1600px, so shrink before the upload — it is the slowest leg of the
        // scan on a workshop connection. A failed downscale (no canvas, exotic
        // codec) must never block a scan: fall back to the original bytes.
        // eslint-disable-next-line no-await-in-loop
        const scanImage = (await downscaleDataUrl(base64, 1600, 0.8)) ?? base64;
        // eslint-disable-next-line no-await-in-loop
        const outcome = await runScan(scanImage, { batch: true });
        if (outcome !== 'read') {
          readAll = false;
          // Signed out: only the first photo is kept for after the sign-in.
          if (outcome === 'signin' && chosen.length > 1) setVisionError('atelier.scan.signInFirstPhoto');
          break;
        }
      }
      if (readAll && files.length > room) setVisionError('atelier.scan.extraPhotosIgnored');
    } catch (err) {
      setVisionError('atelier.visionError.network');
      console.error(err);
    } finally {
      setIsProcessingVision(false);
    }
  };

  /**
   * Analyses a (downscaled) cut-list photo as the project's next sheet. A
   * signed-out visitor is asked to sign in first, with the photo kept;
   * `resumed` marks the automatic run after that sign-in, which never asks
   * again. `batch` leaves the busy state to the caller reading several
   * photos, so nothing can start a read in between.
   */
  const runScan = async (
    scanImage: string,
    { resumed = false, batch = false }: { resumed?: boolean; batch?: boolean } = {}
  ): Promise<'read' | 'failed' | 'signin'> => {
    const sheetIndex = scanSheetsRef.current.length;
    if (sheetIndex >= MAX_SCAN_SHEETS) return 'failed';
    if (!batch) {
      setIsProcessingVision(true);
      setVisionError(null);
    }
    try {
      if (!resumed) {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user) {
          askSignInKeepingWork('scan', scanImage);
          return 'signin';
        }
      }
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: scanImage,
          sheetMaterial: activeSheet.material || 'mdf',
          // The project's group, when an earlier photo of it opened one.
          ...(scanGroupRef.current ? { scanGroup: scanGroupRef.current } : {}),
        }),
      });

      const data = await res.json();
      if (data.success && Array.isArray(data.pieces) && data.pieces.length > 0) {
        const sheetNumber = sheetIndex + 1;
        // The first sheet of a project replaces the list (it clears the
        // example pieces); sheet 1 read again after it was removed, like any
        // later sheet, adds to it.
        const replace = sheetIndex === 0 && scanGroupRef.current === null;
        scanGroupRef.current = typeof data.scanGroup === 'string' ? data.scanGroup : null;
        const sheet: ScreenSheet = { image: scanImage, keeper: newKeeper() };
        sheet.keeper.newScan(scanImage);
        setScanSheets([...scanSheetsRef.current, sheet]);
        // The thumbnail shown here, and saved with the project: 600px keeps
        // the cut list readable; a project of several sheets shrinks them at
        // save time to share one thumbnail's budget (see scansForSave).
        void downscaleDataUrl(scanImage, 600, 0.7).then((thumb) => {
          if (thumb) setScanSheets(scanSheetsRef.current.map((s) => (s === sheet ? { ...s, thumb } : s)));
        });
        const readPieces = (offset: number): Piece[] => data.pieces.map((p: { name?: string; width?: number | string; height?: number | string; quantity?: number | string; material?: string; color?: string }, i: number) => {
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
            id: `ext_${Date.now()}_${sheetNumber}_${i}`,
            // Unnamed lines go on numbering after the pieces already listed.
            name: p.name || t('pieces.defaultName', { index: offset + i + 1 }),
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
        setPieces((prev) =>
          normalizePiecesWithColors(appendSheetPieces(prev, readPieces(replace ? 0 : prev.length), sheetNumber, replace))
        );
        storeAnalysisPass(data.analysisPass);
        // The server is the only authority on the balance; it is echoed back
        // only when a credit was actually debited.
        if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
        return 'read';
      } else {
        if (res.status === 401 && !resumed) {
          // Signed out since the check above: keep the photo, ask again.
          askSignInKeepingWork('scan', scanImage);
          return 'signin';
        }
        if (typeof data.creditsRemaining === 'number') setUserCredits(data.creditsRemaining);
        // The route's own `message` stays French for non-browser callers; the
        // workshop renders the artisan's language from the `error` code, and a
        // code this build does not know degrades to the generic message.
        setVisionError(visionErrorKey(data.error));
        return 'failed';
      }
    } catch (err) {
      setVisionError('atelier.visionError.network');
      console.error(err);
      return 'failed';
    } finally {
      if (!batch) setIsProcessingVision(false);
    }
  };

  // A preview from a WhatsApp link: once the sign-in is known, either the paid
  // run starts (signed in) or the banner shows (signed out). The marker is
  // consumed before the run, so a double effect cannot charge twice.
  useEffect(() => {
    if (!previewAutoRunRef.current) return;
    let cancelled = false;
    (async () => {
      let signedIn = false;
      try {
        const { data: { user } } = await createClient().auth.getUser();
        signedIn = !!user;
      } catch {
        /* treated as signed out */
      }
      if (cancelled) return;
      const step = photoPreviewStep({ preview: previewAutoRunRef.current, signedIn });
      if (step === 'run') {
        previewAutoRunRef.current = false;
        setResumeRequest({ action: 'optimize', resumed: true });
      } else if (step === 'banner') {
        setShowPhotoBanner(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleDownloadJson = async () => {
    if (!result) return;
    if (await previewBlocksExport()) return;
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
    if (await previewBlocksExport()) return;
    // The plan, not the first drawing of the page (the header's logo).
    const svg = document.querySelector<SVGSVGElement>('[data-testid="cut-plan-svg"]');
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Its size on the page comes from CSS, which the file does not carry.
    clone.setAttribute('width', String(Math.round(svg.viewBox.baseVal.width * PNG_PX_PER_CM)));
    clone.setAttribute('height', String(Math.round(svg.viewBox.baseVal.height * PNG_PX_PER_CM)));
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
    if (await previewBlocksExport()) return;
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
    // A preview becomes a plan only through the paid run.
    if (await previewBlocksExport()) return;

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
          buildPdfPayload(derivedProjectName, activeSheet, pieces, result, displayUnit, locale, currency, showEdges)
        ),
      });

      if (res.ok) {
        const generatedAt = new Date().toISOString();
        setPdfGeneratedAt(generatedAt);

        // The file first: recording the PDF in the history may wait for the
        // scan image to be attached (see recordPdfGenerated), and the artisan
        // must not wait for that to get the PDF.
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileNameFromContentDisposition(res.headers.get('Content-Disposition')) ?? `qatlia_rapport_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        await recordPdfGenerated(generatedAt);
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
  // Sides to band that the price leaves out. A price of zero is a choice.
  const uncountedEdges = result && edgePrice !== 0 ? uncountedEdgeMetres(result) : 0;
  const showEdgePriceField = () => {
    setShowAdvancedOptions(true);
    // Once the settings are unfolded.
    window.setTimeout(() => {
      const field = document.getElementById('edge-price-input');
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field?.focus({ preventScroll: true });
    }, 50);
  };
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

              <LocaleSwitcher />
              <OnboardingTour />
              <ThemeToggle />
              <Link
                href={inApp ? '/account/credits' : '/credits'}
                aria-label={t('atelier.header.creditsAria')}
                className={`group relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-semibold transition-all ${CREDIT_BADGE_TONES[creditLevel].box}`}
              >
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${CREDIT_BADGE_TONES[creditLevel].dot}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${CREDIT_BADGE_TONES[creditLevel].dot}`} />
                </span>
                <Zap className={`w-3.5 h-3.5 ${CREDIT_BADGE_TONES[creditLevel].icon}`} />
                <span className="font-mono font-bold" dir="ltr">{userCredits === null ? '—' : n(userCredits)}</span>
                <span className="text-[10px] opacity-80 hidden sm:inline">{t('atelier.header.credits')}</span>
              </Link>
            </div>

            {shortcut.header && (
              <PlanHeaderButton onRun={runFromShortcut} busy={isOptimizing} hasPlan={!!result} stale={planIsStale} />
            )}

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

      {/* The bar shared by every screen. It sticks under the header; the
          machine figures at its end are the atelier's own addition. */}
      <WorkspaceNav current="atelier" busy={isProcessingVision || isOptimizing} className="max-w-[1500px] mx-auto px-4 sm:px-6">
        {/* Machine setup figures, pushed to the trailing edge. */}
        <p className="hidden lg:block font-mono text-[10px] text-slate-500" dir="ltr">
          {formatDisplayValue(activeSheet.height, displayUnit)} × {formatDisplayValue(activeSheet.width, displayUnit)} {displayUnit}
        </p>
        {/* Kerf chip (Stitch header pattern): the blade width is a technical
            figure — mono, amber-tinted, always visible for machine setup.
            It leads to where the blade is set, in the panel card. */}
        <a
          href="#cut-settings"
          dir="ltr"
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-400/10 hover:bg-brand-400/20 border border-brand-500/25 text-brand-500 dark:text-brand-400 text-xs font-mono font-bold transition-colors"
          title={t('options.kerf.title')}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400" aria-hidden="true" />
          {t('options.kerf.chip', { value: n(options.kerfWidth, { maximumFractionDigits: 1 }) })}
        </a>
      </WorkspaceNav>

      {/* Main Workspace Grid */}
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6">
        <div className="space-y-4">

          <div className="min-w-0 w-full space-y-4">

            <LowCreditsBanner balance={userCredits} level={creditLevel} dismissible />

            {/* A parrain's new referral bonuses, once each; a signed-in account only. */}
            {userCredits !== null && <ReferralRewardBanner />}

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
                  onChange={(e) => { setProjectNameDraft(e.target.value); setNameSaveState('idle'); }}
                  onBlur={() => void commitProjectName()}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder={t('atelier.project.namePlaceholder')}
                  maxLength={120}
                  data-testid="project-name-input"
                  className="mt-0.5 block w-full sm:w-[260px] rounded-lg bg-studio-field border border-studio-border px-2.5 py-1.5 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 placeholder:font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <p
                  aria-live="polite"
                  data-testid="project-name-status"
                  className={`text-[10px] font-semibold ${nameSaveState === 'failed' ? 'text-red-600 dark:text-red-400' : nameSaveState === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}
                >
                  {nameSaveState === 'saved' && t('atelier.project.nameSaved')}
                  {nameSaveState === 'pending' && t('atelier.project.namePending')}
                  {nameSaveState === 'failed' && t('atelier.project.nameFailed')}
                </p>
                {/* Same figures as the cut-list chip: pieces are quantities summed,
                    lines are rows (counting distinct names merged same-named rows). */}
                <p className="text-[10px] text-slate-500 font-mono">
                  {t('pieces.counts', {
                    qty: pieces.reduce((sum, p) => sum + (p.quantity || 1), 0),
                    rows: tn('pieces.rowCount', pieces.length),
                  })}
                </p>
              </div>
              <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
                {result && !restoredAt && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                    <CheckCircle2 className="w-3 h-3" /> {t('atelier.project.optimized')}
                  </span>
                )}
                {/* Starts another job from a plan on screen, reopened or just
                    made. Leaving the button drops a pending confirmation. */}
                <button
                  type="button"
                  data-testid="new-job-button"
                  onClick={handleNewJob}
                  onBlur={() => setConfirmingNewJob(false)}
                  disabled={isOptimizing || isProcessingVision || !hasJobOnScreen}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${confirmingNewJob ? 'bg-rose-600 hover:bg-rose-500 border-rose-600 text-white' : 'bg-studio-field border-studio-border text-slate-700 dark:text-slate-200 hover:border-brand-500/50 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                  <span aria-live="polite">{t(confirmingNewJob ? 'atelier.project.newJobConfirm' : 'atelier.project.newJob')}</span>
                </button>
              </div>
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

            {/* Quick Actions: Hero Cards. `data-tour` marks are the guided tour's
                steps (src/components/OnboardingTour.tsx). */}
            <div data-tour="photo" className="grid grid-cols-2 gap-3">
              {/* Take Photo Card */}
              <label className={`group relative flex flex-col gap-3 p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm hover:border-sky-500/40 hover:bg-studio-field cursor-pointer transition-all duration-200 overflow-hidden ${sheetsFull ? 'opacity-50 pointer-events-none' : ''}`}>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} disabled={isProcessingVision || sheetsFull} />
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3">
                  <span className="shrink-0 w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center group-hover:scale-105 group-hover:bg-sky-500/15 transition-all">
                    <Camera className="w-5 h-5 text-sky-400" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:text-white transition-colors">{t(scanSheets.length > 0 ? 'atelier.scan.addSheetTitle' : 'atelier.scan.cameraTitle')}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{t('atelier.scan.cameraDesc')}</p>
                  </div>
                </div>
                <span className="self-start px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-400 text-[10px] font-bold font-mono border border-sky-500/20">{t('atelier.scan.cameraBadge')}</span>
              </label>

              {/* Upload File Card */}
              <label className={`group relative flex flex-col gap-3 p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm hover:border-brand-500/40 hover:bg-studio-field cursor-pointer transition-all duration-200 overflow-hidden ${sheetsFull ? 'opacity-50 pointer-events-none' : ''}`}>
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} disabled={isProcessingVision || sheetsFull} />
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
            <p className="-mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">{t('atelier.scan.sheetsHint', { max: MAX_SCAN_SHEETS })}</p>

            {/* The sheets read for this project */}
            <ScanSheets
              sheets={scanSheets.map((sheet, index) => ({ src: sheet.thumb ?? sheet.image ?? null, pieceCount: sheetPieceCount(index) }))}
              max={MAX_SCAN_SHEETS}
              pendingIndex={scanViewer.pendingKey?.startsWith('atelier-') ? Number(scanViewer.pendingKey.slice('atelier-'.length)) : null}
              busy={isProcessingVision}
              onOpen={openScanViewer}
              onRemove={removeSheet}
            />

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
                <span className="text-xs text-rose-700 dark:text-rose-300 font-medium">{t(storeAppCopyKey(visionError, inApp), { max: MAX_SCAN_SHEETS })}</span>
                {visionError === 'atelier.visionError.insufficientCredits' && (
                  <Link
                    href="/credits"
                    data-sells=""
                    className="ms-auto shrink-0 px-3 py-2 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-black transition-colors"
                  >
                    {t('account.buyCredits')}
                  </Link>
                )}
              </div>
            )}

            {/* Pieces Manager Component: right under the scan that fills it,
                ahead of the panel the pieces are cut from. */}
            <div data-tour="pieces" className="p-4 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
              <PiecesManager
                pieces={pieces}
                onUpdatePieces={setPieces}
                defaultMaterial={activeSheet.material || 'mdf'}
                displayUnit={displayUnit}
                showMaterialCol={options.considerMaterial}
                disabled={isOptimizing}
                showScanMarks={scanSheets.length > 1}
                panelHasGrain={cutMode !== '1d' && !!activeSheet.hasGrain}
              />
            </div>

            {/* Stock Panel Card */}
            <div id="stock-card" data-tour="panel" className="overflow-hidden rounded-xl bg-studio-panel border border-studio-border shadow-sm">
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

              {/* First in the card: pick a panel of the list (it stays shown), or
                  save the one on the card (see src/lib/atelier-panel-choice.ts). */}
              <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
                <div className="relative flex-1 min-w-[180px]">
                  <PackageOpen className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 z-10" aria-hidden="true" />
                  <select
                    value={listPanel?.id ?? ''}
                    aria-label={t('atelier.stock.presetAria')}
                    onChange={(e) => {
                      const preset = allPresets.find((p) => p.id === e.target.value);
                      if (!preset) return;
                      // A saved panel brings its grain, its colour and its price back.
                      const grain = { hasGrain: !!preset.hasGrain, grainOrientation: preset.hasGrain ? preset.grainOrientation ?? 'vertical' : undefined };
                      const { pricePerSheet: _previousPrice, ...withoutPrice } = activeSheet;
                      void _previousPrice;
                      const nextSheet: Sheet = {
                        ...withoutPrice,
                        label: preset.name,
                        height: preset.height,
                        width: preset.width,
                        material: (preset.material as MaterialType) || activeSheet.material,
                        ...grain,
                        color: preset.color || undefined,
                        ...(isPanelPrice(preset.pricePerSheet) ? { pricePerSheet: preset.pricePerSheet } : {}),
                      };
                      setPickedPresetId(preset.id);
                      setSheets([nextSheet]);
                      setActiveSheetIndex(0);
                      repriceResult({ sheet: nextSheet });
                    }}
                    className="w-full appearance-none bg-studio-field border border-studio-border hover:border-studio-border-hover rounded-lg py-2 ps-8 pe-3 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/50 cursor-pointer transition-colors [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                  >
                    <option value="" disabled>{t('atelier.stock.presetPlaceholder')}</option>
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
                  disabled={!presetsReady || isSavingPreset}
                  aria-disabled={saveAction.kind === 'saved' || undefined}
                  aria-label={t(saveAction.kind === 'update' ? 'atelier.stock.updatePresetAria' : 'atelier.stock.savePresetAria')}
                  className="px-3 py-2 rounded-lg bg-studio-field border border-studio-border hover:border-brand-500/50 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-brand-500 dark:hover:text-brand-400 flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-wait aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  {t(saveAction.kind === 'update' ? 'atelier.stock.updatePreset' : 'atelier.stock.savePreset')}
                </button>
                {/* The list itself is managed on its own page. */}
                <Link href="/panels"
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  {t('atelier.stock.managePresets')}
                  <ArrowRight className="w-3.5 h-3.5 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
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
                        // No direction set yet (just ticked) is vertical, as
                        // the plan and the panel drawing already treat it.
                        aria-pressed={(activeSheet.grainOrientation ?? 'vertical') === dir}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${(activeSheet.grainOrientation ?? 'vertical') === dir ? 'bg-brand-400 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {t(`atelier.stock.grain${dir === 'vertical' ? 'Vertical' : 'Horizontal'}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* The panel's name (on the plan, the PDF and in the list when
                  saved), its colour and its price. */}
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
                      placeholder={t('atelier.stock.panelPricePlaceholder', { price: detailMoney(catalogPanelPrice(activeSheet.material, activeSheet.width, activeSheet.height, currency)) })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs font-mono outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all"
                    />
                  </div>
                )}
              </div>

              {savedPrice && keptPriceKey !== savedPriceKey ? (
                <div role="status" className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-lg bg-brand-400/10 border border-brand-500/25 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  <span dir="auto" className="min-w-0">
                    {t('atelier.stock.savedPriceChanged', { name: savedPrice.name, price: n(savedPrice.price) })}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={applySavedPrice}
                      className="min-h-9 px-3 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 font-bold transition-colors"
                    >
                      {t('atelier.stock.applySavedPrice')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeptPriceKey(savedPriceKey)}
                      className="min-h-9 px-3 rounded-lg border border-studio-border bg-studio-panel hover:bg-studio-field font-bold text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      {t('atelier.stock.keepPrice')}
                    </button>
                  </span>
                </div>
              ) : null}

              {presetFeedback && (
                <div role="status" className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] font-semibold ${presetFeedback.tone === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'}`}>
                  {presetFeedback.text}
                </div>
              )}

              {/* The cut settings sit with the panel they apply to. The blade
                  and the edge margin, set for every job, are always shown; the
                  rarer ones unfold under them. scroll-mt clears the sticky
                  header and bar when the blade figure of the bar leads here. */}
              <div id="cut-settings" className="scroll-mt-32 border-t border-studio-border px-4 pt-3.5 pb-3 space-y-3">
                <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <Scissors className="w-3.5 h-3.5 text-brand-400" />
                  {t('atelier.advanced.title')}
                </h3>
                <OptionsPanel
                  part="blade"
                  options={options}
                  onChange={handleOptionsChange}
                  disabled={isOptimizing}
                  edgeMarginMm={Math.round((activeSheet.margin ?? 0) * 100) / 10}
                  onEdgeMarginChange={handleEdgeMarginChange}
                />
                <button
                  type="button"
                  onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                  aria-expanded={showAdvancedOptions}
                  aria-controls="advanced-cutting-options"
                  className="w-full py-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-brand-400" />
                    {t('atelier.advanced.toggle')}
                  </span>
                  <span className={`transition-transform duration-200 ${showAdvancedOptions ? 'rotate-180' : ''}`}>
                    <ChevronDown className="w-4 h-4" />
                  </span>
                </button>
                {showAdvancedOptions && (
                  <div id="advanced-cutting-options" className="animate-in fade-in slide-in-from-top-1 duration-200">
                    <OptionsPanel
                      part="rest"
                      options={options}
                      onChange={handleOptionsChange}
                      disabled={isOptimizing}
                      edgePrice={edgePrice}
                      onEdgePriceChange={(price) => void handleEdgePriceChange(price)}
                      edgePriceSaveFailed={edgePriceSaveFailed}
                    />
                  </div>
                )}
              </div>
            </div>

            {optimizeError && (
              <p ref={runErrorRef} role="alert" className="flex items-center gap-2 text-xs font-semibold text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {optimizeError}
                {(optimizeError === t('atelier.optimize.noCredits')) && (
                  <Link href="/credits" data-sells="" className="ms-auto shrink-0 px-3 py-2 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 font-black transition-colors">{t('account.buyCredits')}</Link>
                )}
              </p>
            )}
            {/* Primary CTA Button */}
            <button
              ref={mainRunRef}
              data-tour="plan"
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
          <div ref={planColumnRef} className="lg:col-span-7 space-y-4 scroll-mt-32">

            {result ? (
              <>
                {planIsStale && (
                  <div
                    role="status"
                    data-testid="plan-stale-notice"
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30"
                  >
                    <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300 min-w-0">
                      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {t('atelier.optimize.stale')}
                    </p>
                    <button
                      type="button"
                      onClick={runFromShortcut}
                      disabled={isOptimizing || pieces.length === 0}
                      className="min-h-9 px-4 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-bold transition-colors disabled:opacity-40"
                    >
                      {t('atelier.optimize.again')}
                    </button>
                  </div>
                )}

                {/* A plan reopened from history is shown exactly as saved: this
                    says so, with the date, until a new run replaces it. */}
                {restoredAt && (
                  <div
                    role="status"
                    data-testid="restored-plan-notice"
                    className="flex items-start gap-3 p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-sky-500 dark:text-sky-400" aria-hidden="true" />
                    <p className="text-xs font-semibold text-sky-700 dark:text-sky-300 min-w-0">
                      {t('atelier.restored.notice', { date: formatDateTime(locale, restoredAt, RESTORED_DATE_OPTIONS) })}
                    </p>
                  </div>
                )}

                {showPhotoBanner && (
                  <div
                    role="status"
                    data-testid="photo-preview-banner"
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30"
                  >
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 min-w-0">{t('atelier.photoPreview.banner')}</p>
                    <button
                      type="button"
                      onClick={() => void previewBlocksExport()}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-black"
                    >
                      {t('atelier.photoPreview.cta')}
                    </button>
                  </div>
                )}

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
                      {/* translate="no": Chrome's page translation turned "MAD" into
                          "UAE dirham" on an Arabic-language phone. */}
                      <p data-testid="cost-banner-total" className="text-3xl font-black font-mono text-white tracking-tight" dir="ltr" translate="no">
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

                {uncountedEdges > 0 && (
                  <div
                    role="status"
                    data-testid="uncounted-edges"
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40"
                  >
                    <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300 min-w-0">
                      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {t('atelier.cost.uncounted', { meters: n(uncountedEdges, { maximumFractionDigits: 2 }) })}
                    </p>
                    <button
                      type="button"
                      onClick={() => (edgePrice === null ? showEdgePriceField() : repriceResult({}))}
                      className="min-h-9 px-4 rounded-lg bg-brand-400 hover:bg-brand-500 text-slate-950 text-xs font-bold transition-colors"
                    >
                      {t(edgePrice === null ? 'atelier.cost.uncountedSet' : 'atelier.cost.uncountedCount')}
                    </button>
                  </div>
                )}

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
                  <div data-testid="cut-plan-toolbar" className="relative z-20 flex items-center gap-2 px-2 sm:px-4 py-2 bg-studio-panel border-b border-studio-border/60">
                    <SheetTabs
                      wasteRates={Array.from({ length: result.sheetsUsed }, (_, i) => result.sheets[i]?.wasteRate ?? 0)}
                      activeIndex={activeSheetIndex}
                      onSelect={(index) => setActiveSheetIndex(Math.max(0, Math.min(result.sheetsUsed - 1, index)))}
                      mode={result.cutMode === '1d' ? '1d' : '2d'}
                    />
                  </div>

                  {/* SVG Canvas — the plan is geometry, not prose: its origin is
                      the sheet's top-left corner and its labels are cm/mm
                      figures, so it stays LTR even when the workshop is RTL. */}
                  {/* The frame does not scroll; the viewport inside it does.
                      The two overlays belong to the frame: as absolute
                      children of the scrolling box they scrolled away with
                      the zoomed plan, taking the zoom-out button with them. */}
                  <div dir="ltr" data-testid="cut-plan-frame" className="relative">
                    {/* Zoom controls — floating instrument control, pinned to the
                        frame (not the toolbar) so it stays reachable while the
                        plan underneath scrolls. Reads out/in like the plan it
                        drives, so it keeps LTR order in every locale. */}
                    <div dir="ltr" className="absolute bottom-3 end-3 z-10 flex items-center gap-1.5 bg-studio-panel/90 backdrop-blur rounded-lg border border-studio-border p-0.5 shadow-sm">
                      <button aria-label={t('atelier.plan.zoomOut')} onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))} disabled={zoomLevel <= 0.5} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <ZoomOut className="w-3.5 h-3.5" />
                      </button>
                      <span title={t('atelier.plan.zoomLevelAria')} className="text-[10px] font-mono text-slate-600 dark:text-slate-400 tabular-nums px-1 w-10 text-center">{Math.round(zoomLevel*100)}%</span>
                      <button aria-label={t('atelier.plan.zoomIn')} onClick={() => setZoomLevel(Math.min(2.5, zoomLevel + 0.25))} disabled={zoomLevel >= 2.5} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      {/* Back to 100% in one tap, instead of counting zoom-out
                          steps on a phone. Inert when already there. */}
                      <span className="h-3.5 w-px bg-studio-border" aria-hidden="true" />
                      <button aria-label={t('atelier.plan.zoomReset')} title={t('atelier.plan.zoomReset')} data-testid="cut-plan-zoom-reset" onClick={() => setZoomLevel(1)} disabled={zoomLevel === 1} className="p-1 rounded-md hover:bg-studio-border transition-colors text-slate-600 dark:text-slate-400 disabled:opacity-35 disabled:cursor-not-allowed">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {/* Technical corner readout — decorative blueprint annotation
                        (sheet size + kerf), pinned to the frame so it stays put
                        while the plan underneath scrolls/zooms. Sits
                        at the opposite corner from the zoom controls above. */}
                    <div aria-hidden="true" dir="ltr" className="pointer-events-none absolute bottom-3 start-3 z-10 flex items-center gap-2 rounded-lg border border-studio-border/70 bg-studio-panel/90 backdrop-blur px-2.5 py-1.5 font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400 shadow-sm">
                      <span className="flex items-center gap-1">
                        <Boxes className="w-3 h-3 text-sky-400" />
                        {formatDisplayValue(activeSheet.height, displayUnit)}×{formatDisplayValue(activeSheet.width, displayUnit)} {displayUnit}
                      </span>
                      {/* Below 400px the kerf part gives way to the four zoom
                          buttons: "2780.0×2060.0 mm | 10 mm" ran under them
                          on a 360-390px phone. The kerf stays in the settings. */}
                      <span className="hidden xs:block h-3 w-px bg-studio-border" />
                      <span className="hidden xs:flex items-center gap-1">
                        <Scissors className="w-3 h-3 text-brand-400" />
                        {options.kerfWidth} mm
                      </span>
                    </div>
                    <div dir="ltr" data-testid="cut-plan-viewport" className={`min-h-[420px] ${zoomLevel > 1 ? PLAN_VIEWPORT_ZOOMED : PLAN_VIEWPORT_FITTED} p-5 flex ${isDark ? 'bg-[#040812]' : 'bg-[#F1F5F9]'}`}>
                    {/* m-auto (not justify-center): when the zoomed plan is wider
                        than the viewport, auto margins clamp to 0 and BOTH edges
                        stay reachable by scrolling — centered overflow via
                        justify-center would clip the left edge under the padding
                        and visually slide the plan under the toolbar.
                        shrink-0: a flex item shrinks to fit by default, which
                        squeezed the zoomed plan back to the screen width — on a
                        phone the zoom did nothing at all. The width at 100% is
                        560px, or the whole viewport when that is narrower, and
                        every zoom step multiplies that width. */}
                    <div
                      className="m-auto shrink-0 transition-[width] duration-200 ease-out"
                      style={{
                        width: `calc(${PLAN_FIT_WIDTH} * ${zoomLevel})`,
                      }}
                    >
                      <svg
                        data-testid="cut-plan-svg"
                        viewBox={`0 0 ${activeSheet.width} ${activeSheet.height}`}
                        className="block w-full"
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
                          stroke={isDark ? '#4A5568' : '#94A3B8'} strokeWidth={isDark ? 1 : 1.5} />

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
                          const measures = sideMeasures(off, {
                            width: shortMeasure(formatDisplayValue(off.width, displayUnit)),
                            height: shortMeasure(formatDisplayValue(off.height, displayUnit)),
                          }, SCREEN_MEASURES);
                          return (
                            <g key={off.id} data-testid="offcut-svg-group" data-offcut-id={off.id}>
                              <rect data-testid="offcut-svg-rect" data-offcut-id={off.id} data-offcut-width={off.width} data-offcut-height={off.height} x={off.x} y={off.y} width={off.width} height={off.height}
                                fill={isDark ? 'url(#hatchD)' : 'url(#hatchL)'}
                                stroke={isDark ? '#2D3A5C' : '#94A3B8'} strokeWidth="0.4" strokeDasharray="2 2" opacity="0.8" />
                              {off.width>=14 && off.height>=10 && (
                                <PlanMeasures measures={measures} fill={isDark ? '#5B7DA6' : '#64748B'} />
                              )}
                            </g>
                          );
                        })}

                        {result.placedPieces.filter(p => p.sheetIndex === activeSheetIndex).map((p) => {
                          const col = p.color || PIECE_COLOR_PALETTE[(p.pieceNumber - 1) % PIECE_COLOR_PALETTE.length];
                          const gradId = `g_${p.sheetIndex}_${p.pieceNumber}`;
                          const minSide = Math.min(p.width, p.height);
                          const ink = isDark ? '#050A14' : '#1E293B';
                          // Each measure along its side, "#N" in the middle (src/lib/cutting/side-measures.ts).
                          const measures = sideMeasures(p, {
                            width: shortMeasure(formatDisplayValue(p.width, displayUnit)),
                            height: shortMeasure(formatDisplayValue(p.height, displayUnit)),
                          }, { ...SCREEN_MEASURES, number: { text: `#${p.pieceNumber}`, font: Math.min(5.5, Math.max(2.5, minSide / 12)) } });
                          const edgePath = (showEdges ? edgeLines(p) : []).map((l) => `M${l.x1} ${l.y1}L${l.x2} ${l.y2}`).join('');
                          return (
                            <g key={`${p.sheetIndex}_${p.pieceNumber}`}>
                              <defs>
                                <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor={col} stopOpacity="0.85"/><stop offset="100%" stopColor={col} stopOpacity="0.6"/>
                                </linearGradient>
                              </defs>
                              <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={`url(#${gradId})`}
                                stroke={isDark ? '#050A14' : '#334155'} strokeWidth={Math.max(0.4, (options.kerfWidth||3)/10)} />
                              {/* The chants: blue dashes along the sides to band (src/lib/cutting/edge-lines.ts). */}
                              {edgePath && (
                                <g data-testid="cut-plan-edges" pointerEvents="none" fill="none">
                                  <path d={edgePath} stroke={EDGE_HALO} strokeWidth={EDGE_HALO_CM} strokeOpacity="0.85" />
                                  <path d={edgePath} stroke={EDGE_COLOR} strokeWidth={EDGE_STROKE_CM} strokeDasharray={EDGE_DASH_CM.join(' ')} />
                                </g>
                              )}
                              {options.showLabels && (<>
                                <text x={measures.number.x} y={measures.number.y} textAnchor="middle" dominantBaseline="central"
                                  fill={ink} fontSize={measures.number.font}
                                  fontWeight="black" fontFamily="monospace">#{p.pieceNumber}</text>
                                <PlanMeasures measures={measures} fill={ink} />
                              </>)}
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                    </div>
                  </div>
                  {/* Any banded panel: the switch stays in reach from a panel without chants, and once off. */}
                  {hasEdgeLines(result.placedPieces) && (
                    <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-studio-border px-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <label className="flex min-h-11 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          data-testid="cut-plan-edge-toggle"
                          checked={showEdges}
                          onChange={(e) => { setShowEdges(e.target.checked); saveShowEdges(e.target.checked); }}
                          className="h-4 w-4 accent-brand-500"
                        />
                        {t('atelier.plan.edgeToggle')}
                      </label>
                      {showEdges && (
                        <p data-testid="cut-plan-edge-legend" className="flex items-center gap-2 py-2">
                          <svg aria-hidden="true" width="32" height="6" viewBox="0 0 32 6" fill="none"><path d="M0 3H32" stroke={EDGE_HALO} strokeWidth="5" /><path d="M0 3H32" stroke={EDGE_COLOR} strokeWidth="3" strokeDasharray="7 5" /></svg>
                          {t('atelier.plan.edgeLegend')}
                        </p>
                      )}
                    </div>
                  )}
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
                      onClick={async () => {
                        // The free preview is not quoted: sign-up or the paid run first.
                        if (await previewBlocksExport()) return;
                        setIsQuotationDialogOpen(true);
                      }}
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
                        <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: n(result.costBreakdown?.materialCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.edges')}</span>
                        <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: n(result.costBreakdown?.edgeCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.labor')}</span>
                        <span className="font-mono font-black text-slate-900 dark:text-white" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: n(result.costBreakdown?.laborCost ?? 0) })}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-studio-field text-center">
                        <span className="text-[9px] text-slate-500 block uppercase">{t('atelier.cost.total')}</span>
                        <span className="font-mono font-black text-brand-400" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: n(result.costBreakdown?.subtotal ?? 0) })}</span>
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
                                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr" translate="no">
                                  {panel.pricing.mode === 'per_sheet'
                                    ? t('atelier.cost.detail.perPanel', { count: panel.count, price: detailMoney(panel.pricing.value) })
                                    : t('atelier.cost.detail.perM2', { count: panel.count, area: detailNumber(panel.areaM2, 4), price: detailNumber(panel.pricing.value, 2) })}
                                </span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: detailMoney(panel.total) })}</span>
                              </span>
                            </li>
                          ))}
                          {costDetail.edges.map((edge, i) => (
                            <li key={`edge-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                              <span className="text-slate-700 dark:text-slate-200">
                                {edge.edgeId && edge.edgeId !== 'none' ? `${t('atelier.cost.detail.edge')} · ${t(edgeBandingLabelKey(edge.edgeId))}` : t('atelier.cost.detail.edge')}
                              </span>
                              <span className="ms-auto flex items-baseline gap-3">
                                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr" translate="no">
                                  {t('atelier.cost.detail.perMeter', { length: detailNumber(edge.lengthM, 2), price: detailNumber(edge.pricePerMeter, 2) })}
                                </span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: detailMoney(edge.total) })}</span>
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
                                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" dir="ltr" translate="no">
                                    {t('atelier.cost.detail.perMeter', { length: detailNumber(costDetail.labor.cutLengthM ?? 0, 2), price: detailNumber(costDetail.labor.pricing.value, 2) })}
                                  </span>
                                )}
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums" dir="ltr" translate="no">{t('atelier.cost.amount',{ value: detailMoney(costDetail.labor.total) })}</span>
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
        {/* The end of the page stays reachable above the bar. */}
        {shortcut.bar && <div aria-hidden="true" className="h-28 lg:hidden" />}
      </main>

      {shortcut.bar && <PlanBar onRun={runFromShortcut} busy={isOptimizing} hasPlan={!!result} stale={planIsStale} />}

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
            if (photoPreviewRef.current) {
              setIsQuotationDialogOpen(false);
              askSignInKeepingWork('optimize');
              return;
            }
            setPendingAuthAction('quotation');
            setIsAuthModalOpen(true);
          }}
          costingInput={result.costingInput}
          panels={quotationPanels}
          pieces={quotationPieces}
          itemLimitError={quotationItemLimitError}
          uncountedEdgeMetres={uncountedEdges}
          projectId={lastSavedProjectId}
        />
      )}

      {scanViewer.view && <ScanViewer {...scanViewer.view} onClose={scanViewer.close} />}
    </div>
  );
}
