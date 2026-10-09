import { Bitmap } from '../src/core/bitmap';
import { createNewFont } from '../src/core/fontFactory';
import type { FontDoc, GlyphDoc, PixelData } from '../src/core/types';
import { makePixelGlyph } from '../src/core/fontFactory';
import { suggestGlyphName } from '../src/core/unicodeNames';

export function newTestFont(gridW = 8, gridH = 8, family = 'TestPixel'): FontDoc {
  return createNewFont({ familyName: family, styleName: 'Regular', gridWidth: gridW, gridHeight: gridH });
}

/**
 * Draw into (or create) a pixel glyph for a code point.
 * Uses the grid template of the font's first pixel glyph.
 */
export function drawGlyph(
  doc: FontDoc,
  cp: number,
  draw: (bm: Bitmap) => void,
): { doc: FontDoc; glyph: GlyphDoc } {
  const template = doc.glyphs.find((g) => g.pixel)?.pixel;
  if (!template) throw new Error('font has no pixel template glyph');
  let glyph = doc.glyphs.find((g) => g.unicode === cp);
  if (!glyph) {
    glyph = makePixelGlyph(cp, template.width, template.height, {
      unitsPerCell: template.unitsPerCell,
      baselineRow: template.baselineRow,
      defaultAdvance: template.width * template.unitsPerCell,
    });
    glyph.name = suggestGlyphName(cp);
  }
  const bm = Bitmap.fromB64(template.width, template.height, glyph.pixel!.cellsB64);
  draw(bm);
  const newPixel: PixelData = { ...glyph.pixel!, cellsB64: bm.toB64() };
  const newGlyph: GlyphDoc = { ...glyph, pixel: newPixel, kind: 'pixel', edited: true };
  const glyphs = doc.glyphs.some((g) => g.id === newGlyph.id)
    ? doc.glyphs.map((g) => (g.id === newGlyph.id ? newGlyph : g))
    : [...doc.glyphs, newGlyph];
  return { doc: { ...doc, glyphs }, glyph: newGlyph };
}

export function cellsOf(glyph: GlyphDoc): Bitmap {
  return Bitmap.fromB64(glyph.pixel!.width, glyph.pixel!.height, glyph.pixel!.cellsB64);
}
