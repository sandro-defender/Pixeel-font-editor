/**
 * The sfnt container helper: splitting a font into tables, writing them back
 * with a correct directory, table checksums and head.checkSumAdjustment. The
 * export's finalize pass (core/sfntFinalize.ts) depends on all of it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSfnt, tableChecksum, withTable, writeSfnt } from '../src/core/sfnt';
import { listTables } from '../src/core/fontCodec';

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** The whole-file checksum the spec defines, with checkSumAdjustment zeroed. */
function fileChecksum(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const n = view.getUint16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
    if (tag === 'head') view.setUint32(view.getUint32(rec + 8) + 8, 0);
  }
  return tableChecksum(bytes);
}

describe('sfnt read/write', () => {
  it('computes the OpenType checksum of a table', () => {
    expect(tableChecksum(new Uint8Array([0, 0, 0, 1]))).toBe(1);
    expect(tableChecksum(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 2]))).toBe(1);
    // a short tail is zero-padded, not dropped
    expect(tableChecksum(new Uint8Array([0, 0, 1]))).toBe(0x100);
  });

  it('round-trips a real font table by table', () => {
    const buffer = fixture('Quantico-Bold.ttf');
    const font = readSfnt(buffer);
    expect(font.version).toBe(0x00010000);
    expect(font.tables.map((t) => t.tag)).toEqual(listTables(buffer));
    const glyf = font.tables.find((t) => t.tag === 'glyf')!;
    expect(glyf.data.length).toBeGreaterThan(1000);

    const rebuilt = writeSfnt(font);
    const again = readSfnt(rebuilt);
    expect(again.tables.map((t) => t.tag)).toEqual([...font.tables.map((t) => t.tag)].sort());
    for (const t of again.tables) {
      const original = font.tables.find((o) => o.tag === t.tag)!;
      if (t.tag === 'head') {
        // only checkSumAdjustment (bytes 8…11) may differ
        expect([...t.data.slice(0, 8)]).toEqual([...original.data.slice(0, 8)]);
        expect([...t.data.slice(12)]).toEqual([...original.data.slice(12)]);
      } else {
        expect([...t.data]).toEqual([...original.data]);
      }
    }
  });

  it('writes a sorted directory with valid checksums and checkSumAdjustment', () => {
    const buffer = writeSfnt(readSfnt(fixture('Quantico-Bold.ttf')));
    const view = new DataView(buffer);
    const n = view.getUint16(4);
    const tags: string[] = [];
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16;
      let tag = '';
      for (let j = 0; j < 4; j++) tag += String.fromCharCode(view.getUint8(rec + j));
      tags.push(tag);
      const offset = view.getUint32(rec + 8);
      const length = view.getUint32(rec + 12);
      expect(offset % 4).toBe(0);
      const data = new Uint8Array(buffer.slice(offset, offset + length));
      if (tag === 'head') {
        const copy = new Uint8Array(data);
        copy[8] = copy[9] = copy[10] = copy[11] = 0;
        expect(tableChecksum(copy)).toBe(view.getUint32(rec + 4));
      } else {
        expect(tableChecksum(data)).toBe(view.getUint32(rec + 4));
      }
    }
    expect(tags).toEqual([...tags].sort());

    const entrySelector = Math.floor(Math.log2(n));
    expect(view.getUint16(8)).toBe(entrySelector);
    expect(view.getUint16(6)).toBe(2 ** entrySelector * 16);
    expect(view.getUint16(10)).toBe(n * 16 - 2 ** entrySelector * 16);

    const head = readSfnt(buffer).tables.find((t) => t.tag === 'head')!;
    const stored = new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength).getUint32(8);
    expect(stored).toBe((0xb1b0afba - fileChecksum(buffer) + 0x100000000) % 0x100000000);
  });

  it('replaces a table and keeps the file readable', () => {
    const font = readSfnt(fixture('Quantico-Bold.ttf'));
    const marker = new Uint8Array([1, 2, 3]);
    const buffer = writeSfnt({ version: font.version, tables: withTable(font.tables, 'FFTM', marker) });
    const again = readSfnt(buffer);
    expect([...(again.tables.find((t) => t.tag === 'FFTM')!.data)]).toEqual([1, 2, 3]);
    expect(again.tables.length).toBe(font.tables.length);
    // the following table still starts on a four-byte boundary
    const view = new DataView(buffer);
    for (let i = 0, n = view.getUint16(4); i < n; i++) expect(view.getUint32(12 + i * 16 + 8) % 4).toBe(0);
  });
});
