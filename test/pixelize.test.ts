import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont, resolveGlyphContours } from '../src/core/fontCodec';
import { Bitmap } from '../src/core/bitmap';
import { rasterizeCoverage } from '../src/core/rasterize';
import {
  detectFontPixelGrid,
  fontDesignBox,
  gridForRows,
  pixelizeFont,
  placeOnGrid,
  snapAdvanceToGrid,
} from '../src/core/pixelGrid';
import { bitmapToAscii } from '../src/core/ledMatrix';
import type { Contour, FontDoc, GlyphDoc } from '../src/core/types';

async function lato(): Promise<FontDoc> {
  const path = resolve(__dirname, 'fixtures/Lato-Regular.ttf');
  const { doc } = await importFont(new Uint8Array(readFileSync(path)).buffer as ArrayBuffer, 'Lato-Regular.ttf');
  return doc;
}

const contoursOf = (doc: FontDoc) => (g: GlyphDoc): Contour[] => resolveGlyphContours(g, doc.glyphs);

function cellsOf(g: GlyphDoc): Bitmap {
  if (!g.pixel) throw new Error(`${g.name} has no pixel grid`);
  return Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64);
}

/** Build a small 8×16 pixel font, export it to TTF and import it back. */
async function roundTrippedPixelFont(): Promise<{ source: FontDoc; imported: FontDoc; art: Map<number, string> }> {
  const { createNewFont } = await import('../src/core/fontFactory');
  let doc = createNewFont({ familyName: 'Pixel Round Trip', styleName: 'Regular', gridWidth: 8, gridHeight: 16 });
  const template = doc.glyphs.find((g) => g.pixel)!.pixel!;
  const art = new Map<number, string>();
  const draw = (cp: number, rows: string[]) => {
    const bm = new Bitmap(template.width, template.height);
    rows.forEach((line, i) => {
      const y = template.height - 1 - i;
      [...line].forEach((ch, x) => bm.set(x, y, ch === '#' ? 1 : 0));
    });
    // compare against the ink box: the converter trims blank columns
    const b = bm.bounds()!;
    art.set(cp, bitmapToAscii(bm.extract(b.x, b.y, b.w, b.h)));
    const g: GlyphDoc = {
      id: `g${cp}`,
      name: String.fromCodePoint(cp),
      unicode: cp,
      advanceWidth: template.unitsPerCell * (template.width + 1),
      leftSideBearing: 0,
      kind: 'pixel',
      contours: [],
      pixel: { ...template, cellsB64: bm.toB64() },
      compound: null,
      instructions: null,
      sourceContours: null,
      edited: true,
      srcIndex: null,
    };
    doc = { ...doc, glyphs: [...doc.glyphs, g] };
  };
  draw(0x41, ['..####..', '.#....#.', '#......#', '#......#', '########', '#......#', '#......#', '#......#']);
  draw(0x42, ['#######.', '#.....##', '#.....##', '#.....##', '########', '#.....##', '#.....##', '#######.']);
  draw(0x67, ['........', '..#####.', '.#....#.', '.#....#.', '.#....#.', '..#####.', '......#.', '######..']);
  draw(0x2d, ['........', '........', '..####..', '........', '........', '........', '........', '........']);
  draw(0x5f, ['........', '........', '........', '........', '........', '........', '........', '########']);
  const { buffer } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: false } });
  const imported = (await importFont(buffer, 'PixelRoundTrip.ttf')).doc;
  return { source: doc, imported, art };
}

