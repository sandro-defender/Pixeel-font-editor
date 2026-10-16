/**
 * A legacy Macintosh (platform 1) cmap subtable holds Mac Roman byte codes, not
 * Unicode. fonteditor-core read them as Unicode, so Quantico-Bold came back with
 * 302 mappings instead of 258 (≤ also took U+00B2, ≥ U+00B3, ≠ U+00AD, º U+00BC),
 * and its glyphs were renamed. These tests pin the importer and the export.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont, reopenFont } from '../src/core/fontCodec';
import { macRomanToUnicode, readCmapSubtables, readUnicodeCmap, unicodeCmapRecord } from '../src/core/cmapRead';
import { readSfnt, writeSfnt } from '../src/core/sfnt';
import { DEFAULT_EXPORT_OPTIONS } from '../src/core/fontCodec';

const QUANTICO = readFileSync(resolve(__dirname, 'fixtures/Quantico-Bold.ttf'));
const quanticoBuffer = (): ArrayBuffer => QUANTICO.buffer.slice(QUANTICO.byteOffset, QUANTICO.byteOffset + QUANTICO.byteLength) as ArrayBuffer;

/** A copy of Quantico whose cmap holds only the (1,0) Mac Roman subtable. */
function macOnlyQuantico(): ArrayBuffer {
  const file = readSfnt(quanticoBuffer());
  const uni = readUnicodeCmap(quanticoBuffer());
  const codes: number[] = new Array(256).fill(0);
  for (let code = 0; code < 256; code++) {
    const g = uni.byCodePoint.get(macRomanToUnicode(code));
    if (g !== undefined) codes[code] = g;
  }
  const sub = new Uint8Array(262);
  const sv = new DataView(sub.buffer);
  sv.setUint16(0, 0);
  sv.setUint16(2, 262);
  sv.setUint16(4, 0);
  codes.forEach((g, i) => (sub[6 + i] = g));
  const head = new Uint8Array(12);
  const hv = new DataView(head.buffer);
  hv.setUint16(0, 0);
  hv.setUint16(2, 1);
  hv.setUint16(4, 1);
  hv.setUint16(6, 0);
  hv.setUint32(8, 12);
  const cmap = new Uint8Array(12 + sub.length);
  cmap.set(head, 0);
  cmap.set(sub, 12);
  const tables = file.tables.map((t) => (t.tag === 'cmap' ? { tag: t.tag, data: cmap } : t));
  return writeSfnt({ sfntVersion: file.sfntVersion, tables });
}

/** A minimal cmap table from raw subtables (each { platform, encoding, bytes }). */
function cmapTable(subs: Array<{ p: number; e: number; bytes: Uint8Array }>): Uint8Array {
  const headerLen = 4 + subs.length * 8;
  const total = headerLen + subs.reduce((n, s) => n + s.bytes.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, subs.length);
  let at = headerLen;
  subs.forEach((s, i) => {
    v.setUint16(4 + i * 8, s.p);
    v.setUint16(6 + i * 8, s.e);
    v.setUint32(8 + i * 8, at);
    out.set(s.bytes, at);
    at += s.bytes.length;
  });
  return out;
}

/** Format 4 covering the given (code, glyph) pairs, one segment per code. */
function format4(pairs: Array<[number, number]>): Uint8Array {
  const segs = [...pairs].sort((a, b) => a[0] - b[0]).map(([c, g]) => ({ c, delta: (g - c) & 0xffff, g }));
  const n = segs.length + 1; // + the 0xFFFF terminator
  const len = 16 + n * 8;
  const out = new Uint8Array(len);
  const v = new DataView(out.buffer);
  v.setUint16(0, 4);
  v.setUint16(2, len);
  v.setUint16(6, n * 2);
  segs.forEach((s, i) => {
    v.setUint16(14 + i * 2, s.c); // endCode
    v.setUint16(16 + n * 2 + i * 2, s.c); // startCode
    v.setUint16(16 + n * 4 + i * 2, s.delta); // idDelta
  });
  v.setUint16(14 + (n - 1) * 2, 0xffff);
  v.setUint16(16 + n * 2 + (n - 1) * 2, 0xffff);
  v.setUint16(16 + n * 4 + (n - 1) * 2, 1);
  return out;
}

function format0(pairs: Array<[number, number]>): Uint8Array {
  const out = new Uint8Array(262);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0);
  v.setUint16(2, 262);
  for (const [c, g] of pairs) out[6 + c] = g;
  return out;
}

