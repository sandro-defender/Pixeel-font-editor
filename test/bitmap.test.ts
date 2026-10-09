import { describe, expect, it } from 'vitest';
import { Bitmap, MAX_GRID } from '../src/core/bitmap';

describe('Bitmap core ops', () => {
  for (const size of [8, 16, 32]) {
    it(`handles a ${size}×${size} grid`, () => {
      const bm = new Bitmap(size, size);
      bm.set(0, 0, 1);
      bm.set(size - 1, size - 1, 1);
      expect(bm.get(0, 0)).toBe(1);
      expect(bm.get(size - 1, size - 1)).toBe(1);
      expect(bm.get(1, 1)).toBe(0);
      expect(bm.count()).toBe(2);
      bm.invert();
      expect(bm.count()).toBe(size * size - 2);
      bm.clear();
      expect(bm.isEmpty()).toBe(true);
    });
  }

  it('supports custom sizes and enforces the performance limit', () => {
    const bm = new Bitmap(12, 7);
    expect(bm.width).toBe(12);
    expect(bm.height).toBe(7);
    expect(() => new Bitmap(MAX_GRID + 1, 4)).toThrow(/limited/);
    expect(() => new Bitmap(0, 4)).toThrow();
  });

  it('draws lines', () => {
    const bm = new Bitmap(8, 8);
    bm.line(0, 0, 7, 0, 1);
    for (let x = 0; x < 8; x++) expect(bm.get(x, 0)).toBe(1);
    const diag = new Bitmap(8, 8);
    diag.line(0, 0, 3, 3, 1);
    expect(diag.count()).toBe(4);
  });

  it('draws rectangles (outline and filled)', () => {
    const bm = new Bitmap(8, 8);
    bm.rect(1, 1, 4, 4, 1, false);
    expect(bm.get(1, 1)).toBe(1);
    expect(bm.get(2, 2)).toBe(0); // hollow centre
    const filled = new Bitmap(8, 8);
    filled.rect(1, 1, 4, 4, 1, true);
    expect(filled.count()).toBe(16);
  });

  it('flood fills bounded regions', () => {
    const bm = new Bitmap(8, 8);
    bm.rect(2, 2, 5, 5, 1, false); // ring
    bm.floodFill(3, 3, 1); // fill inside only
    expect(bm.get(3, 3)).toBe(1);
    expect(bm.get(0, 0)).toBe(0); // outside untouched
  });

  it('shifts pixels with clipping', () => {
    const bm = new Bitmap(4, 4);
    bm.set(0, 0, 1);
    bm.shift(1, 1);
    expect(bm.get(1, 1)).toBe(1);
    expect(bm.get(0, 0)).toBe(0);
    bm.shift(-5, 0); // off-grid
    expect(bm.count()).toBe(0);
  });

  it('flips and rotates', () => {
    const bm = new Bitmap(4, 3);
    bm.set(0, 0, 1);
    bm.flipHorizontal();
    expect(bm.get(3, 0)).toBe(1);
    bm.flipVertical();
    expect(bm.get(3, 2)).toBe(1);
    const r = new Bitmap(3, 2);
    r.set(0, 0, 1);
    r.rotate90(); // CCW: (0,0) -> (0, width-1)
    expect(r.width).toBe(2);
    expect(r.height).toBe(3);
    expect(r.get(0, 2)).toBe(1);
  });

  it('resizes via crop (bottom-left anchor), center, and resample', () => {
    const bm = new Bitmap(4, 4);
    bm.set(0, 0, 1);
    bm.set(3, 3, 1);

    const cropped = bm.resized(2, 2, 'crop');
    expect(cropped.get(0, 0)).toBe(1); // bottom-left kept
    expect(cropped.get(1, 1)).toBe(0); // top-right cropped away

    const centered = bm.resized(2, 2, 'center');
    expect(centered.get(0, 0)).toBe(0);

    const up = bm.resized(8, 8, 'resample');
    expect(up.get(0, 0)).toBe(1);
    expect(up.get(7, 7)).toBe(1);
    expect(up.get(4, 0)).toBe(0);

    const bm2 = new Bitmap(4, 4);
    bm2.set(0, 0, 1);
    bm2.set(2, 2, 1);
    const down = bm2.resized(2, 2, 'resample');
    expect(down.get(0, 0)).toBe(1);
    expect(down.get(1, 1)).toBe(1);
  });

  it('extracts and pastes regions', () => {
    const bm = new Bitmap(8, 8);
    bm.rect(2, 2, 4, 4, 1, true);
    const piece = bm.extract(2, 2, 3, 3);
    expect(piece.count()).toBe(9);
    const target = new Bitmap(8, 8);
    target.paste(piece, 5, 5);
    expect(target.get(5, 5)).toBe(1);
    expect(target.get(7, 7)).toBe(1);
  });

  it('round-trips base64 cell storage', () => {
    const bm = new Bitmap(16, 16);
    bm.set(3, 5, 1);
    bm.set(15, 15, 1);
    const clone = Bitmap.fromB64(16, 16, bm.toB64());
    expect(clone.equals(bm)).toBe(true);
  });
});
