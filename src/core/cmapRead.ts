/**
 * Character map reading, straight from the sfnt bytes.
 *
 * Why not use fonteditor-core's parsed `ttf.cmap`: its
 * `util/readWindowsAllCodes` takes the *first format-0 subtable of any
 * platform* and treats its byte codes as Unicode. In a font with the usual
 * legacy Macintosh subtable — platform 1, encoding 0, Mac Roman — that invents
 * mappings: Quantico-Bold's “≤” also answered to U+00B2 (²), “≥” to U+00B3,
 * “≠” to U+00AD and “º” to U+00BC, and control codes gained glyphs. Those
 * bogus code points then changed the exported OS/2 usFirstCharIndex, the
 * written glyph names and what the editor showed for a character.
 *
 * This reader therefore builds the code-point map from the Unicode subtables
 * only — (3,10)/(0,4)/(0,6) format 12/13, (3,1)/(0,x) format 4/6/0 — in the
 * preference order of the OpenType spec (and of fontTools' `getBestCmap`).
 * Legacy Macintosh subtables are used only when a font has no Unicode subtable
 * at all, and then their byte codes are converted through the Mac Roman table.
 * Format 14 holds Unicode *variation sequences* (base character + selector)
 * and never plain mappings, so its entries are counted and ignored.
 */
import { MAC_ROMAN_TO_UNICODE } from './macEncoding';
import { bytesOf, viewOf } from './sfnt';

export interface CmapSubtableInfo {
  platformID: number;
  encodingID: number;
  format: number;
  /** Number of code point → glyph entries the subtable holds (0 for format 14). */
  entries: number;
  /** How the subtable was treated when building the map. */
  role: 'unicode' | 'macRoman' | 'symbol' | 'variationSequences' | 'ignored';
}

export interface CmapReadResult {
  /** Every subtable of the cmap table, in the order the font lists them. */
  subtables: CmapSubtableInfo[];
  /** Unicode code point → glyph index. */
  map: Map<number, number>;
  /** Where the mappings came from. */
  source: 'unicode' | 'symbol' | 'macRoman' | 'none';
  /** Number of variation-sequence records that were deliberately skipped. */
  variationSequences: number;
}

/** Find a table in the sfnt directory; null when the font has no such table. */
export function findSfntTable(input: ArrayBuffer | Uint8Array, tag: string): { offset: number; length: number } | null {
  const bytes = bytesOf(input);
  if (bytes.length < 12) return null;
  const view = viewOf(bytes);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > bytes.length) break;
    let t = '';
    for (let j = 0; j < 4; j++) t += String.fromCharCode(view.getUint8(rec + j));
    if (t !== tag) continue;
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    if (offset >= bytes.length) return null;
    return { offset, length: Math.min(length, bytes.length - offset) };
  }
  return null;
}

/**
 * Preference of a Unicode subtable (higher wins); 0 means "not a Unicode
 * subtable". Mirrors the OpenType recommendation and fontTools' cmap
 * preference list: full-repertoire formats first, then the BMP ones.
 */
function unicodePreference(platformID: number, encodingID: number, format: number): number {
  if (format === 14 || format === 2) return 0;
  if (platformID === 3 && encodingID === 10) return 5;
  if (platformID === 0 && (encodingID === 4 || encodingID === 6)) return 4;
  if (platformID === 3 && encodingID === 1) return 3;
  if (platformID === 0 && encodingID <= 3) return 2;
  return 0;
}

type Mapping = Map<number, number>;

function readFormat0(view: DataView, offset: number): Mapping {
  const out: Mapping = new Map();
  for (let code = 0; code < 256; code++) {
    const gid = view.getUint8(offset + 6 + code);
    if (gid) out.set(code, gid);
  }
  return out;
}

