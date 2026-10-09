// @vitest-environment jsdom
/**
 * UI smoke test: renders the full app, creates a font, draws a glyph through
 * the store, opens dialogs, and exports via the (main-thread fallback) engine.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { createNewFont } from '../src/core/fontFactory';
import { drawGlyph } from './helpers';
import { exportFont } from '../src/services/exportService';

beforeAll(() => {
  // jsdom lacks createObjectURL and FontFace APIs
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});

describe('App smoke test', () => {
  it('renders, creates a font, edits a glyph, and exports a valid TTF', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText(/Pixeel — pixel & TTF font editor/)).toBeTruthy();

    // create a font in workspace A
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', createNewFont({ familyName: 'Smoke', styleName: 'Regular', gridWidth: 8, gridHeight: 8 }), 'smoke.pixeel');
      s.setActive('A');
    });

    await waitFor(() => {
      expect(screen.getByText(/Font info|Glyph metrics/i)).toBeTruthy();
    });

    // draw a glyph through the same pipeline the editor uses
    await act(async () => {
      const s = useStore.getState();
      const doc = s.fonts.A!;
      const { doc: drawn } = drawGlyph(doc, 83, (bm) => bm.rect(1, 1, 5, 5, 1, true)); // 'S'
      s.commit('A', 'draw', () => drawn);
      const glyph = drawn.glyphs.find((g) => g.unicode === 83)!;
      s.selectGlyph('A', glyph.id);
    });

    // glyph card appears in the browser
    await waitFor(() => {
      expect(screen.getAllByTitle(/U\+0053/).length).toBeGreaterThan(0);
    });

    // export through the service (worker unavailable in jsdom → main thread)
    const doc = useStore.getState().fonts.A!;
    const { buffer, report } = await exportFont(doc, { preserveHinting: true, preserveKerning: true, validate: true });
    expect(report.validation?.ok).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(500);

    // undo removes the drawn glyph
    await act(async () => {
      useStore.getState().undo('A');
    });
    expect(useStore.getState().fonts.A!.glyphs.find((g) => g.unicode === 83)).toBeUndefined();
    await act(async () => {
      useStore.getState().redo('A');
    });
    expect(useStore.getState().fonts.A!.glyphs.find((g) => g.unicode === 83)).toBeTruthy();
  });

  it('opens the new-font and help dialogs without crashing', async () => {
    await act(async () => {
      useStore.getState().openModal({ type: 'newFont' });
    });
    expect(screen.getByText(/Create a new pixel font/)).toBeTruthy();
    await act(async () => {
      useStore.getState().closeModal();
      useStore.getState().openModal({ type: 'help' });
    });
    expect(screen.getByText(/Pixeel help/)).toBeTruthy();
    await act(async () => {
      useStore.getState().closeModal();
    });
  });
});
