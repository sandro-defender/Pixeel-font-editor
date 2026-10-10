/**
 * Font-wide pixel grids and the font → pixels conversion.
 *
 * Converting a *font* (not just a glyph) to pixels only makes sense on a grid
 * the whole font shares:
 *
 *   - one cell size (`unitsPerCell`) for every glyph, so a converted `i` and a
 *     converted `g` have the same pixel size;
 *   - one baseline row, so every glyph sits on the same line;
 *   - advances that are whole numbers of cells, so text set in the font stays
 *     on the lattice and still renders crisply.
 *
 * On top of that this module implements the PixelForge-style **importer**: for
 * a "true" pixel font there is exactly one cell size at which every outline
 * coordinate lands on the lattice and every cell is either completely full or
 * completely empty — no intermediate grays. `detectPixelGrid` finds it by
 * testing the coordinate lattice and verifying with exact coverage, so
 * importing such a font is lossless instead of an arbitrary downsample.
 */
import { Bitmap, MAX_GRID } from './bitmap';
import { contourBoundsTight } from './contours';
import { rasterizeDetailed, type CoverageStats } from './rasterize';
import type { Contour, FontDoc, GlyphDoc, PixelData } from './types';

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/**
 * A pixel lattice shared by a whole font.
 *
 * Cell (col, row) covers the font-unit square
 *   x ∈ [originX + col·u, originX + (col+1)·u]
 *   y ∈ [(row − baselineRow)·u, (row + 1 − baselineRow)·u]
 * with u = unitsPerCell. `baselineRow` is a number, not necessarily an
 * integer: a fractional part encodes a vertical phase, for fonts whose pixel
 * lattice does not pass through the baseline.
 */
export interface PixelGrid {
  /** Font units per cell (the pixel size). */
  unitsPerCell: number;
  /** Row on which y = 0 lies (rows are counted from the bottom, row 0 first). */
  baselineRow: number;
  /** Default grid height in cells (the band the font design maps onto). */
  rows: number;
  /** X (font units) of the left edge of column 0. */
  originX: number;
  /** Nominal width in cells (used for blank glyphs). */
  columns: number;
}

