// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createNewFont, makePixelGlyph } from '../src/core/fontFactory';
import { Bitmap } from '../src/core/bitmap';
import { GlyphDesignerDialog } from '../src/components/GlyphDesigner';
import { useStore } from '../src/state/store';

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => {
    useStore.getState().loadFont('A', null, null);
    useStore.getState().closeModal();
  });
});

describe('glyph designer dialog', () => {
  it('previews a Georgian template and places it into the selected pixel glyph as one edit', async () => {
    const base = createNewFont({ familyName: 'DesignerTest', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    const template = base.glyphs.find((glyph) => glyph.pixel)!.pixel!;
    const glyph = makePixelGlyph(0x10d0, template.width, template.height, {
      unitsPerCell: template.unitsPerCell,
      baselineRow: template.baselineRow,
      defaultAdvance: template.width * template.unitsPerCell,
    });
    const doc = { ...base, glyphs: [...base.glyphs, glyph] };
    act(() => useStore.getState().loadFont('A', doc, 'designer.pixeel'));

    const getImageData = (width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      // Deterministic synthetic ink for the test; the real browser canvas
      // supplies antialiased pixels from the selected local reference font.
      for (let y = 2; y < Math.min(height - 2, 25); y++) {
        for (let x = 12; x < 20; x++) data[(y * width + x) * 4 + 3] = 255;
      }
      return { data };
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: () => {},
      fillText: () => {},
      measureText: () => ({
        width: 500,
        actualBoundingBoxLeft: 250,
        actualBoundingBoxRight: 250,
        actualBoundingBoxAscent: 700,
        actualBoundingBoxDescent: 0,
      }),
      getImageData: (_x: number, _y: number, width: number, height: number) => getImageData(width, height),
      fillStyle: '',
      font: '',
      textAlign: 'center',
      textBaseline: 'alphabetic',
    }) as unknown as CanvasRenderingContext2D);

    render(<GlyphDesignerDialog slot="A" glyphId={glyph.id} />);
    const preview = await screen.findByRole('img', { name: 'Generated pixel glyph preview' });
    expect(preview).toBeTruthy();
    expect(screen.getByText(/GEORGIAN LETTER AN/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Place in pixel window' }));
    await waitFor(() => {
      const updated = useStore.getState().fonts.A!.glyphs.find((item) => item.id === glyph.id)!;
      expect(Bitmap.fromB64(updated.pixel!.width, updated.pixel!.height, updated.pixel!.cellsB64).count()).toBeGreaterThan(0);
      expect(useStore.getState().past.A[useStore.getState().past.A.length - 1]?.label).toBe('Apply glyph design');
    });
  });
});
