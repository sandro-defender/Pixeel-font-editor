/**
 * "Add Character Sets": add the missing glyphs of one or more sets to a font
 * **without touching the characters that are already there**.
 *
 * Design rules (enforced here, not in the UI):
 *
 *  - An existing glyph is never replaced unless the caller explicitly asks for
 *    `existing: 'overwrite'`. Existing mappings, advance widths, side bearings
 *    and artwork are preserved as they are.
 *  - A new glyph is created as an *editable blank* pixel grid (kind `empty`,
 *    `origin: 'added'`). It is deliberately not marked as edited/finished: a
 *    blank grid is a placeholder, not a character design.
 *  - A new glyph may optionally start from a template glyph: pixel artwork is
 *    copied with **nearest-neighbour** scaling, vector outlines are rasterized
 *    onto a grid first and then scaled the same way. Scaling is always explicit
 *    — nothing is ever resized silently.
 *  - Advance widths come from the font's own metrics for the category (letters
 *    → median letter advance, digits → median digit advance, large digits → the
 *    matching standard digit × scale), with pixel-grid and units-per-em
 *    fallbacks.
 *  - The font's global metrics (unitsPerEm, ascent, descent, line gap) are never
 *    modified, and the side bearings of new glyphs start at 0 with the artwork
 *    anchored at the origin column.
 */
import { Bitmap, MAX_GRID } from './bitmap';
import { contourBoundsTight } from './contours';
import { resolveGlyphContours } from './fontCodec';
import { placeOnGrid } from './pixelGrid';
import { allUnicodes, glyphForCodePoint, hasCodePoint, withoutCodePoint } from './unicodeMap';
import { describeCodePoint, suggestGlyphName } from './unicodeNames';
import { makeId, type FontDoc, type GlyphDoc, type PixelData } from './types';
import {
  ALL_CHAR_SET_IDS,
  CHAR_SETS,
  type CharSetId,
  charSetDef,
  glyphHasArtwork,
  largeDigitName,
  altMappingIssue,
  largeDigitPoints,
  pointsForSet,
} from './charSets';

/** What happens to a code point that already maps to a glyph. */
export type ExistingPolicy = 'keep' | 'fillBlank' | 'overwrite';

/** Default number of pixel rows for blank grids created in an outline font. */
export const DEFAULT_NEW_GLYPH_ROWS = 16;

export interface AddSetsOptions {
  /** Which sets to complete (in any order; the plan follows the CHAR_SETS order). */
  sets: CharSetId[];
  /** What to do with code points that already map to a glyph (default 'keep'). */
  existing?: ExistingPolicy;
  /** Start new glyphs blank (default) or from a template glyph. */
  template?: 'blank' | 'copy';
  /**
   * Glyph id to copy when `template: 'copy'` is used. Without it the plan picks
   * a sensible source by itself: the matching standard digit for the large
   * digits, otherwise the first designed glyph of the same set, otherwise the
   * first designed glyph of the font.
   */
  templateGlyphId?: string;
  /**
   * Scale applied to the template artwork (nearest-neighbour for pixels,
   * contour scaling + rasterization for outlines). 2 gives the double-size
   * digits; 1 is a straight copy.
   */
  templateScale?: number;
  /** Grid rows for blank grids created in a vector font (default: the font's own grid). */
  gridRows?: number | 'auto';
  /** Alternative-digit mapping to record/apply when the large-digit set is involved. */
  altDigitPoints?: number[];
  /** When copying artwork over an existing glyph, scale its advance width too (default true). */
  adaptAdvance?: boolean;
}

export interface PlannedGlyph {
  codePoint: number;
  setName: string;
  set: CharSetId;
  name: string;
  /** create = brand-new glyph, fill = blank glyph gets artwork, replace = artwork replaced. */
  mode: 'create' | 'fill' | 'replace';
  glyphId: string | null;
  gridWidth: number;
  gridHeight: number;
  unitsPerCell: number;
  advanceWidth: number;
  /** Template the artwork comes from (null for blank glyphs). */
  templateGlyphId: string | null;
  templateLabel: string | null;
  scale: number;
  /** True when the glyph results without artwork (still needs drawing). */
  blank: boolean;
  /**
   * True when this change discards existing artwork (only possible with
   * `existing: 'overwrite'` *and* a template to replace it with). The UI asks
   * for confirmation before applying a plan that contains such a change.
   */
  replacedArtwork: boolean;
}

