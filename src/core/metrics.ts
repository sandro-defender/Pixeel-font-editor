/**
 * Horizontal metric math for the visual advance / bearings editor.
 *
 * Model (identical for pixel and vector glyphs):
 *   - `lsb`      distance from the glyph origin (x = 0) to the left edge of the
 *                glyph "box" (pixel glyph: left edge of the grid, i.e. offsetX;
 *                vector glyph: left edge of the outline bounds).
 *   - `advance`  distance from the origin to the next glyph's origin.
 *   - RSB        advance − lsb − boxWidth.
 *
 * Dragging the ORIGIN line moves the origin relative to the glyph while the
 * advance line stays put relative to the glyph (so RSB is unchanged and LSB
 * changes). Dragging the ADVANCE line only changes the advance (so RSB changes).
 */

import type { GlyphDoc } from './types';
import { contourBounds } from './contours';

export const MAX_ADVANCE = 0xffff;
export const MAX_BEARING = 0x7fff;

export interface HMetrics {
  advance: number;
  lsb: number;
}

export interface SnapOptions {
  /** Snap results onto the grid defined by `step`. */
  snap: boolean;
  /** Grid step in font units (pixel glyphs: unitsPerCell). */
  step: number;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Round to the nearest multiple of `step` (plain rounding when step is not positive). */
export function snapToGrid(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!(step > 0)) return Math.round(value);
  // `+ 0` normalises -0
  return Math.round(value / step) * step + 0;
}

/** Right side bearing; `glyphWidth` is the width of the glyph box (grid width or outline width). */
export function computeRSB(advance: number, lsb: number, glyphWidth: number): number {
  return advance - lsb - glyphWidth;
}

/** Convert a horizontal distance in grid cells into font units. */
export const cellsToUnits = (cells: number, unitsPerCell: number): number => cells * unitsPerCell;

/**
 * A readable snap step for outline glyphs: the "nice" number nearest to
 * unitsPerEm / 50 (1000 → 20, 2048 → 50, 1024 → 20, 16 → 1).
 */
export function vectorSnapStep(unitsPerEm: number): number {
  const target = Math.max(1, unitsPerEm / 50);
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  let best = nice[0];
  for (const n of nice) if (Math.abs(n - target) < Math.abs(best - target)) best = n;
  return best;
}

/** Drag the advance line by `deltaUnits` (positive = right). The LSB is untouched. */
export function dragAdvance(start: HMetrics, deltaUnits: number, opts: SnapOptions): HMetrics {
  const raw = start.advance + deltaUnits;
  // the advance line sits on a grid line when (advance − lsb) is a multiple of the step
  const value = opts.snap ? start.lsb + snapToGrid(raw - start.lsb, opts.step) : raw;
  return { advance: clamp(Math.round(value), 0, MAX_ADVANCE), lsb: start.lsb };
}

/**
 * Drag the origin line by `deltaUnits` (positive = right, relative to the
 * glyph). The LSB shrinks by that amount and the advance shifts with it so the
 * advance line (and therefore RSB) stays where it was relative to the glyph.
 */
export function dragOrigin(start: HMetrics, deltaUnits: number, opts: SnapOptions): HMetrics {
  const rawLsb = start.lsb - deltaUnits;
  let lsb = opts.snap ? snapToGrid(rawLsb, opts.step) : rawLsb;
  lsb = clamp(Math.round(lsb), -MAX_BEARING, MAX_BEARING);
  let advance = start.advance + (lsb - start.lsb);
  if (advance < 0) {
    advance = 0;
    lsb = start.lsb - start.advance;
  } else if (advance > MAX_ADVANCE) {
    advance = MAX_ADVANCE;
    lsb = start.lsb + (MAX_ADVANCE - start.advance);
  }
  return { advance, lsb };
}

export const sameMetrics = (a: HMetrics, b: HMetrics): boolean => a.advance === b.advance && a.lsb === b.lsb;

/**
 * Width of the glyph "box" the bearings are measured against: the grid width
 * for a pixel glyph, the outline's bounding width for a vector glyph, else 0.
 */
export function glyphBoxWidth(glyph: Pick<GlyphDoc, 'kind' | 'pixel' | 'contours'>): number {
  if (glyph.kind === 'pixel' && glyph.pixel) return glyph.pixel.width * glyph.pixel.unitsPerCell;
  const bb = glyph.contours.length ? contourBounds(glyph.contours) : null;
  return bb ? bb.xMax - bb.xMin : 0;
}