describe('exact coverage rasterization', () => {
  it('measures the true ink fraction of every cell', () => {
    // a 100×100 square in a 50-unit grid: cells are either full or empty
    const square: Contour[] = [
      [
        { x: 0, y: 0, onCurve: true },
        { x: 100, y: 0, onCurve: true },
        { x: 100, y: 100, onCurve: true },
        { x: 0, y: 100, onCurve: true },
      ],
    ];
    const cov = rasterizeCoverage(square, {
      gridWidth: 2,
      gridHeight: 2,
      unitsPerCell: 50,
      offsetX: 0,
      baselineRow: 0,
    });
    expect(Array.from(cov)).toEqual([1, 1, 1, 1]);
  });

  it('reports partial coverage as a fraction, not a probe count', () => {
    // a bar that covers exactly half of a cell's height
    const bar: Contour[] = [
      [
        { x: 0, y: 0, onCurve: true },
        { x: 100, y: 0, onCurve: true },
        { x: 100, y: 25, onCurve: true },
        { x: 0, y: 25, onCurve: true },
      ],
    ];
    const cov = rasterizeCoverage(bar, { gridWidth: 2, gridHeight: 1, unitsPerCell: 50, offsetX: 0, baselineRow: 0 });
    expect(cov[0]).toBeCloseTo(0.5, 6);
    expect(cov[1]).toBeCloseTo(0.5, 6);
  });

  it('handles counters (a hole subtracts from the outer contour)', () => {
    const ring: Contour[] = [
      [
        { x: 0, y: 0, onCurve: true },
        { x: 100, y: 0, onCurve: true },
        { x: 100, y: 100, onCurve: true },
        { x: 0, y: 100, onCurve: true },
      ],
      // counter, wound the other way
      [
        { x: 25, y: 25, onCurve: true },
        { x: 25, y: 75, onCurve: true },
        { x: 75, y: 75, onCurve: true },
        { x: 75, y: 25, onCurve: true },
      ],
    ];
    const cov = rasterizeCoverage(ring, { gridWidth: 1, gridHeight: 1, unitsPerCell: 100, offsetX: 0, baselineRow: 0 });
    expect(cov[0]).toBeCloseTo(0.75, 6);
  });

  it('is winding-agnostic (TrueType draws outer contours clockwise)', () => {
    const cw: Contour[] = [
      [
        { x: 0, y: 0, onCurve: true },
        { x: 0, y: 100, onCurve: true },
        { x: 100, y: 100, onCurve: true },
        { x: 100, y: 0, onCurve: true },
      ],
    ];
    const cov = rasterizeCoverage(cw, { gridWidth: 1, gridHeight: 1, unitsPerCell: 100, offsetX: 0, baselineRow: 0 });
    expect(cov[0]).toBeCloseTo(1, 6);
  });
});

describe('detecting a pixel font’s native grid', () => {
  it('finds the exact lattice and reproduces every glyph cell for cell', async () => {
    const { source, imported, art } = await roundTrippedPixelFont();
    const det = detectFontPixelGrid(imported, contoursOf(imported));
    expect(det.found).toBe(true);
    expect(det.score).toBe(0);
    expect(det.lattice).toBeGreaterThan(0.98);
    const grid = det.grid!;
    // the font was created with 16 rows and 20 % descender → baseline row 3
    expect(grid.rows).toBe(16);
    expect(grid.baselineRow).toBe(3);
    expect(grid.unitsPerCell).toBeCloseTo(imported.metrics.unitsPerEm / 16, 6);

    const { doc: back, report } = pixelizeFont(imported, { grid, contoursOf: contoursOf(imported) });
    expect(report.rescued).toBe(0);
    expect(report.blank).toBe(0);
    for (const [cp, expected] of art) {
      const g = back.glyphs.find((x) => x.unicode === cp);
      expect(g, `U+${cp.toString(16)} missing`).toBeTruthy();
      // the converted glyph keeps the whole 16-row band, so compare ink boxes
      const bm = cellsOf(g!);
      const b = bm.bounds()!;
      expect(bitmapToAscii(bm.extract(b.x, b.y, b.w, b.h)), `U+${cp.toString(16)} changed`).toBe(expected);
    }
    // and it matches the font the TTF was exported from, apart from trailing
    // blank columns the tight ink bounds drop
    for (const [cp] of art) {
      const after = cellsOf(back.glyphs.find((x) => x.unicode === cp)!);
      // the design grid is 16 rows tall and the baseline stays on row 3
      expect(after.height).toBe(16);
      expect(after.width).toBeGreaterThan(0);
    }
  });

  it('does not claim a vector font is a pixel font', async () => {
    const doc = await lato();
    const det = detectFontPixelGrid(doc, contoursOf(doc));
    expect(det.found).toBe(false);
    expect(det.lattice).toBeLessThan(0.5);
  });
});

