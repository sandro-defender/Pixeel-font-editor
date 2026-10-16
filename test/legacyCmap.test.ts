/**
 * Code points must come from the Unicode cmap subtables only.
 *
 * fonteditor-core's `readWindowsAllCodes` merges the first format-0 subtable
 * of any platform into its map — normally the legacy Macintosh (1,0) Mac Roman
 * table — and treats its byte codes as Unicode. Quantico-Bold then imported
 * with 302 instead of 258 mappings: “≤” also answered to U+00B2, “≥” to
 * U+00B3, “≠” to U+00AD, “º” to U+00BC, and control codes gained glyphs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont, unicodeCmapOf } from '../src/core/fontCodec';
import { readCmapFromSfnt } from '../src/core/cmapRead';
import { readSfnt, writeSfnt, type SfntTable } from '../src/core/sfnt';
import { MAC_ROMAN_TO_UNICODE, STANDARD_MAC_GLYPH_NAMES } from '../src/core/macEncoding';
import type { FontDoc } from '../src/core/types';

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const quantico = () => fixture('Quantico-Bold.ttf');

/** Glyph names of a post format-2 table (what another tool would read). */
function postNames(buffer: ArrayBuffer): string[] {
  const post = readSfnt(buffer).tables.find((t) => t.tag === 'post');
  if (!post) return [];
  const view = new DataView(post.data.buffer, post.data.byteOffset, post.data.byteLength);
  if (view.getUint32(0) !== 0x00020000) return [];
  const n = view.getUint16(32);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) indices.push(view.getUint16(34 + i * 2));
  const extra: string[] = [];
  let at = 34 + n * 2;
  while (at < post.data.length) {
    const len = post.data[at];
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(post.data[at + 1 + i]);
    extra.push(s);
    at += len + 1;
  }
  return indices.map((idx) => (idx < 258 ? STANDARD_MAC_GLYPH_NAMES[idx] : (extra[idx - 258] ?? `.unknown${idx}`)));
}

/** Keep only the subtables a test wants, rebuilding the cmap table around them. */
function rebuildCmap(buffer: ArrayBuffer, keep: (platformID: number, encodingID: number) => boolean): ArrayBuffer {
  const font = readSfnt(buffer);
  const cmap = font.tables.find((t) => t.tag === 'cmap')!;
  const view = new DataView(cmap.data.buffer, cmap.data.byteOffset, cmap.data.byteLength);
  const count = view.getUint16(2);
  const kept: Array<{ platformID: number; encodingID: number; blob: Uint8Array }> = [];
  for (let i = 0; i < count; i++) {
    const rec = 4 + i * 8;
    const platformID = view.getUint16(rec);
    const encodingID = view.getUint16(rec + 2);
    const offset = view.getUint32(rec + 4);
    if (!keep(platformID, encodingID)) continue;
    const format = view.getUint16(offset);
    const length = format === 12 || format === 13 ? view.getUint32(offset + 4) : view.getUint16(offset + 2);
    kept.push({ platformID, encodingID, blob: cmap.data.slice(offset, offset + length) });
  }
  const header = 4 + kept.length * 8;
  const total = header + kept.reduce((n, k) => n + k.blob.length, 0);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  ov.setUint16(0, 0);
  ov.setUint16(2, kept.length);
  let at = header;
  kept.forEach((k, i) => {
    ov.setUint16(4 + i * 8, k.platformID);
    ov.setUint16(4 + i * 8 + 2, k.encodingID);
    ov.setUint32(4 + i * 8 + 4, at);
    out.set(k.blob, at);
    at += k.blob.length;
  });
  const tables: SfntTable[] = font.tables.map((t) => (t.tag === 'cmap' ? { tag: 'cmap', data: out } : t));
  return writeSfnt({ version: font.version, tables });
}

