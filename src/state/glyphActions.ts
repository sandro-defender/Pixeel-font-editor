/** Document mutators — pure functions returning a new FontDoc. */
import type { Contour, FontDoc, GlyphDoc, LedMatrixSpec, PixelData } from '../core/types';
import { makeId } from '../core/types';
import { emptyGlyphDoc, resolveGlyphContours } from '../core/fontCodec';
import { resizedPixelData } from '../core/fontFactory';
import { Bitmap, bytesToB64 } from '../core/bitmap';
import { suggestGlyphName } from '../core/unicodeNames';
import { validateUnicodeAssignment } from '../core/transfer';
import { contourBounds } from '../core/contours';
import { conformGlyphToLed, designSpan, ledAdvance, ledMetrics, ledScaleFromSpan, normalizeLedSpec } from '../core/ledMatrix';

export function withGlyph(doc: FontDoc, glyphId: string, next: GlyphDoc): FontDoc {
  return { ...doc, glyphs: doc.glyphs.map((g) => (g.id === glyphId ? next : g)) };
}

export function addGlyph(doc: FontDoc, glyph: GlyphDoc): FontDoc {
  return { ...doc, glyphs: [...doc.glyphs, glyph] };
}

export function removeGlyphs(doc: FontDoc, ids: string[]): FontDoc {
  const blocked = doc.glyphs.filter((g) => ids.includes(g.id) && g.name === '.notdef');
  if (blocked.length) throw new Error('.notdef cannot be deleted — every font needs it.');
  const drop = new Set(ids);
  const glyphs = doc.glyphs.filter((g) => !drop.has(g.id));
  // purge compound references into deleted glyphs by flattening dependents
  const fixed = glyphs.map((g) => {
    if (g.kind === 'compound' && g.compound?.some((c) => c.glyphId && drop.has(c.glyphId))) {
      return { ...g, compound: g.compound.map((c) => (c.glyphId && drop.has(c.glyphId) ? { ...c, glyphId: null } : c)) };
    }
    return g;
  });
  return { ...doc, glyphs: fixed };
}

export function duplicateGlyph(doc: FontDoc, glyphId: string, insertAfter = true): { doc: FontDoc; copy: GlyphDoc } {
  const idx = doc.glyphs.findIndex((g) => g.id === glyphId);
  if (idx < 0) throw new Error('Glyph not found.');
  const src = doc.glyphs[idx];
  const copy: GlyphDoc = {
    ...src,
    id: makeId('g'),
    unicode: null, // never silently steal a code point
    name: src.name === '.notdef' ? 'notdefCopy' : `${src.name}.copy`,
    contours: src.contours.map((c) => c.map((p) => ({ ...p }))),
    pixel: src.pixel ? { ...src.pixel } : null,
    compound: src.compound ? src.compound.map((c) => ({ ...c, transform: { ...c.transform } })) : null,
    sourceContours: src.sourceContours ? src.sourceContours.map((c) => c.map((p) => ({ ...p }))) : null,
    instructions: null,
    edited: true,
    srcIndex: null,
  };
  const glyphs = [...doc.glyphs];
  glyphs.splice(insertAfter ? idx + 1 : doc.glyphs.length, 0, copy);
  return { doc: { ...doc, glyphs }, copy };
}

export function assignUnicode(doc: FontDoc, glyphId: string, unicode: number | null): FontDoc {
  const err = validateUnicodeAssignment(doc, glyphId, unicode);
  if (err) throw new Error(err);
  const glyphs = doc.glyphs.map((g) =>
    g.id === glyphId
      ? { ...g, unicode, name: g.name.startsWith('.glyph') || !g.name ? suggestGlyphName(unicode) ?? g.name : g.name }
      : g,
  );
  return { ...doc, glyphs };
}

