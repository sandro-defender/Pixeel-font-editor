/** Create brand-new pixel fonts from scratch. */
import { Bitmap, bytesToB64 } from './bitmap';
import { EMPTY_META, deriveMetaFields, makePostScriptName } from './metadata';
import { emptyGlyphDoc } from './fontCodec';
import type { FontDoc, GlyphDoc, NewFontOptions, PixelData } from './types';
import { makeId } from './types';
import { suggestGlyphName, QUICK_RANGES } from './unicodeNames';
import { ledAdvance, ledLayout, ledMetrics, normalizeLedSpec, spaceWidthFor } from './ledMatrix';

export const DEFAULT_CELL_TARGET = 1024; // aim for 1024 unitsPerEm

export interface PixelFontLayout {
  unitsPerEm: number;
  unitsPerCell: number;
  ascent: number;
  descent: number;
  baselineRow: number;
  defaultAdvance: number;
}

/** Compute metrics so the whole grid spans exactly one em. */
export function computePixelLayout(gridWidth: number, gridHeight: number, descentRowsOverride?: number): PixelFontLayout {
  const unitsPerCell = Math.max(1, Math.round(DEFAULT_CELL_TARGET / gridHeight));
  const unitsPerEm = unitsPerCell * gridHeight;
  const descentRows = descentRowsOverride ?? Math.max(1, Math.round(gridHeight * 0.2));
  const baselineRow = Math.min(gridHeight - 1, Math.max(0, descentRows));
  return {
    unitsPerEm,
    unitsPerCell,
    ascent: unitsPerCell * (gridHeight - baselineRow),
    descent: -unitsPerCell * baselineRow,
    baselineRow,
    defaultAdvance: unitsPerCell * gridWidth,
  };
}

export function createNewFont(opts: NewFontOptions): FontDoc {
  if (opts.led) return createLedFont(opts);
  const layout = computePixelLayout(opts.gridWidth, opts.gridHeight, opts.descentRows);
  const family = opts.familyName.trim() || 'Untitled Pixel';
  const style = opts.styleName.trim() || 'Regular';
  const notdef = emptyGlyphDoc('.notdef', Math.round(layout.defaultAdvance / 2));
  notdef.srcIndex = 0;
  const space = makePixelGlyph(0x20, opts.gridWidth, opts.gridHeight, layout, true);
  space.advanceWidth = Math.round(layout.unitsPerCell * Math.max(2, Math.round(opts.gridWidth / 3)));
  return {
    fontId: makeId('f'),
    meta: deriveMetaFields({
      ...EMPTY_META,
      fontFamily: family,
      fontSubFamily: style,
      version: 'Version 1.000',
      manufacturer: 'Pixeel font editor',
      description: `Created from scratch with Pixeel (${opts.gridWidth}×${opts.gridHeight} pixel grid).`,
    }),
    metrics: {
      unitsPerEm: layout.unitsPerEm,
      ascent: layout.ascent,
      descent: layout.descent,
      lineGap: 0,
    },
    glyphs: [notdef, space],
    source: {
      fileName: `${makePostScriptName(family, style)}.pixeel`,
      format: 'created',
      tables: [],
      hasHinting: false,
      hasKerning: false,
      hasComposites: false,
      numGlyphs: 2,
      importedAt: Date.now(),
    },
    sourceRef: null,
  };
}

/** New LED matrix (exact-pixel) font: fixed rows, whole-pixel advances. */
export function createLedFont(opts: NewFontOptions): FontDoc {
  const spec = normalizeLedSpec(opts.led!);
  const layout = ledLayout(spec);
  const family = opts.familyName.trim() || 'Untitled LED';
  const style = opts.styleName.trim() || 'Regular';
  const notdef = emptyGlyphDoc('.notdef', Math.round(ledAdvance(spec, spec.cols) / 2));
  notdef.srcIndex = 0;
  const spaceWidth = spaceWidthFor(spec);
  const space = makePixelGlyph(0x20, spaceWidth, spec.rows, { ...layout, defaultAdvance: ledAdvance(spec, spaceWidth) }, true);
  space.advanceWidth = ledAdvance(spec, spaceWidth);
  return {
    fontId: makeId('f'),
    meta: deriveMetaFields({
      ...EMPTY_META,
      fontFamily: family,
      fontSubFamily: style,
      version: 'Version 1.000',
      manufacturer: 'Pixeel font editor',
      description: `LED matrix font, ${spec.cols}×${spec.rows} pixels per glyph, exact pixel outlines (${spec.cellUnits} font units per LED pixel).`,
    }),
    metrics: ledMetrics(spec),
    glyphs: [notdef, space],
    source: {
      fileName: `${makePostScriptName(family, style)}.pixeel`,
      format: 'created',
      tables: [],
      hasHinting: false,
      hasKerning: false,
      hasComposites: false,
      numGlyphs: 2,
      importedAt: Date.now(),
    },
    sourceRef: null,
    ledMatrix: spec,
  };
}

export function makePixelGlyph(
  unicode: number | null,
  width: number,
  height: number,
  layout: Pick<PixelFontLayout, 'unitsPerCell' | 'baselineRow' | 'defaultAdvance'>,
  empty = false,
): GlyphDoc {
  const cells = new Uint8Array(width * height);
  const pixel: PixelData = {
    width,
    height,
    cellsB64: bytesToB64(cells),
    unitsPerCell: layout.unitsPerCell,
    offsetX: 0,
    baselineRow: layout.baselineRow,
  };
  return {
    id: makeId('g'),
    name: suggestGlyphName(unicode),
    unicode,
    advanceWidth: Math.round(layout.defaultAdvance),
    leftSideBearing: 0,
    kind: empty ? 'empty' : 'pixel',
    contours: [],
    pixel,
    compound: null,
    instructions: null,
    sourceContours: null,
    edited: false,
    srcIndex: null,
  };
}

/** Add a starter set (basic Latin + digits + punctuation) as empty pixel glyphs. */
export function basicSetGlyphs(doc: FontDoc): GlyphDoc[] {
  const existing = new Set(doc.glyphs.map((g) => g.unicode).filter((u): u is number => u !== null));
  const layout = {
    unitsPerCell: doc.metrics.unitsPerEm / 16,
    baselineRow: 3,
    defaultAdvance: 0,
  };
  const template = doc.glyphs.find((g) => g.pixel)?.pixel;
  const width = template?.width ?? 8;
  const height = template?.height ?? 8;
  layout.unitsPerCell = template?.unitsPerCell ?? doc.metrics.unitsPerEm / height;
  layout.baselineRow = template?.baselineRow ?? 2;
  layout.defaultAdvance = doc.ledMatrix ? ledAdvance(doc.ledMatrix, width) : width * layout.unitsPerCell;

  const points = QUICK_RANGES.flatMap((r) => r.points).filter((cp) => !existing.has(cp));
  const seen = new Set<number>();
  const out: GlyphDoc[] = [];
  for (const cp of points) {
    if (seen.has(cp)) continue;
    seen.add(cp);
    out.push(makePixelGlyph(cp, width, height, layout, cp === 0x20));
  }
  return out;
}

/** Resize helper used by the grid-resize dialog (explicit crop/pad vs resample). */
export function resizedPixelData(
  pixel: NonNullable<GlyphDoc['pixel']>,
  newW: number,
  newH: number,
  mode: 'crop' | 'center' | 'resample',
): PixelData {
  const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
  const resized = bm.resized(newW, newH, mode);
  return { ...pixel, width: newW, height: newH, cellsB64: resized.toB64() };
}
