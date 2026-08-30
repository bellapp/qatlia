'use client';

import React, { useRef, useState } from 'react';
import {
  Search,
  Plus,
  Trash2,
  FileSpreadsheet,
  CheckSquare,
  Square,
  Library,
} from 'lucide-react';
import { Piece, MaterialType, EdgeBandingConfig, MATERIAL_LIBRARY, EDGEBANDING_PRESETS } from '@/lib/cutting/binpacking';
import { parsePiecesImport } from '@/lib/pieces/import-parser';
import { createFurnitureTemplatePieces, FURNITURE_TEMPLATES, type TemplateName } from '@/lib/pieces/templates';
import { ensureUniquePieceId, getResolvedPieceColor } from '@/lib/pieces/catalog';

interface PiecesManagerProps {
  pieces: Piece[];
  onUpdatePieces: (pieces: Piece[]) => void;
  defaultMaterial: MaterialType;
  showMaterialCol?: boolean;
  disabled?: boolean;
}

type ActivePanel = 'quick-add' | 'import' | 'template' | null;
type FeedbackTone = 'success' | 'warning';

interface PieceDraft {
  id?: string;
  name?: string;
  height: number;
  width: number;
  quantity?: number;
  material?: MaterialType | null;
  edges?: EdgeBandingConfig;
  rotatable?: boolean;
  color?: string;
}

const MATERIAL_COLORS: Record<string, string> = {};
for (const material of MATERIAL_LIBRARY) {
  MATERIAL_COLORS[material.type] = `${material.bgClass} ${material.color} ${material.borderClass}`;
}