/** The vertical band (and horizontal extent) a font's design occupies. */
export interface DesignBox {
  /** Top of the design in font units (≥ ascent). */
  top: number;
  /** Bottom of the design in font units (≤ descent, usually negative). */
  bottom: number;
  left: number;
  right: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The band a font is drawn in: ascent → descent widened to the real ink.
 *
 * The tallest and deepest few percent of glyphs are ignored, so one unusual
 * glyph (a tall bracket, a deep ogonek) cannot shrink the whole font. Glyphs
 * that still stick out get extra rows instead (see `placeOnGrid`).
 */
export function fontDesignBox(doc: FontDoc, contoursOf: (g: GlyphDoc) => Contour[]): DesignBox {
  const m = doc.metrics;
  let top = m.ascent;
  let bottom = m.descent;
  let left = 0;
  let right = Math.max(1, m.unitsPerEm);
  const highs: number[] = [];
  const lows: number[] = [];
  // A spread of the font is enough: glyphs that stick out of the measured band
  // are given extra rows by `placeOnGrid` instead of being cropped, and a
  // 6000-glyph CJK font must not make an import wait seconds.
  for (const g of subsample(doc.glyphs, SCAN_LIMIT)) {
    if (g.name === '.notdef') continue;
    const cs = contoursOf(g);
    if (!cs.length) continue;
    const bb = contourBoundsTight(cs);
    if (!bb) continue;
    highs.push(bb.yMax);
    lows.push(bb.yMin);
    if (bb.xMin < left) left = bb.xMin;
    if (bb.xMax > right) right = bb.xMax;
    if (g.advanceWidth > right) right = g.advanceWidth;
  }
  if (highs.length >= 8) {
    highs.sort((a, b) => b - a);
    lows.sort((a, b) => a - b);
    const at = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    top = Math.max(top, at(highs, 0.03));
    bottom = Math.min(bottom, at(lows, 0.03));
  }
  if (!(top - bottom > 0)) {
    top = m.ascent;
    bottom = m.descent;
  }
  if (!(top - bottom > 0)) {
    top = Math.max(1, m.unitsPerEm);
    bottom = 0;
  }
  return { top, bottom, left, right };
}

/** Build a grid from a cell size and the lattice phases (p = x phase, q = y phase). */
export function buildGrid(box: DesignBox, unitsPerCell: number, p = 0, q = 0): PixelGrid {
  const u = Math.max(1e-6, unitsPerCell);
  const k0 = Math.floor((box.bottom - q) / u);
  const y0 = q + k0 * u;
  const rows = Math.max(1, Math.ceil((box.top - y0) / u - 1e-9));
  const baselineRow = -y0 / u;
  const c0 = Math.floor((box.left - p) / u);
  const c1 = Math.ceil((box.right - p) / u);
  return {
    unitsPerCell: u,
    baselineRow,
    rows: clamp(rows, 1, MAX_GRID),
    originX: p,
    columns: clamp(c1 - c0, 1, MAX_GRID),
  };
}

/** A grid that fits the design box into exactly `rows` cells (lossy conversion). */
export function gridForRows(box: DesignBox, rows: number, originX = 0): PixelGrid {
  const r = clamp(Math.round(rows), 2, MAX_GRID);
  const u = Math.max(1e-6, (box.top - box.bottom) / r);
  return buildGrid(box, u, originX, 0);
}

/** Row index (in the font band) that contains the font-unit coordinate `y`. */
export function gridRow(grid: PixelGrid, y: number): number {
  return Math.floor(y / grid.unitsPerCell + grid.baselineRow);
}

/** Column index that contains the font-unit coordinate `x`. */
export function gridColumn(grid: PixelGrid, x: number): number {
  return Math.floor((x - grid.originX) / grid.unitsPerCell);
}

// ---------------------------------------------------------------------------
// Placing one glyph on the grid
// ---------------------------------------------------------------------------

export interface PlaceOptions {
  /** Ink fraction needed to light a cell (default 0.5). */
  threshold?: number;
  /**
   * Blank cells kept around the ink (default 0). Zero keeps a detected pixel
   * font exactly on its own lattice: the glyph grid then reproduces the design
   * grid cell for cell instead of growing a blank border.
   */
  margin?: number;
  /** Minimum grid width in cells (default 1). */
  minColumns?: number;
}

export interface Placement {
  pixel: PixelData;
  bitmap: Bitmap;
  stats: CoverageStats;
  /** True when ink fell outside the grid (the grid had to be clamped). */
  clipped: boolean;
}

/**
 * Rasterize one glyph on the shared grid.
 *
 * Every glyph gets the font's full row band, so all of them share a baseline;
 * glyphs whose ink sticks out of the band simply get extra rows above or below
 * instead of being cropped. The width follows the ink, with the origin column
 * kept inside the grid so the left side bearing stays visible and editable.
 */
export function placeOnGrid(
  contours: Contour[],
  grid: PixelGrid,
  opts: PlaceOptions = {},
): Placement | null {
  const bb = contourBoundsTight(contours);
  if (!bb) return null;
  const u = grid.unitsPerCell;
  const margin = Math.max(0, opts.margin ?? 0);
  // A coordinate that lands exactly on a cell boundary belongs to the cell
  // *below* it, not to the one above; without this epsilon a glyph whose ink
  // fills the band exactly (every pixel font) gained a blank row on top.
  const eps = u * 1e-9;

  // --- rows: the font band, extended when the ink does not fit -------------
  let r0 = Math.min(0, gridRow(grid, bb.yMin + eps) - margin);
  let r1 = Math.max(grid.rows - 1, gridRow(grid, bb.yMax - eps) + margin);
  let clipped = false;
  if (r1 - r0 + 1 > MAX_GRID) {
    // hopelessly tall glyph: keep the baseline and clip the far end
    r1 = Math.min(r1, r0 + MAX_GRID - 1);
    r0 = Math.max(r0, r1 - MAX_GRID + 1);
    clipped = true;
  }
  const height = r1 - r0 + 1;
  const baselineRow = grid.baselineRow - r0;

  // --- columns: the ink, with the origin column inside ---------------------
  let c0 = Math.min(0, gridColumn(grid, bb.xMin + eps) - margin);
  let c1 = gridColumn(grid, bb.xMax - eps) + margin;
  let width = c1 - c0 + 1;
  if (width < (opts.minColumns ?? 1)) {
    width = Math.max(1, Math.min(MAX_GRID, opts.minColumns ?? 1));
  }
  if (width > MAX_GRID) {
    c1 = c0 + MAX_GRID - 1;
    width = MAX_GRID;
    clipped = true;
  }
  const offsetX = grid.originX + c0 * u;

  const { pixel, bitmap, stats } = rasterizeDetailed(contours, {
    gridWidth: width,
    gridHeight: height,
    unitsPerCell: u,
    offsetX,
    baselineRow,
    threshold: opts.threshold ?? 0.5,
  });
  return { pixel, bitmap, stats, clipped };
}

// ---------------------------------------------------------------------------
// Pixel-font detection (the PixelForge-style importer)
// ---------------------------------------------------------------------------

export interface DetectOptions {
  /** Smallest acceptable matrix height (default 5). */
  minRows?: number;
  /** Largest acceptable matrix height (default 64). */
  maxRows?: number;
  /** Share of outline coordinates that must sit on the lattice (default 0.98). */
  lattice?: number;
  /** Highest grayness still accepted as pixel-perfect (default 0.02). */
  maxScore?: number;
  /** Cap on the number of cell sizes tried (default 96). */
  maxCandidates?: number;
  /** Cap on the glyphs sampled while scoring (default 24). */
  sampleGlyphs?: number;
}

export interface DetectionResult {
  /** The native grid, or null when the font is not a true pixel font. */
  grid: PixelGrid | null;
  found: boolean;
  /** Grayness of the best grid: 0 = every cell is either empty or full. */
  score: number;
  /** Share of coordinates that landed on the detected lattice. */
  lattice: number;
  /** Number of cell sizes that were tried. */
  tried: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** GCD of the differences between all coordinates: the lattice must divide it. */
function latticeStep(values: number[]): number {
  if (values.length < 2) return 0;
  const first = values[0];
  let g = 0;
  for (let i = 1; i < values.length; i++) {
    g = gcd(g, values[i] - first);
    if (g === 1) return 1;
  }
  return g;
}

/** Divisors of `n` inside [lo, hi], largest first. */
function divisorsInRange(n: number, lo: number, hi: number, limit: number): number[] {
  const out: number[] = [];
  if (n <= 0) return out;
  const top = Math.min(n, Math.floor(Math.sqrt(n)));
  const push = (d: number) => {
    if (d >= lo && d <= hi) out.push(d);
  };
  for (let d = 1; d <= top; d++) {
    if (n % d !== 0) continue;
    push(d);
    push(n / d);
    if (out.length > limit * 4) break;
  }
  out.sort((a, b) => b - a);
  return out.slice(0, limit);
}

/**
 * Most common signed distance of the coordinates from the nearest multiple of
 * `u`. Using the *signed* distance (|d| ≤ u/2) makes the wrap at the cell
 * boundary a non-issue.
 */
function modalPhase(values: number[], u: number, tol: number): { phase: number; fraction: number } {
  if (!values.length) return { phase: 0, fraction: 0 };
  const bins = new Map<number, { sum: number; n: number }>();
  for (const v of values) {
    const d = v - Math.round(v / u) * u;
    const key = Math.round(d / tol);
    const e = bins.get(key);
    if (e) {
      e.sum += d;
      e.n += 1;
    } else {
      bins.set(key, { sum: d, n: 1 });
    }
  }
  let best: { sum: number; n: number } | null = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  if (!best) return { phase: 0, fraction: 0 };
  const phase = best.sum / best.n;
  return { phase, fraction: best.n / values.length };
}

/** Total ink and unresolved (gray) area of a set of glyphs on a grid. */
function scoreGrid(
  samples: Contour[][],
  grid: PixelGrid,
  opts: { threshold?: number; maxGlyphs: number; bailAt: number },
): { gray: number; ink: number } {
  let gray = 0;
  let ink = 0;
  const limit = Math.min(samples.length, opts.maxGlyphs);
  for (let i = 0; i < limit; i++) {
    const p = placeOnGrid(samples[i], grid, { threshold: opts.threshold ?? 0.5 });
    if (!p) continue;
    gray += p.stats.grayness * p.stats.ink;
    ink += p.stats.ink;
    // early out: this grid is nowhere near pixel-perfect
    if (ink > 4 && gray / ink > opts.bailAt) return { gray, ink };
  }
  return { gray, ink };
}

/**
 * Find the cell size at which the font renders as a true pixel font.
 *
 * Two tests, cheapest first:
 *
 *  1. **Lattice.** For the native cell size (and phase) every outline
 *     coordinate is a whole number of cells away from the grid origin and from
 *     the baseline. A candidate is only considered when (nearly) all
 *     coordinates of the whole font agree.
 *  2. **Crispness.** Rasterize a sample of glyphs and measure how much of the
 *     ink is *not* cleanly resolved (`grayness`). A pixel-perfect fit is 0;
 *     anything above `maxScore` is just a downsample.
 *
 * Candidates are tried from the largest cell downwards, so the coarsest
 * pixel-perfect grid wins — that is the size at which one design pixel is one
 * rendered pixel, i.e. the size the font was designed for.
 */
export function detectPixelGrid(
  samples: Contour[][],
  box: DesignBox,
  opts: DetectOptions = {},
): DetectionResult {
  const minRows = opts.minRows ?? 5;
  const maxRows = opts.maxRows ?? 64;
  const needLattice = opts.lattice ?? 0.98;
  const maxScore = opts.maxScore ?? 0.02;
  const maxCandidates = opts.maxCandidates ?? 96;
  const sampleGlyphs = opts.sampleGlyphs ?? 24;

  const inked = samples.filter((cs) => cs.length > 0);
  if (!inked.length) return { grid: null, found: false, score: 1, lattice: 0, tried: 0 };

  const xs: number[] = [];
  const ys: number[] = [];
  for (const cs of inked) {
    for (const c of cs) {
      for (const p of c) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        xs.push(Math.round(p.x));
        ys.push(Math.round(p.y));
      }
    }
  }
  if (!xs.length) return { grid: null, found: false, score: 1, lattice: 0, tried: 0 };
  // The lattice test runs once per candidate, so keep the coordinate set
  // bounded: a few thousand values pin the phase down just as well as millions.
  const xsTest = subsample(xs, 4000);
  const ysTest = subsample(ys, 4000);

