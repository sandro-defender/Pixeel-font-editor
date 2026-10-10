/** Core data model for Pixeel. All structures are plain-JSON-serializable. */

export type Slot = 'A' | 'B';

/** A point on a TrueType contour. Off-curve points are quadratic control points. */
export interface VectorPoint {
  x: number;
  y: number;
  onCurve: boolean;
}

export type Contour = VectorPoint[];

/** One component of a composite (compound) glyph. */
export interface CompoundComponent {
  /** Index of the component glyph in the *source* font (for reporting). */
  srcGlyphIndex: number;
  /** Id of the component glyph within this font, if present. */
  glyphId: string | null;
  transform: { a: number; b: number; c: number; d: number; e: number; f: number };
  useMyMetrics?: boolean;
  overlapCompound?: boolean;
}

/**
 * A pixel bitmap placed in font-unit space.
 * Grid cell (col, row) — row 0 is the BOTTOM row — maps to font units:
 *   x = offsetX + col * unitsPerCell
 *   y = (row - baselineRow) * unitsPerCell        (baseline is y = 0)
 */
export interface PixelData {
  width: number;
  height: number;
  /** Row-major, bottom row first, 1 = filled. Base64-encoded bytes. */
  cellsB64: string;
  unitsPerCell: number;
  offsetX: number;
  baselineRow: number;
}

export type GlyphKind = 'pixel' | 'vector' | 'compound' | 'empty';

export type SymmetryMode = 'none' | 'horizontal' | 'vertical' | 'quad' | 'radial';

export interface GlyphDoc {
  id: string;
  name: string;
  /** Assigned Unicode code point, or null when unmapped. */
  unicode: number | null;
  advanceWidth: number;
  leftSideBearing: number;
  kind: GlyphKind;
  /** Vector outlines (font units). Empty for pure pixel/empty glyphs. */
  contours: Contour[];
  pixel: PixelData | null;
  /** Compound component list when kind === 'compound'. */
  compound: CompoundComponent[] | null;
  /** TrueType instructions, kept only while the glyph matches its source. */
  instructions: number[] | null;
  /** Original outline before rasterizing to pixels (allows revert). */
  sourceContours: Contour[] | null;
  /** True once the user modified this glyph's outline data. */
  edited: boolean;
  /** Original glyph index in the imported font (for preservation/reporting). */
  srcIndex: number | null;
  /** Symmetry mode for pixel editing, persisted per glyph. */
  symmetry?: SymmetryMode;
}

/** A kerning pair (by glyph id): `value` font units are added after the left glyph. */
export interface KerningPair {
  left: string;
  right: string;
  value: number;
}

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number; // negative
  lineGap: number;
  /**
   * OS/2 vertical metrics. Optional: when absent they follow ascent / descent /
   * lineGap (win values = ascent and −descent). Imported fonts keep their own.
   */
  typoAscender?: number;
  typoDescender?: number; // usually negative
  typoLineGap?: number;
  /** usWinAscent: positive distance above the baseline (clipping limit on Windows). */
  winAscent?: number;
  /** usWinDescent: positive distance below the baseline. */
  winDescent?: number;
  /** OS/2 fsSelection bit 7: apps should use the typo metrics instead of hhea / win. */
  useTypoMetrics?: boolean;
}

export interface FontMeta {
  fontFamily: string;
  fontSubFamily: string;
  fullName: string;
  postScriptName: string;
  uniqueSubFamily: string;
  version: string;
  copyright: string;
  designer: string;
  manufacturer: string;
  description: string;
  urlOfFontVendor: string;
  urlOfFontDesigner: string;
  licence: string;
  urlOfLicence: string;
}

export interface FontSourceInfo {
  fileName: string;
  format: 'ttf' | 'otf' | 'created';
  /** Every table tag found in the original file. */
  tables: string[];
  hasHinting: boolean;
  hasKerning: boolean;
  hasComposites: boolean;
  numGlyphs: number;
  importedAt: number;
}

/**
 * LED matrix ("exact pixel") settings. When set on a font, every glyph lives
 * on the same fixed grid: `rows` LED pixels tall, each pixel exactly
 * `cellUnits` font units square, baseline on a whole pixel row, and advances
 * that are whole numbers of pixels. See src/core/ledMatrix.ts.
 */
export interface LedMatrixSpec {
  /** Matrix height in LED pixels (every glyph has this many rows). */
  rows: number;
  /** Default glyph width in LED pixels. */
  cols: number;
  /** Blank pixel columns inserted after every glyph (letter spacing). */
  spacing: number;
  /** Font units per LED pixel (integer). unitsPerEm = rows × cellUnits. */
  cellUnits: number;
  /** Pixel rows below the baseline (0 = baseline on the bottom row). */
  descentRows: number;
}

export interface FontDoc {
  /** Stable id of the font instance (used to key preserved source data). */
  fontId: string;
  meta: FontMeta;
  metrics: FontMetrics;
  /** Glyph list; index 0 is always the .notdef glyph. */
  glyphs: GlyphDoc[];
  source: FontSourceInfo | null;
  /**
   * Key into the source registry holding the parsed original ttf object
   * (used to preserve GPOS/kern/hinting on export). Null for new fonts.
   */
  sourceRef: string | null;
  /** Present (non-null) when the font is an LED matrix / exact-pixel font. */
  ledMatrix?: LedMatrixSpec | null;
  /**
   * The design that was mapped onto the LED matrix, remembered when LED mode
   * is turned on. Glyphs re-snapped later (a reverted outline, a pasted glyph)
   * are then scaled exactly like the bulk conversion, even though the original
   * outlines have been replaced by pixels.
   */
  ledSource?: { span: number; ascent: number; descent: number } | null;
  /**
   * Editable kerning pairs, read from the source font's kern / GPOS tables on
   * import. Undefined when the font has none that could be read.
   */
  kerning?: KerningPair[];
  /**
   * True once the pairs were changed in Pixeel (or glyph indices shifted):
   * export then writes a fresh `kern` table from `kerning` instead of passing
   * the source font's kern / GPOS tables through.
   */
  kerningEdited?: boolean;
}

export interface WorkspaceSettings {
  theme: 'light' | 'dark';
}

export interface ProjectFile {
  format: 'pixeel-project';
  version: 1;
  savedAt: number;
  fonts: { A: FontDoc | null; B: FontDoc | null };
  active: Slot;
  settings: WorkspaceSettings;
}

export interface NewFontOptions {
  familyName: string;
  styleName: string;
  gridWidth: number;
  gridHeight: number;
  /** Fraction of the grid (rows) reserved below the baseline, 0..0.5 */
  descentRows?: number;
  /** When set, creates an LED matrix (exact-pixel) font instead. */
  led?: LedMatrixSpec;
}

let idCounter = 0;
/** Generate a short unique id (not crypto-grade; for glyph identity only). */
export function makeId(prefix = 'g'): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${rand}`;
}
