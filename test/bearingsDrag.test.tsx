// @vitest-environment jsdom
/** Dragging the advance / origin handles in the pixel and outline editors. */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { OutlineEditor } from '../src/components/OutlineEditor';
import { useStore } from '../src/state/store';
import { PAD } from '../src/components/PixelEditor';
import { drawGlyph, newTestFont } from './helpers';
import type { FontDoc, GlyphDoc } from '../src/core/types';
import { makeId } from '../src/core/types';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => cleanup());

const RULER = 22;
const zoom = 16;

describe('pixel editor bearing handles', () => {
  async function setup(snap: boolean) {
    const base = newTestFont(8, 8, 'Bearing');
    const { doc, glyph } = drawGlyph(base, 65, (bm) => bm.set(2, 2, 1));
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', doc, 'b.pixeel');
      s.setActive('A');
      s.selectGlyph('A', glyph.id);
      s.setSnapToPixelGrid(snap);
      s.setBearingHandles(true);
    });
    const canvas = screen.getByLabelText('Pixel grid, 8 columns by 8 rows') as HTMLCanvasElement;
    const rect = { left: 0, top: 0, x: 0, y: 0, width: canvas.width, height: canvas.height, right: canvas.width, bottom: canvas.height, toJSON: () => ({}) } as DOMRect;
    canvas.getBoundingClientRect = () => rect;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const g = () => useStore.getState().fonts.A!.glyphs.find((x) => x.id === glyph.id)!;
    return { canvas, glyph, g };
  }

  it('dragging the advance marker updates the advance live and commits ONE undo step', async () => {
    const { canvas, glyph, g } = await setup(true);
    const upc = glyph.pixel!.unitsPerCell;
    const startX = RULER + PAD + glyph.advanceWidth / upc * zoom; // advance marker in the top ruler
    const pasts = useStore.getState().past.A.length;

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: startX, clientY: 10 });
    expect(useStore.getState().liveMetrics).not.toBeNull();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: startX + 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: startX + 2 * zoom + 3, clientY: 10 });
    // live value shown while dragging, document not yet touched
    expect(useStore.getState().liveMetrics!.advance).toBe(glyph.advanceWidth + 2 * upc);
    expect(g().advanceWidth).toBe(glyph.advanceWidth);
    expect(useStore.getState().past.A.length).toBe(pasts);
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: startX + 2 * zoom + 3, clientY: 10 });

    expect(useStore.getState().liveMetrics).toBeNull();
    expect(g().advanceWidth).toBe(glyph.advanceWidth + 2 * upc); // snapped to whole cells
    expect(g().leftSideBearing).toBe(glyph.leftSideBearing);
    expect(useStore.getState().past.A.length).toBe(pasts + 1);

    act(() => useStore.getState().undo('A'));
    expect(g().advanceWidth).toBe(glyph.advanceWidth);
  });

  it('without snapping the advance follows the pointer in whole font units', async () => {
    const { canvas, glyph, g } = await setup(false);
    const upc = glyph.pixel!.unitsPerCell;
    const startX = RULER + PAD + glyph.advanceWidth / upc * zoom;
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: startX, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: startX + 8, clientY: 10 }); // half a cell
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: startX + 8, clientY: 10 });
    expect(g().advanceWidth).toBe(glyph.advanceWidth + Math.round(upc / 2));
  });

  it('dragging the origin marker changes LSB, shifts the content frame and keeps RSB', async () => {
    const { canvas, glyph, g } = await setup(true);
    const upc = glyph.pixel!.unitsPerCell;
    const originX = RULER + PAD + (-glyph.pixel!.offsetX / upc) * zoom;
    const rsb = (x: GlyphDoc) => x.advanceWidth - x.leftSideBearing - x.pixel!.width * upc;
    const pasts = useStore.getState().past.A.length;

    // drag the origin one cell to the LEFT: the glyph gains one cell of left bearing
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: originX, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: originX - zoom, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: originX - zoom, clientY: 10 });

    expect(g().leftSideBearing).toBe(glyph.leftSideBearing + upc);
    expect(g().pixel!.offsetX).toBe(glyph.pixel!.offsetX + upc);
    expect(rsb(g())).toBe(rsb(glyph));
    expect(useStore.getState().past.A.length).toBe(pasts + 1);
  });

  it('a click on a marker without moving commits nothing, and handles can be hidden', async () => {
    const { canvas, glyph } = await setup(true);
    const upc = glyph.pixel!.unitsPerCell;
    const startX = RULER + PAD + glyph.advanceWidth / upc * zoom;
    const pasts = useStore.getState().past.A.length;
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: startX, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: startX, clientY: 10 });
    expect(useStore.getState().past.A.length).toBe(pasts);

    act(() => useStore.getState().setBearingHandles(false));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: startX, clientY: 10 });
    expect(useStore.getState().liveMetrics).toBeNull();
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: startX, clientY: 10 });
  });

  it('shows the live RSB in the metrics panel', async () => {
    await setup(true);
    expect(screen.getAllByText(/^RSB /).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Snap bearings to pixel grid')).toBeTruthy();
  });
});