export function renameGlyph(doc: FontDoc, glyphId: string, name: string): FontDoc {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Glyph name cannot be empty.');
  if (doc.glyphs.some((g) => g.id !== glyphId && g.name === trimmed)) {
    throw new Error(`A glyph named "${trimmed}" already exists.`);
  }
  return withGlyphMap(doc, glyphId, (g) => ({ ...g, name: trimmed }));
}

export function withGlyphMap(doc: FontDoc, glyphId: string, fn: (g: GlyphDoc) => GlyphDoc): FontDoc {
  return { ...doc, glyphs: doc.glyphs.map((g) => (g.id === glyphId ? fn(g) : g)) };
}

export function setPixelData(doc: FontDoc, glyphId: string, pixel: PixelData): FontDoc {
  return withGlyphMap(doc, glyphId, (g) => ({ ...g, pixel, kind: 'pixel', edited: true }));
}

export function setContours(doc: FontDoc, glyphId: string, contours: Contour[]): FontDoc {
  return withGlyphMap(doc, glyphId, (g) => ({
    ...g,
    contours,
    kind: contours.length ? 'vector' : g.kind === 'vector' ? 'empty' : g.kind,
    compound: null,
    edited: true,
    instructions: null,
  }));
}

export function setAdvance(doc: FontDoc, glyphId: string, advance: number): FontDoc {
  if (!Number.isFinite(advance) || advance < 0 || advance > 0xffff) throw new Error('Advance width must be 0–65535.');
  return withGlyphMap(doc, glyphId, (g) => ({ ...g, advanceWidth: Math.round(advance), edited: true }));
}

/** Changing the LSB translates the glyph content so bearings stay truthful. */
export function setLeftSideBearing(doc: FontDoc, glyphId: string, lsb: number): FontDoc {
  if (!Number.isFinite(lsb) || Math.abs(lsb) > 0x7fff) throw new Error('Side bearing out of range.');
  const g = doc.glyphs.find((x) => x.id === glyphId);
  if (!g) return doc;
  const delta = Math.round(lsb) - g.leftSideBearing;
  if (delta === 0) return doc;
  return withGlyphMap(doc, glyphId, (gl) => {
    const next: GlyphDoc = { ...gl, leftSideBearing: Math.round(lsb), edited: true };
    if (gl.kind === 'vector') {
      next.contours = gl.contours.map((c) => c.map((p) => ({ ...p, x: p.x + delta })));
    } else if (gl.kind === 'pixel' && gl.pixel) {
      next.pixel = { ...gl.pixel, offsetX: gl.pixel.offsetX + delta };
    }
    return next;
  });
}

export function resizeGrid(doc: FontDoc, glyphId: string, width: number, height: number, mode: 'crop' | 'center' | 'resample'): FontDoc {
  const g = doc.glyphs.find((x) => x.id === glyphId);
  if (!g?.pixel) throw new Error('Glyph has no pixel grid.');
  if (doc.ledMatrix && height !== doc.ledMatrix.rows) {
    throw new Error(`LED matrix fonts are ${doc.ledMatrix.rows} pixels tall; only the width can change.`);
  }
  const pixel = resizedPixelData(g.pixel, width, height, mode);
  return withGlyphMap(doc, glyphId, (gl) => ({
    ...gl,
    pixel,
    // LED glyphs advance by their own width plus the matrix letter spacing.
    advanceWidth: doc.ledMatrix ? ledAdvance(doc.ledMatrix, width) : gl.advanceWidth,
    edited: true,
  }));
}

/** Contours of a glyph in its own font (composites flattened). */
function contoursIn(doc: FontDoc): (g: GlyphDoc) => Contour[] {
  return (g) => resolveGlyphContours(g, doc.glyphs);
}

/**
 * Scale that maps this font's design onto an LED matrix. Vector and composite
 * glyphs are rasterized through it, so a font with a 1000–2048 unit em keeps
 * its full height on a small matrix instead of being clipped to its bottom
 * rows (which used to make every letter disappear).
 *
 * Once the outlines are gone (a converted font), the span recorded when LED
 * mode was enabled is used, so re-snapping a single glyph still lands on the
 * same scale as the bulk conversion.
 */
