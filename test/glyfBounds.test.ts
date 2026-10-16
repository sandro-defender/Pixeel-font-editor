import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Font } from 'fonteditor-core';
import { buildTtf, DEFAULT_EXPORT_OPTIONS, glyfRecordBounds, importFont, validateExport } from '../src/core/fontCodec';
import { addComponent, startComposite } from '../src/core/composite';
import { setAdvance } from '../src/state/glyphActions';
import { validateMax7219Font } from '../src/services/max7219Export';
import type { FontDoc } from '../src/core/types';
import { drawGlyph, newTestFont, parseTtf } from './helpers';

// Every exported glyph needs its real bounding box in the glyf header and an
// hmtx lsb that matches it: FreeType (ESPHome, Linux, Android, Pillow) draws an
// outline at x − (header xMin − lsb), and OTS — the sanitizer Chrome and Firefox
// run on web fonts — rejects a font whose head box is inverted.

const CHECK = 'Glyph boxes & side bearings';
const exportTtf = (doc: FontDoc, sourceTtf: any = null) => buildTtf({ doc, sourceTtf, options: { ...DEFAULT_EXPORT_OPTIONS } });
const toArrayBuffer = (raw: ArrayBuffer | Uint8Array): ArrayBuffer =>
  raw instanceof Uint8Array ? (raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer) : raw;
const writeTtf = (ttf: any): ArrayBuffer => toArrayBuffer(Font.create().set(ttf).write({ type: 'ttf' }) as ArrayBuffer | Uint8Array);
const boxOf = (rec: any) => ({ xMin: rec.xMin, yMin: rec.yMin, xMax: rec.xMax, yMax: rec.yMax });
const headBox = (ttf: any) => ({ xMin: ttf.head.xMin, yMin: ttf.head.yMin, xMax: ttf.head.xMax, yMax: ttf.head.yMax });
const glyphFor = (ttf: any, cp: number) => ttf.glyf[ttf.cmap[cp]];
/** Bounds straight from the parsed points — independent of the exporter's own helper. */
function pointBounds(rec: any) {
  const pts = (rec.contours ?? []).flat() as Array<{ x: number; y: number }>;
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
}

/**
 * '0': grid columns 2–5 of a grid shifted one cell (128 units) right — the
 * editor's lsb is the grid edge, 128, while the ink starts at 384.
 * '1': a stem in column 1 (ink at 128, editor lsb 0).
 */
function offsetGridFont(): FontDoc {
  let doc = newTestFont(8, 8, 'Boxes');
  doc = drawGlyph(doc, 0x30, (bm) => { for (let y = 0; y < 8; y++) for (let x = 2; x < 6; x++) bm.set(x, y, 1); }).doc;
  doc = drawGlyph(doc, 0x31, (bm) => { for (let y = 0; y < 8; y++) bm.set(1, y, 1); }).doc;
  return { ...doc, glyphs: doc.glyphs.map((g) => (g.unicode === 0x30 ? { ...g, leftSideBearing: 128, pixel: { ...g.pixel!, offsetX: 128 } } : g)) };
}

