/**
 * Corrections applied to the bytes fonteditor-core writes.
 *
 * The writer is good at glyf/loca/hmtx but gets a few table fields wrong and
 * offers no hook to change them. Rather than fork it, Pixeel splits the
 * written sfnt into its tables, fixes those fields and writes the container
 * back with fresh checksums (see core/sfnt.ts).
 *
 * Fixed here:
 *  - `post` format 2 glyph names. fonteditor replaces a glyph's name with the
 *    standard Macintosh name of its first code point whenever one exists, so
 *    `uni00A0` became `nonbreakingspace` and every unmapped glyph (`grave.cap`,
 *    `acute.cap`, …) became `.null`.
 *  - the legacy Macintosh `(1,0)` format-0 subtable of `cmap`, which fonteditor
 *    fills with Unicode values below 256 instead of Mac Roman byte codes (so
 *    code 0xB2 pointed at `twosuperior` where Mac Roman means `lessequal`).
 *  - `OS/2` ulUnicodeRange1-4: its writer sets ulUnicodeRange2 to 268435456
 *    ("Private Use Area" only) in every font, dropping the real coverage bits
 *    (Lato 1342237951 → 268435456), and its `support` hook cannot reach OS/2.
 *  - `OS/2` xAvgCharWidth: averaged over every glyph including the zero-width
 *    ones, while OS/2 version 3 and later average the non-zero-width glyphs
 *    only (Lato 1009 instead of 1108, DotMatrix 44 instead of 47).
 */
import { readCmapFromSfnt } from './cmapRead';
import { MAC_ROMAN_TO_UNICODE, STANDARD_MAC_GLYPH_INDEX } from './macEncoding';
import { bytesOf, readSfnt, viewOf, withTable, writeSfnt, type SfntTable } from './sfnt';

/** A standalone ArrayBuffer holding exactly these bytes. */
function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const bytes = bytesOf(input);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export interface FinalizeOptions {
  /**
   * Glyph names in glyph order. Written into an existing `post` format-2
   * table; fonts whose post table has no names (format 3) are left alone.
   */
  glyphNames?: readonly string[];
  /** OS/2 ulUnicodeRange1-4 (see core/os2Ranges.ts). */
  unicodeRanges?: readonly [number, number, number, number];
}

/** Field offsets inside the OS/2 table (every version has them). */
const OS2_OFFSET = {
  xAvgCharWidth: 2,
  ulUnicodeRange1: 42,
  ulUnicodeRange2: 46,
  ulUnicodeRange3: 50,
  ulUnicodeRange4: 54,
} as const;

/**
 * Every glyph's advance width, from the file's own hhea/hmtx/maxp tables.
 * The last entry of hmtx repeats for the monospaced tail of the font.
 */
export function advanceWidths(tables: readonly SfntTable[]): number[] {
  const get = (tag: string) => tables.find((t) => t.tag === tag);
  const maxp = get('maxp');
  const hhea = get('hhea');
  const hmtx = get('hmtx');
  if (!maxp || !hhea || !hmtx || maxp.data.length < 6 || hhea.data.length < 36) return [];
  const numGlyphs = viewOf(maxp.data).getUint16(4);
  const numberOfHMetrics = viewOf(hhea.data).getUint16(34);
  const view = viewOf(hmtx.data);
  const widths: number[] = [];
  let last = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numberOfHMetrics) {
      const at = i * 4;
      if (at + 2 > hmtx.data.length) break;
      last = view.getUint16(at);
    }
    widths.push(last);
  }
  return widths;
}

/**
 * OS/2 version 3+ defines xAvgCharWidth as the arithmetic average of the
 * advance widths of the glyphs that have one — zero-width glyphs (marks,
 * .null, composed accents) are excluded. Same rounding as fontTools'
 * recalcAvgCharWidth.
 */
export function averageCharWidth(widths: readonly number[]): number {
  const inked = widths.filter((w) => w > 0);
  if (!inked.length) return 0;
  return Math.floor(inked.reduce((sum, w) => sum + w, 0) / inked.length + 0.5);
}

/** Write xAvgCharWidth; null when the table is too short. */
export function patchOs2AvgCharWidth(os2: Uint8Array, value: number): Uint8Array | null {
  if (os2.length < OS2_OFFSET.xAvgCharWidth + 2) return null;
  const out = new Uint8Array(os2);
  new DataView(out.buffer).setInt16(OS2_OFFSET.xAvgCharWidth, Math.max(-32768, Math.min(32767, value)));
  return out;
}

/** Write the four Unicode range words; null when the table is too short. */
export function patchOs2UnicodeRanges(os2: Uint8Array, words: readonly number[]): Uint8Array | null {
  if (os2.length < OS2_OFFSET.ulUnicodeRange4 + 4) return null;
  const out = new Uint8Array(os2);
  const view = new DataView(out.buffer);
  view.setUint32(OS2_OFFSET.ulUnicodeRange1, (words[0] ?? 0) >>> 0);
  view.setUint32(OS2_OFFSET.ulUnicodeRange2, (words[1] ?? 0) >>> 0);
  view.setUint32(OS2_OFFSET.ulUnicodeRange3, (words[2] ?? 0) >>> 0);
  view.setUint32(OS2_OFFSET.ulUnicodeRange4, (words[3] ?? 0) >>> 0);
  return out;
}

