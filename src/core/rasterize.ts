/**
 * Rasterize vector contours into a pixel grid.
 *
 * Why this file was rewritten
 * ---------------------------
 * The old rasterizer sampled 9 points per cell and lit a cell when 2 of them
 * landed inside the outline. That is wrong in two ways that made converted
 * fonts unusable:
 *
 *  1. **Probe counting is not coverage.** A cell that is 20 % covered could
 *     light (two probes happened to land inside) while one that is 60 %
 *     covered could stay dark. Stroke weight drifted glyph to glyph.
 *  2. **The frame was sized from each glyph's own ink height.** Every glyph in
 *     a font therefore got a *different* cell size and a *different* baseline
 *     row: an `i` and a `g` converted from the same font no longer lined up,
 *     and a wide flat glyph (hyphen, underscore, macron) produced cells so
 *     tiny that its ink flooded a 50-column grid.
 *
 * This implementation instead
 *
 *  - computes the **exact area coverage** of every cell (Sutherland–Hodgman
 *    clip of the outline against the cell rectangle + shoelace area), so a
 *    cell's value is the true ink fraction 0..1;
 *  - lights a cell at **majority coverage** (default 0.5), the standard
 *    box-filter downsample, which preserves stroke weight;
 *  - guarantees a glyph with ink never comes back empty (thin-feature rescue);
 *  - derives its frame from a **font-wide grid** (see `pixelGrid.ts`) so every
 *    glyph of a font shares one cell size and one baseline row.
 */
import { Bitmap, MAX_GRID } from './bitmap';
import { contourBoundsTight, contourToSegments } from './contours';
import type { Contour, PixelData } from './types';

export interface RasterizeOptions {
  gridWidth: number;
  gridHeight: number;
  /** Font units covered by one grid cell (the pixel size). */
  unitsPerCell: number;
  /** X (font units) of the left edge of column 0. */
  offsetX: number;
  /** Grid row (from the bottom) on which the baseline (y = 0) sits. */
  baselineRow: number;
  /**
   * Ink fraction needed to light a cell (default 0.5 = majority coverage).
   * 0.5 is a box filter: it keeps the rendered stroke weight of the original.
   */
  threshold?: number;
  /** Curve flattening tolerance, in font units (default: cell / 32). */
  tolerance?: number;
}

// ---------------------------------------------------------------------------
// Outline flattening
// ---------------------------------------------------------------------------

/** Flat closed polygon: [x0, y0, x1, y1, ...]. */
export type Poly = number[];

/** Max distance between a quadratic and its chord. */
function quadDeviation(fromX: number, fromY: number, cx: number, cy: number, toX: number, toY: number): number {
  // B(t) − chord(t) = −t(1−t)·(P0 − 2P1 + P2); the maximum is at t = ½.
  const ax = fromX - 2 * cx + toX;
  const ay = fromY - 2 * cy + toY;
  return Math.hypot(ax, ay) / 4;
}

/** Flatten one contour into a closed polygon with a chord tolerance. */
export function flattenContour(contour: Contour, tolerance: number): Poly {
  const segs = contourToSegments(contour);
  if (!segs.length) return [];
  const tol = Math.max(1e-6, tolerance);
  const out: Poly = [segs[0].from.x, segs[0].from.y];
  for (const s of segs) {
    if (!s.ctrl) {
      out.push(s.to.x, s.to.y);
      continue;
    }
    const dev = quadDeviation(s.from.x, s.from.y, s.ctrl.x, s.ctrl.y, s.to.x, s.to.y);
    // deviation of a curve split into n pieces is ≈ dev / n²
    const steps = dev > tol ? Math.min(64, Math.max(2, Math.ceil(Math.sqrt(dev / tol)))) : 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      out.push(
        mt * mt * s.from.x + 2 * mt * t * s.ctrl!.x + t * t * s.to.x,
        mt * mt * s.from.y + 2 * mt * t * s.ctrl!.y + t * t * s.to.y,
      );
    }
  }
  const n = out.length / 2;
  if (n >= 3 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out.length >= 6 ? out : [];
}

