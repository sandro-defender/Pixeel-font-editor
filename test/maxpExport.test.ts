/**
 * maxp fields the writer gets wrong.
 *
 * fonteditor-core builds the maxp table from `ttf.support.maxp` (OS2.js),
 * which copies `maxZones: ttf.maxp.maxZones || 0` and has no
 * `maxInstructionDefs` field at all. A font created in Pixeel starts from a
 * blank template, so it exported maxZones 0 — an illegal value that OTS
 * reports as "Bad maxZones: 0" — and a hinted font that declares instruction
 * definitions exported 0 of them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont, DEFAULT_EXPORT_OPTIONS } from '../src/core/fontCodec';
import { patchMaxInstructionDefs } from '../src/core/sfntFinalize';
import { readSfnt, writeSfnt } from '../src/core/sfnt';
import { drawGlyph, newTestFont } from './helpers';

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Offsets of the version 1.0 maxp fields this module cares about. */
const MAXP = { maxZones: 14, maxFunctionDefs: 20, maxInstructionDefs: 22 } as const;

function maxpFields(buffer: ArrayBuffer): Record<keyof typeof MAXP, number> {
  const maxp = readSfnt(buffer).tables.find((t) => t.tag === 'maxp')!;
  const view = new DataView(maxp.data.buffer, maxp.data.byteOffset, maxp.data.byteLength);
  return {
    maxZones: view.getUint16(MAXP.maxZones),
    maxFunctionDefs: view.getUint16(MAXP.maxFunctionDefs),
    maxInstructionDefs: view.getUint16(MAXP.maxInstructionDefs),
  };
}

/** The same font with one 16-bit maxp field changed. */
function withMaxpField(buffer: ArrayBuffer, offset: number, value: number): ArrayBuffer {
  const font = readSfnt(buffer);
  const maxp = font.tables.find((t) => t.tag === 'maxp')!;
  const data = new Uint8Array(maxp.data);
  new DataView(data.buffer).setUint16(offset, value);
  return writeSfnt({
    version: font.version,
    tables: font.tables.map((t) => (t.tag === 'maxp' ? { tag: 'maxp', data } : t)),
  });
}

const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, validate: false };

describe('maxp.maxZones', () => {
  it('is legal in a font created in Pixeel', () => {
    let doc = newTestFont(8, 8, 'MaxZones');
    doc = drawGlyph(doc, 0x41, (bm) => bm.rect(1, 1, 6, 6, 1, true)).doc;
    const { buffer } = buildTtf({ doc, sourceTtf: null, options: exportOptions });
    // 0 is out of range: a glyph programme uses the outline zone alone (1) or
    // the outline and the twilight zone (2).
    expect(maxpFields(buffer).maxZones).toBe(2);
  });

  it('is kept from an imported font', async () => {
    const source = fixture('Lato-Regular.ttf');
    expect(maxpFields(source).maxZones).toBe(2);
    const { doc, sourceTtf } = await importFont(source, 'Lato-Regular.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: exportOptions });
    expect(maxpFields(buffer).maxZones).toBe(2);
  });

  it('is repaired when the imported font declares 0', async () => {
    const source = withMaxpField(fixture('Lato-Regular.ttf'), MAXP.maxZones, 0);
    const { doc, sourceTtf } = await importFont(source, 'zero-zones.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: exportOptions });
    expect(maxpFields(buffer).maxZones).toBe(2);
  });
});

describe('maxp.maxInstructionDefs', () => {
  it('writes the field without touching its neighbours', () => {
    const maxp = new Uint8Array(32);
    const view = new DataView(maxp.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(MAXP.maxFunctionDefs, 119);
    view.setUint16(MAXP.maxInstructionDefs, 0);
    const patched = patchMaxInstructionDefs(maxp, 3)!;
    expect(new DataView(patched.buffer).getUint16(MAXP.maxInstructionDefs)).toBe(3);
    expect(new DataView(patched.buffer).getUint16(MAXP.maxFunctionDefs)).toBe(119);
    expect(maxp[MAXP.maxInstructionDefs + 1]).toBe(0); // the input is not mutated
  });

  it('leaves a version 0.5 table alone', () => {
    const maxp = new Uint8Array(6);
    new DataView(maxp.buffer).setUint32(0, 0x00005000);
    expect(patchMaxInstructionDefs(maxp, 3)).toBeNull();
  });

  it('survives a round trip of a hinted font', async () => {
    const source = withMaxpField(fixture('Lato-Regular.ttf'), MAXP.maxInstructionDefs, 3);
    const { doc, sourceTtf } = await importFont(source, 'idefs.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { ...exportOptions, preserveHinting: true } });
    expect(maxpFields(buffer)).toMatchObject({ maxInstructionDefs: 3, maxFunctionDefs: 119 });
  });

  it('is zero when the hinting is dropped', async () => {
    const source = withMaxpField(fixture('Lato-Regular.ttf'), MAXP.maxInstructionDefs, 3);
    const { doc, sourceTtf } = await importFont(source, 'idefs.ttf');
    const { buffer } = buildTtf({ doc, sourceTtf, options: { ...exportOptions, preserveHinting: false } });
    expect(maxpFields(buffer).maxInstructionDefs).toBe(0);
  });
});
