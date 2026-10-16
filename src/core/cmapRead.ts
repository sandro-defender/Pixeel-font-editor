/**
 * Character map (cmap) reader working on the raw sfnt bytes.
 *
 * fonteditor-core merges every subtable it can decode into one dictionary, so
 * a legacy Mac Roman (platform 1) format-0 table is read as if its byte codes
 * were Unicode: Mac 0xB2 becomes U+00B2 instead of U+2264 (≤), and so on.
 * This reader keeps the two apart:
 *  - Unicode subtables only — (3,10) and (3,1) formats 4/12, then (0,*) — are
 *    used for the code point of each glyph;
 *  - Mac subtables are read only when a font has no Unicode subtable at all,
 *    and then their codes are converted through the Mac Roman table;
 *  - format 14 (variation sequences) is not a plain code → glyph mapping, so
 *    it is ignored.
 */

/** Mac Roman bytes 0x80…0xFF as Unicode code points (bytes below 0x80 are ASCII). */
export const MAC_ROMAN_HIGH: readonly number[] = [
  0x00C4, 0x00C5, 0x00C7, 0x00C9, 0x00D1, 0x00D6, 0x00DC, 0x00E1, 0x00E0, 0x00E2, 0x00E4, 0x00E3, 0x00E5, 0x00E7, 0x00E9, 0x00E8,
  0x00EA, 0x00EB, 0x00ED, 0x00EC, 0x00EE, 0x00EF, 0x00F1, 0x00F3, 0x00F2, 0x00F4, 0x00F6, 0x00F5, 0x00FA, 0x00F9, 0x00FB, 0x00FC,
  0x2020, 0x00B0, 0x00A2, 0x00A3, 0x00A7, 0x2022, 0x00B6, 0x00DF, 0x00AE, 0x00A9, 0x2122, 0x00B4, 0x00A8, 0x2260, 0x00C6, 0x00D8,
  0x221E, 0x00B1, 0x2264, 0x2265, 0x00A5, 0x00B5, 0x2202, 0x2211, 0x220F, 0x03C0, 0x222B, 0x00AA, 0x00BA, 0x03A9, 0x00E6, 0x00F8,
  0x00BF, 0x00A1, 0x00AC, 0x221A, 0x0192, 0x2248, 0x2206, 0x00AB, 0x00BB, 0x2026, 0x00A0, 0x00C0, 0x00C3, 0x00D5, 0x0152, 0x0153,
  0x2013, 0x2014, 0x201C, 0x201D, 0x2018, 0x2019, 0x00F7, 0x25CA, 0x00FF, 0x0178, 0x2044, 0x20AC, 0x2039, 0x203A, 0xFB01, 0xFB02,
  0x2021, 0x00B7, 0x201A, 0x201E, 0x2030, 0x00C2, 0x00CA, 0x00C1, 0x00CB, 0x00C8, 0x00CD, 0x00CE, 0x00CF, 0x00CC, 0x00D3, 0x00D4,
  0xF8FF, 0x00D2, 0x00DA, 0x00DB, 0x00D9, 0x0131, 0x02C6, 0x02DC, 0x00AF, 0x02D8, 0x02D9, 0x02DA, 0x00B8, 0x02DD, 0x02DB, 0x02C7,
];

/** A cmap subtable decoded to (code, glyph index) pairs. */
export interface CmapSubtable {
  platformID: number;
  encodingID: number;
  format: number;
  /** code (byte code for format 0/6, Unicode for Unicode subtables) → glyph index */
  entries: Array<[number, number]>;
}

/** Glyph index → code point(s) and the reverse map, as read from the file. */
export interface UnicodeCmap {
  /** code point → glyph index (Unicode subtables; Mac-only fonts converted). */
  byCodePoint: Map<number, number>;
  /** glyph index → code points, ascending. */
  byGlyph: Map<number, number[]>;
  /** Where the mapping came from. */
  source: 'unicode' | 'mac-roman' | 'none';
}

/** A DataView over an ArrayBuffer or any typed array / Node Buffer view of one. */
function viewOf(buffer: ArrayBuffer | ArrayBufferView): DataView {
  return ArrayBuffer.isView(buffer)
    ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer);
}

function tableOffset(view: DataView, tag: string): { offset: number; length: number } | null {
  if (view.byteLength < 12) return null;
  const n = view.getUint16(4);
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    if (at + 16 > view.byteLength) break;
    const t = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    if (t === tag) return { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  }
  return null;
}