  const span = Math.max(1, box.top - box.bottom);
  const uMin = span / maxRows;
  const uMax = span / minRows;
  const step = gcd(latticeStep(xs), latticeStep(ys));


  // cell sizes that can possibly divide the font's coordinate lattice …
  const candidates = divisorsInRange(step, uMin, uMax, maxCandidates);
  // … plus the "N rows tall" sizes, which catch lattices whose gcd was
  // destroyed by a single rounded coordinate.
  for (let r = minRows; r <= maxRows; r++) {
    const u = span / r;
    if (u >= uMin && u <= uMax) candidates.push(u);
  }
  candidates.sort((a, b) => b - a);
  const unique: number[] = [];
  for (const u of candidates) {
    if (!unique.length || Math.abs(unique[unique.length - 1] - u) > u * 1e-6) unique.push(u);
  }
  const tried = unique.slice(0, maxCandidates);

  let bestLattice = 0;
  for (const u of tried) {
    if (!(u > 0)) continue;
    const tol = Math.max(0.02, u * 0.02);
    const px = modalPhase(xsTest, u, tol);
    const py = modalPhase(ysTest, u, tol);
    const share = Math.min(px.fraction, py.fraction);
    if (share > bestLattice) bestLattice = share;
    if (share < needLattice) continue;

    const p = ((px.phase % u) + u) % u;
    const q = ((py.phase % u) + u) % u;
    const grid = buildGrid(box, u, p, q);
    if (grid.rows < minRows || grid.rows > maxRows) continue;
    const { gray, ink } = scoreGrid(inked, grid, {
      maxGlyphs: sampleGlyphs,
      bailAt: Math.max(maxScore * 4, 0.05),
    });
    if (ink <= 0) continue;
    const score = gray / ink;
    if (score <= maxScore) return { grid, found: true, score, lattice: share, tried: tried.length };
  }
  return { grid: null, found: false, score: 1, lattice: bestLattice, tried: tried.length };
}

// ---------------------------------------------------------------------------
// Converting a font to pixels
// ---------------------------------------------------------------------------

export interface PixelizeOptions {
  /** Grid to convert onto. Defaults to `rows` cells over the font design box. */
  grid?: PixelGrid;
  /** Grid height in cells, used when no grid is given (default 16). */
  rows?: number;
  /** Convert one glyph or every inked glyph (default 'font'). */
  scope?: 'glyph' | 'font';
  /** Glyph to convert when scope is 'glyph'. */
  glyphId?: string;
  /** Round advance widths to whole cells (default: true for a whole font). */
  snapAdvance?: boolean;
  /** Ink fraction needed to light a cell (default 0.5). */
  threshold?: number;
  /** Resolves drawable contours (composites flattened). */
  contoursOf?: (g: GlyphDoc) => Contour[];
}

export interface PixelizeReport {
  grid: PixelGrid;
  /** Number of rows in the grid used. */
  rows: number;
  converted: number;
  /** Glyphs left alone because they have no ink. */
  skipped: number;
  /** Glyphs whose ink is thinner than half a cell (lit by the rescue rule). */
  rescued: number;
  /** Glyphs with ink outside the grid. */
  clipped: number;
  /** Converted glyphs that ended up blank. */
  blank: number;
  snapAdvance: boolean;
}

/** Snap an advance to a whole number of cells (never below one cell). */
export function snapAdvanceToGrid(advance: number, grid: PixelGrid): number {
  const u = grid.unitsPerCell;
  if (!(advance > 0)) return 0;
  return Math.max(1, Math.round(advance / u)) * u;
}

// ---------------------------------------------------------------------------
// Detection straight from a FontDoc
// ---------------------------------------------------------------------------

/** Evenly spread subsample (used to keep whole-font scans bounded). */
function subsample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const step = values.length / limit;
  const out: T[] = [];
  for (let i = 0; i < limit; i++) out.push(values[Math.floor(i * step)]);
  return out;
}

