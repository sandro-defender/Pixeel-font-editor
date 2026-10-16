/**
 * Low-level sfnt container helpers: read the table directory, replace table
 * bytes, and write a font back with a sorted directory, correct offsets,
 * table checksums and head.checkSumAdjustment.
 *
 * fonteditor-core computes checksums but cannot change a table after writing
 * (its OS/2 writer resets the Unicode ranges, its post writer renames glyphs),
 * so the editor's export finishes by patching the written bytes here.
 */

export interface SfntTable {
  tag: string;
  data: Uint8Array;
}

export interface SfntFile {
  sfntVersion: number;
  tables: SfntTable[];
}

const HEAD_ADJUST_MAGIC = 0xb1b0afba;

/** Sum of big-endian uint32 words (the table checksum). The tail is zero-padded. */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const n = data.length;
  const full = n & ~3;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < full; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  if (full < n) {
    let last = 0;
    for (let i = 0; i < 4; i++) last = (last << 8) | (full + i < n ? data[full + i] : 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

/** Read every table of an sfnt (single font, not a collection). */
export function readSfnt(buffer: ArrayBuffer | Uint8Array): SfntFile {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) throw new Error('File is too small to be a font.');
  const sfntVersion = view.getUint32(0);
  const n = view.getUint16(4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    if (at + 16 > bytes.byteLength) throw new Error('Truncated table directory.');
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const off = view.getUint32(at + 8);
    const len = view.getUint32(at + 12);
    if (off + len > bytes.byteLength) throw new Error(`Table ${tag} runs past the end of the file.`);
    tables.push({ tag, data: bytes.slice(off, off + len) });
  }
  return { sfntVersion, tables };
}

/** Serialise an sfnt: tables sorted by tag, 4-byte aligned, checksums and head adjustment set. */
export function writeSfnt(file: SfntFile): ArrayBuffer {
  const tables = [...file.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  let pos = 12 + n * 16;
  const offsets: number[] = [];
  for (const t of tables) {
    offsets.push(pos);
    pos += (t.data.length + 3) & ~3;
  }
  const out = new Uint8Array(pos);
  const view = new DataView(out.buffer);
  view.setUint32(0, file.sfntVersion);
  view.setUint16(4, n);
  let pow = 1;
  let log2 = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log2++;
  }
  view.setUint16(6, pow * 16);
  view.setUint16(8, log2);
  view.setUint16(10, n * 16 - pow * 16);
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[at + k] = t.tag.charCodeAt(k);
    view.setUint32(at + 8, offsets[i]);
    view.setUint32(at + 12, t.data.length);
    out.set(t.data, offsets[i]);
  });
  // head.checkSumAdjustment: the whole file sums to 0xB1B0AFBA
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    if (t.tag === 'head' && t.data.length >= 12) {
      view.setUint32(offsets[i] + 8, 0);
    }
    view.setUint32(at + 4, tableChecksum(out.subarray(offsets[i], offsets[i] + t.data.length)));
  });
  const headIndex = tables.findIndex((t) => t.tag === 'head');
  if (headIndex >= 0 && tables[headIndex].data.length >= 12) {
    const headOff = offsets[headIndex];
    view.setUint32(headOff + 8, 0);
    const adjust = (HEAD_ADJUST_MAGIC - tableChecksum(out)) >>> 0;
    view.setUint32(headOff + 8, adjust);
  }
  return out.buffer;
}

/** A table's bytes by tag (first match) from an sfnt file. */
export function findTable(file: SfntFile, tag: string): SfntTable | undefined {
  return file.tables.find((t) => t.tag === tag);
}
