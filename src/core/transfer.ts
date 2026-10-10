/**
 * Copy glyphs between Font A and Font B.
 * Never relies on glyph indices matching between fonts: transfer is
 * identity-based (ids, code points) and outlines are copied by value.
 */
import type { FontDoc, GlyphDoc } from './types';
import { makeId } from './types';
import { cloneContours, scaleContours, contourBounds } from './contours';
import { resolveGlyphContours, flattenedGlyph } from './fontCodec';
import { suggestGlyphName } from './unicodeNames';
import { conformGlyphToLed, ledFontScale } from './ledMatrix';

export type MetricsMode = 'preserve' | 'adapt';
export type CollisionStrategy = 'replace' | 'skip' | 'reassign';

export interface TransferOptions {
  metricsMode: MetricsMode;
  /** Scale outlines/metrics proportionally to the units-per-em ratio. */
  scaleByUpm: boolean;
  collision: CollisionStrategy;
  /** Per source-glyph-id replacement code point (or null to unmap) for 'reassign'. */
  reassignments?: Record<string, number | null>;
}

export interface TransferConflict {
  glyphId: string;
  glyphName: string;
  unicode: number;
  /** id of the destination glyph currently mapped to the code point */
  existingId: string;
}

export interface TransferResult {
  doc: FontDoc;
  copied: number;
  skipped: number;
  replaced: number;
  reassigned: number;
  flattenedComposites: number;
  notes: string[];
  /** Source glyph ids that were actually copied (skips and conflicts excluded). */
  copiedSourceIds: string[];
}

export function findConflicts(src: FontDoc, dst: FontDoc, glyphIds: string[]): TransferConflict[] {
  const dstMap = new Map<number, string>();
  dst.glyphs.forEach((g) => {
    if (g.unicode !== null) dstMap.set(g.unicode, g.id);
  });
  const out: TransferConflict[] = [];
  for (const id of glyphIds) {
    const g = src.glyphs.find((x) => x.id === id);
    if (!g || g.unicode === null) continue;
    const existing = dstMap.get(g.unicode);
    if (existing) out.push({ glyphId: id, glyphName: g.name, unicode: g.unicode, existingId: existing });
  }
  return out;
}

/** Copy one glyph's content into the destination font's unit space. */
export function adaptGlyph(g: GlyphDoc, src: FontDoc, dst: FontDoc, scale: number, reassignTo?: number | null): GlyphDoc {
  const s = scale;
  // An LED destination maps the design onto its own grid, so outlines must not
  // be pre-scaled by the units-per-em ratio — conformGlyphToLed scales them.
  const contourScale = dst.ledMatrix ? 1 : s;
  const copy: GlyphDoc = {
    ...g,
    id: makeId('g'),
    srcIndex: null,
    sourceContours: null,
    instructions: null,
    edited: false,
    compound: null,
    contours: [],
    pixel: null,
    unicode: reassignTo === undefined ? g.unicode : reassignTo,
  };

  if (g.kind === 'compound' && g.compound) {
    // Flatten safely: cross-font component references cannot be preserved
    // unless every component is also copied; flattening is the safe default.
    const flat = flattenedGlyph(g, src.glyphs);
    copy.contours = scaleContours(flat.contours, contourScale);
    copy.kind = flat.contours.length ? 'vector' : 'empty';
  } else if (g.kind === 'pixel' && g.pixel) {
    copy.pixel = {
      ...g.pixel,
      cellsB64: g.pixel.cellsB64,
      unitsPerCell: Math.max(1, Math.round(g.pixel.unitsPerCell * s)),
      offsetX: Math.round(g.pixel.offsetX * s),
      baselineRow: g.pixel.baselineRow,
      width: g.pixel.width,
      height: g.pixel.height,
    };
    copy.kind = 'pixel';
  } else {
    copy.contours = scaleContours(cloneContours(g.contours), contourScale);
    copy.kind = g.contours.length ? 'vector' : g.kind === 'vector' ? 'empty' : g.kind;
    if (copy.kind === 'compound') copy.kind = 'vector';
  }

  copy.advanceWidth = Math.round(g.advanceWidth * s);
  copy.leftSideBearing = Math.round(g.leftSideBearing * s);
  if (!copy.name) copy.name = suggestGlyphName(copy.unicode) || g.name;

  // Destination is an LED matrix font: fit the source design onto its exact
  // pixel grid. The matrix decides the mapping, so the outlines are handed
  // over unscaled and conformGlyphToLed applies the font-wide LED scale.
  if (dst.ledMatrix) {
    return conformGlyphToLed(copy, dst.ledMatrix, (x) => x.contours, {
      scale: ledFontScale(src, dst.ledMatrix, (x) => resolveGlyphContours(x, src.glyphs)),
    });
  }
  return copy;
}