/** Printable ASCII, without the characters PostScript names may not contain. */
function sanitizeGlyphName(name: string, index: number): string {
  let out = '';
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    out += c > 0x20 && c < 0x7f && !'(){}[]<>/%'.includes(ch) ? ch : '_';
  }
  out = out.slice(0, 63);
  return out || `glyph${index}`;
}

/** A `post` format-2 table with the given glyph names, keeping the old header. */
export function buildPostFormat2(header: Uint8Array, names: readonly string[]): Uint8Array {
  const indices: number[] = [];
  const extra: Uint8Array[] = [];
  names.forEach((raw, i) => {
    const name = sanitizeGlyphName(raw, i);
    const standard = STANDARD_MAC_GLYPH_INDEX.get(name);
    if (standard !== undefined) {
      indices.push(standard);
      return;
    }
    indices.push(258 + extra.length);
    const bytes = new Uint8Array(name.length + 1);
    bytes[0] = name.length;
    for (let j = 0; j < name.length; j++) bytes[j + 1] = name.charCodeAt(j) & 0xff;
    extra.push(bytes);
  });

  const extraSize = extra.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(32 + 2 + names.length * 2 + extraSize);
  out.set(header.subarray(0, Math.min(32, header.length)));
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00020000); // format 2.0
  view.setUint16(32, names.length);
  indices.forEach((idx, i) => view.setUint16(34 + i * 2, idx));
  let at = 34 + names.length * 2;
  for (const bytes of extra) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

/** The 256-byte glyph index array of a Mac Roman format-0 subtable. */
export function macRomanFormat0Array(unicodeToGlyph: ReadonlyMap<number, number>): Uint8Array {
  const array = new Uint8Array(256);
  for (let code = 0; code < 256; code++) {
    const cp = MAC_ROMAN_TO_UNICODE[code];
    if (!cp) continue;
    const gid = unicodeToGlyph.get(cp);
    // format 0 stores one byte per code: glyphs past 255 cannot be referenced
    if (gid !== undefined && gid > 0 && gid < 256) array[code] = gid;
  }
  return array;
}

/**
 * Rewrite the `(1,0)` format-0 subtable of a cmap table with Mac Roman codes.
 * Returns null when the table has no such subtable (nothing to fix).
 */
export function fixMacRomanSubtable(cmap: Uint8Array, unicodeToGlyph: ReadonlyMap<number, number>): Uint8Array | null {
  if (cmap.length < 4) return null;
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const numSubtables = view.getUint16(2);
  const offsets = new Map<number, Array<{ platformID: number; encodingID: number }>>();
  let target = -1;
  for (let i = 0; i < numSubtables; i++) {
    const rec = 4 + i * 8;
    if (rec + 8 > cmap.length) break;
    const platformID = view.getUint16(rec);
    const encodingID = view.getUint16(rec + 2);
    const offset = view.getUint32(rec + 4);
    const list = offsets.get(offset) ?? [];
    list.push({ platformID, encodingID });
    offsets.set(offset, list);
    if (platformID === 1 && encodingID === 0) target = offset;
  }
  if (target < 0 || target + 262 > cmap.length) return null;
  // only touch a subtable that nothing else shares, and only format 0
  if ((offsets.get(target) ?? []).length !== 1) return null;
  if (view.getUint16(target) !== 0 || view.getUint16(target + 2) !== 262) return null;

  const out = new Uint8Array(cmap);
  out.set(macRomanFormat0Array(unicodeToGlyph), target + 6);
  return out;
}

/** Apply all corrections; returns the original buffer when nothing changed. */
export function finalizeSfnt(buffer: ArrayBuffer | Uint8Array, options: FinalizeOptions = {}): ArrayBuffer {
  let font;
  try {
    font = readSfnt(buffer);
  } catch {
    return toArrayBuffer(buffer); // not an sfnt we can rewrite — leave it untouched
  }
  let tables: SfntTable[] = font.tables;
  let changed = false;

  const post = tables.find((t) => t.tag === 'post');
  if (options.glyphNames && post && post.data.length >= 32) {
    const view = new DataView(post.data.buffer, post.data.byteOffset, post.data.byteLength);
    if (view.getUint32(0) === 0x00020000) {
      const rebuilt = buildPostFormat2(post.data, options.glyphNames);
      if (rebuilt.length !== post.data.length || rebuilt.some((b, i) => b !== post.data[i])) {
        tables = withTable(tables, 'post', rebuilt);
        changed = true;
      }
    }
  }

  const os2 = tables.find((t) => t.tag === 'OS/2');
  if (os2) {
    let data = os2.data;
    if (options.unicodeRanges) data = patchOs2UnicodeRanges(data, options.unicodeRanges) ?? data;
    const avg = averageCharWidth(advanceWidths(tables));
    data = patchOs2AvgCharWidth(data, avg) ?? data;
    if (data.some((b, i) => b !== os2.data[i])) {
      tables = withTable(tables, 'OS/2', data);
      changed = true;
    }
  }

  const cmap = tables.find((t) => t.tag === 'cmap');
  if (cmap) {
    const read = readCmapFromSfnt(buffer);
    if (read && read.source === 'unicode') {
      const fixed = fixMacRomanSubtable(cmap.data, read.map);
      if (fixed && fixed.some((b, i) => b !== cmap.data[i])) {
        tables = withTable(tables, 'cmap', fixed);
        changed = true;
      }
    }
  }

  if (!changed) return toArrayBuffer(buffer);
  return writeSfnt({ version: font.version, tables });
}