/** Flatten every contour; degenerate ones are dropped. */
export function flattenContours(contours: Contour[], tolerance: number): Poly[] {
  const out: Poly[] = [];
  for (const c of contours) {
    const p = flattenContour(c, tolerance);
    if (p.length >= 6) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Polygon clipping (Sutherland–Hodgman) and signed area
// ---------------------------------------------------------------------------

/** Clip a polygon against the half-plane `nx·x + ny·y ≥ c`. */
export function clipHalfPlane(src: Poly, nx: number, ny: number, c: number): Poly {
  const n = src.length / 2;
  if (n < 3) return [];
  const out: Poly = [];
  let px = src[(n - 1) * 2];
  let py = src[(n - 1) * 2 + 1];
  let pd = nx * px + ny * py - c;
  for (let i = 0; i < n; i++) {
    const qx = src[i * 2];
    const qy = src[i * 2 + 1];
    const qd = nx * qx + ny * qy - c;
    if (qd >= 0) {
      if (pd < 0) {
        const t = pd / (pd - qd);
        out.push(px + t * (qx - px), py + t * (qy - py));
      }
      out.push(qx, qy);
    } else if (pd >= 0) {
      const t = pd / (pd - qd);
      out.push(px + t * (qx - px), py + t * (qy - py));
    }
    px = qx;
    py = qy;
    pd = qd;
  }
  return out;
}

/** Signed area (shoelace) of a closed polygon; positive when counter-clockwise. */
export function polyArea(p: Poly): number {
  const n = p.length / 2;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}

// ---------------------------------------------------------------------------
// Exact coverage
// ---------------------------------------------------------------------------

/**
 * Exact ink coverage (0..1) of every cell of the grid.
 *
 * Rows are clipped once against the outline (cheap) and then each column of
 * that band is clipped separately, so the cost is O(rows·E + cells·E_band)
 * rather than O(cells·E).
 */
export function rasterizeCoverage(contours: Contour[], opts: RasterizeOptions): Float64Array {
  const { gridWidth: W, gridHeight: H, unitsPerCell: u, offsetX, baselineRow } = opts;
  const cov = new Float64Array(W * H);
  if (!contours.length || W <= 0 || H <= 0 || !(u > 0)) return cov;
  const polys = flattenContours(contours, opts.tolerance ?? u / 32);
  if (!polys.length) return cov;
  const cellArea = u * u;
  // TrueType draws outer contours clockwise and counters the other way, so a
  // glyph's signed area can come out negative. The non-zero fill rule only
  // cares that counters cancel outer areas, not which sign that happens in —
  // normalize the winding once, per glyph, instead of per cell.
  let total = 0;
  for (const p of polys) total += polyArea(p);
  const sign = total < 0 ? -1 : 1;

  for (let row = 0; row < H; row++) {
    const yA = (row - baselineRow) * u;
    const yB = yA + u;
    // 1. clip every contour to this horizontal band
    const bands: Poly[] = [];
    let bx0 = Infinity;
    let bx1 = -Infinity;
    for (const poly of polys) {
      let p = clipHalfPlane(poly, 0, 1, yA);
      if (p.length < 6) continue;
      p = clipHalfPlane(p, 0, -1, -yB);
      if (p.length < 6) continue;
      bands.push(p);
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < bx0) bx0 = p[i];
        if (p[i] > bx1) bx1 = p[i];
      }
    }
    if (!bands.length) continue;
    // 2. only the columns the band actually reaches can hold ink
    let c0 = Math.floor((bx0 - offsetX) / u);
    let c1 = Math.floor((bx1 - offsetX) / u);
    if (c1 < 0 || c0 >= W) continue;
    if (c0 < 0) c0 = 0;
    if (c1 > W - 1) c1 = W - 1;
    for (let col = c0; col <= c1; col++) {
      const xA = offsetX + col * u;
      const xB = xA + u;
      let area = 0;
      for (const band of bands) {
        let p = clipHalfPlane(band, 1, 0, xA);
        if (p.length < 6) continue;
        p = clipHalfPlane(p, -1, 0, -xB);
        if (p.length < 6) continue;
        area += polyArea(p);
      }
      if (area !== 0) cov[row * W + col] += (area / cellArea) * sign;
    }
  }
  // overlapping same-direction contours could overshoot; the fill is 0..1
  for (let i = 0; i < cov.length; i++) {
    if (cov[i] < 0) cov[i] = 0;
    else if (cov[i] > 1) cov[i] = 1;
  }
  return cov;
}

export interface CoverageStats {
  /** Total ink area, in cells. */
  ink: number;
  /** Lit cells after thresholding. */
  lit: number;
  /** True when the rescue rule had to fire (ink thinner than half a cell). */
  rescued: boolean;
  /**
   * Graininess of the fit: the share of the ink that is *not* cleanly resolved
   * (0 = every cell is either empty or completely full). Used to recognise
   * genuine pixel fonts.
   */
  grayness: number;
}

/**
 * Turn coverage into a bitmap.
 *
 * A cell lights at `threshold` coverage — a box filter, so the downsampled
 * glyph keeps the weight of the original. If *nothing* reaches the threshold
 * but the glyph does have ink (a hairline thinner than half a cell), the
 * best-covered cells light anyway: a glyph must never silently disappear.
 */