describe('glyph bounding boxes in exported fonts', () => {
  it('writes every glyph’s real box with lsb = xMin, and a font box and hhea extents that match', () => {
    const { buffer, report } = exportTtf(offsetGridFont());
    const ttf = parseTtf(buffer);
    const zero = glyphFor(ttf, 0x30), one = glyphFor(ttf, 0x31);
    expect(boxOf(zero)).toEqual({ xMin: 384, yMin: -256, xMax: 896, yMax: 768 });
    expect(zero.leftSideBearing).toBe(384); // the ink edge, not the editor's grid offset (128)
    expect(boxOf(one)).toEqual({ xMin: 128, yMin: -256, xMax: 256, yMax: 768 });
    expect(one.leftSideBearing).toBe(128);
    for (const rec of ttf.glyf) {
      const b = pointBounds(rec);
      if (!b) {
        expect(rec.leftSideBearing).toBe(0);
        continue;
      }
      expect(boxOf(rec)).toEqual(b);
      expect(rec.leftSideBearing).toBe(b.xMin);
    }
    expect(headBox(ttf)).toEqual({ xMin: 128, yMin: -256, xMax: 896, yMax: 768 });
    expect(ttf.hhea.minLeftSideBearing).toBe(128);
    expect(ttf.hhea.xMaxExtent).toBe(896);
    expect(ttf.hhea.minRightSideBearing).toBe(Math.min(zero.advanceWidth - 896, one.advanceWidth - 256));
    expect(report.validation!.checks.find((c) => c.name === CHECK)).toMatchObject({ ok: true });
  });

  it('lets FreeType draw a pixel glyph where the editor shows it, not shifted by the grid offset', () => {
    const { buffer } = exportTtf(offsetGridFont());
    const v = validateMax7219Font(buffer, '01');
    expect(v.glyphs.get(0x30)!.inkLeftPx).toBe(3); // FreeType 2.13 bitmap_left: 3 (it was 4 while the box was empty)
    expect(v.glyphs.get(0x31)!.inkLeftPx).toBe(1);
  });

  it('keeps an untouched imported glyph’s own box and lsb (FreeType renders it like the original); an edited one gets lsb = xMin', async () => {
    // A font tool that writes lsb 0 for every glyph, with correct boxes — like
    // the DotMatrix '1' of the MAX7219 clock: FreeType draws the ink at x 0.
    const src = parseTtf(exportTtf(offsetGridFont()).buffer);
    glyphFor(src, 0x31).leftSideBearing = 0;
    const srcBuf = writeTtf(src);
    expect(validateMax7219Font(srcBuf, '1').glyphs.get(0x31)!.inkLeftPx).toBe(0);

    const imported = await importFont(srcBuf, 'Quirky.ttf');
    const { buffer } = exportTtf(imported.doc, imported.sourceTtf);
    const out = parseTtf(buffer);
    expect(boxOf(glyphFor(out, 0x31))).toEqual({ xMin: 128, yMin: -256, xMax: 256, yMax: 768 });
    expect(glyphFor(out, 0x31).leftSideBearing).toBe(0);
    expect(validateMax7219Font(buffer, '1').glyphs.get(0x31)!.inkLeftPx).toBe(0);

    const id = imported.doc.glyphs.find((g) => g.unicode === 0x31)!.id;
    const edited = exportTtf(setAdvance(imported.doc, id, 896), imported.sourceTtf);
    expect(glyphFor(parseTtf(edited.buffer), 0x31).leftSideBearing).toBe(128);
    expect(validateMax7219Font(edited.buffer, '1').glyphs.get(0x31)!.inkLeftPx).toBe(1); // where the editor draws it
    expect(edited.report.validation!.checks.find((c) => c.name === CHECK)).toMatchObject({ ok: true });
  });

  it('repairs a font written without glyph boxes (older Pixeel exports) and the validation flags such a file', async () => {
    const old = parseTtf(exportTtf(offsetGridFont()).buffer);
    for (const rec of old.glyf) for (const k of ['xMin', 'yMin', 'xMax', 'yMax']) delete rec[k];
    glyphFor(old, 0x30).leftSideBearing = 128; // the editor's grid offset, as older versions wrote it
    const oldBuf = writeTtf(old);
    const reparsed = parseTtf(oldBuf);
    expect(boxOf(glyphFor(reparsed, 0x30))).toEqual({ xMin: 0, yMin: 0, xMax: 0, yMax: 0 });
    expect(reparsed.head.xMin).toBeGreaterThan(reparsed.head.xMax); // inverted: OTS rejects the font
    expect(validateMax7219Font(oldBuf, '0').glyphs.get(0x30)!.inkLeftPx).toBe(4); // shifted right by the lsb

    const imported = await importFont(oldBuf, 'Old.ttf');
    const oldCheck = validateExport(oldBuf, imported.doc).checks.find((c) => c.name === CHECK)!;
    expect(oldCheck.ok).toBe(false);
    expect(oldCheck.detail).toContain('“zero” box 0,0…0,0 ≠ outline 384,-256…896,768');
    expect(oldCheck.detail).toContain('font box (head) 16384,16384…-16384,-16384');

    const { buffer, report } = exportTtf(imported.doc, imported.sourceTtf);
    const out = parseTtf(buffer);
    expect(boxOf(glyphFor(out, 0x30))).toEqual({ xMin: 384, yMin: -256, xMax: 896, yMax: 768 });
    expect(glyphFor(out, 0x30).leftSideBearing).toBe(384);
    expect(headBox(out)).toEqual({ xMin: 128, yMin: -256, xMax: 896, yMax: 768 });
    expect(validateMax7219Font(buffer, '0').glyphs.get(0x30)!.inkLeftPx).toBe(3);
    expect(report.validation!.checks.find((c) => c.name === CHECK)).toMatchObject({ ok: true });
  });

  it('gives a composite the box of its placed components', () => {
    let doc = newTestFont(8, 8, 'Comp');
    doc = drawGlyph(doc, 0x41, (bm) => { for (let y = 0; y < 6; y++) bm.set(1, y, 1); bm.set(2, 5, 1); }).doc;
    doc = drawGlyph(doc, 0xb4, (bm) => bm.set(3, 6, 1)).doc;
    doc = drawGlyph(doc, 0xc1, (bm) => bm.set(0, 0, 1)).doc;
    const id = (cp: number) => doc.glyphs.find((g) => g.unicode === cp)!.id;
    doc = startComposite(doc, id(0xc1));
    doc = addComponent(doc, id(0xc1), id(0x41));
    doc = addComponent(doc, id(0xc1), id(0xb4), { dx: 40, dy: 300 });
    const { buffer, report } = exportTtf(doc);
    const ttf = parseTtf(buffer);
    const comp = glyphFor(ttf, 0xc1);
    expect(comp.compound).toBe(true);
    const a = boxOf(glyphFor(ttf, 0x41)), acute = boxOf(glyphFor(ttf, 0xb4));
    const expected = {
      xMin: Math.min(a.xMin, acute.xMin + 40),
      yMin: Math.min(a.yMin, acute.yMin + 300),
      xMax: Math.max(a.xMax, acute.xMax + 40),
      yMax: Math.max(a.yMax, acute.yMax + 300),
    };
    expect(boxOf(comp)).toEqual(expected);
    expect(comp.leftSideBearing).toBe(expected.xMin);
    expect(headBox(ttf).yMax).toBe(Math.max(expected.yMax, a.yMax, acute.yMax));
    expect(report.validation!.checks.find((c) => c.name === CHECK)).toMatchObject({ ok: true });
  });

  it('round-trips an untouched font’s glyph boxes, side bearings, font box and hhea extents exactly (Lato)', async () => {
    const raw = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
    const srcBuf = toArrayBuffer(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    const src = parseTtf(srcBuf);
    const imported = await importFont(srcBuf, 'Lato-Regular.ttf');
    const { buffer, report } = exportTtf(imported.doc, imported.sourceTtf);
    const out = parseTtf(buffer);
    const metrics = (r: any) => (r.compound || r.contours?.length ? [r.xMin, r.yMin, r.xMax, r.yMax, r.leftSideBearing] : [r.leftSideBearing]);
    expect(out.glyf.length).toBe(src.glyf.length);
    expect(out.glyf.map(metrics)).toEqual(src.glyf.map(metrics));
    expect(out.glyf.filter((r: any) => r.compound).length).toBeGreaterThan(100);
    expect(headBox(out)).toEqual(headBox(src));
    for (const k of ['minLeftSideBearing', 'minRightSideBearing', 'xMaxExtent', 'advanceWidthMax']) expect(out.hhea[k]).toBe(src.hhea[k]);
    expect(report.validation!.checks.find((c) => c.name === CHECK)).toMatchObject({ ok: true });
  });

  it('gives a font without any outline a valid, empty font box', () => {
    const { buffer, report } = exportTtf(newTestFont(8, 8, 'Blank'));
    const ttf = parseTtf(buffer);
    expect(headBox(ttf)).toEqual({ xMin: 0, yMin: 0, xMax: 0, yMax: 0 });
    expect([ttf.hhea.minLeftSideBearing, ttf.hhea.minRightSideBearing, ttf.hhea.xMaxExtent]).toEqual([0, 0, 0]);
    expect(report.validation!.checks.find((c) => c.name === CHECK)).toMatchObject({ ok: true });
  });
});

describe('glyfRecordBounds', () => {
  const pt = (x: number, y: number, onCurve = true) => ({ x, y, onCurve });
  const square = { contours: [[pt(0, 0), pt(100, 0), pt(100, 200), pt(0, 200)]] };
  const curve = { contours: [[pt(10, 0), pt(50, -30, false), pt(90, 0)]] }; // the off-curve point counts, as in TrueType
  const t = (a: number, b: number, c: number, d: number, e: number, f: number) => ({ a, b, c, d, e, f });

  it('measures simple glyphs from every point and composites through their transforms', () => {
    const boxes = glyfRecordBounds([
      {}, // no outline
      square,
      curve,
      { compound: true, glyfs: [{ glyphIndex: 1, transform: t(1, 0, 0, 1, 30, -10) }, { glyphIndex: 2, transform: t(0.5, 0, 0, 0.5, 0, 300) }] },
      { compound: true, glyfs: [{ glyphIndex: 3, transform: t(1, 0, 0, 1, -5, 0) }] }, // nested composite
      { compound: true, glyfs: [{ glyphIndex: 1, transform: t(0, 1, -1, 0, 0, 0) }] }, // rotated 90°: x' = −y, y' = x
      { compound: true, glyfs: [{ glyphIndex: 1, transform: t(1 / 3, 0, 0, 1 / 3, 0, 0) }] }, // F2Dot14 scale, rounded once
      { compound: true, glyfs: [{ glyphIndex: 7, transform: t(1, 0, 0, 1, 0, 0) }] }, // refers to itself
    ]);
    expect(boxes).toEqual([
      null,
      { xMin: 0, yMin: 0, xMax: 100, yMax: 200 },
      { xMin: 10, yMin: -30, xMax: 90, yMax: 0 },
      { xMin: 5, yMin: -10, xMax: 130, yMax: 300 },
      { xMin: 0, yMin: -10, xMax: 125, yMax: 300 },
      { xMin: -200, yMin: 0, xMax: 0, yMax: 100 },
      { xMin: 0, yMin: 0, xMax: 33, yMax: 67 },
      null,
    ]);
  });
});