describe('reading code points from the Unicode subtables only', () => {
  it('imports Quantico-Bold with its real 258 mappings, not the Mac Roman codes', async () => {
    const source = readCmapFromSfnt(quantico())!;
    expect(source.subtables.map((s) => `${s.platformID},${s.encodingID},${s.format},${s.role}`)).toEqual([
      '0,3,4,unicode',
      '1,0,0,macRoman',
      '3,1,4,unicode',
    ]);
    expect(source.map.size).toBe(258);

    const { doc } = await importFont(quantico(), 'Quantico-Bold.ttf');
    const mapped = new Map<number, string>();
    for (const g of doc.glyphs) {
      if (g.unicode !== null) mapped.set(g.unicode, g.name);
      for (const cp of g.extraUnicodes ?? []) mapped.set(cp, g.name);
    }
    expect(mapped.size).toBe(258);
    expect([...mapped.keys()].sort((a, b) => a - b)).toEqual([...source.map.keys()].sort((a, b) => a - b));

    // the Mac Roman codes that used to leak in as Unicode
    expect(mapped.get(0x2264)).toBe('lessequal');
    for (const cp of [0x00b2, 0x00b3, 0x00ad, 0x00bc, 0x0000, 0x0008, 0x0009, 0x000d, 0x001d]) {
      expect(mapped.has(cp)).toBe(false);
    }
    const lessequal = doc.glyphs.find((g) => g.name === 'lessequal')!;
    expect(lessequal.unicode).toBe(0x2264);
    expect(lessequal.extraUnicodes ?? []).toEqual([]);
  });

  it('re-exports Quantico-Bold with the same mappings and the same glyph names', async () => {
    const { doc, sourceTtf } = await importFont(quantico(), 'Quantico-Bold.ttf');
    const { buffer, report } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);

    const before = readCmapFromSfnt(quantico())!.map;
    const after = readCmapFromSfnt(buffer)!.map;
    expect(after.size).toBe(258);
    expect([...after.entries()].sort((a, b) => a[0] - b[0])).toEqual([...before.entries()].sort((a, b) => a[0] - b[0]));

    expect(postNames(buffer)).toEqual(postNames(quantico()));
    expect(postNames(buffer)[245]).toBe('lessequal');
    expect(postNames(buffer)[98]).toBe('uni00A0'); // not the standard name "nonbreakingspace"
    expect(postNames(buffer)[261]).toBe('grave.cap'); // unmapped glyphs keep their name, not ".null"

    // OS/2 first char index follows the real mappings again (32, not 0)
    const os2 = readSfnt(buffer).tables.find((t) => t.tag === 'OS/2')!;
    const os2View = new DataView(os2.data.buffer, os2.data.byteOffset, os2.data.byteLength);
    expect(os2View.getUint16(64)).toBe(0x20);
  });

  it('writes the legacy Mac subtable with Mac Roman codes, not Unicode values', async () => {
    const { doc, sourceTtf } = await importFont(quantico(), 'Quantico-Bold.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const font = readSfnt(buffer);
    const cmap = font.tables.find((t) => t.tag === 'cmap')!;
    const view = new DataView(cmap.data.buffer, cmap.data.byteOffset, cmap.data.byteLength);
    let macOffset = -1;
    for (let i = 0, n = view.getUint16(2); i < n; i++) {
      const rec = 4 + i * 8;
      if (view.getUint16(rec) === 1 && view.getUint16(rec + 2) === 0) macOffset = view.getUint32(rec + 4);
    }
    expect(macOffset).toBeGreaterThan(0);
    expect(view.getUint16(macOffset)).toBe(0); // format 0

    const unicodeMap = unicodeCmapOf(buffer);
    const gidAt = (code: number) => view.getUint8(macOffset + 6 + code);
    expect(gidAt(0xb2)).toBe(unicodeMap[0x2264]); // Mac Roman 0xB2 is “≤”
    expect(gidAt(0xa4)).toBe(unicodeMap[0x00a7]); // 0xA4 is “§”
    expect(gidAt(0x41)).toBe(unicodeMap[0x0041]); // ASCII is unchanged
    // every entry agrees with the Mac Roman table
    for (let code = 0; code < 256; code++) {
      const gid = gidAt(code);
      if (!gid) continue;
      expect(unicodeMap[MAC_ROMAN_TO_UNICODE[code]]).toBe(gid);
    }
  });

  it('converts a Mac-only font through the Mac Roman table', async () => {
    const macOnly = rebuildCmap(quantico(), (p) => p === 1);
    const read = readCmapFromSfnt(macOnly)!;
    expect(read.source).toBe('macRoman');
    const full = readCmapFromSfnt(quantico())!.map;
    // “≤” is reachable again through its Mac Roman code, as U+2264
    expect(read.map.get(0x2264)).toBe(full.get(0x2264));
    expect(read.map.get(0x00a7)).toBe(full.get(0x00a7));
    expect(read.map.get(0x00b2)).toBeUndefined();

    const { doc, warnings } = await importFont(macOnly, 'QuanticoMacOnly.ttf');
    expect(warnings.join(' ')).toContain('legacy Macintosh');
    const lessequal = doc.glyphs.find((g) => g.name === 'lessequal')!;
    expect(lessequal.unicode).toBe(0x2264);
  });

  it('prefers the Unicode subtable when a Mac subtable disagrees', () => {
    const both = readCmapFromSfnt(quantico())!;
    const unicodeOnly = readCmapFromSfnt(rebuildCmap(quantico(), (p) => p !== 1))!;
    expect(both.source).toBe('unicode');
    expect([...both.map.entries()].sort((a, b) => a[0] - b[0])).toEqual(
      [...unicodeOnly.map.entries()].sort((a, b) => a[0] - b[0]),
    );
  });

  it('ignores format-14 variation sequences instead of mapping them', () => {
    // one format 4 subtable (A → 1) plus a format 14 subtable with one
    // variation sequence for U+0041 with selector U+FE00
    const f4 = new Uint8Array(32);
    const v4 = new DataView(f4.buffer);
    v4.setUint16(0, 4);
    v4.setUint16(2, 32);
    v4.setUint16(6, 4); // segCountX2 → 2 segments
    v4.setUint16(14, 0x0041); // endCode[0]
    v4.setUint16(16, 0xffff); // endCode[1]
    v4.setUint16(20, 0x0041); // startCode[0]
    v4.setUint16(22, 0xffff); // startCode[1]
    v4.setInt16(24, 1 - 0x41); // idDelta[0] → glyph 1
    v4.setInt16(26, 1);
    const f14 = new Uint8Array(10 + 11);
    const v14 = new DataView(f14.buffer);
    v14.setUint16(0, 14);
    v14.setUint32(2, f14.length);
    v14.setUint32(6, 1); // one variation selector record
    f14[10] = 0x00; f14[11] = 0xfe; f14[12] = 0x00; // varSelector U+FE00
    const cmap = new Uint8Array(4 + 2 * 8 + f4.length + f14.length);
    const cv = new DataView(cmap.buffer);
    cv.setUint16(2, 2);
    cv.setUint16(4, 3); cv.setUint16(6, 1); cv.setUint32(8, 20);
    cv.setUint16(12, 0); cv.setUint16(14, 5); cv.setUint32(16, 20 + f4.length);
    cmap.set(f4, 20);
    cmap.set(f14, 20 + f4.length);
    const buffer = writeSfnt({ version: 0x00010000, tables: [{ tag: 'cmap', data: cmap }] });

    const read = readCmapFromSfnt(buffer)!;
    expect(read.map.size).toBe(1);
    expect(read.map.get(0x41)).toBe(1);
    expect(read.variationSequences).toBe(1);
    expect(read.subtables.find((s) => s.format === 14)?.role).toBe('variationSequences');
  });

  it('keeps every code point of a multi-mapped glyph through an export', async () => {
    const { doc, sourceTtf } = await importFont(quantico(), 'Quantico-Bold.ttf');
    const withExtra: FontDoc = {
      ...doc,
      glyphs: doc.glyphs.map((g) => (g.name === 'lessequal' ? { ...g, extraUnicodes: [0x2a7d] } : g)),
    };
    const { buffer } = buildTtf({ doc: withExtra, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const map = readCmapFromSfnt(buffer)!.map;
    expect(map.size).toBe(259);
    expect(map.get(0x2a7d)).toBe(map.get(0x2264));
  });
});
