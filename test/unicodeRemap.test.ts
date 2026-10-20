import { describe, expect, it } from 'vitest';
import { newTestFont, drawGlyph } from './helpers';
import { allUnicodes } from '../src/core/unicodeMap';
import {
  findUnicodeRemapConflicts,
  remapGlyphs,
  unicodeRemapTargets,
} from '../src/core/unicodeRemap';
import { DEFAULT_LARGE_DIGIT_POINTS, GEORGIAN_MKHEDRULI_POINTS } from '../src/core/charSets';

function digitsFont() {
  let doc = newTestFont(8, 8, 'Remap test');
  for (let i = 0; i < 10; i++) {
    doc = drawGlyph(doc, 0x30 + i, (bitmap) => bitmap.set(i % 8, 2, 1)).doc;
    doc = drawGlyph(doc, DEFAULT_LARGE_DIGIT_POINTS[i], (bitmap) => bitmap.set(i % 8, 3, 1)).doc;
  }
  return doc;
}

describe('bulk Unicode remapping', () => {
  it('creates the destination sequences for ASCII, Georgian, and custom ranges', () => {
    expect(unicodeRemapTargets('digits', 10)).toEqual(Array.from({ length: 10 }, (_, i) => 0x30 + i));
    expect(unicodeRemapTargets('georgian', 33)).toEqual(GEORGIAN_MKHEDRULI_POINTS);
    expect(unicodeRemapTargets('ascii', 3)).toEqual([0x20, 0x21, 0x22]);
    expect(unicodeRemapTargets('custom', 3, 0xe100)).toEqual([0xe100, 0xe101, 0xe102]);
    expect(() => unicodeRemapTargets('digits', 11)).toThrow(/contains 10 code points/);
    expect(() => unicodeRemapTargets('custom', 3, 0xd7ff)).toThrow(/surrogate/);
  });

  it('moves selected glyph mappings as one batch and keeps the glyph artwork and metrics', () => {
    const doc = digitsFont();
    const large = DEFAULT_LARGE_DIGIT_POINTS.map((cp) => doc.glyphs.find((g) => g.unicode === cp)!);
    const beforePixels = large.map((g) => g.pixel?.cellsB64);
    const beforeAdvances = large.map((g) => g.advanceWidth);
    const standard = Array.from({ length: 10 }, (_, i) => doc.glyphs.find((g) => g.unicode === 0x30 + i)!);
    const ids = large.map((g) => g.id);

    expect(findUnicodeRemapConflicts(doc, ids, Array.from({ length: 10 }, (_, i) => 0x30 + i), 'move')).toHaveLength(10);

    const next = remapGlyphs(doc, ids, Array.from({ length: 10 }, (_, i) => 0x30 + i), {
      mode: 'move',
      takeExistingMappings: true,
    });
    expect(next).not.toBe(doc);
    expect(large.map((g) => next.glyphs.find((x) => x.id === g.id)!.unicode)).toEqual(Array.from({ length: 10 }, (_, i) => 0x30 + i));
    expect(large.map((g) => allUnicodes(next.glyphs.find((x) => x.id === g.id)!))).toEqual(Array.from({ length: 10 }, (_, i) => [0x30 + i]));
    expect(large.map((g) => next.glyphs.find((x) => x.id === g.id)!.pixel?.cellsB64)).toEqual(beforePixels);
    expect(large.map((g) => next.glyphs.find((x) => x.id === g.id)!.advanceWidth)).toEqual(beforeAdvances);
    expect(standard.map((g) => allUnicodes(next.glyphs.find((x) => x.id === g.id)!))).toEqual(Array.from({ length: 10 }, () => []));
    // The losing glyphs are still present and still carry their artwork.
    expect(standard.every((g) => next.glyphs.some((x) => x.id === g.id && x.pixel?.cellsB64 === g.pixel?.cellsB64))).toBe(true);
    expect(() => remapGlyphs(doc, ids, Array.from({ length: 10 }, (_, i) => 0x30 + i))).toThrow(/already mapped/);
  });

  it('can add ASCII mappings without discarding the alternative-digit code points', () => {
    const doc = digitsFont();
    const large = DEFAULT_LARGE_DIGIT_POINTS.map((cp) => doc.glyphs.find((g) => g.unicode === cp)!);
    const standard = Array.from({ length: 10 }, (_, i) => doc.glyphs.find((g) => g.unicode === 0x30 + i)!);
    const ids = large.map((g) => g.id);
    const next = remapGlyphs(doc, ids, Array.from({ length: 10 }, (_, i) => 0x30 + i), {
      mode: 'alias',
      takeExistingMappings: true,
    });
    ids.forEach((id, i) => {
      const glyph = next.glyphs.find((g) => g.id === id)!;
      expect(allUnicodes(glyph)).toEqual([DEFAULT_LARGE_DIGIT_POINTS[i], 0x30 + i]);
    });
    expect(standard.every((g) => allUnicodes(next.glyphs.find((x) => x.id === g.id)!).length === 0)).toBe(true);
  });

  it('rejects duplicate targets, missing glyphs, .notdef, and taking a mapping without permission', () => {
    const doc = digitsFont();
    const large0 = doc.glyphs.find((g) => g.unicode === DEFAULT_LARGE_DIGIT_POINTS[0])!;
    const large1 = doc.glyphs.find((g) => g.unicode === DEFAULT_LARGE_DIGIT_POINTS[1])!;
    expect(() => remapGlyphs(doc, [large0.id, large1.id], [0x41, 0x41])).toThrow(/same destination/);
    expect(() => remapGlyphs(doc, ['missing-id'], [0x41])).toThrow(/no longer exist/);
    expect(() => remapGlyphs(doc, [doc.glyphs[0].id], [0x41])).toThrow(/\.notdef/);
    expect(() => remapGlyphs(doc, [large0.id], [0x30])).toThrow(/Confirm that you want to take/);
  });
});
