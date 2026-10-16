/**
 * OS/2 fields the writer gets wrong.
 *
 * fonteditor-core's OS/2 `size()` sets `ulUnicodeRange2 = 268435456` — only
 * the "Private Use Area" bit — in every font it writes, and its `support`
 * hook cannot reach OS/2. Lato lost 1342237951, Quantico 1342177354.
 * The expected values below come from fontTools' `intersectUnicodeRanges`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, exportUnicodeRanges, importFont } from '../src/core/fontCodec';
import { rangeWords, unicodeRangeBits, wordBits } from '../src/core/os2Ranges';
import { readSfnt } from '../src/core/sfnt';
import { advanceWidths, averageCharWidth } from '../src/core/sfntFinalize';
import { drawGlyph, newTestFont } from './helpers';
import { suggestGlyphName } from '../src/core/unicodeNames';
import { makeId, type FontDoc, type GlyphDoc } from '../src/core/types';

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** ulUnicodeRange1-4 of an exported file, read from the raw OS/2 bytes. */
function exportedRanges(buffer: ArrayBuffer): [number, number, number, number] {
  const os2 = readSfnt(buffer).tables.find((t) => t.tag === 'OS/2')!;
  const view = new DataView(os2.data.buffer, os2.data.byteOffset, os2.data.byteLength);
  return [view.getUint32(42), view.getUint32(46), view.getUint32(50), view.getUint32(54)];
}

function sourceRanges(buffer: ArrayBuffer): [number, number, number, number] {
  return exportedRanges(buffer);
}

const exportOptions = { preserveHinting: true, preserveKerning: true, validate: false };

describe('OS/2 Unicode ranges', () => {
  it('matches fontTools intersectUnicodeRanges for sample characters', () => {
    const w = (cps: number[]) => rangeWords(unicodeRangeBits(cps));
    expect(w([0x0041])).toEqual([1, 0, 0, 0]); // Basic Latin, bit 0
    expect(w([0x0041, 0x20ac])).toEqual([1, 2, 0, 0]); // + Currency Symbols, bit 33
    expect(w([0x2264])).toEqual([0, 64, 0, 0]); // Mathematical Operators, bit 38
    expect(w([0x00a0])).toEqual([2, 0, 0, 0]); // Latin-1 Supplement, bit 1
    expect(w([0x10d0])).toEqual([67108864, 0, 0, 0]); // Georgian, bit 26
    expect(w([0xe000])).toEqual([0, 268435456, 0, 0]); // Private Use Area, bit 60
    expect(w([0xfeff])).toEqual([0, 0, 8, 0]); // Specials, bit 67
    // beyond the BMP: the block bit plus bit 57 ("Non-Plane 0"), like fontTools
    expect(w([0x0410, 0x1f000])).toEqual([512, 33554432, 0, 67108864]);
    expect([...unicodeRangeBits([0x0410, 0x1f000])].sort((a, b) => a - b)).toEqual([9, 57, 122]);
    // unpacking is the inverse of packing
    expect([...wordBits([512, 33554432, 0, 67108864])].sort((a, b) => a - b)).toEqual([9, 57, 122]);
  });

  it('gives a font created in Pixeel the blocks of its own characters', () => {
    let doc: FontDoc = newTestFont(8, 8, 'RangesNew');
    doc = drawGlyph(doc, 0x41, (bm) => bm.rect(1, 1, 6, 6, 1, true)).doc;
    doc = drawGlyph(doc, 0x20ac, (bm) => bm.rect(0, 0, 5, 5, 1, true)).doc;
    const { buffer } = buildTtf({ doc, sourceTtf: null, options: exportOptions });
    // Basic Latin (bit 0) + Currency Symbols (bit 33) — and no Private Use bit
    expect(exportedRanges(buffer)).toEqual([1, 2, 0, 0]);
  });

  it('no longer writes the Private Use bit into every font', () => {
    let doc: FontDoc = newTestFont(8, 8, 'NoPua');
    doc = drawGlyph(doc, 0x30, (bm) => bm.rect(1, 1, 6, 6, 1, true)).doc;
    const { buffer } = buildTtf({ doc, sourceTtf: null, options: exportOptions });
    const [, word2] = exportedRanges(buffer);
    expect(word2 & 0x10000000).toBe(0); // bit 60 was set unconditionally before
    expect(exportedRanges(buffer)).toEqual([1, 0, 0, 0]);
  });

  it('keeps an imported font’s own range words', async () => {
    for (const name of ['Quantico-Bold.ttf', 'Lato-Regular.ttf']) {
      const source = fixture(name);
      const { doc, sourceTtf } = await importFont(source, name);
      const { buffer } = buildTtf({ doc, sourceTtf, options: exportOptions });
      expect(exportedRanges(buffer)).toEqual(sourceRanges(source));
    }
    // the concrete values of the bug report
    expect(sourceRanges(fixture('Lato-Regular.ttf'))[1]).toBe(1342237951);
    expect(sourceRanges(fixture('Quantico-Bold.ttf'))[1]).toBe(1342177354);
  });

  it('adds a bit for a block added in Pixeel, keeping the source words', async () => {
    const { doc, sourceTtf } = await importFont(fixture('Quantico-Bold.ttf'), 'Quantico-Bold.ttf');
    const before = exportUnicodeRanges(doc, sourceTtf);
    const georgian: GlyphDoc = {
      id: makeId('g'),
      name: suggestGlyphName(0x10d0),
      unicode: 0x10d0,
      advanceWidth: 500,
      leftSideBearing: 0,
      kind: 'empty',
      contours: [],
      pixel: null,
      compound: null,
      instructions: null,
      sourceContours: null,
      edited: true,
      srcIndex: null,
      origin: 'added',
    };
    const extended: FontDoc = { ...doc, glyphs: [...doc.glyphs, georgian] };
    const after = exportUnicodeRanges(extended, sourceTtf);
    expect(after[0]).toBe((before[0] | (1 << 26)) >>> 0); // Georgian, bit 26
    expect(after.slice(1)).toEqual(before.slice(1));

    const { buffer } = buildTtf({ doc: extended, sourceTtf, options: exportOptions });
    expect(exportedRanges(buffer)).toEqual(after);
  });

  it('does not drop a source bit for a block the editor no longer maps', async () => {
    const { doc, sourceTtf } = await importFont(fixture('Quantico-Bold.ttf'), 'Quantico-Bold.ttf');
    // remove every mapping above U+00FF: the source words must survive
    const trimmed: FontDoc = {
      ...doc,
      glyphs: doc.glyphs.map((g) => (g.unicode !== null && g.unicode > 0xff ? { ...g, unicode: null, extraUnicodes: [] } : g)),
    };
    const { buffer } = buildTtf({ doc: trimmed, sourceTtf, options: exportOptions });
    expect(exportedRanges(buffer)).toEqual(sourceRanges(fixture('Quantico-Bold.ttf')));
  });
});

