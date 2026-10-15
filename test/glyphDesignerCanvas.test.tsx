// @vitest-environment jsdom
/**
 * Real-canvas tests for rasterizeCharacterTemplate: instead of mocking
 * measureText/getImageData, the character is rasterized through the actual
 * Skia-backed context using the bundled Lato fixture registered as
 * TEST_FONT_FAMILY. Assertions use generous numeric margins — they pin down
 * rendering *properties* (ink exists, baseline respected, grid boundaries
 * kept), never exact font metrics.
 */
import { describe, expect, it } from 'vitest';
import { rasterizeCharacterTemplate } from '../src/core/glyphDesigner';
import type { Bitmap } from '../src/core/bitmap';
import { TEST_FONT_FAMILY } from './setup/canvas';

function columnIsEmpty(bm: Bitmap, x: number): boolean {
  for (let y = 0; y < bm.height; y++) if (bm.get(x, y)) return false;
  return true;
}

function rowIsEmpty(bm: Bitmap, y: number): boolean {
  for (let x = 0; x < bm.width; x++) if (bm.get(x, y)) return false;
  return true;
}

describe('rasterizeCharacterTemplate with a real canvas', () => {
  it('rasterizes "A" onto a 16×16 grid with ink respecting the baseline', () => {
    const bm = rasterizeCharacterTemplate('A', TEST_FONT_FAMILY, 16, 16, 4);
    expect(bm.width).toBe(16);
    expect(bm.height).toBe(16);
    // A 16px capital draws a few dozen pixels — real rendering, not an illusion.
    expect(bm.count()).toBeGreaterThan(30);
    expect(bm.count()).toBeLessThan(80);
    // "A" has no descender: the descent rows below the baseline stay clear
    // (row 0/1 are two full rows away from the baseline — generous margin).
    expect(rowIsEmpty(bm, 0)).toBe(true);
    expect(rowIsEmpty(bm, 1)).toBe(true);
    // The ink is centered; outer columns are the transparent margin.
    expect(columnIsEmpty(bm, 0)).toBe(true);
    expect(columnIsEmpty(bm, 15)).toBe(true);
    // The apex touches the top of the grid around the center columns.
    expect(bm.count()).toBeGreaterThan(0);
    let topRowInk = 0;
    for (let x = 0; x < bm.width; x++) if (bm.get(x, bm.height - 1)) topRowInk++;
    expect(topRowInk).toBeGreaterThan(0);
    expect(topRowInk).toBeLessThan(bm.width);
  });

  it('keeps descenders below the baseline ("g" crosses it)', () => {
    const bm = rasterizeCharacterTemplate('g', TEST_FONT_FAMILY, 16, 16, 4);
    expect(bm.count()).toBeGreaterThan(40);
    expect(bm.count()).toBeLessThan(130);
    let belowBaseline = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < bm.width; x++) if (bm.get(x, y)) belowBaseline++;
    expect(belowBaseline).toBeGreaterThan(4);
    // A lowercase g only reaches x-height: the very top row stays empty.
    expect(rowIsEmpty(bm, bm.height - 1)).toBe(true);
  });

  it.each([8, 16, 32] as const)('produces real glyphs on the %i×%i pixel-matrix sizes', (size) => {
    const bm = rasterizeCharacterTemplate('A', TEST_FONT_FAMILY, size, size, Math.floor(size / 4));
    expect(bm.width).toBe(size);
    expect(bm.height).toBe(size);
    // At every editor size the letter must show up with meaningful coverage,
    // but never as a solid block (background stays transparent elsewhere).
    expect(bm.count()).toBeGreaterThan(size / 2);
    expect(bm.count()).toBeLessThan(size * size * 0.6);
  });

  it('still rejects unusable input with explicit errors', () => {
    expect(() => rasterizeCharacterTemplate('AB', TEST_FONT_FAMILY, 16, 16, 4)).toThrow(/exactly one/i);
    expect(() => rasterizeCharacterTemplate(' ', TEST_FONT_FAMILY, 16, 16, 4)).toThrow(/space/i);
    expect(() => rasterizeCharacterTemplate('A', TEST_FONT_FAMILY, 0, 16, 4)).toThrow(/invalid/i);
  });
});
