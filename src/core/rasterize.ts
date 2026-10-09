/** Rasterize vector contours into a pixel grid (for the pixel editor). */
import { Bitmap } from './bitmap';
import { windingNumber } from './contours';
import type { Contour, GlyphDoc, PixelData } from './types';

export interface RasterizeOptions {
  gridWidth: number;
  gridHeight: number;
  /** Font units covered by one grid cell. */
  unitsPerCell: number;
  /** X of the grid's left edge in font units. */
  offsetX: number;
  /** Grid row (from bottom) where the baseline (y=0) sits. */
  baselineRow: number;
}

/**
 * Sample the nonzero-winding fill of `contours` at every cell centre.
 * Returns the bitmap plus the full PixelData placement.
 */
export function rasterizeContours(contours: Contour[], opts: RasterizeOptions): PixelData {
  const bm = new Bitmap(opts.gridWidth, opts.gridHeight);
  for (let y = 0; y < opts.gridHeight; y++) {
    for (let x = 0; x < opts.gridWidth; x++) {
      const px = opts.offsetX + (x + 0.5) * opts.unitsPerCell;
      const py = (y + 0.5 - opts.baselineRow) * opts.unitsPerCell;
      if (windingNumber(contours, px, py) !== 0) bm.set(x, y, 1);
    }
  }
  return {
    width: opts.gridWidth,
    height: opts.gridHeight,
    cellsB64: bm.toB64(),
    unitsPerCell: opts.unitsPerCell,
    offsetX: opts.offsetX,
    baselineRow: opts.baselineRow,
  };
}

/**
 * Default rasterization frame for a glyph: vertical span covers the font's
 * ascent→descent, horizontal span covers the glyph bbox (+1 cell margin).
 */
export function defaultRasterizeFrame(
  contours: Contour[],
  metrics: { ascent: number; descent: number },
  gridHeight: number,
): RasterizeOptions {
  const span = Math.max(1, metrics.ascent - metrics.descent);
  const unitsPerCell = span / gridHeight;
  const baselineRow = Math.round(-metrics.descent / unitsPerCell);
  let minX = 0;
  let maxX = unitsPerCell * 8;
  if (contours.length) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of contours) {
      for (const p of c) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
    }
    if (Number.isFinite(lo)) {
      minX = Math.floor(lo / unitsPerCell) * unitsPerCell - unitsPerCell;
      maxX = Math.ceil(hi / unitsPerCell) * unitsPerCell + unitsPerCell;
    }
  }
  const gridWidth = Math.max(1, Math.min(128, Math.round((maxX - minX) / unitsPerCell)));
  return { gridWidth, gridHeight, unitsPerCell, offsetX: minX, baselineRow };
}

/** Resolve the drawable contours of any glyph (flattens compounds not handled here). */
export function glyphContours(glyph: GlyphDoc): Contour[] {
  if (glyph.kind === 'vector' || glyph.kind === 'compound') return glyph.contours;
  return [];
}
