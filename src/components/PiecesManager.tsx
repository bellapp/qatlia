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
import { Piece, MaterialType } from '@/lib/cutting/binpacking';

interface PiecesManagerProps {
  pieces: Piece[];
  onUpdatePieces: (pieces: Piece[]) => void;
  defaultMaterial: MaterialType;
  showMaterialCol: boolean;
  disabled?: boolean;
}

export const PiecesManager: React.FC<PiecesManagerProps> = ({
  pieces,
  onUpdatePieces,
  defaultMaterial,
  showMaterialCol,
  disabled = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMaterial, setFilterMaterial] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // F3: Moteur de recherche + F2: Filtrage multi-critères
  const filteredPieces = pieces.filter((p) => {
    const matchesSearch =
      searchQuery === '' ||
      (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      `${p.width}x${p.height}`.includes(searchQuery);

    const mat = p.material || defaultMaterial;
    const matchesMaterial = filterMaterial === 'all' || mat === filterMaterial;

    return matchesSearch && matchesMaterial;
  });

  const handleAddPiece = () => {
    const newId = `p_${Date.now()}`;
    onUpdatePieces([
      ...pieces,
      {
        id: newId,
        name: `Pièce ${pieces.length + 1}`,
        width: 100,
        height: 50,
        quantity: 1,
        material: defaultMaterial,
        rotatable: true,
      },
    ]);
  };

  const handleUpdate = (id: string, field: keyof Piece, val: string | number | boolean | null) => {
    const updated = pieces.map((p) => {
      if (p.id === id) {
        return { ...p, [field]: val };
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

  // F5: Export CSV
  const handleExportCsv = () => {
    let csv = 'Nom,Longueur (cm),Largeur (cm),Quantite,Materiau,Rotatif\n';
    for (const p of pieces) {
      csv += `"${p.name || ''}",${p.width},${p.height},${p.quantity || 1},"${p.material || defaultMaterial}",${p.rotatable !== false ? 'OUI' : 'NON'}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `qatlia_pieces_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="rounded-2xl bg-[#1E293B] border border-[#334155] p-5 shadow-lg space-y-4">
      {/* Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            Nomenclature des Pièces ({pieces.reduce((s, p) => s + (p.quantity || 1), 0)} total)
          </h2>
          <p className="text-[11px] text-[#94A3B8]">Édition en ligne, recherche et export CSV</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={pieces.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0F172A] hover:bg-[#283548] text-slate-300 text-xs font-semibold border border-[#334155] transition-all disabled:opacity-40"
            title="Exporter la liste au format CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={handleAddPiece}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-[#F5A623] text-xs font-bold transition-all border border-amber-500/30 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Filter Controls & Select All */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-center">
        <div className="sm:col-span-7 relative">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Rechercher par nom ou dimension (ex: 200, Etagère)..."
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
            <option value="mdf">MDF</option>
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

      {/* Batch Actions */}
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

      {/* Table List */}
      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
        {filteredPieces.length === 0 ? (
          <div className="p-8 rounded-xl bg-[#0F172A] border border-[#334155] text-center text-[#64748B] text-xs">
            Aucune pièce ne correspond à votre recherche.
          </div>
        ) : (
          filteredPieces.map((p, idx) => {
            const isSelected = selectedIds.has(p.id || '');
            return (
              <div
                key={p.id || idx}
                className={`p-3 rounded-xl border transition-all flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs ${
                  isSelected ? 'bg-amber-500/5 border-amber-500/40' : 'bg-[#0F172A] border-[#334155]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggleSelect(p.id || '')}
                  className="text-[#64748B] hover:text-amber-400 shrink-0"
                >
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>

                <span className="font-mono text-[#64748B] w-5 text-center shrink-0">#{idx + 1}</span>

                <input
                  type="text"
                  placeholder="Nom de la pièce"
                  value={p.name}
                  onChange={(e) => handleUpdate(p.id || '', 'name', e.target.value)}
                  className="flex-1 min-w-[100px] px-2.5 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] text-white font-medium outline-none focus:border-amber-400"
                />

                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    placeholder="Long."
                    value={p.width}
                    onChange={(e) => handleUpdate(p.id || '', 'width', parseFloat(e.target.value) || 0)}
                    className="w-16 px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] text-white font-mono font-bold text-right outline-none focus:border-amber-400"
                  />
                  <span className="text-[#64748B]">×</span>
                  <input
                    type="number"
                    placeholder="Larg."
                    value={p.height}
                    onChange={(e) => handleUpdate(p.id || '', 'height', parseFloat(e.target.value) || 0)}
                    className="w-16 px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] text-white font-mono font-bold text-right outline-none focus:border-amber-400"
                  />
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[#64748B] text-[10px]">Qté:</span>
                  <input
                    type="number"
                    min="1"
                    value={p.quantity}
                    onChange={(e) => handleUpdate(p.id || '', 'quantity', parseInt(e.target.value, 10) || 1)}
                    className="w-12 px-1.5 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] text-white font-mono font-bold text-center outline-none focus:border-amber-400"
                  />
                </div>

                {showMaterialCol && (
                  <select
                    value={p.material || defaultMaterial}
                    onChange={(e) => handleUpdate(p.id || '', 'material', e.target.value as MaterialType)}
                    className="px-2 py-1.5 rounded-lg bg-[#1E293B] border border-[#334155] text-white text-[11px] outline-none"
                  >
                    <option value="mdf">MDF</option>
                    <option value="aluminium">Alu</option>
                    <option value="verre">Verre</option>
                    <option value="contreplaques">CP</option>
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => handleRemove(p.id || '')}
                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[#64748B] hover:text-rose-400 transition-colors shrink-0 ml-auto sm:ml-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