/** Cap on the glyphs inspected when measuring a whole font. */
const SCAN_LIMIT = 600;

/**
 * Inked contours of a spread of the font's glyphs (never every glyph of a
 * 3000-glyph font: detection only needs a representative sample).
 */
export function glyphContourSamples(
  doc: FontDoc,
  contoursOf: (g: GlyphDoc) => Contour[],
  limit = 60,
): Contour[][] {
  const inked: Contour[][] = [];
  const pool = subsample(doc.glyphs, Math.max(limit * 8, SCAN_LIMIT));
  for (const g of pool) {
    if (g.name === '.notdef') continue;
    const cs = contoursOf(g);
    if (cs.length) inked.push(cs);
  }
  return subsample(inked, limit);
}

export interface FontDetection extends DetectionResult {
  box: DesignBox;
  /** Glyphs that would be converted (have ink and are not .notdef). */
  convertible: number;
}

/**
 * One-call detection for a document: design box, sample and lattice search.
 * Cheap enough to run while a dialog opens or right after an import (the
 * lattice test rejects almost every candidate before any rasterization).
 */
export function detectFontPixelGrid(
  doc: FontDoc,
  contoursOf?: (g: GlyphDoc) => Contour[],
  opts: DetectOptions = {},
): FontDetection {
  const co = contoursOf ?? ((g: GlyphDoc) => g.contours);
  const box = fontDesignBox(doc, co);
  const samples = glyphContourSamples(doc, co, opts.sampleGlyphs ? opts.sampleGlyphs * 3 : 60);
  const det = detectPixelGrid(samples, box, opts);
  let convertible = 0;
  for (const g of doc.glyphs) {
    if (g.name === '.notdef') continue;
    if (g.kind === 'vector' || g.kind === 'compound' || g.contours.length > 0) convertible += 1;
  }
  return { ...det, box, convertible };
}

