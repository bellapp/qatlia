import { NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { z } from 'zod';

const ExportSchema = z.object({
  template: z.enum(['opticoupe', 'classic']).default('opticoupe'),
  projectName: z.string().default('GLASS BONDING'),
  material: z.string().default('VRSSG6'),
  costPerSheet: z.number().default(686.13), // Coût par panneau en €
  costCutPerMeter: z.number().default(1.00), // Coût par mètre linéaire de découpe
  sheet: z.object({
    width: z.number(), // ex: 3210 mm ou 321 cm
    height: z.number(), // ex: 2250 mm ou 225 cm
    kerf: z.number().default(0.3),
    margin: z.number().default(0.0),
    grainDirection: z.boolean().default(true),
  }),
  result: z.object({
    sheetsUsed: z.number(),
    wastePercentage: z.number(),
    totalAreaUsed: z.number(),
    totalAreaAvailable: z.number(),
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
 * Modèle Industriel OptiCoupe 5.20b
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ExportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DATA', details: parsed.error.format() }, { status: 400 });
    }

    const { projectName, material, sheet, result, costPerSheet, costCutPerMeter } = parsed.data;

    // Détection unité : si les cotes sont en cm (< 1000) ou en mm
    const isMm = sheet.width > 500;
    const toMm = (val: number) => isMm ? Math.round(val) : Math.round(val * 10);
    const toM2 = (w: number, h: number) => (toMm(w) * toMm(h)) / 1_000_000;

    // Calculs industriels et financiers
    const sheetAreaM2 = toM2(sheet.width, sheet.height);
    const totalSheetsAreaM2 = sheetAreaM2 * result.sheetsUsed;
    const totalPiecesAreaM2 = result.placedPieces.reduce((sum, p) => sum + toM2(p.width, p.height), 0);
    const globalWasteRate = totalSheetsAreaM2 > 0 ? ((totalSheetsAreaM2 - totalPiecesAreaM2) / totalSheetsAreaM2) * 100 : 0;
    const nonReusableWasteRate = Math.min(2.5, globalWasteRate * 0.15); // estimation chutes < 100mm

    // Calcul du linéaire de découpe
    const linearCutMeters = result.placedPieces.reduce((sum, p) => sum + (2 * (toMm(p.width) + toMm(p.height))) / 1000, 0) * 0.65;

    // Coûts
    const totalSheetCost = result.sheetsUsed * costPerSheet;
    const pieceCost = totalPiecesAreaM2 * (costPerSheet / sheetAreaM2);
    const wasteCost = totalSheetCost - pieceCost;
    const nonReusableCost = wasteCost * (nonReusableWasteRate / globalWasteRate);
    const cuttingCost = linearCutMeters * costCutPerMeter;
    const totalNetCost = totalSheetCost - wasteCost + nonReusableCost + cuttingCost;

    // Création document A4 Portrait (exactement comme le standard OptiCoupe)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const today = new Date().toLocaleDateString('fr-FR');

    // Regroupement des feuilles identiques (ex: "À fabriquer en 4 exemplaires")
    interface SheetPattern {
      patternId: string;
      sheetIndices: number[];
      count: number;
      pieces: typeof result.placedPieces;
      wasteRate: number;
      netCost: number;
    }

    const patternsMap = new Map<string, SheetPattern>();
    for (let s = 0; s < result.sheetsUsed; s++) {
      const sPieces = result.placedPieces.filter((p) => p.sheetIndex === s);
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
          wasteRate: sWaste,
          netCost: sNetCost,
        });
      }
    }

    const uniquePatterns = Array.from(patternsMap.values());
    const totalPages = 1 + uniquePatterns.length;

    // Helper: Dessiner l'en-tête officiel OptiCoupe
    const drawOptiHeader = (pageNum: number) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.rect(20, 15, pageWidth - 40, 16);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text('OptiCoupe 5.20b', 22, 19);
      doc.text('DébitPanneaux1', 22, 23);
      doc.text(`Page ${pageNum} / ${totalPages}`, 22, 27);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(projectName.toUpperCase(), pageWidth / 2, 24, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(today, pageWidth - 22, 19, { align: 'right' });
    };

    // ==========================================
    // PAGE 1 : RÉCAPITULATIF & NOMENCLATURE
    // ==========================================
    drawOptiHeader(1);

    // Groupement des pièces identiques pour la liste de débit
    interface AggregatedPiece {
      num: number;
      material: string;
      dim: string;
      quantity: number;
    }
    const aggMap = new Map<string, AggregatedPiece>();
    let pNum = 1;
    for (const p of result.placedPieces) {
      const key = `${toMm(p.width)} × ${toMm(p.height)}`;
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

    // 1. Tableau "Liste de débit" (Gauche)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Liste de débit', 20, 39);

    const debitRows = debitList.map((d) => [d.num, d.material, d.dim, d.quantity]);
    debitRows.push(['', 'TOTAL', '', totalDebitQty]);

    autoTable(doc, {
      startY: 42,
      margin: { left: 20 },
      tableWidth: 80,
      head: [['', 'Matériau', 'Dimension', 'Quantité']],
      body: debitRows,
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'normal',
        textColor: [0, 0, 0],
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 7,
        cellPadding: 1.2,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 8 },
        1: { halign: 'left', cellWidth: 22 },
        2: { halign: 'center', cellWidth: 32 },
        3: { halign: 'right', cellWidth: 18 },
      },
    });

    // 2. Tableau "Panneaux utilisés" (Droite)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Panneaux utilisés', 110, 39);

    autoTable(doc, {
      startY: 42,
      margin: { left: 110 },
      tableWidth: 80,
      head: [['Matériau', 'Référence', 'Dimension', 'Quantité', 'Surface']],
      body: [
        [
          material.toUpperCase(),
          '312/225',
          `${toMm(sheet.width)} × ${toMm(sheet.height)}`,
          result.sheetsUsed,
          `${totalSheetsAreaM2.toFixed(2)} m²`,
        ],
      ],
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'normal',
        textColor: [0, 0, 0],
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 7,
        cellPadding: 1.2,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 16 },
        1: { halign: 'center', cellWidth: 16 },
        2: { halign: 'center', cellWidth: 26 },
        3: { halign: 'right', cellWidth: 10 },
        4: { halign: 'right', cellWidth: 12 },
      },
    });

    // 3. Tableau "Liste des plans de coupe" (Milieu)
    const planCutStartY = Math.max(((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14, 115);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Liste des plans de coupe', 20, planCutStartY - 3);

    const planCutRows = uniquePatterns.map((pat, idx) => [
      idx + 1,
      material.toUpperCase(),
      '312/225',
      `${toMm(sheet.width)} × ${toMm(sheet.height)}`,
      pat.count,
      pat.pieces.length,
      `${pat.wasteRate.toFixed(2)} %`,
      `${pat.netCost.toFixed(2).replace('.', ',')} €`,
    ]);
    planCutRows.push(['', 'TOTAL', '', '', result.sheetsUsed, totalDebitQty, `${globalWasteRate.toFixed(2)} %`, `${totalNetCost.toFixed(2).replace('.', ',')} €`]);

    autoTable(doc, {
      startY: planCutStartY,
      margin: { left: 20, right: 20 },
      head: [['', 'Matériau', 'Référence', 'Dimension', 'Quantité', 'Pièces', 'Taux de chutes', 'Coût net']],
      body: planCutRows,
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'normal',
        textColor: [0, 0, 0],
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 7,
        cellPadding: 1.5,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 8 },
        1: { halign: 'left', cellWidth: 24 },
        2: { halign: 'center', cellWidth: 24 },
        3: { halign: 'center', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 18 },
        5: { halign: 'right', cellWidth: 16 },
        6: { halign: 'right', cellWidth: 24 },
        7: { halign: 'right', cellWidth: 24 },
      },
    });

    // 4. Tableau "Récapitulatif" (Bas)
    const recapStartY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Récapitulatif', 20, recapStartY - 3);

    const recapRows = [
      ['Nombre de panneaux utilisés', result.sheetsUsed, 'Coût des pièces', `${pieceCost.toFixed(2).replace('.', ',')} €`],
      ['Nombre de plans de coupe', uniquePatterns.length, 'Coût en panneaux', `${totalSheetCost.toFixed(2).replace('.', ',')} €`],
      ['Surface totale des panneaux', `${totalSheetsAreaM2.toFixed(2)} m²`, 'Coût en chutes', `${wasteCost.toFixed(2).replace('.', ',')} €`],
      ['Surface totale des pièces', `${totalPiecesAreaM2.toFixed(2)} m²`, 'Coût des chutes non réutilisables', `${nonReusableCost.toFixed(2).replace('.', ',')} €`],
      ['Taux de chutes', `${globalWasteRate.toFixed(2)} %`, 'Coût du linéaire de découpe', `${cuttingCost.toFixed(2).replace('.', ',')} €`],
      ['Taux des chutes non réutilisables', `${nonReusableWasteRate.toFixed(2)} %`, 'Coût net total', `${totalNetCost.toFixed(2).replace('.', ',')} €`],
      ['Linéaire de découpe', `${linearCutMeters.toFixed(2)} m`, '', ''],
      ['Linéaire des chants', '0.00 m', '', ''],
    ];

    autoTable(doc, {
      startY: recapStartY,
      margin: { left: 20, right: 20 },
      head: [['Données techniques', '', 'Coûts', '']],
      body: recapRows,
      theme: 'plain',
      headStyles: {
        fontSize: 7.5,
        fontStyle: 'normal',
        textColor: [0, 0, 0],
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        fontSize: 7,
        cellPadding: 1.3,
        textColor: [0, 0, 0],
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 55 },
        1: { halign: 'right', cellWidth: 30 },
        2: { halign: 'left', cellWidth: 55 },
        3: { halign: 'right', cellWidth: 30 },
      },
    });

    // =========================================================================
    // PAGES SUIVANTES : SCHÉMAS DE COUPE GRAPHIQUES (Style OptiCoupe monochrome)
    // =========================================================================
    uniquePatterns.forEach((pat, pIndex) => {
      doc.addPage('a4', 'portrait');
      drawOptiHeader(pIndex + 2);

      // Titre du plan de coupe
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      const exemplairesText = pat.count === 1 ? 'Exemplaire unique' : `À fabriquer en ${pat.count} exemplaires`;
      doc.text(
        `${pIndex + 1}/${uniquePatterns.length} -- ${material.toUpperCase()} -- ${toMm(sheet.width)} × ${toMm(sheet.height)} -- ${exemplairesText}`,
        20,
        38
      );

      // Zone de tracé
      const drawX = 25;
      const drawY = 44;
      const maxDrawW = pageWidth - 50;
      const maxDrawH = pageHeight - 65;

      const scale = Math.min(maxDrawW / sheet.width, maxDrawH / sheet.height);
      const canvasW = sheet.width * scale;
      const canvasH = sheet.height * scale;

      // 1. Fond Chutes Grisées (Hachures / Gris OptiCoupe #D1D5DB)
      doc.setFillColor(215, 215, 215);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.rect(drawX, drawY, canvasW, canvasH, 'FD');

      // 2. Tracé des Pièces (Fond Blanc Net #FFFFFF + Bordure Noire Épaisse)
      pat.pieces.forEach((p) => {
        const px = drawX + p.x * scale;
        const py = drawY + p.y * scale;
        const pw = p.width * scale;
        const ph = p.height * scale;

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);
        doc.rect(px, py, pw, ph, 'FD');

        // Cotation centrée dans la pièce
        const dimText = `${toMm(p.width)} × ${toMm(p.height)}`;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(Math.min(7.5, Math.max(4.5, ph / 4)));
        doc.setTextColor(0, 0, 0);

        if (pw > 14 && ph > 6) {
          doc.text(dimText, px + pw / 2, py + ph / 2, { align: 'center', baseline: 'middle' });
        } else if (ph > 10) {
          // Écriture verticale pour les bandes étroites
          doc.text(`${toMm(p.width)}\n×\n${toMm(p.height)}`, px + pw / 2, py + ph / 2 - 3, { align: 'center' });
        }
      });
    });

    const pdfBuffer = doc.output('arraybuffer');

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="OptiCoupe_${projectName.toUpperCase().replace(/\s+/g, '_')}.pdf"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur export PDF OptiCoupe';
    console.error(error);
    return NextResponse.json({ error: 'PDF_EXPORT_FAILED', message }, { status: 500 });
  }
}