export interface SkippedCharacter {
  codePoint: number;
  glyphId: string;
  glyphName: string;
  reason: 'present' | 'blank';
  setName: string;
}

export interface AddSetsPlan {
  sets: CharSetId[];
  /** Everything the plan will write, in application order. */
  changes: PlannedGlyph[];
  additions: PlannedGlyph[];
  fills: PlannedGlyph[];
  replacements: PlannedGlyph[];
  skipped: SkippedCharacter[];
  /** Alternative-digit mapping the resulting font carries. */
  altDigitPoints: number[];
  warnings: string[];
  /** The document with the plan applied (preview and apply share this exact result). */
  nextDoc: FontDoc;
}

// ---------------------------------------------------------------------------
// Alternative (large) digit mapping
// ---------------------------------------------------------------------------

export interface AltDigitValidation {
  ok: boolean;
  error?: string;
  points?: number[];
}

/**
 * Validate a candidate alternative-digit mapping: ten distinct, valid code
 * points that are not the standard digits and not already used by an unrelated
 * character. The font's current large-digit code points are allowed (their
 * glyphs follow the mapping when it moves).
 */
export function validateAltDigitPoints(doc: FontDoc, points: number[]): AltDigitValidation {
  const issue = altMappingIssue(points);
  if (issue) {
    switch (issue.code) {
      case 'length':
        return { ok: false, error: 'The alternative digit set needs exactly 10 code points (one per digit 0–9).' };
      case 'invalid':
        return { ok: false, error: 'Every alternative digit needs a valid Unicode code point (U+0000–U+10FFFF, no surrogates).' };
      case 'control':
        return { ok: false, error: `${describeCodePoint(issue.codePoint)} is a control character and cannot hold a glyph.` };
      case 'standardDigit':
        return { ok: false, error: `${describeCodePoint(issue.codePoint)} is a standard digit — large digits must stay separate glyphs.` };
      case 'duplicate':
        return { ok: false, error: `${describeCodePoint(issue.codePoint)} is assigned to two alternative digits — every digit needs its own code point.` };
    }
  }
  const rounded = points.map((cp) => Math.round(Number(cp)));
  const own = new Set(largeDigitPoints(doc));
  for (const cp of rounded) {
    if (own.has(cp)) continue;
    const owner = doc.glyphs.find((g) => hasCodePoint(g, cp));
    if (!owner) continue;
    if (owner.name === '.notdef') return { ok: false, error: `${describeCodePoint(cp)} is mapped to .notdef and cannot be reused.` };
    return {
      ok: false,
      error: `${describeCodePoint(cp)} is already used by “${owner.name}”. Pick another code point or change that glyph first.`,
    };
  }
  return { ok: true, points: rounded };
}

/** True when a glyph is one of this font's alternative digits. */
const isLargeDigitGlyph = (g: Pick<GlyphDoc, 'name' | 'origin'>): boolean => g.name.endsWith('.large') || g.origin === 'added';

/**
 * Move the existing alternative-digit glyphs to a new set of code points.
 * Designs, advance widths and bearings are untouched — only the cmap entries
 * move — so re-mapping never destroys the artwork.
 */
export function reconfigureAltDigits(doc: FontDoc, points: number[]): FontDoc {
  const check = validateAltDigitPoints(doc, points);
  if (!check.ok) throw new Error(check.error);
  const next = check.points!;
  const current = largeDigitPoints(doc);
  const moves = new Map<string, { from: number; to: number }>();
  current.forEach((cp, i) => {
    const to = next[i];
    if (cp === to) return;
    const owner = doc.glyphs.find((g) => hasCodePoint(g, cp));
    if (!owner || owner.name === '.notdef' || !isLargeDigitGlyph(owner)) return;
    moves.set(owner.id, { from: cp, to });
  });
  let glyphs = doc.glyphs;
  if (moves.size) {
    glyphs = glyphs.map((g) => {
      const move = moves.get(g.id);
      if (!move) return g;
      const cleared = withoutCodePoint(g, move.from);
      return cleared.unicode === null
        ? { ...cleared, unicode: move.to }
        : { ...cleared, extraUnicodes: [...(cleared.extraUnicodes ?? []), move.to] };
    });
  }
  return { ...doc, glyphs, altDigits: { codepoints: [...next] } };
}

