// @vitest-environment jsdom
/**
 * Verifies the real canvas backend wired up in test/setup/canvas.ts: jsdom
 * canvas elements must render real pixels through @napi-rs/canvas instead of
 * logging "Not implemented: HTMLCanvasElement's getContext() method…" and
 * returning null.
 */
import { describe, expect, it } from 'vitest';
import { TEST_FONT_FAMILY } from './setup/canvas';

function makeCanvas(width = 16, height = 16): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

describe('jsdom canvas backed by @napi-rs/canvas', () => {
  it('returns a real 2D context (same object on repeat calls), not null', () => {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    expect(canvas.getContext('2d')).toBe(ctx);
    // The context must point back at its element, like the DOM.
    expect((ctx as CanvasRenderingContext2D).canvas).toBe(canvas);
  });

  it('returns null for unsupported context types (and does not throw)', () => {
    const canvas = makeCanvas();
    expect(canvas.getContext('webgl' as '2d')).toBeNull();
    expect(canvas.getContext('bitmaprenderer' as '2d')).toBeNull();
  });

  it('draws a filled rectangle and reads the exact pixels back', () => {
    const canvas = makeCanvas(8, 8);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(2, 3, 4, 2);

    const inside = ctx.getImageData(4, 4, 1, 1).data;
    expect([inside[0], inside[1], inside[2], inside[3]]).toEqual([255, 0, 0, 255]);

    // Every corner of the rectangle, and only it, is painted.
    for (const [x, y] of [[2, 3], [5, 3], [2, 4], [5, 4]]) {
      expect(ctx.getImageData(x, y, 1, 1).data[3], `pixel ${x},${y} lit`).toBe(255);
    }
    for (const [x, y] of [[1, 3], [6, 3], [2, 2], [5, 5]]) {
      expect(ctx.getImageData(x, y, 1, 1).data[3], `pixel ${x},${y} untouched`).toBe(0);
    }
  });

  it('starts with a fully transparent backing surface', () => {
    const canvas = makeCanvas(4, 4);
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, 4, 4);
    expect([...data].every((v) => v === 0)).toBe(true);
  });

  it('getImageData returns dimensions that match the canvas, with writable ImageData round trip', () => {
    const canvas = makeCanvas(5, 3);
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(5, 3);
    expect(image.width).toBe(5);
    expect(image.height).toBe(3);
    expect(image.data.length).toBe(5 * 3 * 4);
    // middle pixel opaque green
    const i = (1 * 5 + 2) * 4;
    image.data[i + 1] = 255;
    image.data[i + 3] = 255;
    ctx.putImageData(image, 0, 0);
    const back = ctx.getImageData(2, 1, 1, 1).data;
    expect([back[0], back[1], back[2], back[3]]).toEqual([0, 255, 0, 255]);
  });

  it('resizing a canvas updates its size, clears content and resets state', () => {
    const canvas = makeCanvas(4, 4);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 4, 4);
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(255);

    canvas.width = 12;
    canvas.height = 9;
    expect(canvas.width).toBe(12);
    expect(canvas.height).toBe(9);
    // cleared bitmap …
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0);
    // … and the drawing state fell back to the defaults, like in a browser
    expect(ctx.fillStyle).not.toBe('#0000ff');
    // the same context object keeps drawing on the resized surface
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(10, 7, 2, 2);
    expect(ctx.getImageData(11, 8, 1, 1).data[1]).toBe(255);
  });

  it('honors the canvas.width = canvas.width clear idiom', () => {
    const canvas = makeCanvas(6, 6);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#123456';
    ctx.fillRect(0, 0, 6, 6);
    canvas.width = 6; // same value — a browser still wipes the bitmap
    expect(ctx.getImageData(3, 3, 1, 1).data[3]).toBe(0);
    expect(canvas.width).toBe(6);
  });

  it('drawImage composites one jsdom canvas onto another, scaled', () => {
    const source = makeCanvas(2, 2);
    const sctx = source.getContext('2d')!;
    sctx.fillStyle = '#00ff00';
    sctx.fillRect(0, 0, 2, 2);

    const target = makeCanvas(8, 8);
    const tctx = target.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(source, 0, 0, 8, 8);
    expect(tctx.getImageData(7, 7, 1, 1).data[3]).toBe(255);
    expect(target.getContext('2d')!.getImageData(0, 0, 1, 1).data[1]).toBe(255);
  });

  it('measures text with the registered fixture font (positive, deterministic-adjacent bounds)', () => {
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d')!;
    ctx.font = `48px "${TEST_FONT_FAMILY}"`;
    const m = ctx.measureText('A');
    expect(m.width).toBeGreaterThan(10);
    expect(m.width).toBeLessThan(100);
    expect(m.actualBoundingBoxAscent).toBeGreaterThan(10);
    // Empty strings measure zero — the context is not just returning garbage.
    expect(ctx.measureText('').width).toBe(0);
    // Wider strings measure wider — the metrics respond to the input.
    expect(ctx.measureText('AAAA').width).toBeGreaterThan(ctx.measureText('A').width);
  });

  it('fillText rasterizes real glyph ink from the fixture font', () => {
    const canvas = makeCanvas(64, 64);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.font = `48px "${TEST_FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', 32, 32);

    const { data } = ctx.getImageData(0, 0, 64, 64);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
    // A 48px capital has on the order of 100–3000 lit pixels; zero would mean
    // no font was rendered at all.
    expect(lit).toBeGreaterThan(100);
    expect(lit).toBeLessThan(64 * 64);
  });

  it('exposes a working Path2D global and fills paths with a fill rule', () => {
    expect(typeof Path2D).toBe('function');
    const canvas = makeCanvas(8, 8);
    const ctx = canvas.getContext('2d')!;
    const triangle = new Path2D();
    triangle.moveTo(1, 1);
    triangle.lineTo(7, 1);
    triangle.lineTo(7, 7);
    triangle.closePath();
    ctx.fillStyle = '#ff00ff';
    ctx.fill(triangle, 'nonzero');
    const pixel = ctx.getImageData(6, 2, 1, 1).data; // safely inside the triangle
    expect([pixel[0], pixel[3]]).toEqual([255, 255]);
    // far below the hypotenuse stays transparent
    expect(ctx.getImageData(1, 6, 1, 1).data[3]).toBe(0);
  });

  it('supports arcs, shadows and dashed strokes without crashing', () => {
    const canvas = makeCanvas(24, 24);
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = '#ff6a2b';
    ctx.shadowBlur = 4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(12, 12, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillRect(1, 1, 2, 2);
    expect(ctx.getImageData(4, 4, 1, 1).data[3]).toBe(255);
  });
});