/** Decode one cmap subtable at `base` (absolute offset). Unsupported formats return null. */
function decodeSubtable(view: DataView, base: number): { format: number; entries: Array<[number, number]> } | null {
  const format = view.getUint16(base);
  const entries: Array<[number, number]> = [];
  const limit = view.byteLength;
  if (format === 0) {
    for (let c = 0; c < 256; c++) {
      const at = base + 6 + c;
      if (at >= limit) break;
      const g = view.getUint8(at);
      if (g) entries.push([c, g]);
    }
    return { format, entries };
  }
  if (format === 4) {
    const segX2 = view.getUint16(base + 6);
    const seg = segX2 / 2;
    const endAt = base + 14;
    const startAt = endAt + segX2 + 2;
    const deltaAt = startAt + segX2;
    const rangeAt = deltaAt + segX2;
    for (let s = 0; s < seg; s++) {
      const end = view.getUint16(endAt + s * 2);
      const start = view.getUint16(startAt + s * 2);
      const delta = view.getInt16(deltaAt + s * 2);
      const ro = view.getUint16(rangeAt + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) {
          g = (c + delta) & 0xffff;
        } else {
          const at = rangeAt + s * 2 + ro + (c - start) * 2;
          if (at + 2 > limit) continue;
          g = view.getUint16(at);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) entries.push([c, g]);
      }
    }
    return { format, entries };
  }
  if (format === 6) {
    const first = view.getUint16(base + 6);
    const count = view.getUint16(base + 8);
    for (let i = 0; i < count; i++) {
      const at = base + 10 + i * 2;
      if (at + 2 > limit) break;
      const g = view.getUint16(at);
      if (g) entries.push([first + i, g]);
    }
    return { format, entries };
  }
  if (format === 12) {
    const groups = view.getUint32(base + 12);
    for (let i = 0; i < groups; i++) {
      const at = base + 16 + i * 12;
      if (at + 12 > limit) break;
      const start = view.getUint32(at);
      const end = view.getUint32(at + 4);
      const g0 = view.getUint32(at + 8);
      if (end - start > 0x10ffff) continue; // corrupt group
      for (let c = start; c <= end; c++) entries.push([c, g0 + (c - start)]);
    }
    return { format, entries };
  }
  return null; // format 2 (CJK high-byte), 14 (variation sequences) and others are not plain maps
}

/** Every cmap subtable this reader understands, in file order. */
export function readCmapSubtables(buffer: ArrayBuffer | ArrayBufferView): CmapSubtable[] {
  const view = viewOf(buffer);
  const cmap = tableOffset(view, 'cmap');
  if (!cmap || cmap.offset + 4 > view.byteLength) return [];
  const base = cmap.offset;
  const n = view.getUint16(base + 2);
  const out: CmapSubtable[] = [];
  for (let i = 0; i < n; i++) {
    const at = base + 4 + i * 8;
    if (at + 8 > view.byteLength) break;
    const platformID = view.getUint16(at);
    const encodingID = view.getUint16(at + 2);
    const sub = base + view.getUint32(at + 4);
    if (sub + 6 > view.byteLength) continue;
    try {
      const d = decodeSubtable(view, sub);
      if (d) out.push({ platformID, encodingID, format: d.format, entries: d.entries });
    } catch {
      // a corrupt subtable is skipped, the others still count
    }
  }
  return out;
}

/** Unicode subtable priority: full Unicode (3,10), then BMP (3,1), then the Unicode platform (0,*). */
function unicodeRank(s: CmapSubtable): number {
  if (s.platformID === 3 && s.encodingID === 10) return 0;
  if (s.platformID === 3 && s.encodingID === 1) return 1;
  if (s.platformID === 0) return 2;
  return -1;
}

/** Mac Roman byte code → Unicode code point. */
export function macRomanToUnicode(code: number): number {
  return code < 0x80 ? code : MAC_ROMAN_HIGH[code - 0x80];
}

/**
 * The code point → glyph map of a font, from its raw cmap bytes.
 */
export function readUnicodeCmap(buffer: ArrayBuffer | ArrayBufferView): UnicodeCmap {
  const subs = readCmapSubtables(buffer);
  const uni = subs.filter((s) => unicodeRank(s) >= 0).sort((a, b) => unicodeRank(a) - unicodeRank(b));
  const byCodePoint = new Map<number, number>();
  let source: UnicodeCmap['source'] = 'none';
  if (uni.length) {
    source = 'unicode';
    for (const s of uni) {
      for (const [cp, g] of s.entries) if (!byCodePoint.has(cp)) byCodePoint.set(cp, g);
    }
  } else {
    // a Mac-only font: its codes are Mac Roman, not Unicode
    const mac = subs.filter((s) => s.platformID === 1 && s.encodingID === 0);
    if (mac.length) {
      source = 'mac-roman';
      for (const [code, g] of mac[0].entries) {
        const cp = macRomanToUnicode(code);
        if (!byCodePoint.has(cp)) byCodePoint.set(cp, g);
      }
    }
  }
  const byGlyph = new Map<number, number[]>();
  for (const [cp, g] of byCodePoint) {
    const list = byGlyph.get(g);
    if (list) list.push(cp);
    else byGlyph.set(g, [cp]);
  }
  for (const list of byGlyph.values()) list.sort((a, b) => a - b);
  return { byCodePoint, byGlyph, source };
}

/** The Unicode code point → glyph index map as a plain object (for lookups by code point). */
export function unicodeCmapRecord(buffer: ArrayBuffer | ArrayBufferView): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [cp, g] of readUnicodeCmap(buffer).byCodePoint) out[cp] = g;
  return out;
}
