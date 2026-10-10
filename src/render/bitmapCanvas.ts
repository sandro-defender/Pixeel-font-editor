/**
 * Fast bitmap painting. Instead of one fillRect per lit cell, the bitmap is
 * written into an ImageData once and blitted, which keeps large grids (up to
 * 128×128) responsive while drawing.
 */
import type { Bitmap } from '../core/bitmap';

export type Rgba = readonly [number, number, number, number];

export interface LayerOptions {
  /** colour of lit cells */
  on: Rgba;
  /** colour of unlit cells; null leaves them transparent */
  off?: Rgba | null;
  /** optional overlay (e.g. a floating selection) painted over the bitmap */
  overlay?: { bm: Bitmap; x: number; y: number; color: Rgba } | null;
}

/**
 * Render a bitmap to an offscreen canvas with row 0 (the bottom row of the
 * model) at the bottom. One canvas pixel per cell; scale it with drawImage.
 */
export function bitmapLayer(bm: Bitmap, opts: LayerOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bm.width;
  canvas.height = bm.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(bm.width, bm.height);
  const data = image.data;
  const { on, off = null, overlay = null } = opts;
  const { width, height, cells } = bm;
  for (let row = 0; row < height; row++) {
    const srcRow = height - 1 - row; // canvas rows run top→bottom, bitmap rows bottom→top
    for (let x = 0; x < width; x++) {
      const o = (row * width + x) * 4;
      let color: Rgba | null = cells[srcRow * width + x] ? on : off;
      if (overlay) {
        const ox = x - overlay.x;
        const oy = srcRow - overlay.y;
        if (ox >= 0 && oy >= 0 && ox < overlay.bm.width && oy < overlay.bm.height && overlay.bm.get(ox, oy)) {
          color = overlay.color;
        }
      }
      if (color) {
        data[o] = color[0];
        data[o + 1] = color[1];
        data[o + 2] = color[2];
        data[o + 3] = color[3];
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Paint a bitmap onto a target canvas at an integer scale (crisp pixels). */
export function paintBitmap(target: HTMLCanvasElement, bm: Bitmap, scale: number, opts: LayerOptions): void {
  const ctx = target.getContext('2d');
  target.width = bm.width * scale;
  target.height = bm.height * scale;
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmapLayer(bm, opts), 0, 0, target.width, target.height);
}

/** Parse a CSS colour like "#rrggbb" or "rgb(r, g, b)" into RGBA bytes (defaults to opaque black). */
export function toRgba(color: string, alpha = 255): Rgba {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), alpha];
  }
  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  return [0, 0, 0, alpha];
}
