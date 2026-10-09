// @vitest-environment jsdom
/**
 * Pixel editor keyboard model: cursor movement, Space/T/Shift+Space,
 * a single undo per Ctrl+Z, and the LED matrix chip.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