/** The alternative-digit code points of a document (defaults included). */
export const altDigitPointsOf = (doc: FontDoc): number[] => largeDigitPoints(doc);

/** True when the font has no explicit alternative-digit mapping yet. */
export const hasAltDigitMapping = (doc: Pick<FontDoc, 'altDigits'>): boolean => !!doc.altDigits?.codepoints;

// ---------------------------------------------------------------------------
// Metrics & grid defaults
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Glyphs of a set that already carry artwork (the metric reference pool). */
function inkedGlyphsOfSet(doc: FontDoc, set: CharSetId): GlyphDoc[] {
  const points = new Set(pointsForSet(set, doc));
  return doc.glyphs.filter(
    (g) => g.name !== '.notdef' && glyphHasArtwork(g) && allUnicodes(g).some((cp) => points.has(cp)),
  );
}

/**
 * A sensible advance width for a new glyph of `set`, taken from the font's own
 * metrics: the median advance of the same category, then of every inked glyph,
 * then the pixel-grid width, then 60 % of the em.
 */
export function defaultAdvanceFor(doc: FontDoc, set: CharSetId): number {
  const own = inkedGlyphsOfSet(doc, set);
  const sameCategory = median(own.map((g) => g.advanceWidth).filter((a) => a > 0));
  if (sameCategory !== null) return sameCategory;

  const all = doc.glyphs.filter((g) => g.name !== '.notdef' && g.unicode !== null && glyphHasArtwork(g));
  const anyInked = median(all.map((g) => g.advanceWidth).filter((a) => a > 0));
  if (anyInked !== null) return anyInked;

  const template = doc.glyphs.find((g) => g.pixel && g.name !== '.notdef')?.pixel;
  if (template && template.unitsPerCell > 0) return Math.round(template.unitsPerCell * template.width);
  return Math.max(1, Math.round(doc.metrics.unitsPerEm * 0.6));
}

export interface BlankGrid {
  unitsPerCell: number;
  baselineRow: number;
  offsetX: number;
  height: number;
}

/**
 * The grid a newly created glyph is drawn on.
 *
 *  - LED matrix fonts keep their matrix (rows, cell size, baseline).
 *  - Fonts that already have pixel glyphs (BDF imports, converted fonts) reuse
 *    that template, so a new Georgian letter lines up with the Latin ones.
 *  - Outline fonts get a grid over their own design band: `rows` cells from the
 *    ascent down to the descent, baseline on the row nearest y = 0. That grid is
 *    for new glyphs only — imported outlines are not touched.
 */
export function blankGridFor(doc: FontDoc, rows: number | 'auto' = 'auto'): BlankGrid {
  if (doc.ledMatrix) {
    return {
      unitsPerCell: doc.ledMatrix.cellUnits,
      baselineRow: doc.ledMatrix.descentRows,
      offsetX: 0,
      height: doc.ledMatrix.rows,
    };
  }
  const template = doc.glyphs.find((g) => g.pixel && g.name !== '.notdef')?.pixel;
  if (template && rows === 'auto') {
    return { unitsPerCell: template.unitsPerCell, baselineRow: template.baselineRow, offsetX: 0, height: template.height };
  }
  const wanted =
    typeof rows === 'number' ? Math.max(2, Math.min(MAX_GRID, Math.round(rows))) : template?.height ?? DEFAULT_NEW_GLYPH_ROWS;
  if (template && wanted === template.height) {
    return { unitsPerCell: template.unitsPerCell, baselineRow: template.baselineRow, offsetX: 0, height: template.height };
  }
  const top = Math.max(doc.metrics.ascent, 1);
  const bottom = Math.min(doc.metrics.descent, 0);
  const span = Math.max(1, top - bottom);
  const unitsPerCell = Math.round((span / wanted) * 1000) / 1000;
  const baselineRow = Math.min(wanted - 1, Math.max(0, Math.round(-bottom / unitsPerCell)));
  return { unitsPerCell, baselineRow, offsetX: 0, height: wanted };
}

const clampCells = (cells: number): number => Math.max(1, Math.min(MAX_GRID, Math.round(cells) || 1));

