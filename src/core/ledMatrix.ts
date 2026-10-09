/**
 * LED matrix ("exact pixel") font support.
 *
 * An LED matrix font is a pixel font in which every glyph lives on the same
 * fixed grid:
 *   - every glyph is exactly `rows` LED pixels tall,
 *   - every LED pixel is exactly `cellUnits` font units square,
 *   - the baseline falls on a whole pixel-row boundary,
 *   - glyph origins and advance widths are whole numbers of pixels.
 * Exported outlines are therefore axis-aligned squares on integer coordinates
 * and map one-to-one onto the physical matrix at any size that is a whole
 * multiple of the grid.
 *
 * This module is pure (no React, no fonteditor-core) so it can be shared by
 * the UI, transfers, export validation and the tests.
 */
import { Bitmap, MAX_GRID, b64ToBytes } from './bitmap';
import { contourBounds } from './contours';
import { rasterizeContours } from './rasterize';
import type { Contour, FontDoc, FontMetrics, GlyphDoc, LedMatrixSpec } from './types';

/** Largest matrix height supported (matches the editor's grid limit). */
export const LED_MAX_ROWS = MAX_GRID;
export const LED_MAX_SPACING = 32;
/** Default LED pixel size: 100 units → 5×7 font has unitsPerEm 700. */
export const DEFAULT_LED_CELL_UNITS = 100;
/** Hard font-unit limit used by the rest of the editor. */
const MAX_UNITS_PER_EM = 16384;

export interface LedPreset {
  id: string;
  label: string;
  cols: number;
  rows: number;
}

export const LED_PRESETS: LedPreset[] = [
  { id: '5x7', label: '5×7 — classic character', cols: 5, rows: 7 },
  { id: '5x8', label: '5×8', cols: 5, rows: 8 },
  { id: '6x8', label: '6×8', cols: 6, rows: 8 },
  { id: '8x8', label: '8×8 matrix', cols: 8, rows: 8 },
  { id: '8x16', label: '8×16 matrix', cols: 8, rows: 16 },
  { id: '16x16', label: '16×16 matrix', cols: 16, rows: 16 },
];

export function defaultLedSpec(cols = 5, rows = 7): LedMatrixSpec {
  return { rows, cols, spacing: 1, cellUnits: DEFAULT_LED_CELL_UNITS, descentRows: 0 };
}

/**
 * Validate and normalise user input into a legal spec.
 * Throws a readable Error for values that cannot describe a matrix.
 */
