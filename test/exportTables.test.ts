/**
 * The sfnt table directory of an exported font: every tag exactly once, in
 * ascending order. fonteditor-core's writer copies GPOS/kern/kerx for both its
 * `hinting` and its `kerning` option, so asking for both wrote them twice
 * (duplicate directory entry, duplicated data, OTS "Table directory is not
 * correctly ordered").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, checkTableDirectory, importFont, listTables } from '../src/core/fontCodec';
import { setKerningPair } from '../src/core/kerning';
import { drawGlyph, newTestFont } from './helpers';
import type { FontDoc } from '../src/core/types';

function loadLato(): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Table tags of the raw directory, read independently of fonteditor-core. */
function rawTags(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  const n = view.getUint16(4);
  const tags: string[] = [];
  for (let i = 0; i < n; i++) {
    const off = 12 + i * 16;
    tags.push(String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)));
  }
  return tags;
}

/** A directory entry's (offset, length) per tag — duplicates keep both. */
function rawEntries(buffer: ArrayBuffer): Array<{ tag: string; offset: number; length: number }> {
  const view = new DataView(buffer);
  const n = view.getUint16(4);
  const out: Array<{ tag: string; offset: number; length: number }> = [];
  for (let i = 0; i < n; i++) {
    const off = 12 + i * 16;
    out.push({
      tag: String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)),
      offset: view.getUint32(off + 8),
      length: view.getUint32(off + 12),
    });
  }
  return out;
}

describe('exported sfnt table directory', () => {
  const combos: Array<[boolean, boolean]> = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ];

  for (const [preserveHinting, preserveKerning] of combos) {
    it(`writes each table once, sorted (hinting=${preserveHinting}, kerning=${preserveKerning})`, async () => {
      const { doc, sourceTtf } = await importFont(loadLato(), 'Lato-Regular.ttf');
      const { buffer, report } = buildTtf({ doc, sourceTtf, options: { preserveHinting, preserveKerning, validate: true } });

      const tags = rawTags(buffer);
      expect(new Set(tags).size).toBe(tags.length); // no tag twice
      expect(tags).toEqual([...tags].sort()); // ascending order
      expect(report.writtenTables).toEqual(tags); // the report describes the real file
      expect(listTables(buffer)).toEqual(tags);

      // kerning tables only with the kerning option, hinting tables only with hinting
      expect(tags.includes('GPOS')).toBe(preserveKerning);
      expect(tags.includes('fpgm')).toBe(preserveHinting);
      expect(tags.includes('prep')).toBe(preserveHinting);
      expect(tags.includes('cvt ')).toBe(preserveHinting);

      const dir = checkTableDirectory(buffer);
      expect(dir.ok).toBe(true);
      expect(report.validation?.checks.find((c) => c.name === 'Table directory')?.ok).toBe(true);
      expect(report.validation?.ok).toBe(true);
    });
  }

  it('keeps the source GPOS bytes once, not twice', async () => {
    const { doc, sourceTtf } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const gpos = rawEntries(buffer).filter((e) => e.tag === 'GPOS');
    expect(gpos.length).toBe(1);
    expect(gpos[0].length).toBe((sourceTtf.GPOS as ArrayLike<number>).length);
  });

  it('writes a kern table built in Pixeel exactly once', async () => {
    let doc: FontDoc = newTestFont(8, 8, 'KernOnce');
    doc = drawGlyph(doc, 65, (bm) => bm.rect(1, 1, 6, 6, 1, true)).doc;
    doc = drawGlyph(doc, 86, (bm) => bm.rect(0, 0, 7, 3, 1, true)).doc;
    const a = doc.glyphs.find((g) => g.unicode === 65)!;
    const v = doc.glyphs.find((g) => g.unicode === 86)!;
    doc = setKerningPair(doc, a.id, v.id, -40);

    const { buffer, report } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    const tags = rawTags(buffer);
    expect(tags.filter((t) => t === 'kern').length).toBe(1);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toEqual([...tags].sort());
    expect(report.validation?.ok).toBe(true);
    expect(report.validation?.checks.find((c) => c.name === 'Kerning pairs')?.ok).toBe(true);
  });

  it('flags a directory that lists a tag twice or out of order', () => {
    // hand-build a 2-entry directory with the same tag twice, out of order
    const buffer = new ArrayBuffer(12 + 2 * 16);
    const view = new DataView(buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 2);
    const writeTag = (i: number, tag: string) => {
      for (let j = 0; j < 4; j++) view.setUint8(12 + i * 16 + j, tag.charCodeAt(j));
    };
    writeTag(0, 'head');
    writeTag(1, 'OS/2');
    const first = checkTableDirectory(buffer);
    expect(first.ok).toBe(false);
    expect(first.detail).toContain('ascending');

    writeTag(1, 'head');
    const second = checkTableDirectory(buffer);
    expect(second.ok).toBe(false);
    expect(second.detail).toContain('head ×2');
  });

  it('reports an unreadable directory instead of throwing', () => {
    const tiny = new ArrayBuffer(4);
    const res = checkTableDirectory(tiny);
    expect(res.ok).toBe(false);
    expect(res.tags).toEqual([]);
    expect(res.detail).toContain('could not be read');
  });
});