/** Blank pixel grid sized so a glyph with `advance` gets a proportional cell count. */
export function blankPixelFor(grid: BlankGrid, advance: number): PixelData {
  const width = clampCells(advance / Math.max(1e-6, grid.unitsPerCell));
  return {
    width,
    height: grid.height,
    cellsB64: new Bitmap(width, grid.height).toB64(),
    unitsPerCell: grid.unitsPerCell,
    offsetX: grid.offsetX,
    baselineRow: grid.baselineRow,
  };
}

// ---------------------------------------------------------------------------
// Template artwork
// ---------------------------------------------------------------------------

interface TemplateArtwork {
  pixel: PixelData;
  inked: boolean;
  warnings: string[];
}

/**
 * Artwork for a new glyph copied from `src` and scaled by `scale`.
 * Pixel sources are resampled nearest-neighbour (crisp edges, no blur);
 * outline sources are first rasterized onto the new glyph's grid, then scaled
 * the same way, so both paths produce comparable results.
 */
export function artworkFromTemplate(doc: FontDoc, src: GlyphDoc, grid: BlankGrid, scale: number, advance: number): TemplateArtwork {
  const warnings: string[] = [];
  const s = Math.max(0.05, scale);
  let base: Bitmap;
  let unitsPerCell = grid.unitsPerCell;
  let offsetX = grid.offsetX;
  let baselineRow = grid.baselineRow;
  if (src.pixel) {
    base = Bitmap.fromB64(src.pixel.width, src.pixel.height, src.pixel.cellsB64);
    unitsPerCell = src.pixel.unitsPerCell;
    offsetX = src.pixel.offsetX;
    baselineRow = src.pixel.baselineRow;
  } else {
    const contours = resolveGlyphContours(src, doc.glyphs);
    const bb = contourBoundsTight(contours);
    if (!bb) {
      warnings.push(`“${src.name}” has no drawable outline to copy.`);
      return { pixel: blankPixelFor(grid, advance), inked: false, warnings };
    }
    const width = clampCells(Math.max(advance / grid.unitsPerCell, (bb.xMax - bb.xMin) / grid.unitsPerCell + 1));
    const placed = placeOnGrid(contours, { ...grid, rows: grid.height, originX: grid.offsetX, columns: width }, { minColumns: width });
    if (!placed) {
      warnings.push(`“${src.name}” could not be rasterized onto a new grid.`);
      return { pixel: blankPixelFor(grid, advance), inked: false, warnings };
    }
    if (placed.clipped) warnings.push(`Template artwork of “${src.name}” does not fit the new grid and was clipped.`);
    base = placed.bitmap;
    unitsPerCell = placed.pixel.unitsPerCell;
    offsetX = placed.pixel.offsetX;
    baselineRow = placed.pixel.baselineRow;
  }

  const targetW = Math.round(base.width * s);
  const targetH = Math.round(base.height * s);
  if (targetW > MAX_GRID || targetH > MAX_GRID) {
    warnings.push(`Template artwork of “${src.name}” was clamped to the ${MAX_GRID}×${MAX_GRID} grid limit.`);
  }
  const w = clampCells(targetW);
  const h = clampCells(targetH);
  const resized = s === 1 ? base.clone() : base.resized(w, h, 'resample'); // nearest neighbour, explicitly
  return {
    pixel: {
      width: resized.width,
      height: resized.height,
      cellsB64: resized.toB64(),
      unitsPerCell,
      offsetX,
      baselineRow: Math.min(resized.height - 1, Math.max(0, Math.round(baselineRow * s))),
    },
    inked: resized.count() > 0,
    warnings,
  };
}

/** A blank or template-based glyph for `cp`. */
function buildGlyph(
  doc: FontDoc,
  cp: number,
  name: string,
  grid: BlankGrid,
  advance: number,
  template: { glyph: GlyphDoc; scale: number } | null,
): { glyph: GlyphDoc; warnings: string[] } {
  const base: GlyphDoc = {
    id: makeId('g'),
    name,
    unicode: cp,
    advanceWidth: Math.max(0, Math.round(advance)),
    leftSideBearing: 0,
    kind: 'empty',
    contours: [],
    pixel: blankPixelFor(grid, advance),
    compound: null,
    instructions: null,
    sourceContours: null,
    edited: false,
    srcIndex: null,
    origin: 'added',
  };
  if (!template) return { glyph: base, warnings: [] };
  const art = artworkFromTemplate(doc, template.glyph, grid, template.scale, advance);
  return {
    // `edited` stays false: the copy is a synthesized starting point, not a finished character
    glyph: { ...base, pixel: art.pixel, kind: art.inked ? 'pixel' : 'empty' },
    warnings: art.warnings,
  };
}

