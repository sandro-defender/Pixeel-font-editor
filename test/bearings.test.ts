import { describe, expect, it } from 'vitest';
import {
  MAX_ADVANCE,
  computeRSB,
  dragAdvance,
  dragOrigin,
  glyphBoxWidth,
  snapToGrid,
  vectorSnapStep,
} from '../src/core/metrics';
import { setGlyphMetrics } from '../src/state/glyphActions';
import { useStore } from '../src/state/store';
import { newTestFont, drawGlyph } from './helpers';

describe('metrics helpers', () => {
  it('snaps to the nearest multiple of the step', () => {
    expect(snapToGrid(149, 100)).toBe(100);
    expect(snapToGrid(151, 100)).toBe(200);
    expect(snapToGrid(-149, 100)).toBe(-100);
    expect(snapToGrid(-10, 100)).toBe(0);
    expect(Object.is(snapToGrid(-10, 100), -0)).toBe(false);
    expect(snapToGrid(12.6, 0)).toBe(13);
  });

  it('computes RSB = advance - lsb - width', () => {
    expect(computeRSB(600, 50, 500)).toBe(50);
    expect(computeRSB(400, 100, 400)).toBe(-100);
  });

  it('dragging the advance line changes only the advance', () => {
    const start = { advance: 800, lsb: 0 };
    expect(dragAdvance(start, 130, { snap: false, step: 100 })).toEqual({ advance: 930, lsb: 0 });
    expect(dragAdvance(start, 130, { snap: true, step: 100 })).toEqual({ advance: 900, lsb: 0 });
    expect(dragAdvance(start, -5000, { snap: true, step: 100 }).advance).toBe(0);
    expect(dragAdvance(start, 1e9, { snap: false, step: 100 }).advance).toBe(MAX_ADVANCE);
  });

  it('advance snapping is relative to the grid edge (lsb), not to the origin', () => {
    // grid starts 30 units right of the origin: the right edge of a cell column is at 30 + n*100
    expect(dragAdvance({ advance: 830, lsb: 30 }, 40, { snap: true, step: 100 }).advance).toBe(830);
    expect(dragAdvance({ advance: 830, lsb: 30 }, 70, { snap: true, step: 100 }).advance).toBe(930);
  });

  it('dragging the origin changes LSB and keeps RSB (the advance line stays on the glyph)', () => {
    const start = { advance: 600, lsb: 100 };
    const width = 400; // rsb 100
    const res = dragOrigin(start, 40, { snap: false, step: 100 });
    expect(res).toEqual({ advance: 560, lsb: 60 });
    expect(computeRSB(res.advance, res.lsb, width)).toBe(computeRSB(start.advance, start.lsb, width));
    // moving the origin onto the glyph edge
    expect(dragOrigin(start, 100, { snap: true, step: 100 })).toEqual({ advance: 500, lsb: 0 });
    // moving it left grows LSB
    expect(dragOrigin(start, -200, { snap: true, step: 100 })).toEqual({ advance: 800, lsb: 300 });
  });

  it('origin drag never produces a negative advance', () => {
    const res = dragOrigin({ advance: 200, lsb: 0 }, 900, { snap: false, step: 100 });
    expect(res.advance).toBe(0);
    expect(res.lsb).toBe(-200);
  });

  it('picks readable vector snap steps', () => {
    expect(vectorSnapStep(1000)).toBe(20);
    expect(vectorSnapStep(2048)).toBe(50);
    expect(vectorSnapStep(8)).toBe(1);
  });

  it('measures the glyph box: grid width for pixels, outline width for vectors', () => {
    const { glyph } = drawGlyph(newTestFont(8, 8), 65, (bm) => bm.set(1, 1, 1));
    expect(glyphBoxWidth(glyph)).toBe(8 * glyph.pixel!.unitsPerCell);
    const vec = {
      kind: 'vector' as const,
      pixel: null,
      contours: [[{ x: 50, y: 0, onCurve: true }, { x: 450, y: 0, onCurve: true }, { x: 450, y: 700, onCurve: true }]],
    };
    expect(glyphBoxWidth(vec)).toBe(400);
    expect(glyphBoxWidth({ kind: 'empty', pixel: null, contours: [] })).toBe(0);
  });
});

describe('setGlyphMetrics', () => {
  it('updates advance and LSB (shifting pixel content) in one document change', () => {
    const { doc, glyph } = drawGlyph(newTestFont(8, 8), 65, (bm) => bm.set(1, 1, 1));
    const next = setGlyphMetrics(doc, glyph.id, { advance: glyph.advanceWidth + 200, lsb: glyph.leftSideBearing - 100 });
    const g = next.glyphs.find((x) => x.id === glyph.id)!;
    expect(g.advanceWidth).toBe(glyph.advanceWidth + 200);
    expect(g.leftSideBearing).toBe(glyph.leftSideBearing - 100);
    expect(g.pixel!.offsetX).toBe(glyph.pixel!.offsetX - 100);
    expect(g.edited).toBe(true);
  });

  it('is a single undo step through the store', () => {
    const { doc, glyph } = drawGlyph(newTestFont(8, 8), 65, (bm) => bm.set(1, 1, 1));
    const s = useStore.getState();
    s.loadFont('A', doc, 't.pixeel');
    const before = useStore.getState().past.A.length;
    s.commit('A', 'Drag advance width', (d) => setGlyphMetrics(d, glyph.id, { advance: 1234, lsb: glyph.leftSideBearing + 100 }));
    expect(useStore.getState().past.A.length).toBe(before + 1);
    useStore.getState().undo('A');
    const g = useStore.getState().fonts.A!.glyphs.find((x) => x.id === glyph.id)!;
    expect(g.advanceWidth).toBe(glyph.advanceWidth);
    expect(g.leftSideBearing).toBe(glyph.leftSideBearing);
    expect(g.pixel!.offsetX).toBe(glyph.pixel!.offsetX);
  });

  it('rejects out-of-range advances', () => {
    const { doc, glyph } = drawGlyph(newTestFont(8, 8), 65, () => {});
    expect(() => setGlyphMetrics(doc, glyph.id, { advance: -1, lsb: 0 })).toThrow();
  });
});