function getFeedbackClasses(tone: FeedbackTone): string {
  return tone === 'success'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

function normalizeManualDimension(value: number): number {
  return value > 500 ? Math.round(value) / 10 : Math.round(value * 10) / 10;
}

export const PiecesManager: React.FC<PiecesManagerProps> = ({
  pieces,
  onUpdatePieces,
  defaultMaterial,
  disabled = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const [newEdgeColor, setNewEdgeColor] = useState('none');
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; text: string } | null>(null);
  const [importText, setImportText] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateName>('Meuble TV');
  const listRef = useRef<HTMLDivElement>(null);

  const [newHeight, setNewHeight] = useState<string>('');
  const [newWidth, setNewWidth] = useState<string>('');
  const [newQty, setNewQty] = useState<string>('1');
  const [newReference, setNewReference] = useState<string>('');
  const [newColor, setNewColor] = useState<string>(getResolvedPieceColor({ name: 'Nouvelle pièce', height: 1, width: 1, quantity: 1 }));
  const [newEdges, setNewEdges] = useState<EdgeBandingConfig>({ left: false, right: false, top: false, bottom: false });

  const { totalQty, filteredList } = React.useMemo(() => {
    const list = pieces.filter((piece) =>
      searchQuery === '' ||
      (piece.name && piece.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      `${piece.height}x${piece.width}`.includes(searchQuery) ||
      `${piece.width}x${piece.height}`.includes(searchQuery)
    );
    return { totalQty: list.reduce((sum, piece) => sum + (piece.quantity || 1), 0), filteredList: list };
  }, [pieces, searchQuery]);

  const appendPieces = (drafts: PieceDraft[], successText: string, warningText?: string) => {
    if (drafts.length === 0) {
      setFeedback({ tone: 'warning', text: warningText || 'Aucune pièce valide à ajouter.' });
      return;
    }

    const existingIds = new Set(pieces.map((piece) => piece.id).filter((id): id is string => Boolean(id)));
    const nextPieces = drafts.map((draft, index) => {
      const baseId = draft.id || `piece_${pieces.length + index + 1}`;
      const id = ensureUniquePieceId(existingIds, baseId);
      existingIds.add(id);
      return {
        id,
        name: draft.name?.trim() || `Pièce ${pieces.length + index + 1}`,
        height: Math.round(draft.height * 10) / 10,
        width: Math.round(draft.width * 10) / 10,
        quantity: Math.max(1, Math.round(draft.quantity || 1)),
        material: (draft.material || defaultMaterial) as MaterialType,
        edges: { left: false, right: false, top: false, bottom: false, ...draft.edges },
        rotatable: draft.rotatable !== false,
        color: getResolvedPieceColor({
          color: draft.color,
          id,
          name: draft.name,
          height: draft.height,
          width: draft.width,
          quantity: draft.quantity,
          index: pieces.length + index,
        }),
      } satisfies Piece;
    });

    onUpdatePieces([...pieces, ...nextPieces]);
    setFeedback({ tone: 'success', text: successText });
  };

  const resetQuickAdd = () => {
    setNewHeight('');
    setNewWidth('');
    setNewReference('');
    setNewQty('1');
    setNewEdgeColor('none');
    setNewEdges({ left: false, right: false, top: false, bottom: false });
    setNewColor(getResolvedPieceColor({ name: 'Nouvelle pièce', height: 1, width: 1, quantity: 1, index: pieces.length + 1 }));
  };

  const handleAddPieceQuick = (event: React.FormEvent) => {
    event.preventDefault();
    const height = parseFloat(newHeight);
    const width = parseFloat(newWidth);
    const quantity = parseInt(newQty, 10) || 1;

    if (!height || !width || height <= 0 || width <= 0) {
      setFeedback({ tone: 'warning', text: 'Renseignez des dimensions valides en cm.' });
      return;
    }

    appendPieces([
      {
        name: newReference.trim() || `Pièce ${pieces.length + 1}`,
        height: normalizeManualDimension(height),
        width: normalizeManualDimension(width),
        quantity,
        material: defaultMaterial,
        edges: { ...newEdges, color: newEdgeColor },
        rotatable: true,
        color: newColor,
      },
    ], '1 pièce ajoutée.', 'Aucune pièce ajoutée.');
    resetQuickAdd();
    setActivePanel(null);
  };

  const handleImportSubmit = () => {
    const result = parsePiecesImport({ input: importText, defaultMaterial });
    appendPieces(result.importedPieces, result.summary, result.summary);
    if (result.importedPieces.length > 0) {
      setImportText('');
      setActivePanel(null);
    }
  };

  const handleTemplateAppend = () => {
    const templatePieces = createFurnitureTemplatePieces(selectedTemplate, defaultMaterial);
    appendPieces(
      templatePieces,
      `${templatePieces.length} pièces ajoutées depuis ${selectedTemplate}.`,
      'Le modèle sélectionné ne contient aucune pièce.'
    );
    if (templatePieces.length > 0) {
      setActivePanel(null);
    }
  };

  const handleUpdate = (
    id: string,
    field: keyof Piece,
    value: string | number | boolean | EdgeBandingConfig | null,
  ) => {
    const updated = pieces.map((piece, index) => {
      if (piece.id !== id) return piece;

      let finalValue = value;
      if ((field === 'height' || field === 'width') && typeof value === 'number' && value > 500) {
        finalValue = value / 10;
      }

      const nextPiece = { ...piece, [field]: finalValue } as Piece;
      if (field !== 'color') {
        nextPiece.color = getResolvedPieceColor({
          color: nextPiece.color,
          id: nextPiece.id,
          name: nextPiece.name,
          height: nextPiece.height,
          width: nextPiece.width,
          quantity: nextPiece.quantity,
          index,
        });
      }
      return nextPiece;
    });
    onUpdatePieces(updated);
  };

  const handleToggleEdge = (id: string, side: 'left' | 'right' | 'top' | 'bottom') => {
    const updated = pieces.map((piece) => {
      if (piece.id !== id) return piece;
      const currentEdges = piece.edges || {};
      return { ...piece, edges: { ...currentEdges, [side]: !currentEdges[side] } };
    });
    onUpdatePieces(updated);
  };

  const handleRemove = (id: string) => {
    onUpdatePieces(pieces.filter((piece) => piece.id !== id));
    selectedIds.delete(id);
    setSelectedIds(new Set(selectedIds));
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredList.map((piece) => piece.id || '')));
    }
  };

  const handleDeleteSelected = () => {
    onUpdatePieces(pieces.filter((piece) => !selectedIds.has(piece.id || '')));
    setSelectedIds(new Set());
  };

  const handleExportCsv = () => {
    let csv = 'Numéro,Hauteur (cm),Largeur (cm),Quantité,Référence,Couleur\n';
    pieces.forEach((piece, index) => {
      csv += `${index + 1},${piece.height},${piece.width},${piece.quantity || 1},"${piece.name || ''}",${piece.color || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `qatlia_debit_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between px-1 py-2 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative max-w-[170px] sm:max-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Filtrer..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-800 dark:text-slate-200 placeholder-slate-500 text-xs outline-none focus:border-brand-500/50 transition-colors"
            />
          </div>
          <span className="hidden sm:inline text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {totalQty} pcs · {filteredList.length} lignes
          </span>
          <button
            type="button"
            onClick={() => setActivePanel(activePanel === 'import' ? null : 'import')}
            disabled={disabled}
            className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-all ${
              activePanel === 'import'
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-500'
                : 'border-studio-border bg-studio-panel text-slate-600 dark:text-slate-400'
            }`}
          >
            Coller Excel
          </button>
          <button
            type="button"
            onClick={() => setActivePanel(activePanel === 'template' ? null : 'template')}
            disabled={disabled}
            className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-all flex items-center gap-1 ${
              activePanel === 'template'
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-500'
                : 'border-studio-border bg-studio-panel text-slate-600 dark:text-slate-400'
            }`}
          >
            <Library className="w-3 h-3" />
            Modèles
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[10px] font-bold border border-rose-500/20 flex items-center gap-1 transition-all"
            >
              <Trash2 className="w-3 h-3" />
              <span>{selectedIds.size}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSelectAll}
            className="px-2 py-1 rounded-lg bg-studio-panel hover:bg-studio-field text-slate-600 dark:text-slate-400 text-[10px] font-semibold border border-studio-border transition-all"
          >
            {selectedIds.size === filteredList.length && filteredList.length > 0 ? 'Désél.' : 'Tout'}
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={pieces.length === 0}
            className="px-2 py-1 rounded-lg bg-studio-panel hover:bg-studio-field text-slate-600 dark:text-slate-400 border border-studio-border transition-all disabled:opacity-30"
            title="CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {activePanel && (
        <div className="px-1 pb-2">
          <div className="rounded-xl border border-studio-border/80 bg-studio-panel/50 p-3 space-y-3">
            {activePanel === 'import' && (
              <>
                <div className="space-y-1">
                  <label htmlFor="pieces-import-textarea" className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    Coller une liste de pièces
                  </label>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Format accepté : <span className="font-mono">Nom;Hauteur;Largeur;Quantité</span> ou collage Excel avec tabulations.
                  </p>
                </div>
                <textarea
                  id="pieces-import-textarea"
                  rows={5}
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder={'Nom;Hauteur;Largeur;Quantité\nJoue TV;230;45,5;2'}
                  className="w-full rounded-xl border border-studio-border bg-studio-field/70 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-brand-500/40 resize-y"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleImportSubmit}
                    disabled={disabled}
                    className="px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-30"
                  >
                    Importer
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="px-3 py-2 rounded-lg border border-studio-border text-xs font-semibold text-slate-600 dark:text-slate-400"
                  >
                    Annuler
                  </button>
                </div>
              </>
            )}

            {activePanel === 'template' && (
              <>
                <div className="space-y-1">
                  <label htmlFor="pieces-template-select" className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    Ajouter un modèle de meuble
                  </label>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Chaque choix ajoute des pièces prêtes à optimiser, sans remplacer la liste existante.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    id="pieces-template-select"
                    value={selectedTemplate}
                    onChange={(event) => setSelectedTemplate(event.target.value as TemplateName)}
                    className="flex-1 rounded-lg border border-studio-border bg-studio-field/70 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-brand-500/40"
                  >
                    {FURNITURE_TEMPLATES.map((template) => (
                      <option key={template.name} value={template.name}>
                        {template.name} · {template.pieceCount} pièces
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleTemplateAppend}
                    disabled={disabled}
                    className="px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-30"
                  >
                    Ajouter
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="px-3 py-2 rounded-lg border border-studio-border text-xs font-semibold text-slate-600 dark:text-slate-400"
                  >
                    Annuler
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {feedback && (
        <div className="px-1 pb-2">
          <p aria-live="polite" className={`rounded-lg border px-3 py-2 text-[11px] font-medium ${getFeedbackClasses(feedback.tone)}`}>
            {feedback.text}
          </p>
        </div>
      )}

      <div className="grid grid-cols-12 gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-y border-studio-border/50">
        <div className="col-span-1 pl-1">#</div>
        <div className="col-span-4 sm:col-span-4">Pièce</div>
        <div className="col-span-3 sm:col-span-3 text-right">H × L (cm)</div>
        <div className="col-span-1 text-center">Qté</div>
        <div className="hidden sm:flex col-span-2 gap-0.5 justify-center">Chants</div>
        <div className="col-span-3 sm:col-span-1 text-right pr-1">Coul.</div>
      </div>

      <div ref={listRef} data-testid="pieces-list" className="max-h-[340px] overflow-y-auto overscroll-contain scroll-smooth">
        {filteredList.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {searchQuery ? 'Aucun résultat pour ce filtre.' : 'Aucune pièce. Ajoutez la première ci-dessous.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-studio-border/40">
            {filteredList.map((piece, index) => {
              const isSelected = selectedIds.has(piece.id || '');
              const isFocused = focusedRow === piece.id;
              const edges = piece.edges || {};
              const matClass = MATERIAL_COLORS[(piece.material as string) || 'mdf'] || MATERIAL_COLORS.mdf;
              const rowColor = getResolvedPieceColor({
                color: piece.color,
                id: piece.id,
                name: piece.name,
                height: piece.height,
                width: piece.width,
                quantity: piece.quantity,
                index,
              });

              return (
                <div
                  key={piece.id || index}
                  onMouseEnter={() => setFocusedRow(piece.id || null)}
                  onMouseLeave={() => setFocusedRow(null)}
                  className={`grid grid-cols-12 gap-1.5 items-center px-3 py-2 transition-all group ${
                    isSelected
                      ? 'bg-brand-500/10'
                      : index % 2 === 0
                        ? 'bg-studio-canvas/40 hover:bg-studio-panel/60'
                        : 'bg-studio-panel/20 hover:bg-studio-panel/60'
                  }`}
                >
                  <div className="col-span-1 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(piece.id || '')}
                      className="text-slate-600 hover:text-brand-400 transition-colors cursor-pointer"
                      aria-label="Sélectionner"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-brand-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                    <span className={`font-mono ${isSelected ? 'text-brand-400 font-black' : 'text-slate-500'} text-[10px]`}>
                      {index + 1}
                    </span>
                  </div>

                  <div className="col-span-4 sm:col-span-4 flex items-center gap-2 min-w-0">
                    <input
                      type="text"
                      value={piece.name}
                      onChange={(event) => handleUpdate(piece.id || '', 'name', event.target.value)}
                      className="w-full bg-transparent text-slate-800 dark:text-slate-200 font-medium text-[11px] outline-none focus:text-slate-900 dark:focus:text-white truncate placeholder-slate-600"
                      placeholder="Nom"
                    />
                    {!isFocused && (
                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${matClass.split(' ')[1]}`} title={piece.material ?? undefined} />
                    )}
                  </div>

                  <div className="col-span-3 sm:col-span-3 flex items-center justify-end gap-0.5 font-mono text-[11px] tabular-nums">
                    <input
                      type="number"
                      step="0.1"
                      value={Number(piece.height.toFixed(1))}
                      onChange={(event) => handleUpdate(piece.id || '', 'height', parseFloat(event.target.value) || 0)}
                      className="w-12 sm:w-14 text-right bg-transparent text-slate-900 dark:text-slate-100 font-bold outline-none border-b border-dashed border-slate-300 dark:border-slate-600 hover:border-brand-400 focus:border-brand-400 focus:bg-studio-field/60 focus:rounded px-1 py-0.5 -mx-1 tabular-nums cursor-text transition-colors"
                      aria-label="Hauteur cm"
                    />
                    <span className="text-slate-600">×</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Number(piece.width.toFixed(1))}
                      onChange={(event) => handleUpdate(piece.id || '', 'width', parseFloat(event.target.value) || 0)}
                      className="w-12 sm:w-14 text-right bg-transparent text-slate-900 dark:text-slate-100 font-bold outline-none border-b border-dashed border-slate-300 dark:border-slate-600 hover:border-brand-400 focus:border-brand-400 focus:bg-studio-field/60 focus:rounded px-1 py-0.5 -mx-1 tabular-nums cursor-text transition-colors"
                      aria-label="Largeur cm"
                    />
                  </div>

                  <div className="col-span-1 flex justify-center">
                    <input
                      type="number"
                      min="1"
                      value={piece.quantity || 1}
                      onChange={(event) => handleUpdate(piece.id || '', 'quantity', parseInt(event.target.value, 10) || 1)}
                      className="w-8 text-center bg-studio-field/80 border border-brand-500/30 rounded-md text-brand-400 font-mono font-black text-xs outline-none focus:border-brand-400 tabular-nums"
                      aria-label="Quantité"
                    />
                  </div>

                  <div className="hidden sm:flex col-span-2 items-center justify-center gap-0.5 font-mono text-[9px]">
                    {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
                      const label = side === 'left' ? 'G' : side === 'right' ? 'D' : side === 'top' ? 'H' : 'B';
                      const isEdgeActive = edges[side];
                      return (
                        <button
                          key={side}
                          type="button"
                          onClick={() => handleToggleEdge(piece.id || '', side)}
                          className={`w-5 h-5 rounded font-bold transition-all ${
                            isEdgeActive
                              ? 'bg-brand-400 text-slate-950 shadow-sm'
                              : 'bg-studio-field/60 text-slate-600 hover:text-slate-600 dark:text-slate-400 hover:bg-studio-border'
                          }`}
                          title={`Chant ${side}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="col-span-3 sm:col-span-1 flex items-center justify-end gap-1">
                    <label className="sr-only" htmlFor={`piece-color-${piece.id || index}`}>Couleur de la pièce</label>
                    <input
                      id={`piece-color-${piece.id || index}`}
                      type="color"
                      value={rowColor}
                      onChange={(event) => handleUpdate(piece.id || '', 'color', event.target.value)}
                      className="h-7 w-7 rounded-md border border-studio-border bg-transparent p-0.5 cursor-pointer"
                      aria-label={`Couleur ${piece.name || `pièce ${index + 1}`}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemove(piece.id || '')}
                      className="p-1 rounded-md text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all"
                      aria-label="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="pt-2 bg-studio-canvas">
        {activePanel === 'quick-add' ? (
          <form onSubmit={handleAddPieceQuick} className="p-3 rounded-xl bg-studio-panel/80 border border-brand-500/30 backdrop-blur-sm shadow-lg animate-in slide-in-from-bottom-2 duration-150">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <label htmlFor="quick-piece-height" className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">H (cm)</label>
                <input
                  id="quick-piece-height"
                  type="number"
                  step="0.1"
                  required
                  autoFocus
                  placeholder="230"
                  value={newHeight}
                  onChange={(event) => setNewHeight(event.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-900 dark:text-slate-100 font-mono text-xs font-bold text-right outline-none focus:border-brand-500/50 placeholder-slate-600 tabular-nums"
                />
              </div>
              <div className="col-span-3">
                <label htmlFor="quick-piece-width" className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">L (cm)</label>
                <input
                  id="quick-piece-width"
                  type="number"
                  step="0.1"
                  required
                  placeholder="120"
                  value={newWidth}
                  onChange={(event) => setNewWidth(event.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-900 dark:text-slate-100 font-mono text-xs font-bold text-right outline-none focus:border-brand-500/50 placeholder-slate-600 tabular-nums"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="quick-piece-qty" className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">Qté</label>
                <input
                  id="quick-piece-qty"
                  type="number"
                  min="1"
                  value={newQty}
                  onChange={(event) => setNewQty(event.target.value)}
                  className="w-full px-1 py-1.5 rounded-lg bg-studio-field border border-studio-border text-brand-400 font-mono font-bold text-center text-xs outline-none focus:border-brand-500/50 tabular-nums"
                />
              </div>
              <div className="col-span-3">
                <label htmlFor="quick-piece-name" className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">Nom</label>
                <input
                  id="quick-piece-name"
                  type="text"
                  placeholder="ex: Côté G"
                  value={newReference}
                  onChange={(event) => setNewReference(event.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50 placeholder-slate-600"
                />
              </div>
              <div className="col-span-1 flex items-end gap-1">
                <button
                  type="submit"
                  disabled={disabled}
                  className="w-full py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs transition-all active:scale-95 cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2 mt-2 border-t border-studio-border/60 text-[10px] flex-wrap">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Chants :</span>
              {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
                const label = side === 'left' ? 'G' : side === 'right' ? 'D' : side === 'top' ? 'H' : 'B';
                return (
                  <label key={side} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEdges[side]}
                      onChange={(event) => setNewEdges({ ...newEdges, [side]: event.target.checked })}
                      className="rounded text-brand-500 bg-studio-field border-studio-border-hover w-3 h-3"
                    />
                    <span className="text-slate-600 dark:text-slate-400">{label}</span>
                  </label>
                );
              })}
              {(['left', 'right', 'top', 'bottom'] as const).some((side) => newEdges[side]) && (
                <select
                  value={newEdgeColor}
                  onChange={(event) => setNewEdgeColor(event.target.value)}
                  className="px-2 py-0.5 rounded-md bg-studio-field border border-studio-border text-[10px] text-slate-800 dark:text-slate-200 outline-none"
                >
                  {EDGEBANDING_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}{preset.pricePerM > 0 ? ` (${preset.pricePerM} MAD/m)` : ''}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                <label htmlFor="quick-piece-color" className="text-slate-500 dark:text-slate-400 font-semibold">Couleur</label>
                <input
                  id="quick-piece-color"
                  type="color"
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                  className="h-7 w-7 rounded-md border border-studio-border bg-transparent p-0.5 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => {
                    resetQuickAdd();
                    setActivePanel(null);
                  }}
                  className="text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 font-semibold"
                >
                  Annuler
                </button>
              </div>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setActivePanel('quick-add')}
            disabled={disabled}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-studio-border hover:border-brand-500/40 text-slate-500 dark:text-slate-400 hover:text-brand-400 text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-30 group cursor-pointer"
          >
            <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
            Ajouter une pièce
          </button>
        )}
      </div>
    </div>
  );
};