/**
 * Replace one glyph's artwork with a copy of another glyph's — the large-digit
 * workflow ("copy a standard digit into its corresponding large digit").
 * The target keeps its id, name, code point and side bearing; the advance width
 * follows the copy (× scale) unless `adaptAdvance` is false.
 */
export function copyArtworkInto(
  doc: FontDoc,
  targetGlyphId: string,
  sourceGlyphId: string,
  opts: { scale?: number; adaptAdvance?: boolean } = {},
): { doc: FontDoc; warnings: string[] } {
  const target = doc.glyphs.find((g) => g.id === targetGlyphId);
  const source = doc.glyphs.find((g) => g.id === sourceGlyphId);
  if (!target) throw new Error('Target glyph not found.');
  if (!source) throw new Error('Source glyph not found.');
  if (target.id === source.id) throw new Error('Pick a different source glyph.');
  if (!glyphHasArtwork(source)) throw new Error(`“${source.name}” has no artwork to copy yet.`);
  const scale = Math.max(0.05, opts.scale ?? 1);
  const grid = blankGridFor(doc);
  const advance = opts.adaptAdvance === false ? target.advanceWidth : Math.round(source.advanceWidth * scale);
  const art = artworkFromTemplate(doc, source, grid, scale, advance);
  const next: GlyphDoc = {
    ...target,
    pixel: art.pixel,
    kind: art.inked ? 'pixel' : 'empty',
    contours: [],
    compound: null,
    instructions: null,
    // A glyph that was added by this feature keeps `edited: false`: the copied
    // artwork is a synthesized starting point, not a hand-finished design. An
    // existing (imported) glyph that gets overwritten is a modification.
    edited: target.origin !== 'added',
    advanceWidth: advance,
  };
  return {
    doc: { ...doc, glyphs: doc.glyphs.map((g) => (g.id === target.id ? next : g)) },
    warnings: art.warnings,
  };
}

/**
 * Nearest-neighbour resize of a pixel glyph to `factor` × its grid (2 = the
 * double-size digit). Vector glyphs are scaled contour-wise. Never silent: the
 * caller passes an explicit factor and gets the new size back.
 */
