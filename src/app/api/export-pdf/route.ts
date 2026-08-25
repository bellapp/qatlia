import { NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { z } from 'zod';

const ExportSchema = z.object({
  projectName: z.string().default('PROJET DÉBIT'),
  material: z.string().default('MDF'),
  costPerSheet: z.number().default(450.0),
  costCutPerMeter: z.number().default(5.0),
  sheet: z.object({
    width: z.number(),
    height: z.number(),
    kerf: z.number().default(0.3),
    margin: z.number().default(0.0),
    grainDirection: z.boolean().default(false),
  }),
  result: z.object({
    sheetsUsed: z.number(),
    wastePercentage: z.number(),
    totalAreaUsed: z.number(),
    totalAreaAvailable: z.number(),
    moneySavedMad: z.number().optional().default(0),
    offcuts: z.array(
      z.object({
        sheetIndex: z.number(),
        width: z.number(),
        height: z.number(),
        x: z.number(),
        y: z.number(),
        areaM2: z.number(),
        isReusable: z.boolean(),
      })
    ).optional().default([]),
    placedPieces: z.array(
      z.object({
        pieceNumber: z.number(),
        name: z.string(),
        sheetIndex: z.number(),
        width: z.number(),
        height: z.number(),
        rotated: z.boolean(),
        x: z.number(),
        y: z.number(),
      })
    ),
  }),
});

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

    const { projectName, material, sheet, result, costPerSheet, costCutPerMeter } = parsed.data;

    // Conversion d'affichage en mm si dimension > 500, sinon conversion en mm pour uniformité industrielle
    const isMm = sheet.width > 500;
    const toMm = (val: number) => (isMm ? Math.round(val) : Math.round(val * 10));
    const toM2 = (w: number, h: number) => (toMm(w) * toMm(h)) / 1_000_000;

    const sheetAreaM2 = toM2(sheet.width, sheet.height);
    const totalSheetsAreaM2 = sheetAreaM2 * result.sheetsUsed;
    const totalPiecesAreaM2 = result.placedPieces.reduce((sum, p) => sum + toM2(p.width, p.height), 0);
    const globalWasteRate = totalSheetsAreaM2 > 0 ? ((totalSheetsAreaM2 - totalPiecesAreaM2) / totalSheetsAreaM2) * 100 : 0;
    const nonReusableWasteRate = Math.min(2.5, globalWasteRate * 0.15);

    const linearCutMeters = result.placedPieces.reduce((sum, p) => sum + (2 * (toMm(p.width) + toMm(p.height))) / 1000, 0) * 0.65;

    const totalSheetCost = result.sheetsUsed * costPerSheet;
    const pieceCost = totalPiecesAreaM2 * (costPerSheet / sheetAreaM2);
    const wasteCost = totalSheetCost - pieceCost;
    const nonReusableCost = wasteCost * (nonReusableWasteRate / (globalWasteRate || 1));
    const cuttingCost = linearCutMeters * costCutPerMeter;
    const totalNetCost = totalSheetCost - wasteCost + nonReusableCost + cuttingCost;

    const baselineSheets = Math.ceil(totalPiecesAreaM2 / (sheetAreaM2 * 0.65));
    const savedPanelsCount = Math.max(0, baselineSheets - result.sheetsUsed);
    const estimatedSavingsMad = result.moneySavedMad || (savedPanelsCount * costPerSheet + Math.round(linearCutMeters * 2));

    interface SheetPattern {
      patternId: string;
      sheetIndices: number[];
      count: number;
      pieces: typeof result.placedPieces;
      offcuts: typeof result.offcuts;
      wasteRate: number;
      netCost: number;
    }

    const patternsMap = new Map<string, SheetPattern>();
    for (let s = 0; s < result.sheetsUsed; s++) {
      const sPieces = result.placedPieces.filter((p) => p.sheetIndex === s);
      const sOffcuts = result.offcuts ? result.offcuts.filter((o) => o.sheetIndex === s) : [];

      const signature = sPieces
        .map((p) => `${toMm(p.width)}x${toMm(p.height)}@${Math.round(p.x)}_${Math.round(p.y)}`)
        .sort()
        .join('|');

      const sArea = sPieces.reduce((sum, p) => sum + toM2(p.width, p.height), 0);
      const sWaste = sheetAreaM2 > 0 ? Math.max(0, ((sheetAreaM2 - sArea) / sheetAreaM2) * 100) : 0;
      const sNetCost = (costPerSheet * (100 - sWaste) / 100) + (sPieces.length * 2.5);

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
          netCost: sNetCost,
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
      const key = `${p.height.toFixed(1)} × ${p.width.toFixed(1)} cm`;
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
    doc.text('GAIN ÉCONOMIQUE APRÈS OPTIMISATION QATLIA :', 18, 34.5);

    doc.setFontSize(9.5);
    doc.setTextColor(39, 174, 96);
    doc.text(`+ ${estimatedSavingsMad.toLocaleString('fr-FR')} MAD ÉCONOMISÉS`, pW1 - 18, 34.5, { align: 'right' });

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
      head: [['', 'Matériau', 'Dimension (cm)', 'Quantité']],
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
      head: [['Matériau', 'Référence', 'Dimension (cm)', 'Quantité', 'Surface']],
      body: [
        [
          material.toUpperCase(),
          'Stock Brut',
          `${sheet.height.toFixed(1)} × ${sheet.width.toFixed(1)} cm`,
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
      `${sheet.height.toFixed(1)} × ${sheet.width.toFixed(1)} cm`,
      pat.count,
      pat.pieces.length,
      `${pat.wasteRate.toFixed(2)} %`,
      `${pat.netCost.toFixed(2).replace('.', ',')} MAD`,
    ]);
    planCutRows.push(['', 'TOTAL', '', '', result.sheetsUsed, totalDebitQty, `${globalWasteRate.toFixed(2)} %`, `${totalNetCost.toFixed(2).replace('.', ',')} MAD`]);

    autoTable(doc, {
      startY: planCutStartY,
      margin: { left: 14, right: 14 },
      head: [['', 'Matériau', 'Référence', 'Dimension (mm)', 'Quantité', 'Pièces', 'Taux de chutes', 'Coût net (MAD)']],
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
        7: { halign: 'right', cellWidth: 32 },
      },
    });

    const plansFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    const recapStartY = plansFinalY + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Récapitulatif Données & Chiffrage MAD', 14, recapStartY - 2);

    const recapRows = [
      ['Nombre de panneaux utilisés', result.sheetsUsed, 'Coût des pièces', `${pieceCost.toFixed(2).replace('.', ',')} MAD`],
      ['Nombre de plans de coupe', uniquePatterns.length, 'Coût en panneaux bruts', `${totalSheetCost.toFixed(2).replace('.', ',')} MAD`],
      ['Surface totale des panneaux', `${totalSheetsAreaM2.toFixed(2)} m²`, 'Coût des chutes', `${wasteCost.toFixed(2).replace('.', ',')} MAD`],
      ['Surface totale des pièces', `${totalPiecesAreaM2.toFixed(2)} m²`, 'Coût des chutes non réutilisables', `${nonReusableCost.toFixed(2).replace('.', ',')} MAD`],
      ['Taux de chutes', `${globalWasteRate.toFixed(2)} %`, 'Coût du linéaire de découpe', `${cuttingCost.toFixed(2).replace('.', ',')} MAD`],
      ['Taux des chutes non réutilisables', `${nonReusableWasteRate.toFixed(2)} %`, 'Coût net total du débit', `${totalNetCost.toFixed(2).replace('.', ',')} MAD`],
      ['Linéaire de découpe opérateur', `${linearCutMeters.toFixed(2)} m`, 'Gain estimé après optimisation', `+ ${estimatedSavingsMad.toLocaleString('fr-FR')} MAD`],
      ['Linéaire des chants', '0.00 m', 'Rentabilité matière', `${(100 - globalWasteRate).toFixed(1)} %`],
    ];

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
        `${pIndex + 1}/${uniquePatterns.length} -- ${material.toUpperCase()} -- ${toMm(sheet.width)} × ${toMm(sheet.height)} -- ${exemplairesText}`,
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

        // Cotation explicite Hauteur x Largeur en cm au centre de la chute
        if (ow > 12 && oh > 5) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(Math.min(7.0, Math.max(4.0, Math.min(ow, oh) / 4.5)));
          doc.setTextColor(30, 41, 59);
          doc.text(`${off.height.toFixed(1)} × ${off.width.toFixed(1)} cm`, ox + ow / 2, oy + oh / 2, {
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

        const dimText = `${p.height.toFixed(1)} × ${p.width.toFixed(1)} cm`;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(Math.min(7.5, Math.max(4.2, Math.min(pw, ph) / 4)));
        doc.setTextColor(0, 0, 0);

        if (pw > 14 && ph > 6) {
          doc.text(dimText, px + pw / 2, py + ph / 2, { align: 'center', baseline: 'middle' });
        } else if (ph > 9) {
          doc.text(`${p.height.toFixed(1)}\n×\n${p.width.toFixed(1)}`, px + pw / 2, py + ph / 2 - 2, { align: 'center' });
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
