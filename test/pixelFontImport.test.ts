/**
 * End-to-end check against a real third-party pixel font.
 *
 * `spleen-8x16.bdf` is Spleen by Frederic Cambus (BSD-2-Clause, see
 * test/fixtures/Spleen-LICENSE.txt): a genuine 8×16 bitmap font with 1001
 * glyphs that was *not* produced by Pixeel, so it exercises the importer the
 * way a user's font would — including glyphs that hang left of the origin,
 * box-drawing shapes and 1-pixel details.
 *
 * The BDF bitmaps are turned into outlines here (one traced contour set per
 * glyph), which is exactly what an imported pixel-font TTF looks like to the
 * editor. Detection then has to recover the 8×16 lattice and the conversion
 * has to reproduce every glyph cell for cell.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bitmap } from '../src/core/bitmap';
import { tracePixelData } from '../src/core/trace';
import { detectFontPixelGrid, pixelizeFont } from '../src/core/pixelGrid';
import { bitmapToAscii } from '../src/core/ledMatrix';
import type { Contour, FontDoc, GlyphDoc, PixelData } from '../src/core/types';

const U = 100; // font units per design pixel

interface BdfGlyph {
  cp: number;
  width: number;
  height: number;
  xoff: number;
  yoff: number;
  /** Bitmap rows, top row first, bit (width − 1) is the leftmost pixel. */
  rows: number[];
}

function parseBdf(text: string): BdfGlyph[] {
  const out: BdfGlyph[] = [];
  let cur: BdfGlyph | null = null;
  let inBitmap = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const parts = line.split(/\s+/);
    switch (parts[0]) {
      case 'STARTCHAR':
        cur = { cp: -1, width: 0, height: 0, xoff: 0, yoff: 0, rows: [] };
        break;
      case 'ENCODING':
        if (cur) cur.cp = Number(parts[1]);
        break;
      case 'BBX':
        if (cur) {
          cur.width = Number(parts[1]);
          cur.height = Number(parts[2]);
          cur.xoff = Number(parts[3]);
          cur.yoff = Number(parts[4]);
        }
        break;
      case 'BITMAP':
        inBitmap = true;
        break;
      case 'ENDCHAR':
        if (cur && cur.cp >= 0) out.push(cur);
        cur = null;
        inBitmap = false;
        break;
      default:
        if (inBitmap && cur && line) cur.rows.push(parseInt(line, 16));
    }
  }
  return out;
}

function bdfToBitmap(g: BdfGlyph): Bitmap {
  const bm = new Bitmap(g.width, g.height);
  g.rows.forEach((row, i) => {
    const y = g.height - 1 - i;
    for (let x = 0; x < g.width; x++) if ((row >> (g.width - 1 - x)) & 1) bm.set(x, y, 1);
  });
  return bm;
}

function loadSpleen(): { doc: FontDoc; originals: Map<number, Bitmap> } {
  const parsed = parseBdf(readFileSync(resolve(__dirname, 'fixtures/spleen-8x16.bdf'), 'utf8'));
  const originals = new Map<number, Bitmap>();
  const glyphs: GlyphDoc[] = parsed.map((g, i) => {
    const bm = bdfToBitmap(g);
    originals.set(g.cp, bm);
    const pixel: PixelData = {
      width: g.width,
      height: g.height,
      cellsB64: bm.toB64(),
      unitsPerCell: U,
      offsetX: g.xoff * U,
      baselineRow: -g.yoff,
    };
    return {
      id: `spleen${i}`,
      name: String.fromCodePoint(g.cp),
      unicode: g.cp,
      advanceWidth: (g.width + 1) * U,
      leftSideBearing: g.xoff * U,
      kind: 'vector' as const,
      contours: tracePixelData(pixel),
      pixel: null,
      compound: null,
      instructions: null,
      sourceContours: null,
      edited: false,
      srcIndex: i,
    };
  });
  return {
    doc: {
      fontId: 'spleen',
      meta: {} as never,
      metrics: { unitsPerEm: 16 * U, ascent: 12 * U, descent: -4 * U, lineGap: 0 },
      glyphs,
      source: null,
      sourceRef: null,
    },
    originals,
  };
}

/** Ink box of a bitmap (so a tight converted grid can be compared to the source). */
function inkBox(bm: Bitmap): Bitmap | null {
  const b = bm.bounds();
  return b ? bm.extract(b.x, b.y, b.w, b.h) : null;
}

const contoursOf = (g: GlyphDoc): Contour[] => g.contours;

describe('importing a real 8×16 pixel font (spleen)', () => {
  it('recovers the font’s own 8×16 lattice', () => {
    const { doc } = loadSpleen();
    const det = detectFontPixelGrid(doc, contoursOf);
    expect(det.found).toBe(true);
    expect(det.lattice).toBeGreaterThan(0.98);
    expect(det.score).toBe(0); // every cell is either empty or completely full
    const grid = det.grid!;
    expect(grid.unitsPerCell).toBeCloseTo(U, 6);
    expect(grid.rows).toBe(16);
    expect(grid.baselineRow).toBeCloseTo(4, 6); // 4 rows below the baseline
    expect(grid.originX).toBeCloseTo(0, 6);
  });

  it('converts all 1000 glyphs without losing a single pixel', () => {
    const { doc, originals } = loadSpleen();
    const det = detectFontPixelGrid(doc, contoursOf);
    const { doc: out, report } = pixelizeFont(doc, { grid: det.grid!, contoursOf });
    expect(report.converted).toBeGreaterThan(950);
    expect(report.blank).toBe(0);
    expect(report.clipped).toBe(0);
    expect(report.rescued).toBe(0);

    const wrong: string[] = [];
    let checked = 0;
    for (const g of out.glyphs) {
      if (!g.pixel || g.unicode === null) continue;
      const got = inkBox(Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64));
      const want = inkBox(originals.get(g.unicode)!);
      checked += 1;
      if (!got || !want) {
        if (!!got !== !!want) wrong.push(`${g.name}: ink mismatch (${got ? 'got ink' : 'got nothing'})`);
        continue;
      }
      if (!got.equals(want)) {
        wrong.push(
          `${g.name} (U+${g.unicode.toString(16)}): expected\n${bitmapToAscii(want)}\ngot\n${bitmapToAscii(got)}`,
        );
      }
    }
    expect(checked).toBeGreaterThan(950);
    expect(wrong.slice(0, 3).join('\n'), `${wrong.length} glyphs changed`).toBe('');
  });

  it('keeps every glyph on the same baseline row', () => {
    const { doc } = loadSpleen();
    const det = detectFontPixelGrid(doc, contoursOf);
    const { doc: out } = pixelizeFont(doc, { grid: det.grid!, contoursOf });
    const phases = new Set(out.glyphs.filter((g) => g.pixel).map((g) => g.pixel!.baselineRow));
    expect(phases.size).toBe(1);
    expect([...phases][0]).toBeCloseTo(4, 6);
  });

  it('can still downsample the same font onto a coarser grid', () => {
    const { doc } = loadSpleen();
    const { doc: out, report } = pixelizeFont(doc, { rows: 8, contoursOf });
    expect(report.rows).toBe(8);
    expect(report.blank).toBe(0);
    const a = out.glyphs.find((g) => g.unicode === 0x41)!;
    const bm = Bitmap.fromB64(a.pixel!.width, a.pixel!.height, a.pixel!.cellsB64);
    expect(bm.height).toBe(8);
    expect(bm.count()).toBeGreaterThan(3);
  });
});