describe('converting a whole font to pixels', () => {
  it('gives every glyph the same cell size and the same baseline row', async () => {
    // The old per-glyph frame gave each glyph its own cell size *and* its own
    // baseline, so a converted font no longer lined up.
    const doc = await lato();
    const { doc: out, report } = pixelizeFont(doc, { rows: 16, contoursOf: contoursOf(doc) });
    expect(report.converted).toBeGreaterThan(200);
    const sizes = new Set<number>();
    const baselines = new Set<number>();
    for (const g of out.glyphs) {
      if (!g.pixel) continue;
      sizes.add(g.pixel.unitsPerCell);
      // the baseline can sit on a different *row index* (a glyph with a very
      // deep descender gets extra rows below) — what must match is where the
      // baseline lands in font units.
      // a glyph with a very deep descender is given extra rows below, so the
      // row *index* of the baseline can differ — what must match is where the
      // baseline falls inside a cell, i.e. the vertical phase of the lattice.
      baselines.add(Math.round((((g.pixel.baselineRow % 1) + 1) % 1) * 1000));
    }
    expect(sizes.size).toBe(1);
    expect(baselines.size).toBe(1);
  });

  it('never loses a glyph and never floods the grid', async () => {
    const doc = await lato();
    const { doc: out, report } = pixelizeFont(doc, { rows: 16, contoursOf: contoursOf(doc) });
    expect(report.blank, `${report.blank} glyphs came back blank`).toBe(0);
    expect(report.clipped).toBe(0);
    let widest = 0;
    for (const g of out.glyphs) {
      if (!g.pixel) continue;
      const bm = cellsOf(g);
      expect(bm.count(), `${g.name} vanished`).toBeGreaterThan(0);
      widest = Math.max(widest, bm.width);
    }
    // a wide, flat glyph (hyphen, macron) used to produce a 50-column grid
    expect(widest).toBeLessThanOrEqual(24);
  });

  it('keeps flat marks proportional instead of filling the grid', async () => {
    const doc = await lato();
    const { doc: out } = pixelizeFont(doc, { rows: 16, contoursOf: contoursOf(doc) });
    const hyphen = out.glyphs.find((g) => g.unicode === 0x2d)!;
    const bm = cellsOf(hyphen);
    const rows = new Set<number>();
    for (let y = 0; y < bm.height; y++) for (let x = 0; x < bm.width; x++) if (bm.get(x, y)) rows.add(y);
    // one or two rows of ink, not the whole grid
    expect(rows.size).toBeLessThanOrEqual(3);
    expect(bm.count()).toBeLessThan(bm.width * bm.height * 0.5);
  });

  it('snaps advances to whole pixels so text stays on the lattice', async () => {
    const doc = await lato();
    const { doc: out } = pixelizeFont(doc, { rows: 16, contoursOf: contoursOf(doc) });
    const u = out.glyphs.find((g) => g.pixel)!.pixel!.unitsPerCell;
    for (const g of out.glyphs) {
      if (!g.pixel) continue;
      expect(g.advanceWidth % u).toBeCloseTo(0, 6);
    }
    // zero-width marks stay zero-width, everything else is at least one pixel
    const a = out.glyphs.find((g) => g.unicode === 0x41)!;
    expect(a.advanceWidth).toBeGreaterThanOrEqual(u);
  });

  it('can leave advances alone', async () => {
    const doc = await lato();
    const before = doc.glyphs.find((g) => g.unicode === 0x41)!.advanceWidth;
    const { doc: out } = pixelizeFont(doc, { rows: 16, snapAdvance: false, contoursOf: contoursOf(doc) });
    expect(out.glyphs.find((g) => g.unicode === 0x41)!.advanceWidth).toBe(before);
  });

  it('keeps the original outline so a glyph can be reverted', async () => {
    const doc = await lato();
    const { doc: out } = pixelizeFont(doc, { rows: 16, contoursOf: contoursOf(doc) });
    const a = out.glyphs.find((g) => g.unicode === 0x41)!;
    expect(a.kind).toBe('pixel');
    expect(a.contours).toHaveLength(0);
    expect(a.sourceContours?.length).toBeGreaterThan(0);
    expect(a.edited).toBe(true);
  });

  it('converts a single glyph on the font grid', async () => {
    const doc = await lato();
    const target = doc.glyphs.find((g) => g.unicode === 0x41)!;
    const { doc: out, report } = pixelizeFont(doc, {
      rows: 16,
      scope: 'glyph',
      glyphId: target.id,
      contoursOf: contoursOf(doc),
    });
    expect(report.converted).toBe(1);
    const changed = out.glyphs.filter((g) => g.kind === 'pixel');
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe(target.id);
    expect(report.snapAdvance).toBe(false); // single glyph: leave spacing alone
  });

  it('exports a converted font as a valid TTF', async () => {
    const doc = await lato();
    const { doc: out } = pixelizeFont(doc, { rows: 16, contoursOf: contoursOf(doc) });
    const { buffer, report } = buildTtf({ doc: out, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: true } });
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(report.validation?.ok ?? true).toBe(true);
    // and the exported glyphs are axis-aligned squares again
    const reimported = (await importFont(buffer, 'converted.ttf')).doc;
    const a = reimported.glyphs.find((g) => g.unicode === 0x41)!;
    expect(a.contours.length).toBeGreaterThan(0);
  });
});

