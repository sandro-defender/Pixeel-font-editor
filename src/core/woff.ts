/**
 * Font container handling: recognise TrueType/OpenType (sfnt), WOFF and WOFF2
 * (and refuse collections / non-fonts with an explicit message) and unwrap
 * WOFF / WOFF2 into plain sfnt bytes, entirely client-side.
 *
 * WOFF 1 is zlib per table, so it is unpacked here byte-exactly (every table of
 * the original font comes back unchanged — hinting and kerning included). WOFF2
 * needs Brotli and the glyf/loca transform, which the woff2 wasm decoder does.
 */
import { unzlibSync } from 'fflate';

export type FontContainer = 'sfnt' | 'woff' | 'woff2' | 'collection' | 'bdf' | 'unknown';

const tag4 = (v: DataView, off: number): string => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));

/** Identify the file by its first bytes (never by file name). */
export function sniffContainer(buffer: ArrayBuffer): FontContainer {
  if (buffer.byteLength < 4) return 'unknown';
  const v = new DataView(buffer);
  const t = tag4(v, 0);
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'ttcf') return 'collection';
  if (v.getUint32(0) === 0x00010000 || t === 'true' || t === 'OTTO') return 'sfnt';
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64))).trimStart();
  if (head.startsWith('STARTFONT')) return 'bdf';
  return 'unknown';
}

const SFNT_FLAVORS = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]);

/** Flavor of the wrapped font as text, for messages. */
const flavorName = (f: number) => (f === 0x4f54544f ? 'OpenType/CFF' : f === 0x00010000 || f === 0x74727565 ? 'TrueType' : `0x${f.toString(16)}`);

/** Unpack a WOFF 1 file into the original sfnt bytes. Throws readable errors. */
export function woffToSfnt(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength < 44) throw new Error('This WOFF file is too small to be valid — it looks truncated.');
  const v = new DataView(buffer);
  if (tag4(v, 0) !== 'wOFF') throw new Error('Not a WOFF file (missing the “wOFF” signature).');
  const flavor = v.getUint32(4);
  const declaredLength = v.getUint32(8);
  const numTables = v.getUint16(12);
  if (declaredLength > buffer.byteLength) {
    throw new Error(`This WOFF file is truncated: its header says ${declaredLength} bytes but only ${buffer.byteLength} were read. Download it again.`);
  }
  if (!SFNT_FLAVORS.has(flavor)) throw new Error(`This WOFF wraps an unsupported font type (${flavorName(flavor)}). Only TrueType and OpenType/CFF fonts can be opened.`);
  if (numTables === 0 || numTables > 512) throw new Error(`This WOFF file has an invalid table count (${numTables}).`);
  if (44 + numTables * 20 > buffer.byteLength) throw new Error('This WOFF file is truncated: its table directory is incomplete.');

  interface Entry { tag: string; checksum: number; data: Uint8Array }
  const entries: Entry[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = tag4(v, o);
    const offset = v.getUint32(o + 4);
    const compLength = v.getUint32(o + 8);
    const origLength = v.getUint32(o + 12);
    const checksum = v.getUint32(o + 16);
    if (offset + compLength > buffer.byteLength) throw new Error(`WOFF table “${tag}” lies outside the file — the file is truncated or corrupt.`);
    if (compLength > origLength) throw new Error(`WOFF table “${tag}” is corrupt (compressed size ${compLength} is larger than the original ${origLength}).`);
    const raw = new Uint8Array(buffer, offset, compLength);
    let data: Uint8Array;
    if (compLength === origLength) {
      data = raw; // stored uncompressed
    } else {
      try {
        data = unzlibSync(raw, { out: new Uint8Array(origLength) });
      } catch {
        throw new Error(`WOFF table “${tag}” could not be decompressed — the data is corrupt.`);
      }
      if (data.length !== origLength) throw new Error(`WOFF table “${tag}” decompressed to ${data.length} bytes instead of ${origLength} — the file is corrupt.`);
    }
    entries.push({ tag, checksum, data });
  }
  entries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const pad4 = (n: number) => (n + 3) & ~3;
  const dirSize = 12 + numTables * 16;
  let total = dirSize;
  for (const e of entries) total += pad4(e.data.length);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, flavor);
  ov.setUint16(4, numTables);
  let sr = 1, es = 0;
  while (sr * 2 <= numTables) { sr *= 2; es += 1; }
  ov.setUint16(6, sr * 16);
  ov.setUint16(8, es);
  ov.setUint16(10, numTables * 16 - sr * 16);
  let pos = dirSize;
  entries.forEach((e, i) => {
    const d = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[d + k] = e.tag.charCodeAt(k);
    ov.setUint32(d + 4, e.checksum);
    ov.setUint32(d + 8, pos);
    ov.setUint32(d + 12, e.data.length);
    out.set(e.data, pos);
    pos += pad4(e.data.length);
  });
  return out.buffer;
}

/** Header sanity checks for WOFF2 before handing the bytes to the wasm decoder. */
export function checkWoff2Header(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 48) throw new Error('This WOFF2 file is too small to be valid — it looks truncated.');
  const v = new DataView(buffer);
  if (tag4(v, 0) !== 'wOF2') throw new Error('Not a WOFF2 file (missing the “wOF2” signature).');
  const flavor = v.getUint32(4);
  const declaredLength = v.getUint32(8);
  if (flavor === 0x74746366 /* ttcf */) throw new Error('This WOFF2 file contains a font collection (several fonts in one file), which is not supported. Extract a single font first.');
  if (declaredLength > buffer.byteLength) {
    throw new Error(`This WOFF2 file is truncated: its header says ${declaredLength} bytes but only ${buffer.byteLength} were read. Download it again.`);
  }
  if (!SFNT_FLAVORS.has(flavor)) throw new Error(`This WOFF2 wraps an unsupported font type (${flavorName(flavor)}). Only TrueType and OpenType/CFF fonts can be opened.`);
}

export interface Unwrapped {
  /** Plain sfnt bytes. */
  buffer: ArrayBuffer;
  container: 'sfnt' | 'woff' | 'woff2';
}

/** Turn any supported web/desktop font file into sfnt bytes, or explain why not. */
export async function unwrapFont(buffer: ArrayBuffer): Promise<Unwrapped> {
  const kind = sniffContainer(buffer);
  switch (kind) {
    case 'sfnt':
      return { buffer, container: 'sfnt' };
    case 'woff':
      return { buffer: woffToSfnt(buffer), container: 'woff' };
    case 'woff2': {
      checkWoff2Header(buffer);
      const { decodeWoff2 } = await import('./woff2Loader');
      const bytes = await decodeWoff2(new Uint8Array(buffer));
      return { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, container: 'woff2' };
    }
    case 'collection':
      throw new Error('This is a font collection (.ttc / .otc) with several fonts in one file. Extract a single font first (for example with fonttools).');
    case 'bdf':
      throw new Error('This is a BDF bitmap font — open it with “Open font”, which imports BDF as a pixel font.');
    default:
      throw new Error('Not a font this editor can open. Supported: TrueType (.ttf), OpenType/CFF (.otf), WOFF (.woff), WOFF2 (.woff2) and BDF (.bdf).');
  }
}