export function coverageToBitmap(
  cov: Float64Array,
  width: number,
  height: number,
  threshold = 0.5,
): { bitmap: Bitmap; stats: CoverageStats } {
  const bm = new Bitmap(Math.max(1, width), Math.max(1, height));
  let ink = 0;
  let maxCov = 0;
  let gray = 0;
  for (let i = 0; i < cov.length; i++) {
    const c = cov[i];
    if (c <= 0) continue;
    ink += c;
    gray += Math.min(c, 1 - c);
    if (c > maxCov) maxCov = c;
  }
  const grayness = ink > 0 ? gray / ink : 0;
  if (ink === 0) return { bitmap: bm, stats: { ink: 0, lit: 0, rescued: false, grayness: 0 } };

  let lit = 0;
  if (maxCov >= threshold) {
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        if (cov[y * bm.width + x] >= threshold) {
          bm.set(x, y, 1);
          lit++;
        }
      }
    }
    return { bitmap: bm, stats: { ink, lit, rescued: false, grayness } };
  }
  // thin-feature rescue: keep the most covered cells so the ink is represented
  const cut = maxCov * 0.6;
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if (cov[y * bm.width + x] >= cut) {
        bm.set(x, y, 1);
        lit++;
      }
    }
  }
  return { bitmap: bm, stats: { ink, lit, rescued: true, grayness } };
}

/** Rasterize into a fresh Bitmap (shared by the public helpers). */
function rasterizeToBitmap(
  contours: Contour[],
  opts: RasterizeOptions,
): { bitmap: Bitmap; stats: CoverageStats } {
  const cov = rasterizeCoverage(contours, opts);
  return coverageToBitmap(cov, opts.gridWidth, opts.gridHeight, opts.threshold ?? 0.5);
}

/**
 * Sample the nonzero-winding fill of `contours` at every cell.
 * Returns the bitmap plus the full PixelData placement.
 */
export function rasterizeContours(contours: Contour[], opts: RasterizeOptions): PixelData {
  const { bitmap } = rasterizeToBitmap(contours, opts);
  return {
    width: opts.gridWidth,
    height: opts.gridHeight,
    cellsB64: bitmap.toB64(),
    unitsPerCell: opts.unitsPerCell,
    offsetX: opts.offsetX,
    baselineRow: opts.baselineRow,
  };
}

/** Detailed result of one glyph rasterization. */
export interface GlyphRaster {
  pixel: PixelData;
  bitmap: Bitmap;
  stats: CoverageStats;
}

/** Rasterize and also report coverage statistics (used by the converters). */
export function rasterizeDetailed(contours: Contour[], opts: RasterizeOptions): GlyphRaster {
  const { bitmap, stats } = rasterizeToBitmap(contours, opts);
  return {
    pixel: {
      width: opts.gridWidth,
      height: opts.gridHeight,
      cellsB64: bitmap.toB64(),
      unitsPerCell: opts.unitsPerCell,
      offsetX: opts.offsetX,
      baselineRow: opts.baselineRow,
    },
    bitmap,
    stats,
  };
}

/**
 * Backwards-compatible alias.
 *
 * The old name promised a "retry with denser probes"; coverage rasterization
 * resolves thin ink on the first pass, so there is nothing left to retry — but
 * the guarantee it existed for ("a glyph with ink never comes back empty") is
 * now built into `coverageToBitmap`.
 */
export function rasterizeContoursWithRetry(contours: Contour[], opts: RasterizeOptions): PixelData {
  return rasterizeContours(contours, opts);
}

// ---------------------------------------------------------------------------
// Frame selection for a single glyph (no font context)
// ---------------------------------------------------------------------------

export interface GlyphRasterResult {
  /** The frame that was used, with the requested height (within grid limits). */
  frame: RasterizeOptions;
  pixel: PixelData;
  /** True when the thin-feature rescue had to light sub-threshold cells. */
  refined: boolean;
}

/**
 * Exported pixel fonts have straight, axis-aligned edges on a square lattice.
 * When that lattice fits the requested height exactly, keep its phase and
 * scale instead of adding the margin used for arbitrary vector outlines.
 * Otherwise an 8-row design is squeezed into 7 rows and its one-cell strokes
 * straddle neighbouring cells. Test every edge (including closing edges), not
 * just the bounds: curved or off-grid outlines still use coverage sampling.
 */