export function scaleGlyphNearest(
  doc: FontDoc,
  glyphId: string,
  factor: number,
  opts: { adaptAdvance?: boolean } = {},
): { doc: FontDoc; width: number; height: number } {
  const g = doc.glyphs.find((x) => x.id === glyphId);
  if (!g) throw new Error('Glyph not found.');
  const f = Math.max(0.05, factor);
  if (g.pixel) {
    const bm = Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64);
    const w = clampCells(bm.width * f);
    const h = clampCells(bm.height * f);
    const resized = bm.resized(w, h, 'resample');
    const pixel: PixelData = {
      ...g.pixel,
      width: resized.width,
      height: resized.height,
      cellsB64: resized.toB64(),
      baselineRow: Math.min(resized.height - 1, Math.max(0, Math.round(g.pixel.baselineRow * f))),
      offsetX: Math.round(g.pixel.offsetX * f),
    };
    const next: GlyphDoc = {
      ...g,
      pixel,
      kind: resized.count() > 0 ? 'pixel' : g.kind === 'empty' ? 'empty' : 'pixel',
      edited: true,
      instructions: null,
      advanceWidth: opts.adaptAdvance === false ? g.advanceWidth : Math.round(g.advanceWidth * f),
    };
    return { doc: { ...doc, glyphs: doc.glyphs.map((x) => (x.id === glyphId ? next : x)) }, width: pixel.width, height: pixel.height };
  }
  if (!glyphHasArtwork(g)) throw new Error(`“${g.name}” has no artwork to scale yet.`);
  const contours = resolveGlyphContours(g, doc.glyphs).map((c) =>
    c.map((p) => ({ x: Math.round(p.x * f), y: Math.round(p.y * f), onCurve: p.onCurve })),
  );
  const next: GlyphDoc = {
    ...g,
    contours,
    compound: null,
    kind: 'vector',
    edited: true,
    instructions: null,
    leftSideBearing: Math.round(g.leftSideBearing * f),
    advanceWidth: opts.adaptAdvance === false ? g.advanceWidth : Math.round(g.advanceWidth * f),
  };
  const bb = contourBoundsTight(contours);
  return {
    doc: { ...doc, glyphs: doc.glyphs.map((x) => (x.id === glyphId ? next : x)) },
    width: bb ? Math.round(bb.xMax - bb.xMin) : 0,
    height: bb ? Math.round(bb.yMax - bb.yMin) : 0,
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Build the complete change set for "Add Character Sets" **plus** the resulting
 * document. The dialog previews `changes` / `skipped` and applies `nextDoc`
 * unchanged, so what the user confirmed is exactly what is written.
 */
export function planAddSets(doc: FontDoc, opts: AddSetsOptions): AddSetsPlan {
  const existing: ExistingPolicy = opts.existing ?? 'keep';
  const templateMode = opts.template ?? 'blank';
  const gridRows = opts.gridRows ?? 'auto';
  const warnings: string[] = [];
  const requested = ALL_CHAR_SET_IDS.filter((id) => opts.sets.includes(id));
  if (!requested.length) throw new Error('Select at least one character set to add.');

  // --- alternative-digit mapping: validate, then move the existing large digits onto it
  let working = doc;
  let altPoints = largeDigitPoints(doc);
  if (opts.altDigitPoints) {
    const check = validateAltDigitPoints(doc, opts.altDigitPoints);
    if (!check.ok) throw new Error(check.error);
    if (check.points!.join(',') !== altPoints.join(',')) {
      working = reconfigureAltDigits(doc, check.points!);
      altPoints = check.points!;
      warnings.push(`Alternative-digit mapping set to ${describeCodePoint(altPoints[0])}…${describeCodePoint(altPoints[9])}.`);
    }
  }

  const grid = blankGridFor(working, gridRows);
  const changes: PlannedGlyph[] = [];
  const skipped: SkippedCharacter[] = [];
  const addedGlyphs: GlyphDoc[] = [];
  const replacements = new Map<string, GlyphDoc>();
  const removedNotdefPoints: number[] = [];

  /** True once a "no template" notice has been added (one per plan is enough). */
  const noticed: Record<string, boolean> = {};
  /** Last-resort template: the first designed glyph of the font (never .notdef). */
  const fallback = working.glyphs.find((g) => g.name !== '.notdef' && glyphHasArtwork(g)) ?? null;

  const record = (target: GlyphDoc, pixel: PixelData, inked: boolean): void => {
    replacements.set(target.id, {
      ...target,
      pixel,
      kind: inked ? 'pixel' : 'empty',
      contours: [],
      compound: null,
      instructions: null,
      edited: true,
    });
  };

  for (const setId of requested) {
    const def = charSetDef(setId);
    const points = pointsForSet(setId, working);
    const pool = inkedGlyphsOfSet(working, setId);

    /**
     * Template for one character of this set (null → the new glyph starts blank).
     * `chosen` marks the templates that stand for *this* character on purpose
     * (an explicitly picked source, or the matching standard digit of a large
     * digit). Only those may replace the artwork of an existing character.
     */
    const templateFor = (index: number, cp: number): { glyph: GlyphDoc; scale: number; chosen: boolean } | null => {
      if (templateMode !== 'copy') return null;
      const scale = Math.max(0.05, opts.templateScale ?? 1);
      if (opts.templateGlyphId) {
        const picked = working.glyphs.find((g) => g.id === opts.templateGlyphId);
        if (picked && glyphHasArtwork(picked)) return { glyph: picked, scale, chosen: true };
      }
      if (setId === 'largeDigits') {
        const std = glyphForCodePoint(working.glyphs, 0x30 + index);
        if (std && glyphHasArtwork(std)) return { glyph: std, scale, chosen: true };
        if (!noticed.largeDigits) {
          noticed.largeDigits = true;
          warnings.push(
            'No standard digit with artwork exists yet, so the large digits start blank: design (or copy) the standard digits first, then copy them over.',
          );
        }
        return null;
      }
      if (pool.length) return { glyph: pool[0], scale, chosen: false };
      if (fallback) {
        if (!noticed.fallback) {
          noticed.fallback = true;
          warnings.push(
            `No ${def.label} glyph with artwork exists yet, so “${fallback.name}” (another character of this font) is used as the template. Pick a template glyph in the dialog to choose another source.`,
          );
        }
        return { glyph: fallback, scale, chosen: false };
      }
      if (!noticed[setId]) {
        noticed[setId] = true;
        warnings.push(`No ${def.label} glyph with artwork exists yet, so the new characters start blank.`);
      }
      void cp;
      return null;
    };

    points.forEach((cp, index) => {
      const owner = glyphForCodePoint(working.glyphs, cp);
      const ownedByNotdef = owner?.name === '.notdef';
      const ownerHasArt = owner ? glyphHasArtwork(owner) : false;
      const template = templateFor(index, cp);
      const tooBig = owner && !ownedByNotdef;

      if (tooBig) {
        // `overwrite` may only discard artwork when there is something to put in
        // its place: a template that stands for *this* character (a chosen
        // source or the matching standard digit). Replacing a design with an
        // empty grid — or with an unrelated character — would just lose it.
        const overwriting = existing === 'overwrite' && !!template?.chosen;
        if (ownerHasArt && existing === 'overwrite' && !overwriting) {
          if (!noticed.overwriteNoTemplate) {
            noticed.overwriteNoTemplate = true;
            warnings.push(
              '“Overwrite” needs a template that belongs to the character being replaced: existing characters keep their artwork. Choose a template glyph (large digits use their matching standard digit) or use “Fill blanks”.',
            );
          }
        }
        if ((ownerHasArt && !overwriting) || (!ownerHasArt && existing === 'keep')) {
          skipped.push({
            codePoint: cp,
            glyphId: owner.id,
            glyphName: owner.name,
            reason: ownerHasArt ? 'present' : 'blank',
            setName: def.label,
          });
          return;
        }
        const advance = owner.advanceWidth || defaultAdvanceFor(working, setId);
        const art = template ? artworkFromTemplate(working, template.glyph, grid, template.scale, advance) : null;
        if (art) warnings.push(...art.warnings);
        const pixel = art?.pixel ?? blankPixelFor(grid, advance);
        record(owner, pixel, art?.inked ?? false);
        // An existing glyph keeps its advance width and spacing unless the user
        // explicitly asks for the copy's width (× scale).
        const nextAdvance =
          !template || opts.adaptAdvance !== true ? owner.advanceWidth : Math.round(template.glyph.advanceWidth * template.scale);
        if (nextAdvance !== owner.advanceWidth) {
          replacements.set(owner.id, { ...replacements.get(owner.id)!, advanceWidth: nextAdvance });
        }
        changes.push({
          codePoint: cp,
          setName: def.label,
          set: setId,
          name: owner.name,
          mode: ownerHasArt ? 'replace' : existing === 'fillBlank' ? 'fill' : 'replace',
          glyphId: owner.id,
          gridWidth: pixel.width,
          gridHeight: pixel.height,
          unitsPerCell: pixel.unitsPerCell,
          advanceWidth: nextAdvance,
          blank: !(art?.inked ?? false),
          templateGlyphId: template?.glyph.id ?? null,
          templateLabel: template ? template.glyph.name : null,
          scale: template?.scale ?? 1,
          replacedArtwork: ownerHasArt,
        });
        return;
      }

      // --- create a new glyph
      if (ownedByNotdef) removedNotdefPoints.push(cp);
      const isLarge = setId === 'largeDigits';
      const name = isLarge ? largeDigitName(index) : suggestGlyphName(cp) ?? `uni${cp.toString(16).toUpperCase()}`;
      let advance = defaultAdvanceFor(working, setId);
      if (isLarge) {
        const std = glyphForCodePoint(working.glyphs, 0x30 + index);
        if (std && glyphHasArtwork(std)) advance = Math.round(std.advanceWidth * (template?.scale ?? 1));
      }
      const built = buildGlyph(working, cp, name, grid, advance, template);
      warnings.push(...built.warnings);
      addedGlyphs.push(built.glyph);
      changes.push({
        codePoint: cp,
        setName: def.label,
        set: setId,
        name,
        mode: 'create',
        glyphId: built.glyph.id,
        gridWidth: built.glyph.pixel!.width,
        gridHeight: built.glyph.pixel!.height,
        unitsPerCell: built.glyph.pixel!.unitsPerCell,
        advanceWidth: built.glyph.advanceWidth,
        blank: built.glyph.kind === 'empty',
        templateGlyphId: template?.glyph.id ?? null,
        templateLabel: template ? template.glyph.name : null,
        scale: template?.scale ?? 1,
        replacedArtwork: false,
      });
    });
  }

  if (removedNotdefPoints.length) {
    warnings.push(
      `${removedNotdefPoints.length} code point(s) that were mapped to .notdef now belong to real glyphs: ${removedNotdefPoints
        .map((cp) => describeCodePoint(cp))
        .join(', ')}.`,
    );
  }

  let glyphs = replacements.size ? working.glyphs.map((g) => replacements.get(g.id) ?? g) : working.glyphs;
  if (removedNotdefPoints.length) {
    const drop = new Set(removedNotdefPoints);
    glyphs = glyphs.map((g) => {
      if (g.name !== '.notdef') return g;
      let next = g;
      for (const cp of drop) next = withoutCodePoint(next, cp);
      return next;
    });
  }
  if (addedGlyphs.length) glyphs = [...glyphs, ...addedGlyphs];

  // Nothing to do (every character kept) → hand back the very same document, so
  // the caller does not record an empty undo step or mark the font dirty.
  const nextDoc: FontDoc =
    changes.length === 0 && working === doc
      ? doc
      : {
          ...working,
          glyphs,
          ...(opts.altDigitPoints || requested.includes('largeDigits') ? { altDigits: { codepoints: [...altPoints] } } : {}),
        };

  return {
    sets: requested,
    changes,
    additions: changes.filter((c) => c.mode === 'create'),
    fills: changes.filter((c) => c.mode === 'fill'),
    replacements: changes.filter((c) => c.mode === 'replace'),
    skipped,
    altDigitPoints: altPoints,
    warnings,
    nextDoc,
  };
}

/** Plan + apply the "add only what is missing" defaults in one call. */
export function addMissingSets(doc: FontDoc, opts: AddSetsOptions): { doc: FontDoc; plan: AddSetsPlan } {
  const plan = planAddSets(doc, opts);
  return { doc: plan.nextDoc, plan };
}

/** Every set that still has a missing or blank character (drives the "repair" buttons). */
export function incompleteSetIds(doc: FontDoc): CharSetId[] {
  return CHAR_SETS.filter((def) =>
    pointsForSet(def.id, doc).some((cp) => {
      const g = glyphForCodePoint(doc.glyphs, cp);
      return !g || g.name === '.notdef' || !glyphHasArtwork(g);
    }),
  ).map((def) => def.id);
}

/**
 * Add exactly one missing character (clicking a placeholder in the "Missing"
 * grid). The plan of the whole set is computed and then reduced to that one
 * character, so the result is identical to adding it through the dialog.
 * Returns the unchanged document when the character already has artwork.
 */
export function addSingleCharacter(
  doc: FontDoc,
  cp: number,
  opts: Omit<AddSetsOptions, 'sets'> = {},
): { doc: FontDoc; plan: AddSetsPlan | null } {
  const owner = glyphForCodePoint(doc.glyphs, cp);
  if (owner && owner.name !== '.notdef' && glyphHasArtwork(owner)) return { doc, plan: null };
  const setId = findSetOfPoint(doc, cp) ?? 'punct';
  const full = planAddSets(doc, { ...opts, sets: [setId] });
  const kept = full.changes.filter((c) => c.codePoint === cp);
  if (!kept.length) return { doc, plan: null };
  // drop the glyphs the plan would have added for the other characters of the set
  const dropIds = new Set(full.additions.filter((c) => c.codePoint !== cp).map((c) => c.glyphId!));
  const glyphs = full.nextDoc.glyphs.filter((g) => !dropIds.has(g.id));
  const nextDoc: FontDoc = { ...full.nextDoc, glyphs };
  return {
    doc: nextDoc,
    plan: {
      ...full,
      changes: kept,
      additions: kept.filter((c) => c.mode === 'create'),
      fills: kept.filter((c) => c.mode === 'fill'),
      replacements: kept.filter((c) => c.mode === 'replace'),
      nextDoc,
    },
  };
}

/** Which required set a code point belongs to (null when it is none of them). */
export function findSetOfPoint(doc: FontDoc, cp: number): CharSetId | null {
  for (const def of CHAR_SETS) if (pointsForSet(def.id, doc).includes(cp)) return def.id;
  return null;
}