export function transferGlyphs(src: FontDoc, dst: FontDoc, glyphIds: string[], opts: TransferOptions): TransferResult {
  const scale = opts.scaleByUpm ? dst.metrics.unitsPerEm / src.metrics.unitsPerEm : 1;
  const notes: string[] = [];
  const conflicts = new Map(findConflicts(src, dst, glyphIds).map((c) => [c.glyphId, c]));

  let glyphs = [...dst.glyphs];
  const unicodeIndex = () => {
    const m = new Map<number, number>();
    glyphs.forEach((g, i) => {
      if (g.unicode !== null) m.set(g.unicode, i);
    });
    return m;
  };

  let copied = 0, skipped = 0, replaced = 0, reassigned = 0, flattenedComposites = 0;
  const copiedSourceIds: string[] = [];

  for (const id of glyphIds) {
    const g = src.glyphs.find((x) => x.id === id);
    if (!g) continue;
    const conflict = conflicts.get(id);
    let targetUnicode: number | null = g.unicode;

    if (conflict) {
      if (opts.collision === 'skip') {
        skipped += 1;
        continue;
      }
      if (opts.collision === 'reassign') {
        const chosen = opts.reassignments?.[id] !== undefined ? opts.reassignments![id] : null;
        if (chosen !== null) {
          const uIdx = unicodeIndex();
          if (uIdx.has(chosen)) {
            notes.push(`Skipped "${g.name}": replacement U+${chosen.toString(16).toUpperCase()} is also in use.`);
            skipped += 1;
            continue;
          }
        }
        targetUnicode = chosen;
        reassigned += 1;
      }
      if (opts.collision === 'replace') {
        const idx = glyphs.findIndex((x) => x.id === conflict.existingId);
        if (idx > 0) {
          glyphs[idx] = { ...glyphs[idx], unicode: null }; // unmap, keep glyph
        }
        replaced += 1;
      }
    }

    const adapted = adaptGlyph(g, src, dst, scale, targetUnicode);
    if (g.kind === 'compound') flattenedComposites += 1;

    // LED destinations keep grid-derived metrics (whole pixels), so skip adapt.
    if (opts.metricsMode === 'adapt' && adapted.kind !== 'empty' && !dst.ledMatrix) {
      // recompute advance from the copied outline extents, keeping the
      // source's right side bearing scaled proportionally
      const contours = adapted.kind === 'pixel' && adapted.pixel
        ? []
        : adapted.contours;
      const bb = contourBounds(contours);
      if (bb) {
        const rsb = Math.max(0, Math.round((g.advanceWidth - g.leftSideBearing - (contourBounds(g.contours)?.xMax ?? 0)) * scale));
        adapted.advanceWidth = Math.round(bb.xMax + rsb);
        adapted.leftSideBearing = bb.xMin;
        if (adapted.kind === 'vector') {
          // keep outlines at their coordinates; LSB equals bbox min-x
        }
      }
    }
    glyphs.push(adapted);
    copiedSourceIds.push(id);
    copied += 1;
  }

  if (flattenedComposites > 0) {
    notes.push(`${flattenedComposites} composite glyph(s) were flattened to simple outlines during transfer (components are not shared between fonts).`);
  }
  return { doc: { ...dst, glyphs }, copied, skipped, replaced, reassigned, flattenedComposites, notes, copiedSourceIds };
}

/**
 * Source font after a MOVE: the given glyphs are removed. `.notdef` is never
 * removed. Composite references into removed glyphs are detached (flattened on
 * export), mirroring removeGlyphs().
 */
export function sourceAfterMove(src: FontDoc, movedIds: string[]): FontDoc {
  const drop = new Set(movedIds.filter((id) => src.glyphs.some((g) => g.id === id && g.name !== '.notdef')));
  if (drop.size === 0) return src;
  const glyphs = src.glyphs
    .filter((g) => !drop.has(g.id))
    .map((g) =>
      g.kind === 'compound' && g.compound?.some((c) => c.glyphId && drop.has(c.glyphId))
        ? { ...g, compound: g.compound.map((c) => (c.glyphId && drop.has(c.glyphId) ? { ...c, glyphId: null } : c)) }
        : g,
    );
  return { ...src, glyphs };
}

/** Validate a proposed unicode reassignment inside one font. */
export function validateUnicodeAssignment(doc: FontDoc, glyphId: string, unicode: number | null): string | null {
  if (unicode === null) return null;
  const glyph = doc.glyphs.find((g) => g.id === glyphId);
  if (!glyph) return 'Unknown glyph.';
  if (glyph.name === '.notdef') return '.notdef must stay unmapped.';
  const clash = doc.glyphs.find((g) => g.unicode === unicode && g.id !== glyphId);
  if (clash) return `U+${unicode.toString(16).toUpperCase()} is already assigned to "${clash.name}". Unassign it first or pick another value.`;
  return null;
}
