/**
 * OS/2 and sfnt checksums of exported fonts.
 *  - ulUnicodeRange1–4: a new font gets the blocks of its own characters
 *    (fonteditor-core forced the Private Use bit on every font); an imported
 *    font keeps its ranges and gains bits for characters added in Pixeel.
 *  - every table checksum and head.checkSumAdjustment are correct.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont } from '../src/core/fontCodec';
import { computeUnicodeRanges, unicodeRangeBits } from '../src/core/os2Ranges';
import { readSfnt, tableChecksum } from '../src/core/sfnt';
import { drawGlyph, newTestFont, parseTtf } from './helpers';
import type { FontDoc } from '../src/core/types';

const LATO = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
const QUANTICO = readFileSync(resolve(__dirname, 'fixtures/Quantico-Bold.ttf'));
const bytesOf = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function fresh(cps: number[]): FontDoc {
  let doc = newTestFont(8, 8, 'Ranges');
  for (const cp of cps) doc = drawGlyph(doc, cp, (bm) => bm.set(1, 1, 1)).doc;
  return doc;
}

function ranges(buffer: ArrayBuffer): number[] {
  const os2 = parseTtf(buffer)['OS/2'];
  return [os2.ulUnicodeRange1, os2.ulUnicodeRange2, os2.ulUnicodeRange3, os2.ulUnicodeRange4].map((n) => n >>> 0);
}

describe('OS/2 Unicode ranges', () => {
  it('a new font gets the bits of its own characters (values checked with fontTools)', () => {
    // fontTools intersectUnicodeRanges([0x41, 0x2264, 0x1F600, 0xE000, 0x20AC]) → bits 0, 33, 38, 57, 60
    const doc = fresh([0x41, 0x2264, 0x1f600, 0xe000, 0x20ac]);
    const { buffer, report } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);
    expect(ranges(buffer)).toEqual([1, 301989954, 0, 0]);
  });

  it('no Private Use bit unless the font has private-use characters (fonteditor forced bit 60)', () => {
    const { buffer } = buildTtf({ doc: fresh([0x41, 0x42]), sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    expect(ranges(buffer)).toEqual([1, 0, 0, 0]);
  });

  it('an imported font keeps its source ranges (Quantico) and gains bits for added characters', async () => {
    const { doc, sourceTtf } = await importFont(bytesOf(QUANTICO), 'Quantico-Bold.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    expect(ranges(buffer)).toEqual([2147483695, 1342177354, 0, 0]);
  });

  it('Lato: source words kept; U+FEFF adds Arabic Presentation Forms-B (bit 67, as fontTools)', async () => {
    const { doc, sourceTtf } = await importFont(bytesOf(LATO), 'Lato-Regular.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const out = ranges(buffer);
    expect(out.slice(0, 2)).toEqual([3774874367, 1342237951]);
    expect(out[2]).toBe(41); // source 33 | bit 67 - 64 = 3
    expect(out[3]).toBe(0);
  });

  it('added characters: an imported font adds the bit of a character outside its ranges', async () => {
    const { doc, sourceTtf } = await importFont(bytesOf(QUANTICO), 'Quantico-Bold.ttf');
    const base = doc.glyphs.find((g) => g.unicode === 0x41)!;
    const emoji = { ...base, id: 'emoji-test', name: 'emoji', unicode: 0x1f600, extraUnicodes: undefined, origin: 'added' as const, edited: true };
    const added = { ...doc, glyphs: [...doc.glyphs, emoji] };
    const { buffer } = buildTtf({ doc: added, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const out = ranges(buffer);
    expect(unicodeRangeBits([0x1f600]).has(57)).toBe(true);
    expect(out[1] & (1 << 25)).not.toBe(0); // bit 57 = word 2, bit 25
    expect(out[0]).toBe(2147483695); // the source's own words are still there
  });

  it('computeUnicodeRanges: source words are kept and only extended', () => {
    expect(computeUnicodeRanges([0x41], [7, 0, 0, 0])).toEqual([7, 0, 0, 0]);
    expect(computeUnicodeRanges([], null)).toEqual([0, 0, 0, 0]);
    expect(computeUnicodeRanges([0x41, 0x2264], null)).toEqual([1, 64, 0, 0]); // Basic Latin (bit 0), Mathematical Operators (bit 38)
  });
});

describe('sfnt checksums', () => {
  function directoryChecksums(buffer: ArrayBuffer): Map<string, { sum: number; offset: number; length: number }> {
    const view = new DataView(buffer);
    const n = view.getUint16(4);
    const out = new Map<string, { sum: number; offset: number; length: number }>();
    for (let i = 0; i < n; i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
      out.set(tag, { sum: view.getUint32(at + 4), offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
    }
    return out;
  }

  it.each([
    ['Lato', () => importFont(bytesOf(LATO), 'Lato-Regular.ttf')],
    ['Quantico', () => importFont(bytesOf(QUANTICO), 'Quantico-Bold.ttf')],
  ])('%s export: every table checksum and the file checksum are right', async (_, load) => {
    const { doc, sourceTtf } = await load();
    const { buffer } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const dir = directoryChecksums(buffer);
    const bytes = new Uint8Array(buffer);
    for (const [tag, e] of dir) {
      const data = bytes.subarray(e.offset, e.offset + e.length);
      if (tag === 'head') {
        const copy = data.slice();
        new DataView(copy.buffer).setUint32(8, 0);
        expect(tableChecksum(copy)).toBe(e.sum);
      } else {
        expect(tableChecksum(data)).toBe(e.sum);
      }
    }
    let total = 0;
    const view = new DataView(buffer);
    for (let i = 0; i + 4 <= bytes.length; i += 4) total = (total + view.getUint32(i)) >>> 0;
    expect(total).toBe(0xb1b0afba);
    expect(readSfnt(buffer).tables.length).toBe(dir.size);
  });
});