export function normalizeLedSpec(input: LedMatrixSpec): LedMatrixSpec {
  const int = (v: number, lo: number, hi: number, label: string): number => {
    if (!Number.isFinite(v)) throw new Error(`${label} must be a number.`);
    const r = Math.round(v);
    if (r < lo || r > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`);
    return r;
  };
  const rows = int(input.rows, 1, LED_MAX_ROWS, 'Matrix height (rows)');
  const cols = int(input.cols, 1, LED_MAX_ROWS, 'Default width (columns)');
  const spacing = int(input.spacing, 0, LED_MAX_SPACING, 'Letter spacing');
  const cellUnits = int(input.cellUnits, 1, Math.floor(MAX_UNITS_PER_EM / rows), 'Units per LED pixel');
  const descentRows = int(input.descentRows, 0, rows - 1, 'Rows below baseline');
  return { rows, cols, spacing, cellUnits, descentRows };
}

export interface LedLayout {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  baselineRow: number;
  unitsPerCell: number;
}

export function ledLayout(spec: LedMatrixSpec): LedLayout {
  const u = spec.cellUnits;
  const b = spec.descentRows;
  return {
    unitsPerEm: spec.rows * u,
    ascent: (spec.rows - b) * u,
    descent: -b * u,
    baselineRow: b,
    unitsPerCell: u,
  };
}

export function ledMetrics(spec: LedMatrixSpec): FontMetrics {
  const l = ledLayout(spec);
  return { unitsPerEm: l.unitsPerEm, ascent: l.ascent, descent: l.descent, lineGap: 0 };
}

/** Advance (font units) of a glyph `width` LED pixels wide, including letter spacing. */
export function ledAdvance(spec: LedMatrixSpec, width: number): number {
  return (width + spec.spacing) * spec.cellUnits;
}

/** Human-readable matrix label, e.g. "5×7". */
export function ledLabel(spec: LedMatrixSpec): string {
  return `${spec.cols}×${spec.rows}`;
}

/**
 * Re-anchor a bitmap vertically so that its baseline row lands on
 * `newBaseline` in a grid of `newHeight` rows. Pixels pushed outside the grid
 * are cropped; new rows are blank. Horizontal layout is unchanged.
 */
export function reanchorRows(bm: Bitmap, oldBaseline: number, newHeight: number, newBaseline: number): Bitmap {
  const out = new Bitmap(bm.width, newHeight);
  const shift = newBaseline - oldBaseline;
  for (let y = 0; y < bm.height; y++) {
    const ny = y + shift;
    if (ny < 0 || ny >= newHeight) continue;
    for (let x = 0; x < bm.width; x++) {
      if (bm.get(x, y)) out.set(x, ny, 1);
    }
  }
  return out;
}

/** Resolves the drawable contours of a glyph (flattening composites). */
export type ContoursOf = (g: GlyphDoc) => Contour[];

/**
 * Snap one glyph onto the LED grid and return the updated glyph object.
 *  - pixel glyphs: rows are re-anchored to the matrix height and baseline,
 *    cell size / baseline are set to the matrix, the origin is kept on a whole
 *    pixel boundary and the advance becomes (width + spacing) pixels.
 *  - vector / composite glyphs: rasterized onto the matrix (lossy). The
 *    original outline is kept in `sourceContours` so it can still be inspected.
 *  - empty glyphs: receive a blank pixel grid, except .notdef which stays empty.
 */
export function conformGlyphToLed(g: GlyphDoc, spec: LedMatrixSpec, contoursOf: ContoursOf): GlyphDoc {
  if (g.name === '.notdef') return g;
  const u = spec.cellUnits;
  const contours = g.pixel ? [] : contoursOf(g);

  let width: number;
  let offsetX: number;
  let cellsB64: string;
  let sourceContours = g.sourceContours;

  if (g.pixel) {
    const old = Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64);
    const bm = reanchorRows(old, g.pixel.baselineRow, spec.rows, spec.descentRows);
    width = bm.width;
    offsetX = Math.round(g.pixel.offsetX / u) * u;
    cellsB64 = bm.toB64();
  } else if (contours.length) {
    const bb = contourBounds(contours);
    const xMin = bb ? bb.xMin : 0;
    const xMax = bb ? bb.xMax : 0;
    // Cover the ink, but never narrower than the matrix default width.
    const col0 = Math.min(0, Math.floor(xMin / u));
    const col1 = Math.max(spec.cols, Math.ceil(Math.max(xMax, 0) / u));
    width = Math.max(1, Math.min(LED_MAX_ROWS, col1 - col0));
    offsetX = col0 * u;
    const pixel = rasterizeContours(contours, {
      gridWidth: width,
      gridHeight: spec.rows,
      unitsPerCell: u,
      offsetX,
      baselineRow: spec.descentRows,
    });
    cellsB64 = pixel.cellsB64;
    sourceContours = g.sourceContours ?? contours.map((c) => c.map((p) => ({ ...p })));
  } else {
    width = Math.max(1, Math.min(LED_MAX_ROWS, spaceWidthFor(spec)));
    offsetX = 0;
    cellsB64 = new Bitmap(width, spec.rows).toB64();
  }

  return {
    ...g,
    kind: 'pixel',
    contours: [],
    compound: null,
    instructions: null,
    sourceContours,
    pixel: {
      width,
      height: spec.rows,
      cellsB64,
      unitsPerCell: u,
      offsetX,
      baselineRow: spec.descentRows,
    },
    leftSideBearing: offsetX,
    advanceWidth: ledAdvance(spec, width),
    edited: true,
  };
}

/** Width used for blank glyphs (spaces): half the matrix, at least 2 pixels. */
export function spaceWidthFor(spec: LedMatrixSpec): number {
  return Math.max(2, Math.round(spec.cols / 2));
}

// ---------------------------------------------------------------------------
// Exact-pixel validation
// ---------------------------------------------------------------------------

export type LedSeverity = 'error' | 'warning';

export interface LedIssue {
  severity: LedSeverity;
  glyphId: string | null;
  glyph: string;
  message: string;
}

export interface LedCheck {
  /** False for ordinary (non-LED) fonts: the check does not apply. */
  applicable: boolean;
  ok: boolean;
  errors: number;
  warnings: number;
  /** First `limit` issues (counts above are always complete). */
  issues: LedIssue[];
}

/**
 * Verify that a font really is an exact-pixel LED font.
 * Errors make the export "not exact"; warnings are advisory.
 */
export function checkLedFont(doc: FontDoc, limit = 500): LedCheck {
  const spec = doc.ledMatrix;
  if (!spec) return { applicable: false, ok: true, errors: 0, warnings: 0, issues: [] };

  const issues: LedIssue[] = [];
  let errors = 0;
  let warnings = 0;
  const add = (severity: LedSeverity, g: GlyphDoc | null, message: string) => {
    if (severity === 'error') errors += 1;
    else warnings += 1;
    if (issues.length < limit) {
      issues.push({ severity, glyphId: g?.id ?? null, glyph: g?.name ?? '(font)', message });
    }
  };

  let s: LedMatrixSpec | null = null;
  try {
    s = normalizeLedSpec(spec);
  } catch (err) {
    add('error', null, err instanceof Error ? err.message : String(err));
  }
  if (s) {
    const l = ledLayout(s);
    const m = doc.metrics;
    if (m.unitsPerEm !== l.unitsPerEm) add('error', null, `unitsPerEm is ${m.unitsPerEm}; exact pixels need ${l.unitsPerEm} (rows × units per pixel).`);
    if (m.ascent !== l.ascent) add('error', null, `ascent is ${m.ascent}; exact pixels need ${l.ascent}.`);
    if (m.descent !== l.descent) add('error', null, `descent is ${m.descent}; exact pixels need ${l.descent}.`);
  }

  for (const g of doc.glyphs) {
    if (g.name === '.notdef') continue;
    if (!g.pixel) {
      if (g.kind === 'empty' && g.contours.length === 0) continue;
      add('error', g, 'Not an exact-pixel glyph (vector outline). Use “Snap to LED grid”.');
      continue;
    }
    if (!s) continue;
    const p = g.pixel;
    const bytes = safeDecodedLength(p.cellsB64);
    if (bytes !== p.width * p.height) {
      add('error', g, `Corrupt pixel data (${bytes ?? '?'} bytes for ${p.width}×${p.height}).`);
      continue;
    }
    if (p.height !== s.rows) add('error', g, `Grid is ${p.height} rows tall; the matrix needs ${s.rows}.`);
    if (p.unitsPerCell !== s.cellUnits) add('error', g, `Pixel size is ${p.unitsPerCell} units; the matrix needs ${s.cellUnits}.`);
    if (p.baselineRow !== s.descentRows) add('error', g, `Baseline is on row ${p.baselineRow}; the matrix needs row ${s.descentRows}.`);
    if (p.offsetX % s.cellUnits !== 0) add('error', g, `Origin ${p.offsetX} is not a whole number of pixels (off-grid).`);
    if (g.advanceWidth % s.cellUnits !== 0) add('error', g, `Advance ${g.advanceWidth} is not a whole number of pixels (off-grid).`);
    else if (g.advanceWidth !== ledAdvance(s, p.width)) {
      add('warning', g, `Advance is ${g.advanceWidth / s.cellUnits} px; grid width + spacing is ${p.width + s.spacing} px.`);
    }
  }
  return { applicable: true, ok: errors === 0, errors, warnings, issues };
}

function safeDecodedLength(b64: string): number | null {
  try {
    return b64ToBytes(b64).length;
  } catch {
    return null;
  }
}

/** Issues for one glyph (used by the editor toolbar). */
export function glyphLedIssues(check: LedCheck, glyphId: string): LedIssue[] {
  return check.issues.filter((i) => i.glyphId === glyphId);
}

// ---------------------------------------------------------------------------
// Exact pixel entry: ASCII art and LED column bytes
// ---------------------------------------------------------------------------

const ON_CHARS = new Set(['#', '1', 'X', 'x', '@', '█', '■', '*']);
const OFF_CHARS = new Set(['.', '0', '-', '_', ' ']);

export interface PixelTextParse {
  bitmap: Bitmap;
  /** Number of text rows read (the bitmap height). */
  rows: number;
  warnings: string[];
}

/** Render a bitmap as text art, top row first: `#` = lit, `.` = off. */
export function bitmapToAscii(bm: Bitmap): string {
  const lines: string[] = [];
  for (let y = bm.height - 1; y >= 0; y--) {
    let line = '';
    for (let x = 0; x < bm.width; x++) line += bm.get(x, y) ? '#' : '.';
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Parse text art (one line per row, top row first). Trailing and leading
 * whitespace-only lines are ignored; the width is the longest line.
 */
export function asciiToBitmap(text: string): PixelTextParse {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (lines.length === 0) throw new Error('Paste or type at least one row of pixels.');
  const width = Math.max(...lines.map((l) => l.length));
  if (width < 1) throw new Error('Rows are empty.');
  if (width > LED_MAX_ROWS || lines.length > LED_MAX_ROWS) throw new Error(`Grid is limited to ${LED_MAX_ROWS}×${LED_MAX_ROWS}.`);
  const bm = new Bitmap(width, lines.length);
  const warnings: string[] = [];
  lines.forEach((line, i) => {
    const y = lines.length - 1 - i;
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ON_CHARS.has(ch)) bm.set(x, y, 1);
      else if (!OFF_CHARS.has(ch)) {
        if (!warnings.some((w) => w.includes(`"${ch}"`))) {
          warnings.push(`Unknown character "${ch}" treated as off (use # for on, . for off).`);
        }
      }
    }
  });
  return { bitmap: bm, rows: lines.length, warnings };
}

/** Bytes per column needed for `rows` pixels (8 pixels per byte). */
export function bytesPerColumn(rows: number): number {
  return Math.ceil(rows / 8);
}

/**
 * LED-firmware column encoding. Each column is `bytesPerColumn(rows)` bytes;
 * bit j of byte k is the pixel in row 8k+j counted from the TOP (so bit 0 of the
 * first byte is the top-left pixel column). This matches the common 5×7 font
 * tables used by LED matrix drivers.
 */
export function bitmapToColumnBytes(bm: Bitmap): number[][] {
  const bpc = bytesPerColumn(bm.height);
  const cols: number[][] = [];
  for (let x = 0; x < bm.width; x++) {
    const bytes = new Array<number>(bpc).fill(0);
    for (let r = 0; r < bm.height; r++) {
      const y = bm.height - 1 - r;
      if (bm.get(x, y)) bytes[r >> 3] |= 1 << (r & 7);
    }
    cols.push(bytes);
  }
  return cols;
}

/** Text form of the column encoding: one column per line, e.g. `0x3E, 0x51,`. */
export function bitmapToColumnHex(bm: Bitmap): string {
  return bitmapToColumnBytes(bm)
    .map((bytes) => bytes.map((b) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(', ') + ',')
    .join('\n');
}

/**
 * Parse column bytes (hex `0x..` or decimal, separators ignored, `//` and
 * `/* *\/` comments stripped) into a bitmap that is exactly `rows` tall.
 */
export function columnBytesToBitmap(text: string, rows: number): { bitmap: Bitmap; warnings: string[] } {
  const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const tokens = cleaned.match(/0x[0-9a-f]+|\d+/gi) ?? [];
  if (tokens.length === 0) throw new Error('No byte values found. Use hex like 0x3E or decimal like 62.');
  const values = tokens.map((t) => (/^0x/i.test(t) ? parseInt(t.slice(2), 16) : parseInt(t, 10)));
  const bpc = bytesPerColumn(rows);
  if (values.length % bpc !== 0) {
    throw new Error(`Got ${values.length} bytes; ${rows} rows need ${bpc} byte(s) per column, so the count must be a multiple of ${bpc}.`);
  }
  const width = values.length / bpc;
  if (width > LED_MAX_ROWS) throw new Error(`Grid is limited to ${LED_MAX_ROWS} columns.`);
  const warnings: string[] = [];
  if (values.some((v) => v < 0 || v > 255)) {
    throw new Error('Each byte must be between 0x00 and 0xFF.');
  }
  const bm = new Bitmap(width, rows);
  let stray = false;
  for (let x = 0; x < width; x++) {
    for (let r = 0; r < rows; r++) {
      const byte = values[x * bpc + (r >> 3)];
      if ((byte >> (r & 7)) & 1) bm.set(x, rows - 1 - r, 1);
    }
    for (let r = rows; r < bpc * 8; r++) {
      if ((values[x * bpc + (r >> 3)] >> (r & 7)) & 1) stray = true;
    }
  }
  if (stray) warnings.push(`Some bits beyond row ${rows} were ignored.`);
  return { bitmap: bm, warnings };
}
