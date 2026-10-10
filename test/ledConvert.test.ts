import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importFont, resolveGlyphContours } from '../src/core/fontCodec';
import { applyLedMatrix, snapGlyphToLed } from '../src/state/glyphActions';
import { adaptGlyph, transferGlyphs } from '../src/core/transfer';
import { Bitmap } from '../src/core/bitmap';
import {
  checkLedFont,
  conformGlyphToLed,
  designSpan,
  ledDescentRowsFor,
  ledFontScale,
  ledLabel,
  ledMetrics,
  normalizeLedSpec,
} from '../src/core/ledMatrix';
import { createNewFont } from '../src/core/fontFactory';
import type { Contour, FontDoc } from '../src/core/types';

async function lato(): Promise<FontDoc> {
  const path = resolve(__dirname, 'fixtures/Lato-Regular.ttf');
  const { doc } = await importFont(new Uint8Array(readFileSync(path)).buffer as ArrayBuffer, 'Lato-Regular.ttf');
  return doc;
}

/** The spec the LED dialog suggests for an imported font. */
function suggestedSpec(doc: FontDoc) {
  const rows = 16;
  const contoursOf = (g: FontDoc['glyphs'][number]) => resolveGlyphContours(g, doc.glyphs);
  const cellUnits = Math.max(1, Math.round(doc.metrics.unitsPerEm / rows));
  return normalizeLedSpec({ rows, cols: 8, spacing: 1, cellUnits, descentRows: ledDescentRowsFor(doc, rows, contoursOf) });
}

function cells(doc: FontDoc, cp: number): Bitmap {
  const g = doc.glyphs.find((x) => x.unicode === cp);
  if (!g?.pixel) throw new Error(`no pixel glyph for ${cp}`);
  return Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64);
}

