import { NextResponse } from 'next/server';
import { z } from 'zod';

const DxfSchema = z.object({
  projectName: z.string().default('QatlIA_Plan'),
  sheet: z.object({
    width: z.number(),
    height: z.number(),
  }),
  placedPieces: z.array(
    z.object({
      pieceNumber: z.number(),
      name: z.string(),
      sheetIndex: z.number(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
  ),
});

/**
 * Générateur DXF (AutoCAD R12 ASCII) pour machines CNC et découpeuses laser / scies numériques
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = DxfSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.format() }, { status: 400 });
    }

    const { projectName, sheet, placedPieces } = parsed.data;

    let dxf = '';

    // HEADER
    dxf += '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n';

    // TABLES (Layers)
    dxf += '0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n';
    // Layer Sheet (Cyan)
    dxf += '0\nLAYER\n2\nPANNEAU\n70\n0\n62\n4\n6\nCONTINUOUS\n';
    // Layer Cuts (Red/White)
    dxf += '0\nLAYER\n2\nDECOUPES\n70\n0\n62\n1\n6\nCONTINUOUS\n';
    // Layer Labels (Yellow)
    dxf += '0\nLAYER\n2\nTEXTE\n70\n0\n62\n2\n6\nCONTINUOUS\n';
    dxf += '0\nENDTAB\n0\nENDSEC\n';

    // ENTITIES
    dxf += '0\nSECTION\n2\nENTITIES\n';

    // Group pieces by sheet
    const maxSheetIndex = placedPieces.reduce((max, p) => Math.max(max, p.sheetIndex), 0);

    for (let s = 0; s <= maxSheetIndex; s++) {
      const offsetX = s * (sheet.width + 50); // décalage de 50cm entre panneaux dans le fichier DXF

      // Draw Sheet Contour
      dxf += '0\nPOLYLINE\n8\nPANNEAU\n66\n1\n70\n1\n';
      const corners = [
        [offsetX, 0],
        [offsetX + sheet.width, 0],
        [offsetX + sheet.width, sheet.height],
        [offsetX, sheet.height],
      ];
      for (const [cx, cy] of corners) {
        dxf += `0\nVERTEX\n8\nPANNEAU\n10\n${cx}\n20\n${cy}\n30\n0.0\n`;
      }
      dxf += '0\nSEQEND\n';

      // Draw Placed Pieces
      const sheetPieces = placedPieces.filter((p) => p.sheetIndex === s);
      for (const p of sheetPieces) {
        const px = offsetX + p.x;
        const py = p.y;

        // Rectangle Polyline
        dxf += '0\nPOLYLINE\n8\nDECOUPES\n66\n1\n70\n1\n';
        const pCorners = [
          [px, py],
          [px + p.width, py],
          [px + p.width, py + p.height],
          [px, py + p.height],
        ];
        for (const [cx, cy] of pCorners) {
          dxf += `0\nVERTEX\n8\nDECOUPES\n10\n${cx}\n20\n${cy}\n30\n0.0\n`;
        }
        dxf += '0\nSEQEND\n';

        // Label Text
        const textX = px + p.width / 2;
        const textY = py + p.height / 2;
        dxf += `0\nTEXT\n8\nTEXTE\n10\n${textX}\n20\n${textY}\n30\n0.0\n40\n4.0\n1\n#${p.pieceNumber} (${p.width}x${p.height})\n`;
      }
    }

    dxf += '0\nENDSEC\n0\nEOF\n';

    return new Response(dxf, {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf',
        'Content-Disposition': `attachment; filename="qatlia_${projectName.toLowerCase().replace(/\s+/g, '_')}.dxf"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur génération DXF';
    return NextResponse.json({ error: 'DXF_EXPORT_FAILED', message }, { status: 500 });
  }
}