function pixelAlignedFrame(contours: Contour[], rows: number): RasterizeOptions | null {
  const bb = contourBoundsTight(contours);
  if (!bb || bb.yMax <= bb.yMin || bb.xMax <= bb.xMin) return null;
  const u = (bb.yMax - bb.yMin) / rows;
  if (!(u > 0)) return null;
  const onGrid = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i];
      const next = contour[(i + 1) % contour.length];
      if (!p.onCurve || (p.x !== next.x && p.y !== next.y) ||
          !onGrid((p.x - bb.xMin) / u) || !onGrid((p.y - bb.yMin) / u)) return null;
    }
  }
  const width = Math.round((bb.xMax - bb.xMin) / u);
  if (width < 1 || width > MAX_GRID) return null;
  return {
    gridWidth: width,
    gridHeight: rows,
    unitsPerCell: u,
    offsetX: bb.xMin,
    // Preserve placement even for shifted outlines / fractional font units.
    baselineRow: -bb.yMin / u,
  };
}

/**
 * Default rasterization frame for one glyph when no font-wide grid is known.
 *
 * The cell size is driven by the **larger** ink dimension, not by the ink
 * height alone: sizing from the height made wide, flat glyphs (hyphen,
 * underscore, macron, ogonek) produce cells far smaller than their own strokes
 * and flood a grid dozens of columns wide.
 *
 * Pixel outlines that exactly fit the requested grid keep their native lattice
 * without padding, so 16px with 2px strokes becomes 8px with 1px strokes.
 */
export function defaultRasterizeFrame(
  contours: Contour[],
  metrics: { ascent: number; descent: number },
  gridHeight: number,
): RasterizeOptions {
  const requested = Math.max(2, Math.min(MAX_GRID, Math.round(gridHeight)));
  const aligned = pixelAlignedFrame(contours, requested);
  if (aligned) return aligned;
  const bb = contourBoundsTight(contours);
  if (!bb) {
    // nothing to draw (space, .notdef): fall back to the font's line metrics
    return emFrame(metrics, requested);
  }
  const inkH = Math.max(1e-6, bb.yMax - bb.yMin);
  const inkW = Math.max(0, bb.xMax - bb.xMin);
  // Keep the baseline in view for glyphs that sit just below or above it
  // (underscore, quotes, parentheses). Marks that live far from the baseline
  // (accents) would need a grid mostly filled with empty rows, so those keep
  // an ink-only span and simply record where the baseline is.
  const nearBaseline = (v: number) => Math.abs(v) <= inkH * 3;
  const top = nearBaseline(bb.yMax) ? Math.max(bb.yMax, 0) : bb.yMax;
  const bottom = nearBaseline(bb.yMin) ? Math.min(bb.yMin, 0) : bb.yMin;
  const span = Math.max(1e-6, top - bottom);
  // `rows - 2` cells carry the ink, leaving one cell of margin above and below
  const inner = Math.max(1, requested - 2);
  // the larger ink dimension decides the cell size, so flat glyphs stay narrow
  let unitsPerCell = Math.max(span, inkW) / inner;
  // a very wide glyph must still fit the hard grid limit: coarsen, never clip
  if (inkW > 0) unitsPerCell = Math.max(unitsPerCell, inkW / (MAX_GRID - 2));
  // baseline on a row boundary; it may sit outside the grid
  const baselineRow = Math.round(-bottom / unitsPerCell);
  // left edge on a cell boundary at least one cell left of the ink
  const offsetX = Math.floor((bb.xMin - unitsPerCell) / unitsPerCell) * unitsPerCell;
  const gridWidth = Math.max(1, Math.min(MAX_GRID, Math.ceil((bb.xMax - offsetX) / unitsPerCell) + 1));
  return { gridWidth, gridHeight: requested, unitsPerCell, offsetX, baselineRow };
}

/** Frame covering the whole em (used when the glyph has no ink at all). */
function emFrame(metrics: { ascent: number; descent: number }, rows: number): RasterizeOptions {
  const span = Math.max(1, metrics.ascent - metrics.descent);
  const unitsPerCell = span / rows;
  const baselineRow = Math.round(-metrics.descent / unitsPerCell);
  const gridWidth = Math.max(1, Math.min(MAX_GRID, 8));
  return { gridWidth, gridHeight: rows, unitsPerCell, offsetX: 0, baselineRow };
}

/**
 * Rasterize one glyph with the default frame for `gridHeight` rows.
 *
 * Prefer `pixelGrid.pixelizeGlyph` when converting a whole font: that keeps
 * one cell size and one baseline row for every glyph, which is what makes the
 * converted font line up.
 */
export function rasterizeGlyphContours(
  contours: Contour[],
  metrics: { ascent: number; descent: number },
  gridHeight: number,
): GlyphRasterResult {
  const frame = defaultRasterizeFrame(contours, metrics, gridHeight);
  const { pixel, stats } = rasterizeDetailed(contours, frame);
  return { frame, pixel, refined: stats.rescued };
}
