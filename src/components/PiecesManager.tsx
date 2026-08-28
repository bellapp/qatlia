'use client';

import React, { useState } from 'react';
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

export const PiecesManager: React.FC<PiecesManagerProps> = ({
  pieces,
  onUpdatePieces,
  defaultMaterial,
  disabled = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Formulaire d'ajout rapide épuré
  const [newHeight, setNewHeight] = useState<string>('');
  const [newWidth, setNewWidth] = useState<string>('');
  const [newQty, setNewQty] = useState<string>('1');
  const [newReference, setNewReference] = useState<string>('');
  const [newEdges, setNewEdges] = useState<EdgeBandingConfig>({ left: false, right: false, top: false, bottom: false });
  const [showEdgeOptions, setShowEdgeOptions] = useState(false);

  const filteredPieces = pieces.filter((p) => {
    return (
      searchQuery === '' ||
      (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      `${p.height}x${p.width}`.includes(searchQuery) ||
      `${p.width}x${p.height}`.includes(searchQuery)
    );
  });

  const handleAddPieceQuick = (e: React.FormEvent) => {
    e.preventDefault();
    let h = parseFloat(newHeight);
    let w = parseFloat(newWidth);
    const q = parseInt(newQty, 10) || 1;

    if (!h || !w || h <= 0 || w <= 0) return;

    if (h > 500 || w > 500) {
      h = h / 10;
      w = w / 10;
    }

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
    setShowEdgeOptions(false);
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
        return {
          ...p,
          edges: {
            ...currentEdges,
            [side]: !currentEdges[side],
          },
        };
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
    if (selectedIds.size === filteredPieces.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPieces.map((p) => p.id || '')));
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
    <div className="space-y-4">
      {/* Saisie Rapide (Design Carte Minimaliste) */}
      <form onSubmit={handleAddPieceQuick} className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/90 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-amber-400" /> Ajouter une pièce (cm)
          </span>
          <button
            type="button"
            onClick={() => setShowEdgeOptions(!showEdgeOptions)}
            className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${showEdgeOptions ? 'bg-amber-400/10 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {showEdgeOptions ? 'Masquer chants' : '+ Options chants'}
          </button>
        </div>

        <div className="grid grid-cols-12 gap-2">
          {/* Hauteur */}
          <div className="col-span-4 sm:col-span-3">
            <input
              type="number"
              step="0.1"
              required
              placeholder="H (cm)"
              value={newHeight}
              onChange={(e) => setNewHeight(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-xs font-semibold focus:border-amber-500/50 outline-none text-right placeholder-slate-600"
            />
          </div>

          {/* Largeur */}
          <div className="col-span-4 sm:col-span-3">
            <input
              type="number"
              step="0.1"
              required
              placeholder="L (cm)"
              value={newWidth}
              onChange={(e) => setNewWidth(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-xs font-semibold focus:border-amber-500/50 outline-none text-right placeholder-slate-600"
            />
          </div>

          {/* Quantité */}
          <div className="col-span-4 sm:col-span-2">
            <input
              type="number"
              min="1"
              placeholder="Qté"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="w-full px-2 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-xs font-bold text-center focus:border-amber-500/50 outline-none placeholder-slate-600"
            />
          </div>

          {/* Nom & Submit */}
          <div className="col-span-12 sm:col-span-4 flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Nom (ex: Côté G)"
              value={newReference}
              onChange={(e) => setNewReference(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs font-medium focus:border-amber-500/50 outline-none placeholder-slate-600"
            />
            <button
              type="submit"
              disabled={disabled}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition-transform active:scale-95 shadow-sm cursor-pointer"
            >
              Ajouter
            </button>
          </div>
        </div>

        {/* Chants optionnels */}
        {showEdgeOptions && (
          <div className="flex items-center gap-3 pt-2 border-t border-slate-800/60 text-[10px] text-slate-300 animate-in fade-in duration-150">
            <span className="font-semibold text-slate-400">Bandes de chants :</span>
            {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
              const label = side === 'left' ? 'G' : side === 'right' ? 'D' : side === 'top' ? 'H' : 'B';
              return (
                <label key={side} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEdges[side]}
                    onChange={(e) => setNewEdges({ ...newEdges, [side]: e.target.checked })}
                    className="rounded text-amber-500 bg-slate-950 border-slate-700"
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        )}
      </form>

      {/* Barre d'outils de liste */}
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Filtrer les pièces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-200 placeholder-slate-500 text-xs outline-none focus:border-amber-500/50"
          />
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold border border-rose-500/30 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Suppr. ({selectedIds.size})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSelectAll}
            className="px-2 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition-colors"
            title="Tout sélectionner / désélectionner"
          >
            {selectedIds.size === filteredPieces.length && filteredPieces.length > 0 ? 'Désél.' : 'Sélect.'}
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={pieces.length === 0}
            className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition-colors disabled:opacity-30"
            title="Exporter CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Liste des Pièces (Cards Responsives & Fluides) */}
      <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
        {filteredPieces.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs rounded-2xl bg-slate-900/30 border border-dashed border-slate-800">
            Aucune pièce trouvée.
          </div>
        ) : (
          filteredPieces.map((p, idx) => {
            const isSelected = selectedIds.has(p.id || '');
            const ed = p.edges || {};

            return (
              <div
                key={p.id || idx}
                className={`p-2.5 rounded-xl border transition-all flex flex-wrap items-center gap-2 ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500/30 shadow-sm'
                    : 'bg-slate-900/40 hover:bg-slate-900/80 border-slate-800/70 hover:border-slate-700/80'
                }`}
              >
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleSelect(p.id || '')}
                    className="text-slate-600 hover:text-amber-400 transition-colors cursor-pointer"
                    aria-label="Sélectionner"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                  <span className="font-mono text-slate-400 font-bold text-xs w-6">#{idx + 1}</span>
                </div>

                <div className="flex-1 min-w-[100px]">
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => handleUpdate(p.id || '', 'name', e.target.value)}
                    className="w-full bg-transparent text-slate-200 font-medium text-xs outline-none focus:text-white truncate"
                    placeholder="Nom"
                  />
                </div>

                <div className="flex items-center gap-1 font-mono text-xs shrink-0">
                  <input
                    type="number"
                    step="0.1"
                    value={Number(p.height.toFixed(1))}
                    onChange={(e) => handleUpdate(p.id || '', 'height', parseFloat(e.target.value) || 0)}
                    className="w-16 px-1.5 py-1 rounded-lg bg-slate-950 border border-slate-800 focus:border-amber-500/50 text-slate-100 font-bold text-right outline-none"
                    aria-label="Hauteur cm"
                  />
                  <span className="text-slate-600">×</span>
                  <input
                    type="number"
                    step="0.1"
                    value={Number(p.width.toFixed(1))}
                    onChange={(e) => handleUpdate(p.id || '', 'width', parseFloat(e.target.value) || 0)}
                    className="w-16 px-1.5 py-1 rounded-lg bg-slate-950 border border-slate-800 focus:border-amber-500/50 text-slate-100 font-bold text-right outline-none"
                    aria-label="Largeur cm"
                  />
                  <span className="text-slate-500 text-[10px] pl-0.5">cm</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Qté</span>
                  <input
                    type="number"
                    min="1"
                    value={p.quantity || 1}
                    onChange={(e) => handleUpdate(p.id || '', 'quantity', parseInt(e.target.value, 10) || 1)}
                    className="w-14 px-1.5 py-1 rounded-lg bg-slate-950 border border-amber-500/40 focus:border-amber-400 text-amber-400 font-mono font-black text-center text-sm outline-none"
                    aria-label="Quantité"
                  />
                </div>

                <div className="flex items-center gap-0.5 font-mono text-[9px] shrink-0">
                  {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
                    const label = side === 'left' ? 'G' : side === 'right' ? 'D' : side === 'top' ? 'H' : 'B';
                    return (
                      <button
                        key={side}
                        type="button"
                        onClick={() => handleToggleEdge(p.id || '', side)}
                        className={`w-5 h-5 rounded font-bold transition-colors ${
                          ed[side] ? 'bg-amber-400 text-slate-950' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(p.id || '')}
                  className="p-1 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0 ml-auto"
                  aria-label="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