describe('Unicode mappings read from the raw cmap', () => {
  it('Quantico-Bold: exactly its 258 Unicode mappings, none from the Mac subtable', () => {
    const uni = readUnicodeCmap(quanticoBuffer());
    expect(uni.source).toBe('unicode');
    expect(uni.byCodePoint.size).toBe(258);
    // ≤ U+2264 is glyph “lessequal”; U+00B2 (²) is not mapped at all
    expect(uni.byCodePoint.has(0xb2)).toBe(false);
    expect(uni.byCodePoint.has(0x01)).toBe(false);
    expect(uni.byCodePoint.has(0x08)).toBe(false);
    expect(uni.byCodePoint.has(0x1d)).toBe(false);
  });

  it('a Mac-only font is converted through the Mac Roman table', () => {
    const mac = macOnlyQuantico();
    expect(readCmapSubtables(mac).map((s) => `${s.platformID},${s.encodingID},${s.format}`)).toEqual(['1,0,0']);
    const uni = readUnicodeCmap(mac);
    expect(uni.source).toBe('mac-roman');
    expect(uni.byCodePoint.size).toBe(214);
    expect(uni.byCodePoint.has(0xb2)).toBe(false);
    const full = readUnicodeCmap(quanticoBuffer());
    expect(uni.byCodePoint.get(0x2264)).toBe(full.byCodePoint.get(0x2264));
    expect(uni.byCodePoint.get(0xc6)).toBe(full.byCodePoint.get(0xc6)); // Æ, Mac code 0xAE
  });

  it('format 14 variation-sequence entries are not plain mappings', () => {
    const uniBytes = format4([[0x41, 5], [0x42, 6]]);
    // format 14 header + one variation selector record (U+FE0F, default UVS for U+0043)
    const vs = new Uint8Array(10 + 11);
    const vv = new DataView(vs.buffer);
    vv.setUint16(0, 14);
    vv.setUint32(2, vs.length);
    vv.setUint32(6, 1); // numVarSelectorRecords
    vs[10] = 0x00; vs[11] = 0x0f; vs[12] = 0xf0; // varSelector: U+FE0F as uint24
    vv.setUint32(13, 0); // defaultUVSOffset (absent, for the test)
    vv.setUint32(17, 0); // nonDefaultUVSOffset (absent)
    const buffer = withCmap(cmapTable([{ p: 3, e: 1, bytes: uniBytes }, { p: 0, e: 5, bytes: vs }]));
    const uni = readUnicodeCmap(buffer);
    expect([...uni.byCodePoint.keys()].sort()).toEqual([0x41, 0x42]);
  });

  it('Unicode subtables win over the Mac subtable when both exist', () => {
    const cmap = cmapTable([
      { p: 1, e: 0, bytes: format0([[0xb2, 9]]) },
      { p: 3, e: 1, bytes: format4([[0x2264, 4]]) },
    ]);
    const uni = readUnicodeCmap(withCmap(cmap));
    expect(uni.source).toBe('unicode');
    expect([...uni.byCodePoint.entries()]).toEqual([[0x2264, 4]]);
  });

  it('unicodeCmapRecord is the same map as a plain object', () => {
    const rec = unicodeCmapRecord(quanticoBuffer());
    expect(Object.keys(rec)).toHaveLength(258);
    expect(rec[0x2264]).toBe(readUnicodeCmap(quanticoBuffer()).byCodePoint.get(0x2264));
  });
});

/** Replace the cmap table of the Quantico fixture. */
function withCmap(cmap: Uint8Array): ArrayBuffer {
  const file = readSfnt(quanticoBuffer());
  return writeSfnt({ sfntVersion: file.sfntVersion, tables: file.tables.map((t) => (t.tag === 'cmap' ? { tag: t.tag, data: cmap } : t)) });
}

describe('Quantico-Bold round trip', () => {
  it('imports 258 code points with the original glyph names', async () => {
    const { doc } = await importFont(quanticoBuffer(), 'Quantico-Bold.ttf');
    expect(doc.glyphs.filter((g) => g.unicode !== null)).toHaveLength(258);
    expect(doc.glyphs.some((g) => (g.extraUnicodes?.length ?? 0) > 0)).toBe(false);
    const name = (cp: number) => doc.glyphs.find((g) => g.unicode === cp)?.name;
    expect(name(0x2264)).toBe('lessequal');
    expect(name(0xa7)).toBe('section');
    expect(name(0xc6)).toBe('AE');
    expect(name(0xa0)).toBe('uni00A0');
    expect(doc.glyphs[0].name).toBe('.notdef');
  });

  it('exports the same 258 mappings, the original glyph names and standard Mac codes', async () => {
    const { doc, sourceTtf } = await importFont(quanticoBuffer(), 'Quantico-Bold.ttf');
    const { buffer, report } = buildTtf({ doc, sourceTtf, options: { ...DEFAULT_EXPORT_OPTIONS, validate: true } });
    expect(report.validation?.ok).toBe(true);
    const reopened = await importFont(buffer, 'out.ttf');
    expect(reopened.doc.glyphs.map((g) => g.name)).toEqual(doc.glyphs.map((g) => g.name));
    expect(reopened.doc.glyphs.filter((g) => g.unicode !== null)).toHaveLength(258);
    expect(reopened.doc.glyphs.map((g) => g.unicode)).toEqual(doc.glyphs.map((g) => g.unicode));
    // the file's own Mac subtable gives ≤ at Mac code 0xB2, and nothing that Mac Roman does not define
    const lessequal = doc.glyphs.findIndex((g) => g.name === 'lessequal');
    const mac = readCmapSubtables(buffer).find((s) => s.platformID === 1);
    expect(mac?.entries.find(([code]) => code === 0xb2)?.[1]).toBe(lessequal);
    const { cmap } = reopenFont(buffer);
    expect(cmap[0xb2]).toBeUndefined();
    expect(cmap[0x2264]).toBe(lessequal);
  });
});
