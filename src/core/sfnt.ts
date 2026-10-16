/**
 * Minimal sfnt (TrueType/OpenType container) reader and writer.
 *
 * fonteditor-core produces the tables; Pixeel needs a way to correct a few
 * fields it writes wrong (see core/sfntFinalize.ts) without re-running the
 * whole writer. Splitting a font into its tables and writing them back is
 * safe: every offset inside an sfnt table is relative to that table, so only
 * the directory and the checksums have to be recomputed.
 */

/**
 * Accept a Node Buffer / Uint8Array as well as an ArrayBuffer: fonteditor-core
 * returns a Buffer in Node, and a Uint8Array can be a window on a larger,
 * pooled buffer — a DataView must then start at its byteOffset.
 */
export function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** A DataView over exactly the given bytes. */
export function viewOf(input: ArrayBuffer | Uint8Array): DataView {
  const bytes = bytesOf(input);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export interface SfntTable {
  /** Four-character tag, padded with spaces exactly as in the file (e.g. `cvt `). */
  tag: string;
  data: Uint8Array;
}

export interface SfntFont {
  /** sfnt version: 0x00010000 for TrueType outlines, 'OTTO' for CFF. */
  version: number;
  tables: SfntTable[];
}

/**
 * The OpenType table checksum: the sum of the data as big-endian uint32s,
 * zero-padded to a multiple of four bytes, modulo 2^32.
 */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const full = data.length - (data.length % 4);
  for (let i = 0; i < full; i += 4) {
    sum = (sum + ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3])) >>> 0;
  }
  if (full < data.length) {
    let tail = 0;
    for (let i = 0; i < 4; i++) tail = (tail << 8) | (full + i < data.length ? data[full + i] : 0);
    sum = (sum + tail) >>> 0;
  }
  return sum >>> 0;
}

/** Split an sfnt file into its tables (in directory order). */
export function readSfnt(input: ArrayBuffer | Uint8Array): SfntFont {
  const bytes = bytesOf(input);
  if (bytes.length < 12) throw new Error('Not an sfnt font: file is too small.');
  const view = viewOf(bytes);
  const version = view.getUint32(0);
  const numTables = view.getUint16(4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > bytes.length) break;
    let tag = '';
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(view.getUint8(rec + j));
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    if (offset > bytes.length) continue;
    const end = Math.min(offset + length, bytes.length);
    tables.push({ tag, data: bytes.slice(offset, end) });
  }
  return { version, tables };
}

/**
 * Write tables back into an sfnt file: tags sorted ascending (each exactly
 * once), tables padded to four bytes, table checksums and — when a `head`
 * table is present — its checkSumAdjustment recomputed.
 */
export function writeSfnt(font: SfntFont): ArrayBuffer {
  const tables = [...font.tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  const padded = (len: number) => len + ((4 - (len % 4)) % 4);
  let offset = 12 + n * 16;
  const layout = tables.map((t) => {
    const at = offset;
    offset += padded(t.data.length);
    return { tag: t.tag, data: t.data, offset: at };
  });
  const total = offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  const entrySelector = n > 0 ? Math.floor(Math.log2(n)) : 0;
  const searchRange = n > 0 ? 2 ** entrySelector * 16 : 0;
  view.setUint32(0, font.version >>> 0);
  view.setUint16(4, n);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, n * 16 - searchRange);

  let headOffset = -1;
  layout.forEach((t, i) => {
    const rec = 12 + i * 16;
    for (let j = 0; j < 4; j++) view.setUint8(rec + j, t.tag.charCodeAt(j) & 0xff);
    const data = t.data;
    if (t.tag === 'head') {
      headOffset = t.offset;
      // the file checksum is defined with checkSumAdjustment zeroed
      if (data.length >= 12) {
        const copy = new Uint8Array(data);
        copy[8] = copy[9] = copy[10] = copy[11] = 0;
        t.data = copy;
      }
    }
    out.set(t.data, t.offset);
    view.setUint32(rec + 4, tableChecksum(t.data));
    view.setUint32(rec + 8, t.offset);
    view.setUint32(rec + 12, data.length);
  });

  if (headOffset >= 0) {
    const adjustment = (0xb1b0afba - tableChecksum(out) + 0x100000000) % 0x100000000;
    view.setUint32(headOffset + 8, adjustment >>> 0);
  }
  return out.buffer as ArrayBuffer;
}

/** Replace (or add) one table; returns a new table list. */
export function withTable(tables: SfntTable[], tag: string, data: Uint8Array): SfntTable[] {
  const i = tables.findIndex((t) => t.tag === tag);
  if (i < 0) return [...tables, { tag, data }];
  const out = [...tables];
  out[i] = { tag, data };
  return out;
}
