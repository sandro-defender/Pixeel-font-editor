// @vitest-environment jsdom
/**
 * The "Convert to pixel grid" dialog: it must detect a real pixel font, fall
 * back to a shared downsample grid otherwise, and put the whole font on one
 * lattice (same cell size, same baseline phase).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RasterizeDialog } from '../src/components/dialogs';
import { createNewFont } from '../src/core/fontFactory';
import { tracePixelData } from '../src/core/trace';
import { Bitmap } from '../src/core/bitmap';
import { asciiToBitmap } from '../src/core/ledMatrix';
import { useStore } from '../src/state/store';
import { drawGlyph } from './helpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importFont } from '../src/core/fontCodec';
import type { FontDoc } from '../src/core/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A pixel font turned back into outlines — i.e. what an import looks like. */
function importedPixelFont(): FontDoc {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const base = createNewFont({ familyName: 'Detected', styleName: 'Regular', gridWidth: 8, gridHeight: 16 });
  const art = asciiToBitmap([
    '..####..',
    '.#....#.',
    '#......#',
    '#......#',
    '########',
    '#......#',
    '#......#',
    '#......#',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ].join('\n')).bitmap;
  const { doc } = drawGlyph(base, 65, (bm) => bm.paste(art, 0, 0));
  return {
    ...doc,
    glyphs: doc.glyphs.map((g) =>
      g.pixel
        ? { ...g, kind: 'vector' as const, contours: tracePixelData(g.pixel), pixel: null, sourceContours: null }
        : g,
    ),
  };
}

async function latoDoc(): Promise<FontDoc> {
  const path = resolve(__dirname, 'fixtures/Lato-Regular.ttf');
  return (await importFont(new Uint8Array(readFileSync(path)).buffer as ArrayBuffer, 'Lato-Regular.ttf')).doc;
}

describe('Convert to pixel grid dialog', () => {
  it('detects the native lattice of an imported pixel font and converts it losslessly', () => {
    const doc = importedPixelFont();
    useStore.getState().loadFont('A', doc, 'detected.ttf');
    render(<RasterizeDialog slot="A" scope="font" />);

    expect(screen.getByText(/Pixel font detected/)).toBeTruthy();
    expect(screen.getByText(/Detected size \(16 rows\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Convert \d+ glyphs?/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Convert \d+ glyphs?/ }));
    const out = useStore.getState().fonts.A!;
    const a = out.glyphs.find((g) => g.unicode === 65)!;
    expect(a.kind).toBe('pixel');
    expect(a.pixel!.height).toBe(16);
    expect(a.pixel!.baselineRow).toBe(3);
    const bm = Bitmap.fromB64(a.pixel!.width, a.pixel!.height, a.pixel!.cellsB64);
    const ink = bm.extract(0, 8, 8, 8);
    expect(ink.equals(artBitmap())).toBe(true);
  });

  it('puts an outline font on one shared grid and reports it as a downsample', async () => {
    const doc = await latoDoc();
    useStore.getState().loadFont('A', doc, 'Lato-Regular.ttf');
    render(<RasterizeDialog slot="A" scope="font" />);

    expect(screen.getByText(/not drawn on a pixel lattice/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Convert \d+ glyphs/ }));

    const out = useStore.getState().fonts.A!;
    const pixels = out.glyphs.filter((g) => g.pixel);
    expect(pixels.length).toBeGreaterThan(200);
    const sizes = new Set(pixels.map((g) => g.pixel!.unitsPerCell));
    const phases = new Set(pixels.map((g) => Math.round((((g.pixel!.baselineRow % 1) + 1) % 1) * 1000)));
    expect(sizes.size).toBe(1);
    expect(phases.size).toBe(1);
    // advances are whole pixels
    const u = pixels[0].pixel!.unitsPerCell;
    expect(pixels.every((g) => Math.abs(g.advanceWidth % u) < 1e-6)).toBe(true);
    // the preview glyph really has ink
    const a = out.glyphs.find((g) => g.unicode === 65)!;
    expect(Bitmap.fromB64(a.pixel!.width, a.pixel!.height, a.pixel!.cellsB64).count()).toBeGreaterThan(5);
  });

  it('converts a single glyph only when asked to', async () => {
    const doc = await latoDoc();
    useStore.getState().loadFont('A', doc, 'Lato-Regular.ttf');
    const target = doc.glyphs.find((g) => g.unicode === 65)!;
    render(<RasterizeDialog slot="A" glyphId={target.id} />);

    fireEvent.click(screen.getByRole('button', { name: /Create editable pixel grid/ }));
    const out = useStore.getState().fonts.A!;
    expect(out.glyphs.filter((g) => g.kind === 'pixel')).toHaveLength(1);
    expect(out.glyphs.find((g) => g.id === target.id)!.kind).toBe('pixel');
  });
});

function artBitmap(): Bitmap {
  return asciiToBitmap([
    '..####..',
    '.#....#.',
    '#......#',
    '#......#',
    '########',
    '#......#',
    '#......#',
    '#......#',
  ].join('\n')).bitmap;
}
