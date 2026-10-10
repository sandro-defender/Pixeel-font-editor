/** Rasterize vector contours into a pixel grid (for the pixel editor). */
import { Bitmap, MAX_GRID } from './bitmap';
import { contourBoundsTight, createWindingTester } from './contours';
import type { Contour, PixelData } from './types';

export interface RasterizeOptions {
  gridWidth: number;
  gridHeight: number;
  /** Font units covered by one grid cell. */
  unitsPerCell: number;
  /** X of the grid's left edge in font units. */
  offsetX: number;
  /** Grid row (from bottom) where the baseline (y=0) sits. */
  baselineRow: number;
  /**
   * Probe grid per cell axis (default 3 → 9 probes per cell). Coverage
   * sampling keeps features thinner than one cell — hairlines, underscores,
   * minus signs, thin serifs — visible instead of letting them fall between
   * single centre probes and disappear.
   */
  samplesPerCell?: number;
  /**
   * How many probes must fall inside the outline for the cell to light
   * (default 2 of 9 ≈ 22% coverage: thin strokes survive, single-probe
   * noise at anti-aliased edges does not).
   */
  minSamples?: number;
}

/** Probe offsets inside a cell for `samples` subdivisions (0..1, centred). */
function probeOffsets(samples: number): number[] {
  const out: number[] = [];
  const step = 1 / samples;
  for (let i = 0; i < samples; i++) out.push((i + 0.5) * step);
  return out;
}

/** Rasterize into a fresh Bitmap (shared by the public helpers). */
function rasterizeToBitmap(contours: Contour[], opts: RasterizeOptions): Bitmap {
  const bm = new Bitmap(opts.gridWidth, opts.gridHeight);
  // 3 probes per axis is the default; the no-vanishing retry asks for far more
  // (up to 128) to reach ink that is thinner than a cell.
  const samples = Math.max(1, Math.min(128, Math.floor(opts.samplesPerCell ?? 3)));
  // default: ~22% coverage — thin strokes survive, single-probe noise does not
  const minSamples = Math.max(1, Math.floor(opts.minSamples ?? 2));
  if (contours.length) {
    const inside = createWindingTester(contours);
    const offs = probeOffsets(samples);
    const { unitsPerCell: u, offsetX, baselineRow } = opts;
    for (let y = 0; y < opts.gridHeight; y++) {
      for (let x = 0; x < opts.gridWidth; x++) {
        let hits = 0;
        for (let sy = 0; sy < samples && hits < minSamples; sy++) {
          const py = (y + offs[sy] - baselineRow) * u;
          for (let sx = 0; sx < samples; sx++) {
            if (inside(offsetX + (x + offs[sx]) * u, py) !== 0) {
              hits += 1;
              if (hits >= minSamples) break;
            }
          }
        }
        if (hits >= minSamples) bm.set(x, y, 1);
      }
    }
  }
  return bm;
}

/**
 * Sample the nonzero-winding fill of `contours` at every cell.
 * Returns the bitmap plus the full PixelData placement.
 */
export function rasterizeContours(contours: Contour[], opts: RasterizeOptions): PixelData {
  const bm = rasterizeToBitmap(contours, opts);
  return {
    width: opts.gridWidth,
    height: opts.gridHeight,
    cellsB64: bm.toB64(),
    unitsPerCell: opts.unitsPerCell,
    offsetX: opts.offsetX,
    baselineRow: opts.baselineRow,
  };
}

function litCount(pixel: PixelData): number {
  return Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64).count();
}

/**
 * Rasterize, but never let a glyph with ink come back empty: if the first pass
 * lights nothing (ink thinner than a probe spacing — hairlines, rules, stems),
 * the sampling is repeated with denser probe grids until something appears.
 *
 * The last pass is sized from the ink itself (`cell / thinnest feature`), so a
 * 4-unit stem inside a 125-unit cell is still hit by a probe instead of falling
 * between all of them.
 */
export function rasterizeContoursWithRetry(contours: Contour[], opts: RasterizeOptions): PixelData {
  const first = rasterizeContours(contours, opts);
  if (!contours.length || litCount(first) > 0) return first;
  const bb = contourBoundsTight(contours);
  if (!bb) return first;
  const thin = Math.min(bb.xMax - bb.xMin, bb.yMax - bb.yMin);
  const need = Math.ceil(Math.max(1e-6, opts.unitsPerCell) / Math.max(thin, 1e-6));
  // probe finely enough that one lands inside the thinnest feature, but keep
  // the total work bounded on large grids
  const budget = Math.floor(Math.sqrt(4_000_000 / Math.max(1, opts.gridWidth * opts.gridHeight)));
  const dense = Math.max(9, Math.min(128, need, budget));
  for (const samplesPerCell of [5, 9, dense]) {
    if (samplesPerCell <= 3) continue;
    const retry = rasterizeContours(contours, { ...opts, samplesPerCell, minSamples: 1 });
    if (litCount(retry) > 0) return retry;
  }
  return first;
}