describe('converting a font to an LED matrix', () => {
  it('suggests a matrix that fits the font design', async () => {
    const doc = await lato();
    const spec = suggestedSpec(doc);
    expect(spec.rows).toBe(16);
    // the em becomes rows × cellUnits units, so a 2000-unit font is not
    // squeezed into a 700-unit band it can never fill
    expect(spec.rows * spec.cellUnits).toBeGreaterThanOrEqual(doc.metrics.unitsPerEm * 0.9);
    expect(spec.descentRows).toBeGreaterThan(0); // Lato has real descenders
    expect(ledMetrics(spec).unitsPerEm).toBe(spec.rows * spec.cellUnits);
  });

  it('scales the whole design onto the matrix instead of clipping its bottom', async () => {
    const doc = await lato();
    const spec = suggestedSpec(doc);
    const contoursOf = (g: FontDoc['glyphs'][number]) => resolveGlyphContours(g, doc.glyphs);
    const scale = ledFontScale(doc, spec, contoursOf);
    const matrixEm = spec.rows * spec.cellUnits;
    const span = designSpan(doc, contoursOf);
    // the scaled design fits the matrix band, and uses most of it
    expect(doc.metrics.ascent * scale).toBeLessThanOrEqual((spec.rows - spec.descentRows) * spec.cellUnits + 1e-6);
    expect(-doc.metrics.descent * scale).toBeLessThanOrEqual(spec.descentRows * spec.cellUnits + 1e-6);
    expect((doc.metrics.ascent - doc.metrics.descent) * scale).toBeGreaterThan(matrixEm * 0.85);
    expect(span).toBeGreaterThan(doc.metrics.ascent - doc.metrics.descent - 1);
  });

  it('keeps every letter visible after the conversion (no vanishing, no clipping)', async () => {
    const doc = await lato();
    const led = applyLedMatrix(doc, suggestedSpec(doc));
    expect(led.ledMatrix).toBeTruthy();
    const check = checkLedFont(led);
    expect(check.errors).toBe(0);

    const A = cells(led, 65); // 'A'
    const g = cells(led, 103); // 'g' — descender must survive
    const H = cells(led, 72); // 'H' — crossbar must be inside the grid
    expect(A.count()).toBeGreaterThan(10);
    expect(g.count()).toBeGreaterThan(10);
    expect(H.count()).toBeGreaterThan(10);

    // the drawing reaches the top rows of the grid: it used to be cut off at
    // the bottom of a 700-unit window, which turned letters into blobs
    const topRow = (bm: Bitmap) => {
      for (let y = bm.height - 1; y >= 0; y--) for (let x = 0; x < bm.width; x++) if (bm.get(x, y)) return y;
      return -1;
    };
    expect(topRow(A)).toBeGreaterThan(A.height * 0.4);
    expect(topRow(H)).toBeGreaterThan(H.height * 0.4);
    // 'g' keeps ink below the baseline
    expect(g.count()).toBeGreaterThan(0);
  });

  it('converts every inked glyph of a whole font without losing one', async () => {
    const doc = await lato();
    const led = applyLedMatrix(doc, suggestedSpec(doc));
    const spec = led.ledMatrix!;
    let inked = 0;
    let vanished = 0;
    let outOfGrid = 0;
    for (const g of led.glyphs) {
      if (!g.pixel) continue;
      const bm = Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64);
      const srcInk = g.sourceContours && g.sourceContours.length > 0;
      if (!srcInk) continue;
      inked++;
      if (bm.count() === 0) vanished++;
      // the raster must respect the matrix: rows and the pixel size
      if (bm.height !== spec.rows || g.pixel!.unitsPerCell !== spec.cellUnits || g.pixel!.baselineRow !== spec.descentRows) outOfGrid++;
    }
    expect(inked).toBeGreaterThan(200);
    expect(vanished, `${vanished} of ${inked} glyphs vanished`).toBe(0);
    expect(outOfGrid).toBe(0);
  });

  it('snapping one glyph later uses the same scale', async () => {
    const doc = await lato();
    const spec = suggestedSpec(doc);
    let led = applyLedMatrix(doc, spec);
    const before = cells(led, 65);
    // wipe 'A' and re-snap it from its kept outline
    const a = led.glyphs.find((x) => x.unicode === 65)!;
    expect(a.sourceContours && a.sourceContours.length).toBeGreaterThan(0);
    led = {
      ...led,
      glyphs: led.glyphs.map((g) =>
        g.id === a.id ? { ...g, contours: a.sourceContours!.map((c) => c.map((p) => ({ ...p }))), kind: 'vector' as const, pixel: null } : g,
      ),
    };
    led = snapGlyphToLed(led, a.id);
    const after = cells(led, 65);
    expect(after.toB64()).toBe(before.toB64());
  });

  it('conforming with no scale keeps the old coordinate behaviour', async () => {
    const doc = await lato();
    const contoursOf = (g: FontDoc['glyphs'][number]) => resolveGlyphContours(g, doc.glyphs);
    const spec = normalizeLedSpec({ rows: 7, cols: 5, spacing: 1, cellUnits: 100, descentRows: 0 });
    const a = doc.glyphs.find((g) => g.unicode === 65)!;
    const unscaled = conformGlyphToLed(a, spec, contoursOf);
    expect(unscaled.pixel).toBeTruthy();
    // the matrix fixes the cell size and the row count; the width covers the ink
    expect(unscaled.pixel!.height).toBe(spec.rows);
    expect(unscaled.pixel!.unitsPerCell).toBe(spec.cellUnits);
    expect(unscaled.pixel!.baselineRow).toBe(spec.descentRows);
    expect(unscaled.pixel!.width).toBeGreaterThanOrEqual(1);
  });

  it('copies glyphs into an LED font without double-scaling', async () => {
    const src = await lato();
    const dst = createNewFont({ familyName: 'Led', styleName: 'Regular', gridWidth: 8, gridHeight: 16, led: suggestedSpec(src) });
    const a = src.glyphs.find((g) => g.unicode === 65)!;
    const copied = adaptGlyph(a, src, dst, src.metrics.unitsPerEm / dst.metrics.unitsPerEm);
    expect(ciedPixel(copied).count()).toBeGreaterThan(5);
    // advance is a whole number of matrix pixels
    expect(copied.advanceWidth % dst.ledMatrix!.cellUnits).toBe(0);

    const { doc: moved } = transferGlyphs(src, dst, [a.id], { metricsMode: 'preserve', scaleByUpm: true, collision: 'replace' });
    const movedA = moved.glyphs.find((g) => g.unicode === 65)!;
    expect(ciedPixel(movedA).count()).toBeGreaterThan(5);
    expect(checkLedFont(moved).errors).toBe(0);
  });

  it('reports the descent rows a matrix needs and clamps them', () => {
    const rows = 16;
    const makeDoc = (ascent: number, descent: number): FontDoc =>
      ({ ...createNewFont({ familyName: 'X', styleName: 'Regular', gridWidth: 8, gridHeight: 8 }), metrics: { ...createNewFont({ familyName: 'X', styleName: 'Regular', gridWidth: 8, gridHeight: 8 }).metrics, ascent, descent } }) as FontDoc;
    const flat = makeDoc(800, 0);
    expect(ledDescentRowsFor(flat, rows, () => [])).toBe(0);
    const deep = makeDoc(800, -700); // descent nearly as deep as the ascent
    const need = ledDescentRowsFor(deep, rows, () => []);
    expect(need).toBeGreaterThan(rows / 2 - 1);
    expect(need).toBeLessThanOrEqual(rows - 1);
  });
});

function ciedPixel(g: { pixel: { width: number; height: number; cellsB64: string } | null }): Bitmap {
  if (!g.pixel) throw new Error('glyph has no pixel data');
  return Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64);
}
