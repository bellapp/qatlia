import { NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { z } from 'zod';

const ExportSchema = z.object({
  projectName: z.string().default('Projet Découpe'),
  material: z.string().default('MDF'),
  sheet: z.object({
    width: z.number(),
    height: z.number(),
    kerf: z.number().default(0.4),
    margin: z.number().default(1.0),
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ExportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_DATA', details: parsed.error.format() }, { status: 400 });
    }

    const { projectName, material, sheet, result } = parsed.data;

    // Création document PDF A4 Paysage pour le schéma
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // 1. En-tête Header
    doc.setFillColor(30, 58, 95); // #1E3A5F
    doc.rect(0, 0, pageWidth, 22, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('QatlIA — Plan d\'Optimisation de Découpe', 14, 14);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Projet : ${projectName} • Matériau : ${material.toUpperCase()}`, pageWidth - 14, 14, { align: 'right' });

    // 2. Bloc Statistiques et Spécifications
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Format Panneau : ${sheet.width} × ${sheet.height} cm  |  Trait de scie : ${sheet.kerf} cm  |  Sens veinage : ${sheet.grainDirection ? 'Respecté' : 'Libre'}`,
      14,
      30
    );

    doc.text(
      `Feuilles utilisées : ${result.sheetsUsed}  |  Taux de chute : ${result.wastePercentage}%  |  Surface utile : ${(100 - result.wastePercentage).toFixed(1)}%  |  Pièces : ${result.placedPieces.length}`,
      14,
      36
    );

    // 3. Tableau des Pièces (AutoTable)
    const tableData = result.placedPieces.map((p) => [
      `#${p.pieceNumber}`,
      p.name,
      `Panneau ${p.sheetIndex + 1}`,
      `${p.width} cm`,
      `${p.height} cm`,
      p.rotated ? 'Oui' : 'Non',
      `${(p.width * p.height / 10000).toFixed(3)} m²`,
    ]);

    autoTable(doc, {
      startY: 42,
      head: [['N°', 'Nom de la pièce', 'Feuille', 'Longueur', 'Largeur', 'Tourné', 'Surface']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 58, 95],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
      },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
      },
      margin: { left: 14, right: 14 },
    });

    // 4. Pages Schémas Visuels : Générer UNE PAGE PAR FEUILLE / PANNEAU
    const colors = [
      [56, 189, 248], // Sky Blue
      [245, 166, 35], // Amber
      [52, 211, 153], // Emerald
      [248, 113, 113], // Red
      [167, 139, 250], // Purple
      [251, 191, 36], // Gold
      [45, 212, 191], // Teal
      [129, 140, 248], // Indigo
    ];

    for (let sheetIdx = 0; sheetIdx < result.sheetsUsed; sheetIdx++) {
      doc.addPage('a4', 'landscape');

      // Header du panneau
      doc.setFillColor(30, 58, 95);
      doc.rect(0, 0, pageWidth, 16, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`Schéma Visuel — ${projectName} (Panneau ${sheetIdx + 1} / ${result.sheetsUsed})`, 14, 11);

      const sheetPieces = result.placedPieces.filter((p) => p.sheetIndex === sheetIdx);
      const sheetAreaUsed = sheetPieces.reduce((sum, p) => sum + p.width * p.height, 0);
      const sheetTotalArea = sheet.width * sheet.height;
      const sheetWaste = Math.max(0, Math.round(((sheetTotalArea - sheetAreaUsed) / sheetTotalArea) * 1000) / 10);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Pièces sur ce panneau : ${sheetPieces.length}  |  Chute : ${sheetWaste}%  |  Format : ${sheet.width} × ${sheet.height} cm`,
        pageWidth - 14,
        11,
        { align: 'right' }
      );

      // Zone de dessin à l'échelle
      const canvasX = 20;
      const canvasY = 26;
      const maxDrawWidth = pageWidth - 40;
      const maxDrawHeight = pageHeight - 40;

      const scale = Math.min(maxDrawWidth / sheet.width, maxDrawHeight / sheet.height);
      const drawW = sheet.width * scale;
      const drawH = sheet.height * scale;

      // Panneau brut
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(71, 85, 105);
      doc.setLineWidth(0.5);
      doc.rect(canvasX, canvasY, drawW, drawH, 'FD');

      // Découpes de ce panneau
      sheetPieces.forEach((p) => {
        const px = canvasX + p.x * scale;
        const py = canvasY + p.y * scale;
        const pw = p.width * scale;
        const ph = p.height * scale;
        const c = colors[(p.pieceNumber - 1) % colors.length];

        doc.setFillColor(c[0], c[1], c[2]);
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.3);
        doc.rect(px, py, pw, ph, 'FD');

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(Math.min(9, Math.max(5, ph / 2.5)));
        doc.setFont('helvetica', 'bold');
        doc.text(`#${p.pieceNumber}`, px + pw / 2, py + ph / 2 - 1, { align: 'center' });
        doc.setFontSize(Math.min(7, Math.max(4, ph / 3.5)));
        doc.text(`${p.width}×${p.height}`, px + pw / 2, py + ph / 2 + 3, { align: 'center' });
      });
    }

    const pdfBuffer = doc.output('arraybuffer');

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="qatlia-${projectName.toLowerCase().replace(/\s+/g, '_')}.pdf"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur export PDF';
    return NextResponse.json({ error: 'PDF_EXPORT_FAILED', message }, { status: 500 });
  }
}