export function ledScaleFor(doc: FontDoc, spec: LedMatrixSpec): number {
  // The design recorded when LED mode was enabled is the reference — after a
  // conversion the font's own metrics are the matrix's, so they would map the
  // design 1:1 and undo the fitting.
  const source =
    doc.ledSource ?? { span: designSpan(doc, contoursIn(doc)), ascent: doc.metrics.ascent, descent: doc.metrics.descent };
  return ledScaleFromSpan(source.span, spec, source.ascent, source.descent);
}

/**
 * Turn a font into an LED matrix (exact-pixel) font, or switch LED mode off
 * (`null` keeps all glyph data and metrics as they are).
 * Turning it on snaps every glyph to the matrix: pixel grids are re-anchored
 * (and proportionally resampled when an existing matrix's height changes),
 * vector outlines are scaled onto the matrix and rasterized, and metrics
 * become whole pixels.
 */
export function applyLedMatrix(doc: FontDoc, spec: LedMatrixSpec | null): FontDoc {
  if (!spec) return { ...doc, ledMatrix: null, ledSource: null };
  const s = normalizeLedSpec(spec);
  const contoursOf = contoursIn(doc);
  const scale = ledScaleFor(doc, s);
  // A smaller matrix is a smaller rendition, not a crop of the old glyph.
  // Scale current pixels rather than sourceContours so edits survive resizing.
  const pixelScale = doc.ledMatrix ? s.rows / doc.ledMatrix.rows : undefined;
  const glyphs = doc.glyphs.map((g) => (g.name === '.notdef' ? g : conformGlyphToLed(g, s, contoursOf, { scale, pixelScale })));
  // Remember the design so later single-glyph snaps use the same scale.
  const hasVector = doc.glyphs.some((g) => !g.pixel && (g.kind === 'vector' || g.kind === 'compound' || g.contours.length > 0));
  const ledSource = hasVector ? { span: designSpan(doc, contoursOf), ascent: doc.metrics.ascent, descent: doc.metrics.descent } : doc.ledSource ?? null;
  return { ...doc, ledMatrix: s, ledSource, metrics: ledMetrics(s), glyphs };
}

/** Snap a single glyph onto the font's LED matrix (rasterizes vector outlines). */
export function snapGlyphToLed(doc: FontDoc, glyphId: string): FontDoc {
  if (!doc.ledMatrix) throw new Error('This font is not an LED matrix font.');
  const spec = doc.ledMatrix;
  const contoursOf = contoursIn(doc);
  const scale = ledScaleFor(doc, spec);
  return withGlyphMap(doc, glyphId, (g) => (g.name === '.notdef' ? g : conformGlyphToLed(g, spec, contoursOf, { scale })));
}

/**
 * Replace a pixel glyph's bitmap (text / column-byte entry). The glyph keeps its
 * grid placement; LED fonts also get the matching whole-pixel advance.
 */
export function setGlyphBitmap(doc: FontDoc, glyphId: string, bm: Bitmap): FontDoc {
  const target = doc.glyphs.find((g) => g.id === glyphId);
  if (!target) throw new Error('Glyph not found.');
  if (!target.pixel) throw new Error('This glyph has no pixel grid.');
  if (doc.ledMatrix && bm.height !== doc.ledMatrix.rows) {
    throw new Error(`LED matrix fonts are ${doc.ledMatrix.rows} pixels tall.`);
  }
  return withGlyphMap(doc, glyphId, (g) => ({
    ...g,
    pixel: { ...g.pixel!, width: bm.width, height: bm.height, cellsB64: bm.toB64() },
    advanceWidth: doc.ledMatrix ? ledAdvance(doc.ledMatrix, bm.width) : g.advanceWidth,
    kind: 'pixel',
    instructions: null,
    edited: true,
  }));
}