/**
 * OS/2 version 3 and later define xAvgCharWidth as the average over the
 * glyphs that have a non-zero advance width. fonteditor-core divided the sum
 * of every advance by the number of glyphs, so Lato exported 1009 where the
 * original (and fontTools' recalcAvgCharWidth) says 1108.
 */
describe('OS/2 xAvgCharWidth', () => {
  const avgOf = (buffer: ArrayBuffer): number => {
    const os2 = readSfnt(buffer).tables.find((t) => t.tag === 'OS/2')!;
    return new DataView(os2.data.buffer, os2.data.byteOffset, os2.data.byteLength).getInt16(2);
  };

  it('averages the non-zero advance widths only', () => {
    expect(averageCharWidth([500, 500, 0, 0])).toBe(500);
    expect(averageCharWidth([0, 0])).toBe(0);
    expect(averageCharWidth([1, 2])).toBe(2); // rounds like fontTools otRound (1.5 → 2)
    expect(averageCharWidth([])).toBe(0);
  });

  it('reads the advance widths of a real font from hhea/hmtx/maxp', () => {
    const tables = readSfnt(fixture('Quantico-Bold.ttf')).tables;
    const widths = advanceWidths(tables);
    expect(widths.length).toBe(268);
    expect(widths.filter((w) => w === 0).length).toBe(1); // only .null has no advance
    expect(averageCharWidth(widths)).toBe(589);
  });

  it('exports Lato with 1108, the value its designer stored', async () => {
    const { doc, sourceTtf } = await importFont(fixture('Lato-Regular.ttf'), 'Lato-Regular.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: exportOptions });
    expect(avgOf(buffer)).toBe(1108); // was 1009: 269 zero-width glyphs dragged it down
    expect(averageCharWidth(advanceWidths(readSfnt(buffer).tables))).toBe(1108);
  });

  it('exports Quantico with the version 3+ definition of the average', async () => {
    const { doc, sourceTtf } = await importFont(fixture('Quantico-Bold.ttf'), 'Quantico-Bold.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: exportOptions });
    expect(avgOf(buffer)).toBe(589);
  });

  it('ignores a zero-width glyph of a font made in Pixeel', () => {
    let doc: FontDoc = newTestFont(8, 8, 'ZeroWidth');
    doc = drawGlyph(doc, 0x41, (bm) => bm.rect(1, 1, 6, 6, 1, true)).doc;
    doc = drawGlyph(doc, 0x42, (bm) => bm.rect(1, 1, 6, 6, 1, true)).doc;
    const widths = doc.glyphs.map((g) => Math.round(g.advanceWidth));
    const zeroed: FontDoc = {
      ...doc,
      glyphs: doc.glyphs.map((g) => (g.unicode === 0x42 ? { ...g, advanceWidth: 0 } : g)),
    };
    const { buffer } = buildTtf({ doc: zeroed, sourceTtf: null, options: exportOptions });
    const expected = averageCharWidth(widths.map((w, i) => (zeroed.glyphs[i].unicode === 0x42 ? 0 : w)));
    expect(avgOf(buffer)).toBe(expected);
    expect(avgOf(buffer)).toBe(averageCharWidth(advanceWidths(readSfnt(buffer).tables)));
  });
});
