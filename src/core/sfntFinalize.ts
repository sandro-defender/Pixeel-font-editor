/**
 * Corrections applied to the bytes fonteditor-core writes, before a font is
 * handed out. Each one changes only the tables it names; everything else is
 * copied byte for byte.
 */
import { readSfnt, writeSfnt, type SfntTable } from './sfnt';
import { macRomanToUnicode } from './cmapRead';

/** Pascal string bytes (length byte + ASCII/UTF-8), at most 255 bytes. */
function pascal(name: string): Uint8Array {
  const raw = new TextEncoder().encode(name);
  const body = raw.length > 255 ? raw.subarray(0, 255) : raw;
  const out = new Uint8Array(body.length + 1);
  out[0] = body.length;
  out.set(body, 1);
  return out;
}

/**
 * post format 2: the writer names every glyph after its first code point's
 * standard Mac name (lessequal → “twosuperior”, uni00A0 → “nonbreakingspace”),
 * so the glyph names of the editor are written as custom names instead. The
 * .notdef glyph keeps its standard index 0.
 */
export function rewritePostNames(post: Uint8Array, names: string[]): Uint8Array {
  const view = new DataView(post.buffer, post.byteOffset, post.byteLength);
  if (post.byteLength < 32 || view.getUint32(0) !== 0x00020000) return post; // only format 2 carries names
  const header = post.slice(0, 32);
  const strings: Uint8Array[] = [];
  const indices: number[] = [];
  names.forEach((name, i) => {
    if (i === 0 && name === '.notdef') {
      indices.push(0);
      return;
    }
    indices.push(258 + strings.length);
    strings.push(pascal(name || 'glyph'));
  });
  const stringBytes = strings.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(32 + 2 + names.length * 2 + stringBytes);
  out.set(header, 0);
  const ov = new DataView(out.buffer);
  ov.setUint16(32, names.length);
  indices.forEach((ix, i) => ov.setUint16(34 + i * 2, ix));
  let at = 34 + names.length * 2;
  for (const s of strings) {
    out.set(s, at);
    at += s.length;
  }
  return out;
}

/**
 * The (1,0) Macintosh format-0 subtable: its byte codes are Mac Roman codes.
 * Each code gets the glyph of the Unicode character it stands for, or 0.
 * The subtable keeps its size, so it is patched in place.
 */
export function patchMacRomanSubtable(cmap: Uint8Array, glyphOfCodePoint: (cp: number) => number): Uint8Array {
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  if (cmap.byteLength < 4) return cmap;
  const n = view.getUint16(2);
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8;
    if (rec + 8 > cmap.byteLength) break;
    if (view.getUint16(rec) !== 1 || view.getUint16(rec + 2) !== 0) continue;
    const sub = view.getUint32(rec + 4);
    if (sub + 262 > cmap.byteLength || view.getUint16(sub) !== 0) continue;
    const out = cmap.slice();
    for (let code = 0; code < 256; code++) {
      out[sub + 6 + code] = glyphOfCodePoint(macRomanToUnicode(code)) & 0xff;
    }
    return out;
  }
  return cmap;
}

/**
 * OS/2 fields fonteditor-core gets wrong: it sets ulUnicodeRange2 to the Private
 * Use bit for every font.
 */
export function patchOs2(os2: Uint8Array, values: { unicodeRanges: readonly number[] }): Uint8Array {
  if (os2.byteLength < 58) return os2; // version 0 is 78 bytes, but anything shorter has no ranges
  const out = os2.slice();
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  values.unicodeRanges.forEach((word, i) => v.setUint32(42 + i * 4, word >>> 0));
  return out;
}

export interface FinalizeInput {
  /** Glyph names in glyph order (the names the editor holds). */
  glyphNames: string[];
  /** Code point → glyph index for the written font (Unicode mappings only). */
  glyphOfCodePoint: (cp: number) => number;
  /** OS/2 values the writer gets wrong (see patchOs2). */
  os2: { unicodeRanges: readonly number[] };
}

/** Apply every correction to a written sfnt and return the new bytes. */
export function finalizeSfnt(buffer: ArrayBuffer, input: FinalizeInput): ArrayBuffer {
  const file = readSfnt(buffer);
  const tables: SfntTable[] = file.tables.map((t) => {
    if (t.tag === 'post') return { tag: t.tag, data: rewritePostNames(t.data, input.glyphNames) };
    if (t.tag === 'cmap') return { tag: t.tag, data: patchMacRomanSubtable(t.data, input.glyphOfCodePoint) };
    if (t.tag === 'OS/2') return { tag: t.tag, data: patchOs2(t.data, input.os2) };
    return t;
  });
  return writeSfnt({ sfntVersion: file.sfntVersion, tables });
}
