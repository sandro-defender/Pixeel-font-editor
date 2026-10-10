import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importFont, resolveGlyphContours } from '../src/core/fontCodec';
import { Bitmap } from '../src/core/bitmap';
import { traceBitmap } from '../src/core/trace';
import { contourBoundsTight } from '../src/core/contours';
import { defaultRasterizeFrame, rasterizeContours, rasterizeGlyphContours } from '../src/core/rasterize';
import type { Contour, FontDoc } from '../src/core/types';

/** Load the bundled Lato fixture once (TTC-free TTF). */
async function lato(): Promise<FontDoc> {
  const path = resolve(__dirname, 'fixtures/Lato-Regular.ttf');
  const { doc } = await importFont(new Uint8Array(readFileSync(path)).buffer as ArrayBuffer, 'Lato-Regular.ttf');
  return doc;
}

function contoursOfDoc(doc: FontDoc) {
  return (cp: number): Contour[] => {
    const g = doc.glyphs.find((x) => x.unicode === cp);
    return g ? resolveGlyphContours(g, doc.glyphs) : [];
  };
}

const metrics = { ascent: 1974, descent: -426 };

describe('rasterize vector glyph → pixel grid', () => {
  it('keeps thin marks that sit off the baseline visible (underscore, minus)', async () => {
    const doc = await lato();
    const contoursOf = contoursOfDoc(doc);
    // U+005F low line: ink lives entirely *below* the baseline, so a frame
    // clamped to the baseline row used to sample empty space and return nothing.
    for (const cp of [0x5f, 0x2d, 0x203e, 0x207b]) {
      const cs = contoursOf(cp);
      if (!cs.length) continue;
      const { pixel, frame } = rasterizeGlyphContours(cs, doc.metrics, 16);
      const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
      expect(bm.count(), `U+${cp.toString(16)} rasterized empty`).toBeGreaterThan(0);
      // the baseline is recorded even when it lies outside the visible grid
      expect(frame.baselineRow).toBeTypeOf('number');
    }
  });

  it('never returns an empty grid for a glyph that has ink', async () => {
    const doc = await lato();
    const contoursOf = contoursOfDoc(doc);
    let checked = 0;
    for (const g of doc.glyphs) {
      const cs = resolveGlyphContours(g, doc.glyphs);
      const bb = contourBoundsTight(cs);
      if (!bb) continue; // spaces and empty glyphs are legitimately blank
      checked++;
      const { pixel } = rasterizeGlyphContours(cs, doc.metrics, 16);
      const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
      expect(bm.count(), `${g.name} (U+${g.unicode?.toString(16) ?? '?'}) vanished`).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(100); // the sweep really covered the font
  });

  it('sizes the frame from the glyph ink, not the line metrics', () => {
    // a small mark in a large em: the old ascent→descent frame made every
    // cell ~150 units, so a 120-unit-tall mark fell between the samples.
    const box: Contour[] = [
      [
        { x: 100, y: 100, onCurve: true },
        { x: 220, y: 100, onCurve: true },
        { x: 220, y: 220, onCurve: true },
        { x: 100, y: 220, onCurve: true },
      ],
    ];
    const frame = defaultRasterizeFrame(box, metrics, 16);
    const inkH = 120;
    // one cell must be able to resolve the mark: cells ≪ ink height
    expect(frame.unitsPerCell).toBeLessThan(inkH);
    const { pixel } = rasterizeGlyphContours(box, metrics, 16);
    const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
    expect(bm.count()).toBeGreaterThan(4);
  });

  it('resolves a hairline stem with its own pixel instead of skipping it', () => {
    // 4 units wide, 1800 units tall (a drawn vertical rule)
    const hair: Contour[] = [
      [
        { x: 500, y: 0, onCurve: true },
        { x: 504, y: 0, onCurve: true },
        { x: 504, y: 1800, onCurve: true },
        { x: 500, y: 1800, onCurve: true },
      ],
    ];
    const { pixel, frame, refined } = rasterizeGlyphContours(hair, metrics, 16);
    const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
    expect(bm.count()).toBeGreaterThan(0);
    expect(bm.width).toBeGreaterThanOrEqual(1);
    // the grid is made tall enough for the thin direction to be resolved
    expect(frame.gridHeight).toBeGreaterThanOrEqual(16);
    expect(refined).toBeTypeOf('boolean');
  });

  it('lights cells by coverage, so anti-aliased edges do not flicker', () => {
    // one closed contour: a polygon inscribed in a circle of radius 400
    const disc: Contour[] = [[]];
    const steps = 96;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      disc[0].push({ x: 500 + Math.cos(a) * 400, y: 600 + Math.sin(a) * 400, onCurve: true });
    }
    const coarse = rasterizeContours(disc, defaultRasterizeFrame(disc, metrics, 12));
    const fine = rasterizeContours(disc, defaultRasterizeFrame(disc, metrics, 64));
    const coarseCount = Bitmap.fromB64(coarse.width, coarse.height, coarse.cellsB64).count();
    const fineCount = Bitmap.fromB64(fine.width, fine.height, fine.cellsB64).count();
    expect(coarseCount).toBeGreaterThan(10);
    expect(fineCount).toBeGreaterThan(coarseCount); // more rows resolve more detail
  });

  it('reports the baseline row even when it falls outside the grid', () => {
    // a mark that lives entirely above the baseline (an accent)
    const accent: Contour[] = [
      [
        { x: 0, y: 1500, onCurve: true },
        { x: 300, y: 1500, onCurve: true },
        { x: 300, y: 1800, onCurve: true },
        { x: 0, y: 1800, onCurve: true },
      ],
    ];
    const frame = defaultRasterizeFrame(accent, metrics, 16);
    expect(frame.baselineRow).toBeLessThan(0); // baseline below the ink
    const bm = Bitmap.fromB64(frame.gridWidth, frame.gridHeight, rasterizeContours(accent, frame).cellsB64);
    expect(bm.count()).toBeGreaterThan(0);
  });

  it('produces exactly the requested number of rows, even for tall narrow glyphs', async () => {
    // Regression: tall narrow glyphs (l, I, i, |) used to get extra rows at small
    // heights — picking 8 px gave a 10-row l next to an 8-row o.
    const doc = await lato();
    const contoursOf = contoursOfDoc(doc);
    for (const ch of ['l', 'I', 'i', 'o', 'a']) {
      for (const h of [8, 12, 16]) {
        const cs = contoursOf(ch.charCodeAt(0));
        const { pixel } = rasterizeGlyphContours(cs, doc.metrics, h);
        expect(pixel.height, `${ch} at ${h}px`).toBe(h);
        const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
        expect(bm.count(), `${ch} at ${h}px keeps its stroke`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps pixel-font strokes and counters exact at 8px and 16px', () => {
    // An 8-row pixel design: doubled at 16px, not squeezed into 15 rows
    // or shifted into partially covered neighbouring columns at 8px.
    for (const rows of [
      ['.####.', '#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '.####.'],
      ['#....#', '#....#', '#....#', '######', '#....#', '#....#', '#....#', '#....#'],
      ['#.....', '.#....', '..#...', '...#..', '....#.', '.....#', '.....#', '.....#'],
      ['#', '#', '#', '#', '#', '#', '#', '#'],
    ]) {
      const original = new Bitmap(rows[0].length, rows.length);
      rows.forEach((row, y) => [...row].forEach((v, x) => original.set(x, 7 - y, v === '#' ? 1 : 0)));
      // Fractional units and non-zero bearings must not move the sampling grid.
      for (const [unit, left, bottom] of [[100, 0, 0], [62.5, -37.25, -125], [100, 135, 1700]]) {
        const contours = traceBitmap(original).map((c) => c.map((p) => ({
          ...p, x: left + p.x * unit, y: bottom + p.y * unit,
        })));
        for (const height of [8, 16]) {
          const { pixel } = rasterizeGlyphContours(contours, metrics, height);
          const actual = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
          const expected = original.resized(original.width * height / 8, height, 'resample');
          expect(actual.equals(expected), `${rows.join('/')} at ${height}px (${unit}, ${left}, ${bottom})`).toBe(true);
          expect(pixel.unitsPerCell).toBe(unit * 8 / height);
          expect(pixel.offsetX).toBe(left);
          expect(-pixel.baselineRow * pixel.unitsPerCell).toBe(bottom);
        }
      }
    }
  });

  it('falls back to the em frame for glyphs without ink (spaces)', () => {
    const frame = defaultRasterizeFrame([], metrics, 16);
    expect(frame.gridHeight).toBe(16);
    expect(frame.unitsPerCell).toBeCloseTo((metrics.ascent - metrics.descent) / 16, 5);
  });
});
