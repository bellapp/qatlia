import { NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fromCanonicalCm } from '@/lib/units';
import { ExportSchema } from '@/lib/exports/pdf-schema';
import { computeCostBreakdown } from '@/lib/costing';

/**
 * Modèle QatlIA Pro (Débit Industriel avec Cotation Précise des Chutes & Colonnes Traversantes)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ExportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DATA', details: parsed.error.format() }, { status: 400 });
    }

    const { projectName, material, sheet, result, displayUnit } = parsed.data;

    // Input geometry (sheet/pieces/offcuts) is always canonical centimetres —
    // there is no magnitude-based mm/cm guessing here. `fmt` is the only
    // place a value is converted, and only for a human-readable label;
    // every calculation below stays in cm (converted to m² by /10000, to
    // metres by /100), regardless of the artisan's chosen `displayUnit`.
    const fmt = (valueCm: number) => fromCanonicalCm(valueCm, displayUnit).toFixed(1);
    const toM2 = (w: number, h: number) => (w * h) / 10_000;
    const fmtMad = (valueMad: number) => `${valueMad.toFixed(2).replace('.', ',')} MAD`;

    const sheetAreaM2 = toM2(sheet.width, sheet.height);
    const totalSheetsAreaM2 = sheetAreaM2 * result.sheetsUsed;
    const totalPiecesAreaM2 = result.placedPieces.reduce((sum, p) => sum + toM2(p.width, p.height), 0);
    const globalWasteRate = totalSheetsAreaM2 > 0 ? ((totalSheetsAreaM2 - totalPiecesAreaM2) / totalSheetsAreaM2) * 100 : 0;

    // Non-reusable waste is measured directly from the optimizer's own
    // reusable-offcut classification (see Offcut.isReusable in
    // src/lib/cutting/binpacking.ts), not an invented cap/multiplier.
    const nonReusableOffcutAreaM2 = result.offcuts
      .filter((o) => !o.isReusable)
      .reduce((sum, o) => sum + o.areaM2, 0);
    const nonReusableWasteRate = totalSheetsAreaM2 > 0 ? (nonReusableOffcutAreaM2 / totalSheetsAreaM2) * 100 : 0;

    // This route never renders `result.costBreakdown` directly — a client
    // could submit any figure there, forged or stale, independent of the
    // components that are supposed to sum to it. Instead it recomputes the
    // breakdown itself, from `result.costingInput` (the exact input the
    // optimizer passed to computeCostBreakdown — see
    // OptimizationResult.costingInput in src/lib/cutting/binpacking.ts),
    // through the same single shared calculator. When no costingInput is
    // present (e.g. a legacy 1D plan, which never had pricing wired up),
    // the cost is reported unavailable rather than falling back to whatever
    // totals the client happened to submit.
    const costBreakdown = result.costingInput ? computeCostBreakdown(result.costingInput) : undefined;

    interface SheetPattern {
      patternId: string;
      sheetIndices: number[];
      count: number;
      pieces: typeof result.placedPieces;
      offcuts: typeof result.offcuts;
      wasteRate: number;
    }

    const patternsMap = new Map<string, SheetPattern>();
    for (let s = 0; s < result.sheetsUsed; s++) {
      const sPieces = result.placedPieces.filter((p) => p.sheetIndex === s);
      const sOffcuts = result.offcuts ? result.offcuts.filter((o) => o.sheetIndex === s) : [];

      // Signature precision only needs to distinguish patterns; rounding to
      // the nearest 0.1cm (an mm-equivalent step) is unrelated to `displayUnit`.
      const signature = sPieces
        .map((p) => `${Math.round(p.width * 10)}x${Math.round(p.height * 10)}@${Math.round(p.x)}_${Math.round(p.y)}`)
        .sort()
        .join('|');

      const sArea = sPieces.reduce((sum, p) => sum + toM2(p.width, p.height), 0);
      const sWaste = sheetAreaM2 > 0 ? Math.max(0, ((sheetAreaM2 - sArea) / sheetAreaM2) * 100) : 0;

      if (patternsMap.has(signature)) {
        const existing = patternsMap.get(signature)!;
        existing.count += 1;
        existing.sheetIndices.push(s);
      } else {
        patternsMap.set(signature, {
          patternId: signature,
          sheetIndices: [s],
          count: 1,
          pieces: sPieces,
          offcuts: sOffcuts,
          wasteRate: sWaste,
        });
      }
    }

    const uniquePatterns = Array.from(patternsMap.values());

    interface AggregatedPiece {
      num: number;
      material: string;
      dim: string;
      quantity: number;
    }
    const aggMap = new Map<string, AggregatedPiece>();
    let pNum = 1;
    for (const p of result.placedPieces) {
      const key = `${fmt(p.height)} × ${fmt(p.width)} ${displayUnit}`;
      if (aggMap.has(key)) {
        aggMap.get(key)!.quantity += 1;
      } else {
        aggMap.set(key, {
          num: pNum++,
          material: material.toUpperCase(),
          dim: key,
          quantity: 1,
        });
      }
    }
    const debitList = Array.from(aggMap.values());
    const totalDebitQty = debitList.reduce((s, p) => s + p.quantity, 0);

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const today = new Date().toLocaleDateString('fr-FR');

    const drawQatliaHeader = (pageNum: number, totalPgs: number, orientation: 'portrait' | 'landscape') => {
      const pW = orientation === 'landscape' ? 297 : 210;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.rect(14, 10, pW - 28, 15);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 58, 95);
      doc.text('QatlIA Pro 2026', 16, 15);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Plan de Débit Linéaire & Optimisation', 16, 19);
      doc.text(`Page ${pageNum} / ${totalPgs}`, 16, 23);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
      doc.text(projectName.toUpperCase(), pW / 2, 19, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(today, pW - 16, 15, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(245, 166, 35);
      doc.text('Devise : MAD', pW - 16, 21, { align: 'right' });
    };

    // PAGE 1
    const pW1 = 210;
    doc.setFillColor(245, 247, 250);
    doc.setDrawColor(30, 58, 95);
    doc.setLineWidth(0.4);
    doc.rect(14, 28, pW1 - 28, 10, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 58, 95);
    doc.text('COÛT TOTAL ESTIMÉ DU DÉBIT :', 18, 34.5);

    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 95);
    doc.text(costBreakdown ? fmtMad(costBreakdown.subtotal) : 'Non calculé', pW1 - 18, 34.5, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0);
    doc.text('Liste de débit', 14, 43);

    const debitRows = debitList.map((d) => [d.num, d.material, d.dim, d.quantity]);
    debitRows.push(['', 'TOTAL', '', totalDebitQty]);

    autoTable(doc, {
      startY: 45,
      margin: { left: 14 },
      tableWidth: 88,
      head: [['', 'Matériau', `Dimension (${displayUnit})`, 'Quantité']],
      body: debitRows,
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 6.8,
        cellPadding: 1.0,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 7 },
        1: { halign: 'left', cellWidth: 20 },
        2: { halign: 'center', cellWidth: 38 },
        3: { halign: 'right', cellWidth: 20 },
      },
    });

    const debitFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Panneaux utilisés', 108, 43);

    autoTable(doc, {
      startY: 45,
      margin: { left: 108 },
      tableWidth: 88,
      head: [['Matériau', 'Référence', `Dimension (${displayUnit})`, 'Quantité', 'Surface']],
      body: [
        [
          material.toUpperCase(),
          'Stock Brut',
          `${fmt(sheet.height)} × ${fmt(sheet.width)} ${displayUnit}`,
          result.sheetsUsed,
          `${totalSheetsAreaM2.toFixed(2)} m²`,
        ],
      ],
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 6.8,
        cellPadding: 1.0,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 16 },
        1: { halign: 'center', cellWidth: 16 },
        2: { halign: 'center', cellWidth: 28 },
        3: { halign: 'right', cellWidth: 12 },
        4: { halign: 'right', cellWidth: 14 },
      },
    });

    const panelsFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    const planCutStartY = Math.max(debitFinalY, panelsFinalY) + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Liste des plans de coupe (Passes Linéaires Traversantes)', 14, planCutStartY - 2);

    const planCutRows = uniquePatterns.map((pat, idx) => [
      idx + 1,
      material.toUpperCase(),
      'Stock',
      `${fmt(sheet.height)} × ${fmt(sheet.width)} ${displayUnit}`,
      pat.count,
      pat.pieces.length,
      `${pat.wasteRate.toFixed(2)} %`,
    ]);
    planCutRows.push(['', 'TOTAL', '', '', result.sheetsUsed, totalDebitQty, `${globalWasteRate.toFixed(2)} %`]);

    autoTable(doc, {
      startY: planCutStartY,
      margin: { left: 14, right: 14 },
      head: [['', 'Matériau', 'Référence', `Dimension (${displayUnit})`, 'Quantité', 'Pièces', 'Taux de chutes']],
      body: planCutRows,
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 6.8,
        cellPadding: 1.2,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 6 },
        1: { halign: 'left', cellWidth: 22 },
        2: { halign: 'center', cellWidth: 24 },
        3: { halign: 'center', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 16 },
        5: { halign: 'right', cellWidth: 16 },
        6: { halign: 'right', cellWidth: 28 },
      },
    });

    const plansFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    const recapStartY = plansFinalY + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Récapitulatif Données & Chiffrage MAD', 14, recapStartY - 2);

    // Technical (left) and financial (right) columns are independent lists —
    // the financial figures come from the `costBreakdown` recomputed above
    // from `result.costingInput` (see src/lib/costing.ts), never from
    // `result.costBreakdown` as submitted.
    const technicalRows: [string, string | number][] = [
      ['Nombre de panneaux utilisés', result.sheetsUsed],
      ['Nombre de plans de coupe', uniquePatterns.length],
      ['Surface totale des panneaux', `${totalSheetsAreaM2.toFixed(2)} m²`],
      ['Surface totale des pièces', `${totalPiecesAreaM2.toFixed(2)} m²`],
      ['Taux de chutes', `${globalWasteRate.toFixed(2)} %`],
      ['Taux des chutes non réutilisables', `${nonReusableWasteRate.toFixed(2)} %`],
      ['Linéaire de découpe opérateur', `${result.totalLinearCutMeters.toFixed(2)} m`],
      ['Rentabilité matière', `${(100 - globalWasteRate).toFixed(1)} %`],
    ];
    const financialRows: [string, string][] = costBreakdown
      ? [
          ['Coût matière', fmtMad(costBreakdown.materialCost)],
          ['Coût chants', fmtMad(costBreakdown.edgeCost)],
          ["Coût main d'œuvre", fmtMad(costBreakdown.laborCost)],
          ['Sous-total du débit', fmtMad(costBreakdown.subtotal)],
        ]
      : [['Chiffrage', 'Non disponible']];

    const recapRowCount = Math.max(technicalRows.length, financialRows.length);
    const recapRows = Array.from({ length: recapRowCount }, (_, i) => [
      ...(technicalRows[i] ?? ['', '']),
      ...(financialRows[i] ?? ['', '']),
    ]);

    autoTable(doc, {
      startY: recapStartY,
      margin: { left: 14, right: 14 },
      head: [['Données techniques', '', 'Chiffrage Financier (MAD)', '']],
      body: recapRows,
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 6.8,
        cellPadding: 1.1,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 58 },
        1: { halign: 'right', cellWidth: 30 },
        2: { halign: 'left', cellWidth: 58 },
        3: { halign: 'right', cellWidth: 32 },
      },
    });

    // PAGES SCHÉMAS GRAPHIQUES (A4 Paysage)
    uniquePatterns.forEach((pat, pIndex) => {
      doc.addPage('a4', 'landscape');
      const pW = 297;
      const pH = 210;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      const exemplairesText = pat.count === 1 ? 'Exemplaire unique' : `À fabriquer en ${pat.count} exemplaires`;
      doc.text(
        `${pIndex + 1}/${uniquePatterns.length} -- ${material.toUpperCase()} -- ${fmt(sheet.width)} × ${fmt(sheet.height)} ${displayUnit} -- ${exemplairesText}`,
        14,
        32
      );

      const drawX = 14;
      const drawY = 36;
      const maxDrawW = pW - 28;
      const maxDrawH = pH - 46;

      const scale = Math.min(maxDrawW / sheet.width, maxDrawH / sheet.height);
      const canvasW = sheet.width * scale;
      const canvasH = sheet.height * scale;

      // 1. Fond Panneau Brut (Blanc avec Contour Noir Épais)
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.rect(drawX, drawY, canvasW, canvasH, 'FD');

      // 2. Dessin des Chutes (Fond Gris #C8CCD1 avec Bordures Noires Nettes)
      pat.offcuts.forEach((off) => {
        const ox = drawX + off.x * scale;
        const oy = drawY + off.y * scale;
        const ow = off.width * scale;
        const oh = off.height * scale;

        // Rectangle de chute avec fond gris et contour noir bien marqué
        doc.setFillColor(200, 204, 209);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);
        doc.rect(ox, oy, ow, oh, 'FD');

        // Cotation explicite Hauteur x Largeur au centre de la chute, dans l'unité choisie
        if (ow > 12 && oh > 5) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(Math.min(7.0, Math.max(4.0, Math.min(ow, oh) / 4.5)));
          doc.setTextColor(30, 41, 59);
          doc.text(`${fmt(off.height)} × ${fmt(off.width)} ${displayUnit}`, ox + ow / 2, oy + oh / 2, {
            align: 'center',
            baseline: 'middle',
          });
        }
      });

      // 3. Dessin des pièces utiles (Fond Blanc Pur + Bordure Noire Épaisse 0.4mm)
      pat.pieces.forEach((p) => {
        const px = drawX + p.x * scale;
        const py = drawY + p.y * scale;
        const pw = p.width * scale;
        const ph = p.height * scale;

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);
        doc.rect(px, py, pw, ph, 'FD');

        const dimText = `${fmt(p.height)} × ${fmt(p.width)} ${displayUnit}`;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(Math.min(7.5, Math.max(4.2, Math.min(pw, ph) / 4)));
        doc.setTextColor(0, 0, 0);

        if (pw > 14 && ph > 6) {
          doc.text(dimText, px + pw / 2, py + ph / 2, { align: 'center', baseline: 'middle' });
        } else if (ph > 9) {
          doc.text(`${fmt(p.height)}\n×\n${fmt(p.width)}`, px + pw / 2, py + ph / 2 - 2, { align: 'center' });
        }
      });
    });

    const totalPgs = doc.getNumberOfPages();
    for (let i = 1; i <= totalPgs; i++) {
      doc.setPage(i);
      const isLand = i > 1;
      drawQatliaHeader(i, totalPgs, isLand ? 'landscape' : 'portrait');
    }

    const pdfBuffer = doc.output('arraybuffer');

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="QatlIA_${projectName.toUpperCase().replace(/\s+/g, '_')}.pdf"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur export PDF QatlIA';
    console.error(error);
    return NextResponse.json({ error: 'PDF_EXPORT_FAILED', message }, { status: 500 });
  }
}
