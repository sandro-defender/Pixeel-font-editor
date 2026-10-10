import { describe, expect, it } from 'vitest';
import { createNewFont, basicSetGlyphs, georgianSetGlyphs } from '../src/core/fontFactory';
import { buildTtf } from '../src/core/fontCodec';
import { GEORGIAN_LETTER_POINTS, GEORGIAN_SCRIPT_RANGES, unicodeName } from '../src/core/unicodeNames';
import { parseTtf } from './helpers';

describe('complete Georgian Unicode support', () => {
  it('names modern, historic and capital letter forms across all four scripts', () => {
    expect(unicodeName(0x10f0)).toBe('GEORGIAN LETTER HAE');
    expect(unicodeName(0x10f1)).toBe('GEORGIAN LETTER HE');
    expect(unicodeName(0x10ff)).toBe('GEORGIAN LETTER LABIAL SIGN');
    expect(unicodeName(0x1c90)).toBe('GEORGIAN MTAVRULI CAPITAL LETTER AN');
    expect(unicodeName(0x1cbf)).toBe('GEORGIAN MTAVRULI CAPITAL LETTER LABIAL SIGN');
    expect(unicodeName(0x10a0)).toBe('GEORGIAN CAPITAL LETTER AN');
    expect(unicodeName(0x10cd)).toBe('GEORGIAN CAPITAL LETTER AEN');
    expect(unicodeName(0x2d00)).toBe('GEORGIAN SMALL LETTER AN');
    expect(unicodeName(0x2d2d)).toBe('GEORGIAN SMALL LETTER AEN');
  });

  it('exposes every assigned Georgian letter once in the four script sets', () => {
    expect(GEORGIAN_SCRIPT_RANGES.map((script) => script.points.length)).toEqual([46, 46, 40, 40]);
    expect(GEORGIAN_LETTER_POINTS).toHaveLength(172);
    expect(new Set(GEORGIAN_LETTER_POINTS).size).toBe(172);
    expect(GEORGIAN_LETTER_POINTS.every((point) => unicodeName(point)?.includes('LETTER'))).toBe(true);
  });

  it('keeps the basic Georgian starter set to the 33 modern Mkhedruli letters', () => {
    const doc = createNewFont({ familyName: 'Geo', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    const basic = basicSetGlyphs(doc);
    const mkhedruli = basic.filter((glyph) => glyph.unicode !== null && glyph.unicode >= 0x10d0 && glyph.unicode <= 0x10f0);
    expect(mkhedruli).toHaveLength(33);
    expect(mkhedruli.map((glyph) => glyph.unicode)).toContain(0x10f0);
  });

  it('creates the full 172-letter Georgian set with pixel grids and official names', () => {
    const doc = createNewFont({ familyName: 'Geo', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    const glyphs = georgianSetGlyphs(doc);
    expect(glyphs).toHaveLength(172);
    expect(glyphs.every((glyph) => glyph.pixel !== null)).toBe(true);
    expect(glyphs.map((glyph) => glyph.unicode)).toEqual(GEORGIAN_LETTER_POINTS);
    expect(new Set(glyphs.map((glyph) => glyph.unicode)).size).toBe(172);
  });

  it('round-trips all Georgian letter code points through TTF export', () => {
    const base = createNewFont({ familyName: 'GeoExport', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    const doc = { ...base, glyphs: [...base.glyphs, ...georgianSetGlyphs(base)] };
    const { buffer, report } = buildTtf({
      doc,
      sourceTtf: null,
      options: { preserveHinting: false, preserveKerning: false, validate: true },
    });
    expect(report.validation?.ok).toBe(true);
    const cmap = parseTtf(buffer).cmap as Record<string, number>;
    expect(GEORGIAN_LETTER_POINTS.every((point) => cmap[point] !== undefined)).toBe(true);
  });
});
