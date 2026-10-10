import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sniffContainer, unwrapFont, woffToSfnt } from '../src/core/woff';
import { buildTtf, importFont } from '../src/core/fontCodec';
import { registerSource, getSource } from '../src/core/sourceRegistry';
import { parseTtf } from './helpers';

const read = (name: string): ArrayBuffer => {
  const b = readFileSync(resolve(__dirname, 'fixtures', name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Table tag → bytes of an sfnt buffer. */
function tables(buf: ArrayBuffer): Map<string, Uint8Array> {
  const v = new DataView(buf);
  const n = v.getUint16(4);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    out.set(tag, new Uint8Array(buf, v.getUint32(o + 8), v.getUint32(o + 12)));
  }
  return out;
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const TTF = read('Lato-Regular.ttf');
const WOFF = read('Lato-Regular.woff');
const WOFF2 = read('Lato-Regular.woff2');

describe('container detection', () => {
  it('recognises each format by its signature', () => {
    expect(sniffContainer(TTF)).toBe('sfnt');
    expect(sniffContainer(WOFF)).toBe('woff');
    expect(sniffContainer(WOFF2)).toBe('woff2');
    expect(sniffContainer(new TextEncoder().encode('STARTFONT 2.1\n').buffer as ArrayBuffer)).toBe('bdf');
    const ttc = new Uint8Array(64);
    ttc.set([0x74, 0x74, 0x63, 0x66]);
    expect(sniffContainer(ttc.buffer)).toBe('collection');
    expect(sniffContainer(new TextEncoder().encode('hello world').buffer as ArrayBuffer)).toBe('unknown');
    expect(sniffContainer(new ArrayBuffer(2))).toBe('unknown');
  });
});

describe('WOFF import (fixture made with fontTools)', () => {
  it('unpacks to byte-identical tables', () => {
    const sfnt = woffToSfnt(WOFF);
    const orig = tables(TTF);
    const got = tables(sfnt);
    expect([...got.keys()].sort()).toEqual([...orig.keys()].sort());
    // fontTools stamps a new modified time into `head` when it saves, so that one table is compared by size only
    for (const [tag, bytes] of orig) {
      if (tag === 'head') expect(got.get(tag)!.length).toBe(bytes.length);
      else expect(same(got.get(tag)!, bytes), `table ${tag}`).toBe(true);
    }
  });

  it('imports the same font as the .ttf, and records the container', async () => {
    const a = await importFont(TTF, 'Lato-Regular.ttf');
    const b = await importFont(WOFF, 'Lato-Regular.woff');
    expect(b.doc.glyphs.length).toBe(a.doc.glyphs.length);
    expect(b.doc.meta.fontFamily).toBe('Lato');
    expect(b.doc.metrics).toEqual(a.doc.metrics);
    expect(b.doc.source).toMatchObject({ fileName: 'Lato-Regular.woff', container: 'woff', hasKerning: true, hasHinting: true });
    expect(b.doc.glyphs.map((g) => [g.name, g.unicode, g.advanceWidth, g.contours.length])).toEqual(a.doc.glyphs.map((g) => [g.name, g.unicode, g.advanceWidth, g.contours.length]));
    expect(b.doc.kerning?.length).toBe(a.doc.kerning?.length);
    expect(b.warnings.join(' ')).toMatch(/Opened from WOFF/);
    expect(a.doc.source?.container).toBeUndefined();
  });

  it('exports a valid .ttf that keeps the original hinting and kerning', async () => {
    const { doc, sourceTtf } = await importFont(WOFF, 'Lato-Regular.woff');
    const ref = registerSource(sourceTtf);
    const { buffer, report } = buildTtf({ doc: { ...doc, sourceRef: ref }, sourceTtf: getSource(ref) ?? null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);
    expect(sniffContainer(buffer)).toBe('sfnt');
    const out = parseTtf(buffer);
    expect(!!out.GPOS).toBe(true);
    expect(!!out.fpgm).toBe(true);
    expect(out.glyf.length).toBe(doc.glyphs.length);
  });
});

describe('WOFF2 import (fixture made with fontTools + brotli)', () => {
  it('decompresses client-side to a font with the same glyph data', async () => {
    const { buffer, container } = await unwrapFont(WOFF2);
    expect(container).toBe('woff2');
    expect(sniffContainer(buffer)).toBe('sfnt');
    const orig = tables(TTF);
    const got = tables(buffer);
    // glyph data may be re-laid-out by the woff2 transform, but these must match exactly
    for (const tag of ['head', 'hhea', 'maxp', 'OS/2', 'cmap', 'hmtx', 'GPOS', 'name']) {
      expect(got.has(tag), tag).toBe(true);
      if (tag !== 'head') expect(same(got.get(tag)!, orig.get(tag)!), `table ${tag}`).toBe(true);
    }
  });

  it('imports the same font as the .ttf', async () => {
    const a = await importFont(TTF, 'Lato-Regular.ttf');
    const b = await importFont(WOFF2, 'Lato-Regular.woff2');
    expect(b.doc.glyphs.length).toBe(a.doc.glyphs.length);
    expect(b.doc.metrics).toEqual(a.doc.metrics);
    expect(b.doc.source).toMatchObject({ container: 'woff2', fileName: 'Lato-Regular.woff2' });
    expect(b.doc.glyphs.map((g) => [g.name, g.unicode, g.advanceWidth, g.kind])).toEqual(a.doc.glyphs.map((g) => [g.name, g.unicode, g.advanceWidth, g.kind]));
    // outlines identical
    const bad = a.doc.glyphs.filter((g, i) => JSON.stringify(g.contours) !== JSON.stringify(b.doc.glyphs[i].contours));
    expect(bad.length).toBe(0);
    expect(b.doc.kerning?.length).toBe(a.doc.kerning?.length);
    expect(b.warnings.join(' ')).toMatch(/Opened from WOFF2/);
  });

  it('exports a valid .ttf', async () => {
    const { doc, sourceTtf } = await importFont(WOFF2, 'Lato-Regular.woff2');
    const ref = registerSource(sourceTtf);
    const { report } = buildTtf({ doc: { ...doc, sourceRef: ref }, sourceTtf: getSource(ref) ?? null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);
  });
});

describe('clear errors', () => {
  const fails = (buf: ArrayBuffer | Uint8Array, re: RegExp) => expect(importFont(buf, 'x')).rejects.toThrow(re);
  const bytes = (b: ArrayBuffer) => new Uint8Array(b.slice(0));

  it('truncated WOFF', async () => {
    await fails(WOFF.slice(0, 20), /too small|truncated/);
    await fails(WOFF.slice(0, 5000), /truncated/);
  });

  it('corrupt WOFF table data', async () => {
    const b = bytes(WOFF);
    const v = new DataView(b.buffer);
    // find a compressed table and damage the middle of its zlib stream
    for (let i = 0; i < v.getUint16(12); i++) {
      const o = 44 + i * 20;
      const off = v.getUint32(o + 4), comp = v.getUint32(o + 8), orig = v.getUint32(o + 12);
      if (comp < orig && comp > 200) {
        for (let k = 20; k < 120; k++) b[off + k] ^= 0xa5;
        break;
      }
    }
    await fails(b, /could not be decompressed|corrupt/);
  });

  it('WOFF with an impossible table', async () => {
    const b = bytes(WOFF);
    new DataView(b.buffer).setUint32(44 + 4, b.length + 10); // first table starts past the end
    await fails(b, /outside the file/);
    const c = bytes(WOFF);
    new DataView(c.buffer).setUint32(4, 0x12345678); // unknown flavor
    await fails(c, /unsupported font type/);
    const d = bytes(WOFF);
    new DataView(d.buffer).setUint16(12, 0);
    await fails(d, /invalid table count/);
  });

  it('truncated or garbage WOFF2', async () => {
    await fails(WOFF2.slice(0, 30), /too small|truncated/);
    await fails(WOFF2.slice(0, 20000), /truncated/);
    const g = bytes(WOFF2);
    for (let i = 60; i < g.length; i++) g[i] = (i * 31) & 0xff; // header intact, body garbage
    await fails(g, /corrupt or uses an unsupported feature/);
  });

  it('collections, non-fonts and empty files', async () => {
    const ttc = new Uint8Array(64);
    ttc.set([0x74, 0x74, 0x63, 0x66]);
    await fails(ttc, /font collection/);
    await fails(new TextEncoder().encode('just some text, not a font at all'), /Not a font this editor can open/);
    await fails(new Uint8Array(0), /Not a font this editor can open/);
  });
});
