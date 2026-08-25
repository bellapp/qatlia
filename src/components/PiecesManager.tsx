'use client';

import React, { useState } from 'react';
import {
  Search,
  Filter,
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
  const [filterMaterial, setFilterMaterial] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Formulaire d'ajout rapide (Unité officielle : cm)
  const [newHeight, setNewHeight] = useState<string>('');
  const [newWidth, setNewWidth] = useState<string>('');
  const [newQty, setNewQty] = useState<string>('1');
  const [newReference, setNewReference] = useState<string>('');
  const [newGrain, setNewGrain] = useState<boolean>(false);
  const [newEdges, setNewEdges] = useState<EdgeBandingConfig>({ left: false, right: false, top: false, bottom: false });

  // Moteur de recherche et filtrage
  const filteredPieces = pieces.filter((p) => {
    const matchesSearch =
      searchQuery === '' ||
      (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      `${p.height}x${p.width}`.includes(searchQuery) ||
      `${p.width}x${p.height}`.includes(searchQuery);

    const mat = p.material || defaultMaterial;
    const matchesMaterial = filterMaterial === 'all' || mat === filterMaterial;

    return matchesSearch && matchesMaterial;
  });

  const handleAddPieceQuick = (e: React.FormEvent) => {
    e.preventDefault();
    let h = parseFloat(newHeight);
    let w = parseFloat(newWidth);
    const q = parseInt(newQty, 10) || 1;

    if (!h || !w || h <= 0 || w <= 0) return;

    // Si saisi en mm (> 500), conversion automatique en cm
    if (h > 500 || w > 500) {
      h = h / 10;
      w = w / 10;
    }

    const newId = `p_${Date.now()}`;
    const newPiece: Piece = {
      id: newId,
      name: newReference.trim() || `Pièce ${pieces.length + 1}`,
      height: Math.round(h * 10) / 10, // Hauteur (Y) en cm
      width: Math.round(w * 10) / 10,  // Largeur (X) en cm
      quantity: q,
      material: defaultMaterial,
      grainDirection: newGrain,
      edges: { ...newEdges },
      rotatable: !newGrain,
    };

    onUpdatePieces([...pieces, newPiece]);
    setNewHeight('');
    setNewWidth('');
    setNewReference('');
    setNewQty('1');
    setNewEdges({ left: false, right: false, top: false, bottom: false });
  };

  const handleUpdate = (id: string, field: keyof Piece, val: string | number | boolean | EdgeBandingConfig | null) => {
    const updated = pieces.map((p) => {
      if (p.id === id) {
        let finalVal = val;
        // Si mise à jour dimension et valeur en mm (> 500), conversion en cm
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
    let csv = 'Numéro,Hauteur (Y cm),Largeur (X cm),Quantité,Matériau,Référence,Sens du fil,Chant Gauche,Chant Droit,Chant Haut,Chant Bas\n';
    pieces.forEach((p, idx) => {
      const ed = p.edges || {};
      csv += `${idx + 1},${p.height},${p.width},${p.quantity || 1},"${p.material || defaultMaterial}","${p.name || ''}",${p.grainDirection ? 'OUI' : 'NON'},${ed.left ? '1' : '0'},${ed.right ? '1' : '0'},${ed.top ? '1' : '0'},${ed.bottom ? '1' : '0'}\n`;
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
    <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg space-y-5">
      {/* Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#334155] pb-4">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            Nomenclature des Pièces ({pieces.reduce((s, p) => s + (p.quantity || 1), 0)} au total)
          </h2>
          <p className="text-[11px] text-[#94A3B8]">Unités : Hauteur (Y) × Largeur (X) en centimètres (cm)</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={pieces.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0F172A] hover:bg-[#283548] text-slate-300 text-xs font-semibold border border-[#334155] transition-all disabled:opacity-40"
            title="Exporter la liste de débit CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Formulaire de Saisie en Centimètres (cm) */}
      <form onSubmit={handleAddPieceQuick} className="p-4 rounded-xl bg-[#0F172A] border border-[#334155] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Saisie d&apos;une nouvelle pièce (en cm)
          </span>
          <span className="text-[10px] text-amber-300/90 font-mono font-bold">Unité : cm</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 text-xs">
          {/* Hauteur Y (cm) */}
          <div className="sm:col-span-3">
            <label className="block text-[10px] font-bold text-[#94A3B8] uppercase mb-1">
              Hauteur (Y en cm) *
            </label>
            <input
              type="number"
              step="0.1"
              required
              placeholder="ex: 230"
              value={newHeight}
              onChange={(e) => setNewHeight(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#1E293B] border border-[#475569] text-white font-mono font-bold outline-none focus:border-amber-400 text-right"
            />
          </div>

          {/* Largeur X (cm) */}
          <div className="sm:col-span-3">
            <label className="block text-[10px] font-bold text-[#94A3B8] uppercase mb-1">
              Largeur (X en cm) *
            </label>
            <input
              type="number"
              step="0.1"
              required
              placeholder="ex: 120"
              value={newWidth}
              onChange={(e) => setNewWidth(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#1E293B] border border-[#475569] text-white font-mono font-bold outline-none focus:border-amber-400 text-right"
            />
          </div>

          {/* Quantité */}
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold text-[#94A3B8] uppercase mb-1">
              Quantité
            </label>
            <input
              type="number"
              min="1"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#475569] text-white font-mono font-bold text-center outline-none focus:border-amber-400"
            />
          </div>

          {/* Référence / Nom */}
          <div className="sm:col-span-4">
            <label className="block text-[10px] font-bold text-[#94A3B8] uppercase mb-1">
              Référence / Nom
            </label>
            <input
              type="text"
              placeholder="ex: Côté G / Étagère"
              value={newReference}
              onChange={(e) => setNewReference(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#1E293B] border border-[#475569] text-white font-medium outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Options de chants & Matériau */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1E293B] text-[11px]">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[#94A3B8]">Chants :</span>
            <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newEdges.left}
                onChange={(e) => setNewEdges({ ...newEdges, left: e.target.checked })}
                className="rounded text-amber-500 bg-[#1E293B]"
              />
              <span>G</span>
            </label>
            <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newEdges.right}
                onChange={(e) => setNewEdges({ ...newEdges, right: e.target.checked })}
                className="rounded text-amber-500 bg-[#1E293B]"
              />
              <span>D</span>
            </label>
            <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newEdges.top}
                onChange={(e) => setNewEdges({ ...newEdges, top: e.target.checked })}
                className="rounded text-amber-500 bg-[#1E293B]"
              />
              <span>H</span>
            </label>
            <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newEdges.bottom}
                onChange={(e) => setNewEdges({ ...newEdges, bottom: e.target.checked })}
                className="rounded text-amber-500 bg-[#1E293B]"
              />
              <span>B</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newGrain}
                onChange={(e) => setNewGrain(e.target.checked)}
                className="rounded text-amber-500 bg-[#1E293B]"
              />
              <span>Sens du fil fixe</span>
            </label>

            <button
              type="submit"
              disabled={disabled}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition-all shadow cursor-pointer"
            >
              + Ajouter la pièce
            </button>
          </div>
        </div>
      </form>

      {/* Barre de recherche & Filtres */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-center">
        <div className="sm:col-span-7 relative">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Rechercher (ex: 230, Côté, 48)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-white placeholder-[#64748B] outline-none focus:border-amber-400"
          />
        </div>

        <div className="sm:col-span-3 flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
          <select
            value={filterMaterial}
            onChange={(e) => setFilterMaterial(e.target.value)}
            className="w-full px-2.5 py-2 rounded-xl bg-[#0F172A] border border-[#334155] text-slate-200 text-xs outline-none focus:border-amber-400"
          >
            <option value="all">Tous matériaux</option>
            <option value="mdf">MDF / Bois</option>
            <option value="aluminium">Aluminium</option>
            <option value="verre">Verre</option>
            <option value="contreplaques">Contreplaqué</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="w-full py-2 px-2 rounded-xl bg-[#0F172A] hover:bg-[#283548] text-slate-300 font-semibold border border-[#334155] text-[11px] text-center"
          >
            {selectedIds.size === filteredPieces.length && filteredPieces.length > 0 ? 'Tout désél.' : 'Tout sélect.'}
          </button>
        </div>
      </div>

      {/* Batch delete */}
      {selectedIds.size > 0 && (
        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs text-rose-300">
          <span>{selectedIds.size} pièce(s) sélectionnée(s)</span>
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="px-2.5 py-1 rounded-lg bg-rose-500 text-white font-bold text-xs hover:bg-rose-600 transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Supprimer la sélection</span>
          </button>
        </div>
      )}

      {/* Tableau Type OptiCoupe : N° | Hauteur (cm) | Largeur (cm) | Qté | Référence | Chants | Act. */}
      <div className="border border-[#334155] rounded-xl overflow-hidden bg-[#0F172A]">
        <div className="grid grid-cols-12 bg-[#1E293B] px-3 py-2.5 text-[11px] font-black text-slate-300 uppercase tracking-wider border-b border-[#334155]">
          <div className="col-span-1 text-center">N°</div>
          <div className="col-span-2 text-right pr-2">Hauteur (Y cm)</div>
          <div className="col-span-2 text-right pr-2">Largeur (X cm)</div>
          <div className="col-span-2 text-center">Quantité</div>
          <div className="col-span-2 pl-2">Référence</div>
          <div className="col-span-2 text-center">Chants (G D H B)</div>
          <div className="col-span-1 text-center">Act.</div>
        </div>

        <div className="divide-y divide-[#1E293B] max-h-[380px] overflow-y-auto">
          {filteredPieces.length === 0 ? (
            <div className="p-8 text-center text-[#64748B] text-xs">
              Aucune pièce dans la liste de débit.
            </div>
          ) : (
            filteredPieces.map((p, idx) => {
              const isSelected = selectedIds.has(p.id || '');
              const ed = p.edges || {};

              // Affichage en cm
              const displayH = p.height > 500 ? p.height / 10 : p.height;
              const displayW = p.width > 500 ? p.width / 10 : p.width;

              return (
                <div
                  key={p.id || idx}
                  className={`grid grid-cols-12 items-center px-3 py-2 text-xs transition-colors ${
                    isSelected ? 'bg-amber-500/10' : 'hover:bg-[#1E293B]/60'
                  }`}
                >
                  <div className="col-span-1 flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(p.id || '')}
                      className="text-[#64748B] hover:text-amber-400"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span className="font-mono text-[#94A3B8] font-bold text-[11px]">#{idx + 1}</span>
                  </div>

                  {/* Hauteur Y (en cm) */}
                  <div className="col-span-2 text-right pr-1">
                    <input
                      type="number"
                      step="0.1"
                      value={displayH}
                      onChange={(e) => handleUpdate(p.id || '', 'height', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-[#475569] focus:border-amber-400 text-white font-mono font-bold text-right text-xs outline-none"
                    />
                  </div>

                  {/* Largeur X (en cm) */}
                  <div className="col-span-2 text-right pr-1">
                    <input
                      type="number"
                      step="0.1"
                      value={displayW}
                      onChange={(e) => handleUpdate(p.id || '', 'width', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-[#475569] focus:border-amber-400 text-white font-mono font-bold text-right text-xs outline-none"
                    />
                  </div>

                  {/* Quantité */}
                  <div className="col-span-2 text-center px-2">
                    <input
                      type="number"
                      min="1"
                      value={p.quantity}
                      onChange={(e) => handleUpdate(p.id || '', 'quantity', parseInt(e.target.value, 10) || 1)}
                      className="w-full max-w-[65px] mx-auto px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-[#475569] focus:border-amber-400 text-white font-mono font-bold text-center text-xs outline-none"
                    />
                  </div>

                  {/* Référence / Nom */}
                  <div className="col-span-2 pl-2">
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => handleUpdate(p.id || '', 'name', e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] hover:border-[#475569] focus:border-amber-400 text-white font-medium text-xs outline-none"
                    />
                  </div>

                  {/* Chants G D H B */}
                  <div className="col-span-2 flex items-center justify-center gap-1 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => handleToggleEdge(p.id || '', 'left')}
                      className={`w-5 h-5 rounded font-bold flex items-center justify-center ${ed.left ? 'bg-amber-500 text-slate-950' : 'bg-[#1E293B] text-[#64748B] border border-[#334155]'}`}
                      title="Chant Gauche"
                    >
                      G
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleEdge(p.id || '', 'right')}
                      className={`w-5 h-5 rounded font-bold flex items-center justify-center ${ed.right ? 'bg-amber-500 text-slate-950' : 'bg-[#1E293B] text-[#64748B] border border-[#334155]'}`}
                      title="Chant Droit"
                    >
                      D
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleEdge(p.id || '', 'top')}
                      className={`w-5 h-5 rounded font-bold flex items-center justify-center ${ed.top ? 'bg-amber-500 text-slate-950' : 'bg-[#1E293B] text-[#64748B] border border-[#334155]'}`}
                      title="Chant Haut"
                    >
                      H
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleEdge(p.id || '', 'bottom')}
                      className={`w-5 h-5 rounded font-bold flex items-center justify-center ${ed.bottom ? 'bg-amber-500 text-slate-950' : 'bg-[#1E293B] text-[#64748B] border border-[#334155]'}`}
                      title="Chant Bas"
                    >
                      B
                    </button>
                  </div>

                  {/* Action */}
                  <div className="col-span-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemove(p.id || '')}
                      className="p-1.5 rounded hover:bg-rose-500/20 text-[#64748B] hover:text-rose-400 transition-colors cursor-pointer"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
