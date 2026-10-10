import { describe, expect, it } from 'vitest';
import { Bitmap } from '../src/core/bitmap';
import { bitmapToSvgPath, DEFAULT_GLYPH_DESIGN_STYLE, styleGlyphTemplate } from '../src/core/glyphDesigner';

describe('glyph design helpers', () => {
  it('leaves the template unchanged with the regular preset', () => {
    const source = new Bitmap(7, 7);
    source.line(2, 1, 2, 5, 1);
    source.line(2, 5, 4, 5, 1);
    const styled = styleGlyphTemplate(source, 1, DEFAULT_GLYPH_DESIGN_STYLE);
    expect(styled.equals(source)).toBe(true);
  });

  it('makes a visibly heavier glyph while keeping the original pixels', () => {
    const source = new Bitmap(7, 7);
    source.line(3, 1, 3, 5, 1);
    const bold = styleGlyphTemplate(source, 1, { ...DEFAULT_GLYPH_DESIGN_STYLE, weight: 1 });
    expect(bold.count()).toBeGreaterThan(source.count());
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        if (source.get(x, y)) expect(bold.get(x, y)).toBe(1);
      }
    }
  });

  it('uses the baseline and vertical nudge as the transform anchor', () => {
    const source = new Bitmap(5, 7);
    source.set(2, 3, 1);
    const raised = styleGlyphTemplate(source, 3, { ...DEFAULT_GLYPH_DESIGN_STYLE, verticalShift: 2 });
    expect(raised.get(2, 5)).toBe(1);
    expect(raised.get(2, 3)).toBe(0);
  });

  it('builds an SVG path from lit pixels for crisp previews', () => {
    const bitmap = new Bitmap(3, 2);
    bitmap.set(0, 0, 1);
    bitmap.set(2, 1, 1);
    expect(bitmapToSvgPath(bitmap)).toBe('M0 1h1v1h-1zM2 0h1v1h-1z');
  });
});
