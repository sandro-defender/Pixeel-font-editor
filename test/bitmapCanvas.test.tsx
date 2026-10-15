// @vitest-environment jsdom
/**
 * Pixel-level tests for the render layer (src/render/bitmapCanvas.ts). These
 * run against the real Skia-backed canvas: colors are read back out of actual
 * ImageData, not from spies on fillRect/putImageData.
 */
import { describe, expect, it } from 'vitest';
import { Bitmap } from '../src/core/bitmap';
import { bitmapLayer, ledDotSize, paintBitmap, paintLedDots, toRgba } from '../src/render/bitmapCanvas';

const RED = [255, 0, 0, 255] as const;
const BLUE = [0, 0, 255, 255] as const;
const DARK_PANEL = [11, 13, 16, 255]; // #0b0d10
const LED_ON = [255, 106, 43, 255]; // #ff6a2b
const LED_OFF = [35, 38, 46, 255]; // #23262e

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  const ctx = canvas.getContext('2d')!;
  return [...ctx.getImageData(x, y, 1, 1).data];
}

/** 4×3 bitmap with the bottom-left and top-right corners lit. */
function cornersBitmap(): Bitmap {
  const bm = new Bitmap(4, 3);
  bm.set(0, 0, 1);
  bm.set(3, 2, 1);
  return bm;
}

describe('bitmapLayer', () => {
  it('paints lit pixels in the requested color, bottom row at the bottom', () => {
    const bm = cornersBitmap();
    const canvas = bitmapLayer(bm, { on: RED });
    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(3);
    // bitmap (0,0) is the bottom-left cell → canvas pixel (0, 2)
    expect(pixelAt(canvas, 0, 2)).toEqual(RED);
    // bitmap (3,2) is the top-right cell → canvas pixel (3, 0)
    expect(pixelAt(canvas, 3, 0)).toEqual(RED);
    // an unlit cell with off: null stays fully transparent
    expect(pixelAt(canvas, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('paints the off color when one is given', () => {
    const canvas = bitmapLayer(cornersBitmap(), { on: RED, off: BLUE });
    expect(pixelAt(canvas, 1, 1)).toEqual(BLUE);
    expect(pixelAt(canvas, 0, 2)).toEqual(RED);
  });

  it('lets the overlay color win over the bitmap cell', () => {
    const overlayBm = new Bitmap(1, 1);
    overlayBm.set(0, 0, 1);
    const canvas = bitmapLayer(cornersBitmap(), {
      on: RED,
      overlay: { bm: overlayBm, x: 0, y: 0, color: BLUE },
    });
    // (0,0) is lit in the bitmap (red) but overridden by the overlay (blue)
    expect(pixelAt(canvas, 0, 2)).toEqual(BLUE);
    expect(pixelAt(canvas, 3, 0)).toEqual(RED);
  });
});

describe('paintBitmap', () => {
  it('scales the grid crisply and resizes the target canvas', () => {
    const target = document.createElement('canvas');
    const bm = cornersBitmap();
    paintBitmap(target, bm, 5, { on: RED });
    expect(target.width).toBe(20);
    expect(target.height).toBe(15);
    // center of the scaled bottom-left cell
    expect(pixelAt(target, 2, 12)).toEqual(RED);
    // center of a scaled unlit cell stays transparent (off: null)
    expect(pixelAt(target, 7, 7)).toEqual([0, 0, 0, 0]);
  });
});

describe('paintLedDots', () => {
  it('draws a dark panel with glowing dots on lit cells only', () => {
    const target = document.createElement('canvas');
    const bm = cornersBitmap();
    const dot = 10;
    const pad = 2;
    paintLedDots(target, bm, dot, { glow: false });
    expect(target.width).toBe(bm.width * dot + pad * 2);
    expect(target.height).toBe(bm.height * dot + pad * 2);
    // panel corner between dots = dark background
    expect(pixelAt(target, 0, 0)).toEqual(DARK_PANEL);
    // center of the lit bottom-left dot (canvas y measured from the top)
    const litCy = pad + (bm.height - 1 - 0) * dot + dot / 2;
    expect(pixelAt(target, pad + 0 * dot + dot / 2, litCy)).toEqual(LED_ON);
    // center of an unlit dot
    expect(pixelAt(target, pad + 1 * dot + dot / 2, litCy)).toEqual(LED_OFF);
  });
});

describe('color + sizing helpers', () => {
  it('parses #rgb, #rrggbb and rgb() strings into RGBA bytes', () => {
    expect(toRgba('#fff')).toEqual([255, 255, 255, 255]);
    expect(toRgba('#0b0d10')).toEqual([11, 13, 16, 255]);
    expect(toRgba('rgb(10, 20, 30)')).toEqual([10, 20, 30, 255]);
    expect(toRgba('not-a-color')).toEqual([0, 0, 0, 255]);
    expect(toRgba('#112233', 128)).toEqual([17, 34, 51, 128]);
  });

  it('computes an integer LED dot size that fits the budget', () => {
    expect(ledDotSize(new Bitmap(16, 16), 160)).toBe(10);
    expect(ledDotSize(new Bitmap(128, 8), 40)).toBe(3); // clamped to the floor
  });
});
