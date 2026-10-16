/**
 * The exported table directory: every tag once, ascending, and exactly the
 * tables the options ask for. fonteditor-core's writer copies GPOS/kern/kerx
 * for both the `hinting` and the `kerning` option, so a naive pass-through
 * wrote them twice (OTS: "Table directory is not correctly ordered").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont, listTables, validateExport } from '../src/core/fontCodec';
import type { ExportOptions } from '../src/core/fontCodec';
import { setKerningPair } from '../src/core/kerning';
import { drawGlyph, newTestFont } from './helpers';

const lato = () => readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));

const COMBOS: Array<[boolean, boolean]> = [
  [true, true],
  [true, false],
  [false, true],
  [false, false],
];

function isSortedUnique(tags: string[]): boolean {
  return tags.every((t, i) => i === 0 || tags[i - 1] < t);
}

describe('table directory of exported fonts', () => {
  it.each(COMBOS)('Lato with hinting=%s kerning=%s: no duplicates, sorted, tables match the options', async (hinting, kerning) => {
    const { doc, sourceTtf } = await importFont(lato(), 'Lato-Regular.ttf');
    const opts: ExportOptions = { preserveHinting: hinting, preserveKerning: kerning, validate: true };
    const { buffer, report } = buildTtf({ doc, sourceTtf, options: opts });
    const tags = listTables(buffer);

    expect(new Set(tags).size).toBe(tags.length);
    expect(isSortedUnique(tags)).toBe(true);
    expect(tags.includes('GPOS')).toBe(kerning);
    expect(tags.includes('fpgm')).toBe(hinting);
    expect(tags.includes('prep')).toBe(hinting);
    expect(tags.includes('cvt ')).toBe(hinting);
    expect(report.writtenTables).toEqual(tags);
    expect(report.validation?.checks.find((c) => c.name === 'Table directory')?.ok).toBe(true);
    expect(report.validation?.ok).toBe(true);
  });

  it('a kern table made in Pixeel is written once, with and without hinting', async () => {
    let doc = newTestFont(8, 8, 'KernOnce');
    for (const ch of 'AV') doc = drawGlyph(doc, ch.codePointAt(0)!, (bm) => bm.set(1, 1, 1)).doc;
    const id = (ch: string) => doc.glyphs.find((g) => g.unicode === ch.codePointAt(0))!.id;
    doc = setKerningPair(doc, id('A'), id('V'), -40);
    for (const hinting of [true, false]) {
      const { buffer, report } = buildTtf({
        doc,
        sourceTtf: null,
        options: { preserveHinting: hinting, preserveKerning: true, validate: true },
      });
      const tags = listTables(buffer);
      expect(tags.filter((t) => t === 'kern')).toHaveLength(1);
      expect(tags.filter((t) => t === 'GPOS')).toHaveLength(0);
      expect(isSortedUnique(tags)).toBe(true);
      expect(report.validation?.ok).toBe(true);
    }
  });

  it('validateExport flags a directory with a duplicated tag', async () => {
    const { doc, sourceTtf } = await importFont(lato(), 'Lato-Regular.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    // rename the 'name' table's directory entry to 'GPOS' (a second GPOS in the directory)
    const bytes = new Uint8Array(buffer.slice(0));
    const view = new DataView(bytes.buffer);
    const n = view.getUint16(4);
    let gposAt = -1;
    for (let i = 0; i < n; i++) {
      const off = 12 + i * 16;
      if (String.fromCharCode(...bytes.subarray(off, off + 4)) === 'GPOS') gposAt = off;
    }
    expect(gposAt).toBeGreaterThan(0);
    const nameAt = (() => {
      for (let i = 0; i < n; i++) {
        const off = 12 + i * 16;
        if (String.fromCharCode(...bytes.subarray(off, off + 4)) === 'name') return off;
      }
      return -1;
    })();
    bytes.set(new TextEncoder().encode('GPOS'), nameAt);
    const check = validateExport(bytes.buffer, doc).checks.find((c) => c.name === 'Table directory');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('duplicate');
  });
});