/**
 * Convert vector/composite glyphs of a font into editable pixel grids on one
 * shared lattice.
 *
 * Original outlines are kept in `sourceContours`, so every converted glyph can
 * still be reverted. Advances are snapped to whole cells by default: without
 * that the converted font would drift off the lattice as soon as text is set
 * in it, and the pixel-perfect rendering would be lost again.
 */
export function pixelizeFont(doc: FontDoc, opts: PixelizeOptions = {}): { doc: FontDoc; report: PixelizeReport } {
  const contoursOf = opts.contoursOf ?? ((g: GlyphDoc) => g.contours);
  const scope = opts.scope ?? 'font';
  const grid = opts.grid ?? gridForRows(fontDesignBox(doc, contoursOf), opts.rows ?? 16);
  const snap = opts.snapAdvance ?? scope === 'font';
  const report: PixelizeReport = {
    grid,
    rows: grid.rows,
    converted: 0,
    skipped: 0,
    rescued: 0,
    clipped: 0,
    blank: 0,
    snapAdvance: snap,
  };

  const wanted = (g: GlyphDoc): boolean => {
    if (g.name === '.notdef') return false;
    if (scope === 'glyph') return g.id === opts.glyphId;
    return true;
  };

  const glyphs = doc.glyphs.map((g) => {
    if (!wanted(g)) return g;
    const cs = contoursOf(g);
    if (!cs.length) {
      if (scope === 'glyph') report.skipped += 1;
      return g;
    }
    const placed = placeOnGrid(cs, grid, { threshold: opts.threshold ?? 0.5 });
    if (!placed) {
      report.skipped += 1;
      return g;
    }
    report.converted += 1;
    if (placed.stats.rescued) report.rescued += 1;
    if (placed.clipped) report.clipped += 1;
    if (placed.stats.lit === 0) report.blank += 1;
    const advanceWidth = snap ? snapAdvanceToGrid(g.advanceWidth, grid) : g.advanceWidth;
    return {
      ...g,
      kind: 'pixel' as const,
      contours: [] as Contour[],
      compound: null,
      instructions: null,
      pixel: placed.pixel,
      sourceContours: g.sourceContours ?? cs.map((c) => c.map((p) => ({ ...p }))),
      leftSideBearing: Math.round(placed.pixel.offsetX),
      advanceWidth: Math.round(advanceWidth),
      edited: true,
    };
  });

  return { doc: { ...doc, glyphs }, report };
}
