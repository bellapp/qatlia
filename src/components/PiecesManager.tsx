'use client';

import React, { useState, useRef } from 'react';
import {
  Search,
  Plus,
  Trash2,
  FileSpreadsheet,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Piece, MaterialType, EdgeBandingConfig } from '@/lib/cutting/binpacking';

interface PiecesManagerProps {
  pieces: Piece[];
  onUpdatePieces: (pieces: Piece[]) => void;
  defaultMaterial: MaterialType;
  showMaterialCol?: boolean;
  disabled?: boolean;
}

const MATERIAL_COLORS: Record<string, string> = {
  mdf: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  aluminium: 'bg-slate-400/10 text-slate-700 dark:text-slate-300 border-slate-500/20',
  verre: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  contreplaques: 'bg-brand-600/10 text-brand-400 border-brand-500/20',
};

export const PiecesManager: React.FC<PiecesManagerProps> = ({
  pieces,
  onUpdatePieces,
  defaultMaterial,
  disabled = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [newHeight, setNewHeight] = useState<string>('');
  const [newWidth, setNewWidth] = useState<string>('');
  const [newQty, setNewQty] = useState<string>('1');
  const [newReference, setNewReference] = useState<string>('');
  const [newEdges, setNewEdges] = useState<EdgeBandingConfig>({ left: false, right: false, top: false, bottom: false });

  const { totalQty, filteredList } = React.useMemo(() => {
    const list = pieces.filter((p) =>
      searchQuery === '' ||
      (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      `${p.height}x${p.width}`.includes(searchQuery) ||
      `${p.width}x${p.height}`.includes(searchQuery)
    );
    return { totalQty: list.reduce((s, p) => s + (p.quantity || 1), 0), filteredList: list };
  }, [pieces, searchQuery]);

  const handleAddPieceQuick = (e: React.FormEvent) => {
    e.preventDefault();
    let h = parseFloat(newHeight);
    let w = parseFloat(newWidth);
    const q = parseInt(newQty, 10) || 1;

    if (!h || !w || h <= 0 || w <= 0) return;

    if (h > 500 || w > 500) { h = h / 10; w = w / 10; }

    const newId = `p_${Date.now()}`;
    const newPiece: Piece = {
      id: newId,
      name: newReference.trim() || `Pièce ${pieces.length + 1}`,
      height: Math.round(h * 10) / 10,
      width: Math.round(w * 10) / 10,
      quantity: q,
      material: defaultMaterial,
      edges: { ...newEdges },
      rotatable: true,
    };

    onUpdatePieces([...pieces, newPiece]);
    setNewHeight('');
    setNewWidth('');
    setNewReference('');
    setNewQty('1');
    setNewEdges({ left: false, right: false, top: false, bottom: false });
    setShowQuickAdd(false);
  };

  const handleUpdate = (id: string, field: keyof Piece, val: string | number | boolean | EdgeBandingConfig | null) => {
    const updated = pieces.map((p) => {
      if (p.id === id) {
        let finalVal = val;
        if ((field === 'height' || field === 'width') && typeof val === 'number' && val > 500) {
          finalVal = val / 10;
        }
        return { ...p, [field]: finalVal };
      }
      return p;
    });
    onUpdatePieces(updated);
  };

  const handleToggleEdge = (id: string, side: 'left' | 'right' | 'top' | 'bottom') => {
    const updated = pieces.map((p) => {
      if (p.id === id) {
        const currentEdges = p.edges || {};
        return { ...p, edges: { ...currentEdges, [side]: !currentEdges[side] } };
      }
      return p;
    });
    onUpdatePieces(updated);
  };

  const handleRemove = (id: string) => {
    onUpdatePieces(pieces.filter((p) => p.id !== id));
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
      setSelectedIds(new Set(filteredList.map((p) => p.id || '')));
    }
  };

  const handleDeleteSelected = () => {
    onUpdatePieces(pieces.filter((p) => !selectedIds.has(p.id || '')));
    setSelectedIds(new Set());
  };

  const handleExportCsv = () => {
    let csv = 'Numéro,Hauteur (cm),Largeur (cm),Quantité,Référence\n';
    pieces.forEach((p, idx) => {
      csv += `${idx + 1},${p.height},${p.width},${p.quantity || 1},"${p.name || ''}"\n`;
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
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 py-2 gap-2">
        <div className="flex items-center gap-2">
          <div className="relative max-w-[170px] sm:max-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Filtrer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-800 dark:text-slate-200 placeholder-slate-500 text-xs outline-none focus:border-brand-500/50 transition-colors"
            />
          </div>
          <span className="hidden sm:inline text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {totalQty} pcs · {filteredList.length} lignes
          </span>
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

      {/* Table Header */}
      <div className="grid grid-cols-12 gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-y border-studio-border/50">
        <div className="col-span-1 pl-1">#</div>
        <div className="col-span-3 sm:col-span-3">Pièce</div>
        <div className="col-span-3 sm:col-span-3 text-right">H × L (cm)</div>
        <div className="col-span-1 sm:col-span-1 text-center">Qté</div>
        <div className="hidden sm:flex col-span-2 gap-0.5 justify-center">Chants</div>
        <div className="col-span-1 sm:col-span-2 text-right pr-1"></div>
      </div>

      {/* Pieces List */}
      <div ref={listRef} className="max-h-[340px] overflow-y-auto overscroll-contain scroll-smooth">
        {filteredList.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {searchQuery ? 'Aucun résultat pour ce filtre.' : 'Aucune pièce. Ajoutez la première ci-dessous.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-studio-border/40">
            {filteredList.map((p, idx) => {
              const isSelected = selectedIds.has(p.id || '');
              const isFocused = focusedRow === p.id;
              const ed = p.edges || {};
              const matClass = MATERIAL_COLORS[(p.material as string) || 'mdf'] || MATERIAL_COLORS.mdf;

              return (
                <div
                  key={p.id || idx}
                  onMouseEnter={() => setFocusedRow(p.id || null)}
                  onMouseLeave={() => setFocusedRow(null)}
                  className={`grid grid-cols-12 gap-1.5 items-center px-3 py-2 transition-all group ${
                    isSelected
                      ? 'bg-brand-500/10'
                      : idx % 2 === 0
                        ? 'bg-studio-canvas/40 hover:bg-studio-panel/60'
                        : 'bg-studio-panel/20 hover:bg-studio-panel/60'
                  }`}
                >
                  {/* # */}
                  <div className="col-span-1 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(p.id || '')}
                      className="text-slate-600 hover:text-brand-400 transition-colors cursor-pointer"
                      aria-label="Sélectionner"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-brand-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                    {isSelected && (
                      <span className="font-mono text-brand-400 font-black text-[10px]">{idx + 1}</span>
                    )}
                  </div>

                  {/* Name */}
                  <div className="col-span-3 sm:col-span-3 flex items-center gap-1 min-w-0">
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => handleUpdate(p.id || '', 'name', e.target.value)}
                      className="w-full bg-transparent text-slate-800 dark:text-slate-200 font-medium text-[11px] outline-none focus:text-slate-900 dark:text-white truncate placeholder-slate-600"
                      placeholder="Nom"
                    />
                    {!isFocused && (
                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${matClass.split(' ')[1]}`} title={p.material ?? undefined} />
                    )}
                  </div>

                  {/* Dimensions */}
                  <div className="col-span-3 sm:col-span-3 flex items-center justify-end gap-0.5 font-mono text-[11px] tabular-nums">
                    <input
                      type="number"
                      step="0.1"
                      value={Number(p.height.toFixed(1))}
                      onChange={(e) => handleUpdate(p.id || '', 'height', parseFloat(e.target.value) || 0)}
                      className="w-12 sm:w-14 text-right bg-transparent text-slate-900 dark:text-slate-100 font-bold outline-none focus:bg-studio-field/60 focus:rounded px-1 py-0.5 -mx-1 tabular-nums"
                      aria-label="Hauteur cm"
                    />
                    <span className="text-slate-600">×</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Number(p.width.toFixed(1))}
                      onChange={(e) => handleUpdate(p.id || '', 'width', parseFloat(e.target.value) || 0)}
                      className="w-12 sm:w-14 text-right bg-transparent text-slate-900 dark:text-slate-100 font-bold outline-none focus:bg-studio-field/60 focus:rounded px-1 py-0.5 -mx-1 tabular-nums"
                      aria-label="Largeur cm"
                    />
                  </div>

                  {/* Qty */}
                  <div className="col-span-1 sm:col-span-1 flex justify-center">
                    <input
                      type="number"
                      min="1"
                      value={p.quantity || 1}
                      onChange={(e) => handleUpdate(p.id || '', 'quantity', parseInt(e.target.value, 10) || 1)}
                      className="w-8 text-center bg-studio-field/80 border border-brand-500/30 rounded-md text-brand-400 font-mono font-black text-xs outline-none focus:border-brand-400 tabular-nums"
                      aria-label="Quantité"
                    />
                  </div>

                  {/* Edges */}
                  <div className="hidden sm:flex col-span-2 items-center justify-center gap-0.5 font-mono text-[9px]">
                    {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
                      const label = side === 'left' ? 'G' : side === 'right' ? 'D' : side === 'top' ? 'H' : 'B';
                      const isEdgeActive = ed[side];
                      return (
                        <button
                          key={side}
                          type="button"
                          onClick={() => handleToggleEdge(p.id || '', side)}
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

                  {/* Actions */}
                  <div className="col-span-1 sm:col-span-2 flex items-center justify-end gap-1">
                    <div className="hidden sm:flex text-[9px] font-mono text-slate-500 dark:text-slate-400 mr-1 tabular-nums">
                      {(p.height * p.width * (p.quantity || 1) / 10000).toFixed(2)} m²
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(p.id || '')}
                      className="p-1 rounded-md text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all"
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

      {/* Sticky Quick-Add Bar */}
      <div className="sticky bottom-0 -mx-0 pt-2 bg-studio-canvas">
        {showQuickAdd ? (
          <form onSubmit={handleAddPieceQuick} className="p-3 rounded-xl bg-studio-panel/80 border border-brand-500/30 backdrop-blur-sm shadow-lg animate-in slide-in-from-bottom-2 duration-150">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <label className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">H (cm)</label>
                <input
                  type="number" step="0.1" required autoFocus
                  placeholder="230"
                  value={newHeight}
                  onChange={(e) => setNewHeight(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-900 dark:text-slate-100 font-mono text-xs font-bold text-right outline-none focus:border-brand-500/50 placeholder-slate-600 tabular-nums"
                />
              </div>
              <div className="col-span-3">
                <label className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">L (cm)</label>
                <input
                  type="number" step="0.1" required
                  placeholder="120"
                  value={newWidth}
                  onChange={(e) => setNewWidth(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-900 dark:text-slate-100 font-mono text-xs font-bold text-right outline-none focus:border-brand-500/50 placeholder-slate-600 tabular-nums"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">Qté</label>
                <input
                  type="number" min="1"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  className="w-full px-1 py-1.5 rounded-lg bg-studio-field border border-studio-border text-brand-400 font-mono font-bold text-center text-xs outline-none focus:border-brand-500/50 tabular-nums"
                />
              </div>
              <div className="col-span-3">
                <label className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-0.5">Nom</label>
                <input
                  type="text"
                  placeholder="ex: Côté G"
                  value={newReference}
                  onChange={(e) => setNewReference(e.target.value)}
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
            <div className="flex items-center gap-3 pt-2 mt-2 border-t border-studio-border/60 text-[10px]">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Chants :</span>
              {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
                const label = side === 'left' ? 'G' : side === 'right' ? 'D' : side === 'top' ? 'H' : 'B';
                return (
                  <label key={side} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEdges[side]}
                      onChange={(e) => setNewEdges({ ...newEdges, [side]: e.target.checked })}
                      className="rounded text-brand-500 bg-studio-field border-studio-border-hover w-3 h-3"
                    />
                    <span className="text-slate-600 dark:text-slate-400">{label}</span>
                  </label>
                );
              })}
              <button
                type="button"
                onClick={() => setShowQuickAdd(false)}
                className="ml-auto text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300 font-semibold"
              >
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowQuickAdd(true)}
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
}