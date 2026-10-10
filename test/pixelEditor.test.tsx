// @vitest-environment jsdom
/**
 * Pixel editor keyboard model: cursor movement, Space/T/Shift+Space,
 * a single undo per Ctrl+Z, and the LED matrix chip.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { createNewFont } from '../src/core/fontFactory';
import { drawGlyph, cellsOf } from './helpers';
import { checkLedFont, normalizeLedSpec } from '../src/core/ledMatrix';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});

// vitest runs without globals here, so @testing-library's auto-cleanup is off
afterEach(() => cleanup());

describe('pixel editor keyboard', () => {
  it('moves the cursor, paints, toggles and undoes one step per key', async () => {
    const spec = normalizeLedSpec({ rows: 7, cols: 5, spacing: 1, cellUnits: 100, descentRows: 0 });
    const base = createNewFont({ familyName: 'KeyTest', styleName: 'Regular', gridWidth: 5, gridHeight: 7, led: spec });
    const { doc, glyph } = drawGlyph(base, 65, () => {});
    expect(checkLedFont(doc).errors).toBe(0);

    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', doc, 'led.pixeel');
      s.setActive('A');
      s.selectGlyph('A', glyph.id);
      s.setTool('A', 'pencil');
    });

    const area = await screen.findByLabelText('Pixel editor keyboard area');
    expect(screen.getAllByText(/LED 5×7/).length).toBeGreaterThan(0);
    const pixelAt = (x: number, y: number) => {
      const g = useStore.getState().fonts.A!.glyphs.find((gg) => gg.id === glyph.id)!;
      return cellsOf(g).get(x, y);
    };

    // the cursor starts at the top-left cell (bitmap row 6 of 7; row 0 is the bottom)
    fireEvent.keyDown(area, { key: 't' });
    expect(pixelAt(0, 6)).toBe(1);
    fireEvent.keyDown(area, { key: 't' });
    expect(pixelAt(0, 6)).toBe(0);
    fireEvent.keyDown(area, { key: 't' });
    expect(pixelAt(0, 6)).toBe(1);

    // arrows move the cursor, Space paints there
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: ' ' });
    expect(pixelAt(1, 6)).toBe(1);

    // Shift+Space erases at the cursor even with the pencil
    fireEvent.keyDown(area, { key: ' ', shiftKey: true });
    expect(pixelAt(1, 6)).toBe(0);

    // one Ctrl+Z reverts exactly one edit (the erase), not two
    fireEvent.keyDown(area, { key: 'z', ctrlKey: true });
    expect(pixelAt(1, 6)).toBe(1);
    expect(pixelAt(0, 6)).toBe(1);
    fireEvent.keyDown(area, { key: 'z', ctrlKey: true });
    expect(pixelAt(1, 6)).toBe(0);
    expect(pixelAt(0, 6)).toBe(1);
  });
});

describe('moving a selection out of the grid window', () => {
  /** 8×8 font, one glyph with two corner pixels; renders the app and selects the glyph. */
  async function setupMoveTest() {
    const base = createNewFont({ familyName: 'MoveTest', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    const { doc, glyph } = drawGlyph(base, 65, (bm) => {
      bm.set(0, 0, 1);
      bm.set(7, 7, 1);
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', doc, 'move.pixeel');
      s.setActive('A');
      s.selectGlyph('A', glyph.id);
      s.setTool('A', 'select');
    });
    const area = await screen.findByLabelText('Pixel editor keyboard area');
    const cells = () => cellsOf(useStore.getState().fonts.A!.glyphs.find((g) => g.id === glyph.id)!);
    return { area, cells };
  }

  it('nudging a selection past the edge and placing it loses no pixels', async () => {
    const { area, cells } = await setupMoveTest();
    expect(cells().count()).toBe(2);

    // Ctrl+A: the whole grid becomes a floating selection (the grid itself is cleared)
    fireEvent.keyDown(area, { key: 'a', ctrlKey: true });
    expect(cells().count()).toBe(0);

    // arrows nudge the selection towards/past the right and top edges, Esc places it
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: 'ArrowUp' });
    fireEvent.keyDown(area, { key: 'Escape' });

    // nothing was cropped away: both corner pixels are back, whole
    expect(cells().count()).toBe(2);
    expect(cells().get(0, 0)).toBe(1);
    expect(cells().get(7, 7)).toBe(1);
  });

  it('dragging a selection far outside the window loses no pixels', async () => {
    const { area, cells } = await setupMoveTest();
    fireEvent.keyDown(area, { key: 'a', ctrlKey: true });
    expect(cells().count()).toBe(0);

    // jsdom has no layout/pointer capture: stub what cellAt and the drag need
    const canvas = screen.getByLabelText('Pixel grid, 8 columns by 8 rows') as HTMLCanvasElement;
    const rect = {
      left: 0, top: 0, x: 0, y: 0,
      width: canvas.width, height: canvas.height,
      right: canvas.width, bottom: canvas.height,
      toJSON: () => ({}),
    } as DOMRect;
    canvas.getBoundingClientRect = () => rect;
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};

    const RULER = 22;
    const zoom = 16;
    const at = (x: number, y: number) => ({ clientX: RULER + (x + 0.5) * zoom, clientY: RULER + (7 - y + 0.5) * zoom });

    // grab the selection at the bottom-left cell and drag it far past the edge
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...at(0, 0) });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 5000, clientY: 500 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5000, clientY: 500 });

    // place the selection: every pixel must survive
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(cells().count()).toBe(2);
    expect(cells().get(0, 0)).toBe(1);
    expect(cells().get(7, 7)).toBe(1);
  });
});