export interface GlyphRasterResult {
  /** The frame that was used (its height may exceed the request for hairline glyphs). */
  frame: RasterizeOptions;
  pixel: PixelData;
  /** True when the probe density was raised so that thin ink stayed visible. */
  refined: boolean;
}

/**
 * Rasterize one glyph with the default frame for `gridHeight` rows.
 *
 * Guarantees that a glyph with ink never comes back empty: hairline stems
 * (thinner than a probe spacing) are re-sampled with a denser probe grid
 * until at least one cell lights, so nothing silently disappears.
 */
export function rasterizeGlyphContours(
  contours: Contour[],
  metrics: { ascent: number; descent: number },
  gridHeight: number,
): GlyphRasterResult {
  const frame = defaultRasterizeFrame(contours, metrics, gridHeight);
  const plain = rasterizeContours(contours, frame);
  if (!contours.length || litCount(plain) > 0) return { frame, pixel: plain, refined: false };
  const pixel = rasterizeContoursWithRetry(contours, frame);
  return { frame, pixel, refined: pixel !== plain };
}

/**
 * Default rasterization frame for a glyph.
 *
 * The frame is derived from the glyph's own ink (not from the font's
 * ascent/descent): the requested number of rows spans the ink height plus one
 * cell of margin, so thin strokes stay a full cell wide and nothing is clipped
 * away by line metrics that do not bracket the drawing. The baseline is placed
 * on the nearest row boundary — which may lie outside the grid for glyphs that
 * sit far from it (underscores, apostrophes); that keeps their ink in view
 * instead of sampling empty space.
 *
 * The previous ascent→descent frame made every cell far larger than the
 * glyph's features: underscores, hyphens and hairlines fell between the
 * sampled cell centres and vanished, and for fonts whose hhea metrics do not
 * bracket the ink (tiny ascent, ink above the ascent) whole letters
 * disappeared.
 */
export function defaultRasterizeFrame(
  contours: Contour[],
  metrics: { ascent: number; descent: number },
  gridHeight: number,
): RasterizeOptions {
  const requested = Math.max(2, Math.min(MAX_GRID, Math.round(gridHeight)));
  const bb = contourBoundsTight(contours);
  if (!bb) {
    // nothing to draw (space, .notdef): fall back to the font's line metrics
    return emFrame(metrics, requested);
  }
  const inkH = Math.max(1e-6, bb.yMax - bb.yMin);
  const inkW = Math.max(0, bb.xMax - bb.xMin);
  // Prefer a span that also contains the baseline: it keeps the baseline guide
  // visible for glyphs that sit just below or above it (underscore, quotes,
  // parentheses). Marks that live far from the baseline (accents, apostrophes)
  // would need a grid mostly filled with empty rows, so those keep an
  // ink-only span and simply record where the baseline is.
  const spanWithBaseline = Math.max(bb.yMax, 0) - Math.min(bb.yMin, 0);
  const withBaseline = spanWithBaseline <= inkH * 3;
  const top = withBaseline ? Math.max(bb.yMax, 0) : bb.yMax;
  const bottom = withBaseline ? Math.min(bb.yMin, 0) : bb.yMin;
  // A glyph much narrower than it is tall (hairline stems) would need cells
  // wider than its own ink; use more rows — up to the grid limit — so the thin
  // direction still gets resolved instead of falling between the probes.
  const aspectRows = inkW > 0 ? Math.ceil(inkH / inkW) + 1 : 0;
  const rows = Math.min(MAX_GRID, Math.max(requested, aspectRows));
  // rows cover the span plus one cell of margin (half a cell above and below)
  let unitsPerCell = Math.max(1e-6, top - bottom) / (rows - 1);
  // a very wide glyph must still fit the hard grid limit: coarsen the cells instead of clipping
  if (inkW > 0) unitsPerCell = Math.max(unitsPerCell, inkW / (MAX_GRID - 1));
  // baseline on a row boundary just below the span; it may sit outside the grid
  const baselineRow = Math.round(-bottom / unitsPerCell);
  // left edge on a cell boundary at least half a cell left of the ink
  const offsetX = Math.round(Math.floor((bb.xMin - unitsPerCell / 2) / unitsPerCell) * unitsPerCell);
  // Enough columns to reach the right edge of the ink: the ink can start up to
  // a cell right of offsetX, so deriving the width from the ink width alone can
  // stop one column short (a hairline then falls outside the grid entirely).
  const gridWidth = Math.max(1, Math.min(MAX_GRID, Math.ceil((bb.xMax - offsetX) / unitsPerCell)));
  return { gridWidth, gridHeight: rows, unitsPerCell, offsetX, baselineRow };
}

/** Frame covering the whole em (used when the glyph has no ink at all). */
function emFrame(metrics: { ascent: number; descent: number }, rows: number): RasterizeOptions {
  const span = Math.max(1, metrics.ascent - metrics.descent);
  const unitsPerCell = span / rows;
  const baselineRow = Math.round(-metrics.descent / unitsPerCell);
  const gridWidth = Math.max(1, Math.min(MAX_GRID, 8));
  return { gridWidth, gridHeight: rows, unitsPerCell, offsetX: 0, baselineRow };
}
