/** Document mutators — pure functions returning a new FontDoc. */
import type { Contour, FontDoc, GlyphDoc, PixelData } from '../core/types';
import { makeId } from '../core/types';
import { emptyGlyphDoc } from '../core/fontCodec';
import { resizedPixelData } from '../core/fontFactory';
import { bytesToB64 } from '../core/bitmap';
import { suggestGlyphName } from '../core/unicodeNames';
import { validateUnicodeAssignment } from '../core/transfer';
import { contourBounds } from '../core/contours';

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
  return withGlyphMap(doc, glyphId, (g) => ({ ...g, pixel, kind: pixel.cellsB64.length ? 'pixel' : g.kind, edited: true }));
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
  const pixel = resizedPixelData(g.pixel, width, height, mode);
  return withGlyphMap(doc, glyphId, (gl) => ({ ...gl, pixel, edited: true }));
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

export function markSaved(doc: FontDoc): FontDoc {
  return doc;
}

export function updateMetrics(doc: FontDoc, metrics: FontDoc['metrics']): FontDoc {
  if (metrics.unitsPerEm < 16 || metrics.unitsPerEm > 16384) throw new Error('unitsPerEm must be 16–16384.');
  if (metrics.ascent <= 0) throw new Error('Ascent must be positive.');
  if (metrics.descent >= 0) throw new Error('Descent must be negative.');
  return { ...doc, metrics: { ...metrics, unitsPerEm: Math.round(metrics.unitsPerEm), ascent: Math.round(metrics.ascent), descent: Math.round(metrics.descent), lineGap: Math.round(metrics.lineGap) } };
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

export function makeEmptyGlyph(doc: FontDoc, unicode: number | null, name?: string): GlyphDoc {
  const template = doc.glyphs.find((g) => g.pixel)?.pixel;
  const g = emptyGlyphDoc(name || suggestGlyphName(unicode, doc.glyphs.length) || 'glyph', template ? template.width * template.unitsPerCell : Math.round(doc.metrics.unitsPerEm / 2));
  g.unicode = unicode;
  if (template) {
    g.pixel = { ...template, cellsB64: bytesToB64(new Uint8Array(template.width * template.height)) };
    g.kind = unicode === 0x20 ? 'empty' : 'pixel';
  }
  return g;
}
