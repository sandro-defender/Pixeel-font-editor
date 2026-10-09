import { describe, expect, it } from 'vitest';
import { Bitmap } from '../src/core/bitmap';
import { traceBitmap, isOuterLoop } from '../src/core/trace';

function fromPattern(rows: string[]): Bitmap {
  // rows given top-first for readability; convert to bottom-first
  const h = rows.length;
  const w = rows[0].length;
  const bm = new Bitmap(w, h);
  for (let ry = 0; ry < h; ry++) {
    for (let x = 0; x < w; x++) {
      if (rows[ry][x] === '#') bm.set(x, h - 1 - ry, 1);
    }
  }
  return bm;
}

describe('bitmap → TrueType contour tracing', () => {
  it('traces a single pixel as one 4-point square', () => {
    const bm = fromPattern(['#']);
    const cs = traceBitmap(bm);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toHaveLength(4);
    expect(isOuterLoop(cs[0])).toBe(true);
    const pts = cs[0].map((p) => `${p.x},${p.y}`).sort();
    expect(pts).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('merges runs of pixels into single sharp rectangles', () => {
    const bm = fromPattern(['####', '####']);
    const cs = traceBitmap(bm);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toHaveLength(4); // one rect, not 8 points
    expect(isOuterLoop(cs[0])).toBe(true);
  });

  it('keeps a hole as a separate counter loop with opposite winding', () => {
    const bm = fromPattern(['###', '#.#', '###']);
    const cs = traceBitmap(bm);
    expect(cs).toHaveLength(2);
    const outers = cs.filter(isOuterLoop);
    const holes = cs.filter((c) => !isOuterLoop(c));
    expect(outers).toHaveLength(1);
    expect(holes).toHaveLength(1);
    expect(outers[0]).toHaveLength(4); // plain 3×3 square outline
    expect(holes[0]).toHaveLength(4); // the 1x1 counter
  });

  it('splits diagonally touching pixels into two loops', () => {
    const bm = fromPattern(['#.', '.#']);
    const cs = traceBitmap(bm);
    expect(cs).toHaveLength(2);
    for (const c of cs) expect(c).toHaveLength(4);
  });

  it('handles disconnected islands', () => {
    const bm = fromPattern(['#.#', '...', '#.#']);
    const cs = traceBitmap(bm);
    expect(cs).toHaveLength(4);
  });

  it('handles an empty grid', () => {
    const bm = new Bitmap(8, 8);
    expect(traceBitmap(bm)).toHaveLength(0);
  });

  it('preserves the two true counters of an 8-shape', () => {
    const bm = fromPattern(['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####']);
    const cs = traceBitmap(bm);
    const holes = cs.filter((c) => !isOuterLoop(c));
    expect(holes.length).toBe(2);
    expect(cs.filter(isOuterLoop).length).toBe(1);
  });

  it('renders diagonally pinched gaps as background (no phantom holes)', () => {
    // The gaps in this shape are 8-connected to the outside through diagonal
    // pinch points, so they must stay background: each 4-connected filled
    // component becomes its own CCW loop.
    const bm = fromPattern(['.###.', '#...#', '.###.', '#...#', '.###.']);
    const cs = traceBitmap(bm);
    expect(cs.length).toBe(7);
    expect(cs.every(isOuterLoop)).toBe(true);
  });

  it('works on a 32×32 grid with a complex shape', () => {
    const bm = new Bitmap(32, 32);
    bm.rect(4, 4, 27, 27, 1, false); // big ring
    bm.rect(10, 10, 14, 14, 1, true); // island inside the hole
    bm.rect(20, 20, 24, 24, 1, true); // another island
    const cs = traceBitmap(bm);
    // outer ring boundary + inner ring boundary + two islands
    expect(cs.filter(isOuterLoop).length).toBe(3);
    expect(cs.filter((c) => !isOuterLoop(c)).length).toBe(1);
  });
});
