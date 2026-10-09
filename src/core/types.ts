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
}

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number; // negative
  lineGap: number;
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
}

let idCounter = 0;
/** Generate a short unique id (not crypto-grade; for glyph identity only). */
export function makeId(prefix = 'g'): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${rand}`;
}
