import { describe, expect, it } from 'vitest';
import { symmetricPoints, paintWithSymmetry } from '../src/core/symmetry';
import { Bitmap } from '../src/core/bitmap';

describe('symmetry', () => {
  it('none returns single point', () => {
    expect(symmetricPoints(1, 2, 5, 5, 'none')).toEqual([{ x: 1, y: 2 }]);
  });
  it('horizontal mirrors x', () => {
    const pts = symmetricPoints(0, 2, 5, 5, 'horizontal');
    expect(pts).toContainEqual({ x: 0, y: 2 });
    expect(pts).toContainEqual({ x: 4, y: 2 });
    expect(pts.length).toBe(2);
  });
  it('vertical mirrors y', () => {
    const pts = symmetricPoints(1, 0, 5, 5, 'vertical');
    expect(pts).toContainEqual({ x: 1, y: 0 });
    expect(pts).toContainEqual({ x: 1, y: 4 });
  });
  it('quad mirrors both', () => {
    const pts = symmetricPoints(0, 0, 4, 4, 'quad');
    expect(pts.length).toBe(4);
    expect(pts).toContainEqual({ x: 0, y: 0 });
    expect(pts).toContainEqual({ x: 3, y: 0 });
    expect(pts).toContainEqual({ x: 0, y: 3 });
    expect(pts).toContainEqual({ x: 3, y: 3 });
  });
  it('center point dedupes for odd grid', () => {
    const pts = symmetricPoints(2, 2, 5, 5, 'quad');
    // center mirrors to itself
    expect(pts).toEqual([{ x: 2, y: 2 }]);
  });
  it('paintWithSymmetry sets mirrored pixels', () => {
    const bm = new Bitmap(5, 5);
    paintWithSymmetry((x, y, v) => bm.set(x, y, v), 0, 0, 5, 5, 'quad', 1);
    expect(bm.get(0, 0)).toBe(1);
    expect(bm.get(4, 0)).toBe(1);
    expect(bm.get(0, 4)).toBe(1);
    expect(bm.get(4, 4)).toBe(1);
  });
  it('radial includes rotations', () => {
    const pts = symmetricPoints(0, 0, 5, 5, 'radial');
    // should have at least 4 points
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });
});