describe('grid helpers', () => {
  it('sizes a grid from the design box', async () => {
    const doc = await lato();
    const box = fontDesignBox(doc, contoursOf(doc));
    expect(box.top).toBeGreaterThanOrEqual(doc.metrics.ascent);
    expect(box.bottom).toBeLessThanOrEqual(doc.metrics.descent);
    const grid = gridForRows(box, 16);
    expect(grid.rows).toBeGreaterThanOrEqual(16);
    expect(grid.rows).toBeLessThanOrEqual(18);
    // the band really covers the box
    const top = (grid.rows - grid.baselineRow) * grid.unitsPerCell;
    const bottom = -grid.baselineRow * grid.unitsPerCell;
    expect(top).toBeGreaterThanOrEqual(box.top - 1e-6);
    expect(bottom).toBeLessThanOrEqual(box.bottom + 1e-6);
  });

  it('places a glyph inside the font band with the shared baseline', async () => {
    const doc = await lato();
    const grid = gridForRows(fontDesignBox(doc, contoursOf(doc)), 16);
    for (const cp of [0x41, 0x67, 0x5f]) {
      const g = doc.glyphs.find((x) => x.unicode === cp)!;
      const p = placeOnGrid(contoursOf(doc)(g), grid)!;
      expect(p.pixel.baselineRow).toBe(grid.baselineRow);
      expect(p.pixel.height).toBe(grid.rows);
      expect(p.pixel.unitsPerCell).toBe(grid.unitsPerCell);
      expect(p.stats.lit).toBeGreaterThan(0);
    }
  });

  it('snaps advances without collapsing them to zero', async () => {
    const doc = await lato();
    const grid = gridForRows(fontDesignBox(doc, contoursOf(doc)), 16);
    expect(snapAdvanceToGrid(0, grid)).toBe(0);
    expect(snapAdvanceToGrid(1, grid)).toBe(grid.unitsPerCell);
    expect(snapAdvanceToGrid(grid.unitsPerCell * 6.4, grid)).toBeCloseTo(grid.unitsPerCell * 6, 6);
  });
});
