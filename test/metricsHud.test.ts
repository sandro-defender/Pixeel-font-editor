import { describe, expect, it } from 'vitest';
import { computeMetricsForTest } from '../src/components/MetricsHUD';
import { Bitmap } from '../src/core/bitmap';
import type { GlyphDoc } from '../src/core/types';
import { makeId } from '../src/core/types';

function makePixelGlyph(w: number, h: number, filled: Array<[number, number]>, advance = 600, lsb = 50): GlyphDoc {
  const bm = new Bitmap(w, h);
  for (const [x, y] of filled) bm.set(x, y, 1);
  return {
    id: makeId(),
    name: 'A',
    unicode: 65,
    advanceWidth: advance,
    leftSideBearing: lsb,
    kind: 'pixel',
    contours: [],
    pixel: {
      width: w,
      height: h,
      cellsB64: bm.toB64(),
      unitsPerCell: 100,
      offsetX: lsb,
      baselineRow: 2,
    },
    compound: null,
    instructions: null,
    sourceContours: null,
    edited: true,
    srcIndex: null,
  };
}

describe('metrics HUD calculations', () => {
  it('computes pixel stats', () => {
    const g = makePixelGlyph(5, 5, [
      [0, 0],
      [1, 0],
      [2, 2],
    ]);
    const res = computeMetricsForTest(g);
    expect(res.adv).toBe(600);
    expect(res.lsb).toBe(50);
    expect(res.pixelStats).not.toBeNull();
    expect(res.pixelStats!.count).toBe(3);
    expect(res.pixelStats!.w).toBe(5);
    expect(res.pixelStats!.h).toBe(5);
    expect(res.pixelStats!.bbox).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });

  it('handles empty pixel grid', () => {
    const g = makePixelGlyph(4, 4, []);
    const res = computeMetricsForTest(g);
    expect(res.pixelStats!.count).toBe(0);
    expect(res.pixelStats!.bbox).toBeUndefined();
  });

  it('computes vector bbox', () => {
    const g: GlyphDoc = {
      id: makeId(),
      name: 'B',
      unicode: 66,
      advanceWidth: 600,
      leftSideBearing: 0,
      kind: 'vector',
      contours: [
        [
          { x: 0, y: 0, onCurve: true },
          { x: 100, y: 0, onCurve: true },
          { x: 100, y: 100, onCurve: true },
          { x: 0, y: 100, onCurve: true },
        ],
      ],
      pixel: null,
      compound: null,
      instructions: null,
      sourceContours: null,
      edited: true,
      srcIndex: null,
    };
    const res = computeMetricsForTest(g);
    expect(res.vectorBbox).not.toBeNull();
    expect(res.vectorBbox!.xMin).toBe(0);
    expect(res.vectorBbox!.xMax).toBe(100);
  });
});