/** Recompute LSB from contour bbox (used after outline edits move points). */
export function syncLsbFromContours(doc: FontDoc, glyphId: string): FontDoc {
  const g = doc.glyphs.find((x) => x.id === glyphId);
  if (!g) return doc;
  const bb = contourBounds(g.contours);
  const lsb = bb ? bb.xMin : 0;
  if (lsb === g.leftSideBearing) return doc;
  return withGlyphMap(doc, glyphId, (gl) => ({ ...gl, leftSideBearing: lsb }));
}

export function revertToSource(doc: FontDoc, glyphId: string): FontDoc {
  const g = doc.glyphs.find((x) => x.id === glyphId);
  if (!g || !g.sourceContours) throw new Error('No original outline available for this glyph.');
  return withGlyphMap(doc, glyphId, (gl) => ({
    ...gl,
    contours: gl.sourceContours!.map((c) => c.map((p) => ({ ...p }))),
    pixel: null,
    kind: gl.sourceContours!.length ? 'vector' : 'empty',
    edited: false,
    instructions: gl.instructions,
  }));
}

/** Validate global vertical metrics; returns the rounded, checked values. Throws on invalid input. */
export function checkMetrics(metrics: FontDoc['metrics']): FontDoc['metrics'] {
  const values = [metrics.unitsPerEm, metrics.ascent, metrics.descent, metrics.lineGap];
  if (!values.every((v) => Number.isFinite(v))) throw new Error('Metrics must be numbers.');
  if (metrics.unitsPerEm < 16 || metrics.unitsPerEm > 16384) throw new Error('unitsPerEm must be 16–16384.');
  if (metrics.ascent <= 0) throw new Error('Ascent must be positive.');
  if (metrics.descent >= 0) throw new Error('Descent must be negative.');
  return {
    unitsPerEm: Math.round(metrics.unitsPerEm),
    ascent: Math.round(metrics.ascent),
    descent: Math.round(metrics.descent),
    lineGap: Math.round(metrics.lineGap),
  };
}

export function updateMetrics(doc: FontDoc, metrics: FontDoc['metrics']): FontDoc {
  const checked = checkMetrics(metrics);
  return { ...doc, metrics: checked };
}

/** Give an outline-less glyph a blank pixel grid matching the font's template. */
export function initializePixelGrid(doc: FontDoc, glyphId: string): FontDoc {
  const template = doc.glyphs.find((g) => g.pixel)?.pixel;
  if (!template) throw new Error('This font has no pixel grid template (create a pixel font first).');
  return withGlyphMap(doc, glyphId, (g) =>
    g.pixel
      ? g
      : { ...g, pixel: { ...template, cellsB64: bytesToB64(new Uint8Array(template.width * template.height)) }, kind: 'pixel' },
  );
}

export function setGlyphSymmetry(doc: FontDoc, glyphId: string, symmetry: import('../core/types').SymmetryMode): FontDoc {
  return withGlyphMap(doc, glyphId, (g) => ({ ...g, symmetry }));
}

export function makeEmptyGlyph(doc: FontDoc, unicode: number | null, name?: string): GlyphDoc {
  const template = doc.glyphs.find((g) => g.pixel)?.pixel;
  const advance = template
    ? doc.ledMatrix
      ? ledAdvance(doc.ledMatrix, template.width)
      : template.width * template.unitsPerCell
    : Math.round(doc.metrics.unitsPerEm / 2);
  const g = emptyGlyphDoc(name || suggestGlyphName(unicode, doc.glyphs.length) || 'glyph', advance);
  g.unicode = unicode;
  if (template) {
    g.pixel = { ...template, cellsB64: bytesToB64(new Uint8Array(template.width * template.height)) };
    g.kind = unicode === 0x20 ? 'empty' : 'pixel';
  }
  return g;
}
