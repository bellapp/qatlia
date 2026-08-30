import { z } from 'zod';

export const DxfSchema = z.object({
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
  /**
   * Unit contract for this route: every geometry coordinate written below
   * (POLYLINE/VERTEX/TEXT position) is always canonical centimetres, because
   * CNC/laser machines reading this file expect one consistent, unambiguous
   * unit — `displayUnit` never rescales it. This field is metadata only: it
   * picks the unit `fromCanonicalCm` uses to render the human-readable piece
   * label text (e.g. "#1 (500.0x300.0 mm)"), so the artisan's on-screen
   * choice is legible on the plan without touching machine coordinates.
   */
  displayUnit: z.enum(['cm', 'mm']).optional().default('cm'),
});