describe('outline editor bearing handles', () => {
  function vectorGlyph(): GlyphDoc {
    return {
      id: makeId(), name: 'A', unicode: 65, advanceWidth: 600, leftSideBearing: 100, kind: 'vector',
      contours: [[{ x: 100, y: 0, onCurve: true }, { x: 500, y: 0, onCurve: true }, { x: 500, y: 700, onCurve: true }, { x: 100, y: 700, onCurve: true }]],
      pixel: null, compound: null, instructions: null, sourceContours: null, edited: false, srcIndex: null,
    };
  }

  it('drags the advance line and the origin line, each as one undo step', async () => {
    const base = newTestFont(8, 8, 'Vec');
    const glyph = vectorGlyph();
    const doc: FontDoc = { ...base, glyphs: [...base.glyphs, glyph] };
    act(() => {
      const s = useStore.getState();
      s.loadFont('A', doc, 'v.pixeel');
      s.setSnapToPixelGrid(false);
      s.setBearingHandles(true);
    });
    Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
    Object.defineProperty(SVGElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true });
    const view = render(<OutlineEditor slot="A" glyph={glyph} />);
    const svg = screen.getByRole('img') as unknown as SVGSVGElement;
    const vb = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // 1 screen px == 1 view unit
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: vb[2], height: vb[3], right: vb[2], bottom: vb[3], toJSON: () => ({}) }) as DOMRect;
    const get = () => useStore.getState().fonts.A!.glyphs.find((g) => g.id === glyph.id)!;
    const pasts = useStore.getState().past.A.length;

    const adv = screen.getByLabelText('Drag advance width line');
    fireEvent.pointerDown(adv, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 350 });
    expect(useStore.getState().liveMetrics!.advance).toBe(650);
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 350 });
    expect(get().advanceWidth).toBe(650);
    expect(get().leftSideBearing).toBe(100);
    expect(useStore.getState().past.A.length).toBe(pasts + 1);

    view.rerender(<OutlineEditor slot="A" glyph={get()} />);
    const vb2 = svg.getAttribute('viewBox')!.split(' ').map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: vb2[2], height: vb2[3], right: vb2[2], bottom: vb2[3], toJSON: () => ({}) }) as DOMRect;
    // origin: drag 40 units right -> lsb 60, outline moves -40, advance follows
    const org = screen.getByLabelText('Drag origin line (left side bearing)');
    fireEvent.pointerDown(org, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 140 });
    expect(get().leftSideBearing).toBe(60);
    expect(get().advanceWidth).toBe(610);
    expect(Math.min(...get().contours[0].map((p) => p.x))).toBe(60);
    expect(useStore.getState().past.A.length).toBe(pasts + 2);

    act(() => useStore.getState().undo('A'));
    expect(get().leftSideBearing).toBe(100);
    expect(get().advanceWidth).toBe(650);
    act(() => useStore.getState().undo('A'));
    expect(get().advanceWidth).toBe(600);
  });
});