function readFormat4(view: DataView, offset: number): Mapping {
  const out: Mapping = new Map();
  const segCountX2 = view.getUint16(offset + 6);
  const segCount = segCountX2 / 2;
  const endOff = offset + 14;
  const startOff = endOff + segCountX2 + 2;
  const deltaOff = startOff + segCountX2;
  const rangeOff = deltaOff + segCountX2;
  for (let s = 0; s < segCount; s++) {
    const end = view.getUint16(endOff + s * 2);
    const start = view.getUint16(startOff + s * 2);
    const delta = view.getInt16(deltaOff + s * 2);
    const rangeOffset = view.getUint16(rangeOff + s * 2);
    if (start > end) continue;
    for (let cp = start; cp <= end; cp++) {
      if (cp === 0xffff) continue;
      let gid: number;
      if (rangeOffset === 0) {
        gid = (cp + delta) & 0xffff;
      } else {
        const gidOffset = rangeOff + s * 2 + rangeOffset + (cp - start) * 2;
        if (gidOffset + 1 >= view.byteLength) continue;
        const raw = view.getUint16(gidOffset);
        gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (gid) out.set(cp, gid);
    }
  }
  return out;
}

function readFormat6(view: DataView, offset: number): Mapping {
  const out: Mapping = new Map();
  const first = view.getUint16(offset + 6);
  const count = view.getUint16(offset + 8);
  for (let i = 0; i < count; i++) {
    const gid = view.getUint16(offset + 10 + i * 2);
    if (gid) out.set(first + i, gid);
  }
  return out;
}

/** Formats 12 (segmented coverage) and 13 (many glyphs to one code point). */
function readFormat12or13(view: DataView, offset: number, format: number): Mapping {
  const out: Mapping = new Map();
  const nGroups = view.getUint32(offset + 12);
  const max = Math.min(nGroups, 0x100000);
  for (let g = 0; g < max; g++) {
    const rec = offset + 16 + g * 12;
    if (rec + 12 > view.byteLength) break;
    const start = view.getUint32(rec);
    const end = view.getUint32(rec + 4);
    const startGid = view.getUint32(rec + 8);
    if (end < start || end - start > 0x110000) continue;
    for (let cp = start; cp <= end; cp++) {
      const gid = format === 13 ? startGid : startGid + (cp - start);
      if (gid) out.set(cp, gid);
    }
  }
  return out;
}

/** Number of variation-selector records in a format-14 subtable. */
function countFormat14(view: DataView, offset: number): number {
  const n = view.getUint32(offset + 6);
  return Number.isFinite(n) ? Math.min(n, 0xffff) : 0;
}

/**
 * Read the cmap table of an sfnt font (TTF/OTF bytes, WOFF already unwrapped).
 * Returns null when the font has no usable cmap table.
 */
export function readCmapFromSfnt(input: ArrayBuffer | Uint8Array): CmapReadResult | null {
  const bytes = bytesOf(input);
  const table = findSfntTable(bytes, 'cmap');
  if (!table || table.length < 4) return null;
  const view = viewOf(bytes);
  const base = table.offset;
  const numSubtables = view.getUint16(base + 2);

  const subtables: CmapSubtableInfo[] = [];
  const unicodeTables: Array<{ pref: number; map: Mapping }> = [];
  const symbolTables: Mapping[] = [];
  const macTables: Mapping[] = [];
  let variationSequences = 0;

  for (let i = 0; i < numSubtables; i++) {
    const rec = base + 4 + i * 8;
    if (rec + 8 > bytes.length) break;
    const platformID = view.getUint16(rec);
    const encodingID = view.getUint16(rec + 2);
    const offset = base + view.getUint32(rec + 4);
    if (offset + 4 > bytes.length) continue;
    const format = view.getUint16(offset);

    let map: Mapping | null = null;
    try {
      if (format === 0) map = readFormat0(view, offset);
      else if (format === 4) map = readFormat4(view, offset);
      else if (format === 6) map = readFormat6(view, offset);
      else if (format === 12 || format === 13) map = readFormat12or13(view, offset, format);
    } catch {
      map = null; // a truncated subtable must not break the import
    }

    if (format === 14) {
      const n = countFormat14(view, offset);
      variationSequences += n;
      subtables.push({ platformID, encodingID, format, entries: 0, role: 'variationSequences' });
      continue;
    }
    if (!map) {
      subtables.push({ platformID, encodingID, format, entries: 0, role: 'ignored' });
      continue;
    }

    const pref = unicodePreference(platformID, encodingID, format);
    let role: CmapSubtableInfo['role'];
    if (pref > 0) {
      role = 'unicode';
      unicodeTables.push({ pref, map });
    } else if (platformID === 3 && encodingID === 0) {
      role = 'symbol';
      symbolTables.push(map);
    } else if (platformID === 1) {
      role = 'macRoman';
      macTables.push(map);
    } else {
      role = 'ignored';
    }
    subtables.push({ platformID, encodingID, format, entries: map.size, role });
  }

  const out: Mapping = new Map();
  let source: CmapReadResult['source'] = 'none';
  if (unicodeTables.length) {
    source = 'unicode';
    for (const { map } of [...unicodeTables].sort((a, b) => b.pref - a.pref)) {
      for (const [cp, gid] of map) if (!out.has(cp)) out.set(cp, gid);
    }
  } else if (symbolTables.length) {
    // A Windows Symbol subtable already stores code points (usually U+F000…F0FF).
    source = 'symbol';
    for (const map of symbolTables) for (const [cp, gid] of map) if (!out.has(cp)) out.set(cp, gid);
  } else if (macTables.length) {
    // Last resort: a Mac-only font. Its byte codes are Mac Roman, not Unicode.
    source = 'macRoman';
    for (const map of macTables) {
      for (const [code, gid] of map) {
        const cp = code < 256 ? MAC_ROMAN_TO_UNICODE[code] : 0;
        if (cp && !out.has(cp)) out.set(cp, gid);
      }
    }
  }
  return { subtables, map: out, source, variationSequences };
}

/** Group a code point → glyph map by glyph index, code points ascending. */
export function codePointsByGlyph(map: ReadonlyMap<number, number>): Map<number, number[]> {
  const byGlyph = new Map<number, number[]>();
  for (const [cp, gid] of map) {
    const list = byGlyph.get(gid);
    if (list) list.push(cp);
    else byGlyph.set(gid, [cp]);
  }
  for (const list of byGlyph.values()) list.sort((a, b) => a - b);
  return byGlyph;
}
