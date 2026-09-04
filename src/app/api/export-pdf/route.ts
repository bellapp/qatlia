import { NextResponse } from 'next/server';
import { jsPDF, type TextOptionsLight } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fromCanonicalCm } from '@/lib/units';
import { ExportSchema } from '@/lib/exports/pdf-schema';
import { computeCostBreakdown } from '@/lib/costing';
import { pdfCatalogFor } from '@/lib/exports/pdf-catalog';
import {
  registerAmiriFont,
  payloadNeedsArabicFont,
  drawContentAwareText,
  arabicSafeCellHooks,
  NOT_REGISTERED,
} from '@/lib/exports/pdf-fonts';
import { formatDateTime } from '@/i18n';

/** Every direct label/table font in this route: Arabic content switches to
 * the embedded Amiri font for its own draw call only (see
 * drawContentAwareText/arabicSafeCellHooks in pdf-fonts.ts) — the base font
 * for borders, layout and every non-Arabic string stays plain Helvetica in
 * every locale, since it needs no embedding at all. */
const BASE_FONT = 'helvetica';

/**
 * Modèle QatlIA Pro (Débit Industriel avec Cotation Précise des Chutes & Colonnes Traversantes)
 *
 * Every customer-facing label in this route is drawn from `cat` (the
 * fr/en/ar catalog in src/lib/exports/pdf-catalog.ts), selected by the
 * artisan's own atelier locale (see `locale` in pdf-schema.ts). See
 * src/lib/exports/pdf-fonts.ts for how Arabic text gets a real embedded
 * font, correct letter-shaping and correct visual (left-to-right drawing)
 * order instead of tofu or a naively reversed string.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ExportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DATA', details: parsed.error.format() }, { status: 400 });
    }

    const { projectName, material, sheet, result, displayUnit, locale } = parsed.data;
    const cat = pdfCatalogFor(locale);

    // Input geometry (sheet/pieces/offcuts) is always canonical centimetres —
    // there is no magnitude-based mm/cm guessing here. `fmt` is the only
    // place a value is converted, and only for a human-readable label;
    // every calculation below stays in cm (converted to m² by /10000, to
    // metres by /100), regardless of the artisan's chosen `displayUnit`.
    // Dimension/percentage/money labels are deliberately *not* run through
    // locale-aware number formatting: they must stay visually
    // left-to-right and byte-identical across locales (see pdf-fonts.ts's
    // drawContentAwareText, which leaves any string with no Arabic script in
    // it — every one of these — completely unchanged).
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

    // Lazily embeds the Amiri font (see src/lib/exports/pdf-fonts.ts) only
    // when this specific payload can actually need Arabic glyphs: locale
    // 'ar' (every ar-catalog string is Arabic), or an artisan-typed Arabic
    // projectName/material even in a French/English-locale export. A
    // pure-Latin fr/en export never decodes or embeds the font at all.
    const fontRegistration = payloadNeedsArabicFont(locale, projectName, material)
      ? await registerAmiriFont(doc)
      : NOT_REGISTERED;
    const cellHooks = arabicSafeCellHooks(doc, fontRegistration);

    // Every doc.text(...) call in this route goes through here instead of
    // calling doc.text directly: drawContentAwareText is a no-op (beyond
    // stripping stray bidi control characters) for any string with no
    // Arabic script in it (the overwhelming majority — every plain
    // dimension, percentage and MAD figure), and switches to the embedded
    // Amiri font, shapes and bidi-reorders the rest, restoring the prior
    // font immediately after (see its doc comment in pdf-fonts.ts).
    const drawText = (text: string, x: number, y: number, options?: TextOptionsLight) => {
      drawContentAwareText(doc, fontRegistration, text, x, y, options);
    };

    const today = formatDateTime(locale, new Date(), { day: '2-digit', month: '2-digit', year: 'numeric' });

    const drawQatliaHeader = (pageNum: number, totalPgs: number, orientation: 'portrait' | 'landscape') => {
      const pW = orientation === 'landscape' ? 297 : 210;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.3);
      doc.rect(14, 10, pW - 28, 15);

      doc.setFont(BASE_FONT, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 58, 95);
      drawText(cat.brand, 16, 15);

      doc.setFont(BASE_FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      drawText(cat.tagline, 16, 19);
      drawText(cat.pageIndicator(pageNum, totalPgs), 16, 23);

      doc.setFont(BASE_FONT, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
      drawText(projectName.toUpperCase(), pW / 2, 19, { align: 'center' });

      doc.setFont(BASE_FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      drawText(today, pW - 16, 15, { align: 'right' });
      doc.setFont(BASE_FONT, 'bold');
      doc.setTextColor(245, 166, 35);
      drawText(cat.currencyLabel, pW - 16, 21, { align: 'right' });
    };

    // PAGE 1
    const pW1 = 210;
    doc.setFillColor(245, 247, 250);
    doc.setDrawColor(30, 58, 95);
    doc.setLineWidth(0.4);
    doc.rect(14, 28, pW1 - 28, 10, 'FD');

    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 58, 95);
    drawText(cat.totalCostLabel, 18, 34.5);

    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 95);
    drawText(costBreakdown ? fmtMad(costBreakdown.subtotal) : cat.costUnavailable, pW1 - 18, 34.5, { align: 'right' });

    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0);
    drawText(cat.cuttingList.title, 14, 43);

    const debitRows = debitList.map((d) => [d.num, d.material, d.dim, d.quantity]);
    debitRows.push(['', cat.cuttingList.total, '', totalDebitQty]);

    autoTable(doc, {
      startY: 45,
      margin: { left: 14 },
      tableWidth: 88,
      head: [['', cat.cuttingList.columnMaterial, cat.cuttingList.columnDimension(displayUnit), cat.cuttingList.columnQuantity]],
      body: debitRows,
      theme: 'plain',
      headStyles: {
        font: BASE_FONT,
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        font: BASE_FONT,
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
      ...cellHooks,
    });

    const debitFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(9.5);
    drawText(cat.panelsUsed.title, 108, 43);

    autoTable(doc, {
      startY: 45,
      margin: { left: 108 },
      tableWidth: 88,
      head: [
        [
          cat.panelsUsed.columnMaterial,
          cat.panelsUsed.columnReference,
          cat.panelsUsed.columnDimension(displayUnit),
          cat.panelsUsed.columnQuantity,
          cat.panelsUsed.columnArea,
        ],
      ],
      body: [
        [
          material.toUpperCase(),
          cat.panelsUsed.stockRaw,
          `${fmt(sheet.height)} × ${fmt(sheet.width)} ${displayUnit}`,
          result.sheetsUsed,
          `${totalSheetsAreaM2.toFixed(2)} m²`,
        ],
      ],
      theme: 'plain',
      headStyles: {
        font: BASE_FONT,
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        font: BASE_FONT,
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
      ...cellHooks,
    });

    const panelsFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    const planCutStartY = Math.max(debitFinalY, panelsFinalY) + 8;
    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(9.5);
    drawText(cat.cutPlans.title, 14, planCutStartY - 2);

    const planCutRows = uniquePatterns.map((pat, idx) => [
      idx + 1,
      material.toUpperCase(),
      cat.cutPlans.stockReference,
      `${fmt(sheet.height)} × ${fmt(sheet.width)} ${displayUnit}`,
      pat.count,
      pat.pieces.length,
      `${pat.wasteRate.toFixed(2)} %`,
    ]);
    planCutRows.push(['', cat.cutPlans.total, '', '', result.sheetsUsed, totalDebitQty, `${globalWasteRate.toFixed(2)} %`]);

    autoTable(doc, {
      startY: planCutStartY,
      margin: { left: 14, right: 14 },
      head: [
        [
          '',
          cat.cutPlans.columnMaterial,
          cat.cutPlans.columnReference,
          cat.cutPlans.columnDimension(displayUnit),
          cat.cutPlans.columnQuantity,
          cat.cutPlans.columnPieces,
          cat.cutPlans.columnWasteRate,
        ],
      ],
      body: planCutRows,
      theme: 'plain',
      headStyles: {
        font: BASE_FONT,
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        font: BASE_FONT,
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
      ...cellHooks,
    });

    const plansFinalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    const recapStartY = plansFinalY + 8;
    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(9.5);
    drawText(cat.recap.title, 14, recapStartY - 2);

    // Technical (left) and financial (right) columns are independent lists —
    // the financial figures come from the `costBreakdown` recomputed above
    // from `result.costingInput` (see src/lib/costing.ts), never from
    // `result.costBreakdown` as submitted.
    const technicalRows: [string, string | number][] = [
      [cat.recap.sheetsUsedLabel, result.sheetsUsed],
      [cat.recap.cutPlansCountLabel, uniquePatterns.length],
      [cat.recap.totalSheetAreaLabel, `${totalSheetsAreaM2.toFixed(2)} m²`],
      [cat.recap.totalPiecesAreaLabel, `${totalPiecesAreaM2.toFixed(2)} m²`],
      [cat.recap.wasteRateLabel, `${globalWasteRate.toFixed(2)} %`],
      [cat.recap.nonReusableWasteRateLabel, `${nonReusableWasteRate.toFixed(2)} %`],
      [cat.recap.linearCutLabel, `${result.totalLinearCutMeters.toFixed(2)} m`],
      [cat.recap.materialYieldLabel, `${(100 - globalWasteRate).toFixed(1)} %`],
    ];
    const financialRows: [string, string][] = costBreakdown
      ? [
          [cat.recap.materialCostLabel, fmtMad(costBreakdown.materialCost)],
          [cat.recap.edgeCostLabel, fmtMad(costBreakdown.edgeCost)],
          [cat.recap.laborCostLabel, fmtMad(costBreakdown.laborCost)],
          [cat.recap.subtotalLabel, fmtMad(costBreakdown.subtotal)],
        ]
      : [[cat.recap.costingLabel, cat.recap.costingUnavailable]];

    const recapRowCount = Math.max(technicalRows.length, financialRows.length);
    const recapRows = Array.from({ length: recapRowCount }, (_, i) => [
      ...(technicalRows[i] ?? ['', '']),
      ...(financialRows[i] ?? ['', '']),
    ]);

    autoTable(doc, {
      startY: recapStartY,
      margin: { left: 14, right: 14 },
      head: [[cat.recap.technicalHeader, '', cat.recap.financialHeader, '']],
      body: recapRows,
      theme: 'plain',
      headStyles: {
        font: BASE_FONT,
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: {
        font: BASE_FONT,
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
      ...cellHooks,
    });

    // PAGES SCHÉMAS GRAPHIQUES (A4 Paysage)
    uniquePatterns.forEach((pat, pIndex) => {
      doc.addPage('a4', 'landscape');
      const pW = 297;
      const pH = 210;

      doc.setFont(BASE_FONT, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      const exemplairesText = pat.count === 1 ? cat.schema.uniqueSample : cat.schema.multipleSamples(pat.count);
      drawText(
        cat.schema.header(
          pIndex + 1,
          uniquePatterns.length,
          material.toUpperCase(),
          `${fmt(sheet.width)} × ${fmt(sheet.height)} ${displayUnit}`,
          exemplairesText
        ),
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

      // 1b. Ramage du panneau (option): soft wood-vein strokes over the panel
      // background, UNDER the pieces and offcuts. The veining direction comes
      // from the artisan's own choice in the atelier.
      if (sheet.hasGrain) {
        doc.setDrawColor(180, 148, 96); // soft wood-tone, light enough not to fight the pieces
        doc.setLineWidth(0.12);
        if (sheet.grainOrientation === 'vertical') {
          // Wavy strokes running along the panel height
          const spacing = Math.max(1.2, Math.min(4, canvasW / 60));
          for (let gx = drawX + spacing; gx < drawX + canvasW - spacing / 2; gx += spacing) {
            for (let gy = drawY; gy < drawY + canvasH - 2; gy += 4) {
              doc.line(gx, gy, gx + 0.35, gy + 2);
              doc.line(gx + 0.35, gy + 2, gx, gy + 4);
            }
          }
        } else {
          const spacing = Math.max(1.2, Math.min(4, canvasH / 60));
          for (let gy = drawY + spacing; gy < drawY + canvasH - spacing / 2; gy += spacing) {
            for (let gx = drawX; gx < drawX + canvasW - 2; gx += 4) {
              doc.line(gx, gy, gx + 2, gy + 0.35);
              doc.line(gx + 2, gy + 0.35, gx + 4, gy);
            }
          }
        }
        // Grain direction arrow alongside the panel, with a localized label.
        const arrowLen = Math.min(30, (sheet.grainOrientation === 'vertical' ? canvasH : canvasW) * 0.5);
        const arrowX = drawX + canvasW + 4;
        const arrowY = drawY + (sheet.grainOrientation === 'vertical' ? canvasH * 0.25 : canvasH + 6);
        doc.setDrawColor(60, 60, 60);
        doc.setLineWidth(0.4);
        doc.line(arrowX, arrowY, arrowX + (sheet.grainOrientation === 'vertical' ? 0 : arrowLen), arrowY + (sheet.grainOrientation === 'vertical' ? arrowLen : 0));
        // Arrowhead
        if (sheet.grainOrientation === 'vertical') {
          doc.line(arrowX, arrowY, arrowX - 1.2, arrowY + 2.2);
          doc.line(arrowX, arrowY, arrowX + 1.2, arrowY + 2.2);
        } else {
          doc.line(arrowX, arrowY, arrowX + 2.2, arrowY - 1.2);
          doc.line(arrowX, arrowY, arrowX + 2.2, arrowY + 1.2);
        }
        doc.setFont(BASE_FONT, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(60, 60, 60);
        if (sheet.grainOrientation === 'vertical') {
          drawText(cat.schema.grainDirectionLabel, arrowX + 1.5, arrowY + arrowLen / 2, { align: 'center', angle: 90 });
        } else {
          drawText(cat.schema.grainDirectionLabel, arrowX + arrowLen / 2, arrowY + 3.5, { align: 'center' });
        }
      }

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
          doc.setFont(BASE_FONT, 'normal');
          doc.setFontSize(Math.min(7.0, Math.max(4.0, Math.min(ow, oh) / 4.5)));
          doc.setTextColor(30, 41, 59);
          drawText(`${fmt(off.height)} × ${fmt(off.width)} ${displayUnit}`, ox + ow / 2, oy + oh / 2, {
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
        doc.setFont(BASE_FONT, 'normal');
        doc.setFontSize(Math.min(7.5, Math.max(4.2, Math.min(pw, ph) / 4)));
        doc.setTextColor(0, 0, 0);

        if (pw > 14 && ph > 6) {
          drawText(dimText, px + pw / 2, py + ph / 2, { align: 'center', baseline: 'middle' });
        } else if (ph > 9) {
          drawText(`${fmt(p.height)}\n×\n${fmt(p.width)}`, px + pw / 2, py + ph / 2 - 2, { align: 'center' });
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

    // A `Content-Disposition` header value must be a valid HTTP ByteString
    // (Latin-1 range only) — the artisan's free-typed `projectName` is not
    // guaranteed to be (an Arabic name, or any other non-ASCII text, would
    // otherwise throw constructing the Response and 500 the whole export).
    // The ASCII-only `filename` stays a safe fallback for older clients;
    // `filename*` (RFC 5987/6266) carries the exact project name, percent-
    // encoded, for every modern browser.
    const asciiProjectName =
      projectName
        .toUpperCase()
        .replace(/[^\x20-\x7E]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'EXPORT';
    const utf8FileName = `QatlIA_${projectName.toUpperCase().replace(/\s+/g, '_')}.pdf`;

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          `attachment; filename="QatlIA_${asciiProjectName}.pdf"; ` +
          `filename*=UTF-8''${encodeURIComponent(utf8FileName)}`,
      },
    });
  } catch (error: unknown) {
    // Locale isn't reliably known here (a malformed request body can throw
    // before `parsed.data.locale` is ever read), so this stays an internal,
    // English technical message — matching the `error` code above it
    // ('PDF_EXPORT_FAILED'), not customer-facing catalog copy. The detail
    // itself (which can carry a stack trace or other internal information)
    // is logged server-side only; the response body carries nothing but the
    // stable, machine-readable error code, never `error.message` — an
    // unhandled exception here must never leak internals to the caller.
    console.error('PDF_EXPORT_FAILED:', error);
    return NextResponse.json({ error: 'PDF_EXPORT_FAILED' }, { status: 500 });
  }
}
