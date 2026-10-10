// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LedMatrixDialog } from '../src/components/dialogs';
import { createNewFont } from '../src/core/fontFactory';
import { Bitmap } from '../src/core/bitmap';
import { asciiToBitmap } from '../src/core/ledMatrix';
import { setGlyphBitmap } from '../src/state/glyphActions';
import { useStore } from '../src/state/store';
import { drawGlyph } from './helpers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LED size selection', () => {
  it.each(['height', 'preset'])('halves strokes and baseline through the %s control', (control) => {
    // The drawing is tested directly; jsdom has no canvas renderer.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const spec = { rows: 16, cols: 12, spacing: 1, cellUnits: 100, descentRows: 4 };
    const base = createNewFont({ familyName: 'Resize', styleName: 'Regular', gridWidth: 12, gridHeight: 16, led: spec });
    const { doc, glyph } = drawGlyph(base, 65, () => {});
    const small = asciiToBitmap('.####.\n#....#\n#....#\n#....#\n#....#\n#....#\n#....#\n.####.').bitmap;
    useStore.getState().loadFont('A', setGlyphBitmap(doc, glyph.id, small.resized(12, 16, 'resample')), null);
    render(<LedMatrixDialog slot="A" />);
    if (control === 'height') {
      // Clearing the field while typing must not lose the original baseline ratio.
      fireEvent.change(screen.getByLabelText('LED rows'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('LED rows'), { target: { value: '8' } });
    } else {
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Apply preset' }));
      fireEvent.click(screen.getByRole('option', { name: '8×8 matrix' }));
    }
    expect((screen.getByLabelText('LED descent rows') as HTMLInputElement).value).toBe('2');
    expect(screen.getByText('Preview — sample letters on this matrix')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    const resized = useStore.getState().fonts.A!.glyphs.find((g) => g.id === glyph.id)!.pixel!;
    expect(resized.baselineRow).toBe(2);
    expect(Bitmap.fromB64(resized.width, resized.height, resized.cellsB64).equals(small)).toBe(true);
  });
});
