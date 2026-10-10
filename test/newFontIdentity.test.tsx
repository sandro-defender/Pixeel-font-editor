// @vitest-environment jsdom
/**
 * Creating a new font through the dialog fills in author, version and license
 * automatically, and the derived name fields follow the family/style instead of
 * keeping the "Untitled" placeholders.
 */
import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { createNewFont } from '../src/core/fontFactory';
import { buildTtf } from '../src/core/fontCodec';
import { parseTtf } from './helpers';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  act(() => {
    useStore.getState().loadFont('A', null, null);
    useStore.getState().loadFont('B', null, null);
    useStore.getState().closeModal();
  });
});

/** Type into a MUI TextField by its label. */
function type(label: RegExp | string, value: string) {
  const field = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(field, { target: { value } });
}

describe('new font: derived names, version, author and license', () => {
  it('derives full/PostScript/unique names from the family and style', () => {
    const doc = createNewFont({ familyName: 'My Pixel Font', styleName: 'Bold', gridWidth: 16, gridHeight: 16 });
    expect(doc.meta.fullName).toBe('My Pixel Font Bold');
    expect(doc.meta.postScriptName).toBe('MyPixelFont-Bold');
    expect(doc.meta.uniqueSubFamily).toBe('Pixeel: My Pixel Font Bold');
    // no leftover placeholder from the blank template
    expect(doc.meta.fullName).not.toMatch(/Untitled/);
    expect(doc.meta.postScriptName).not.toMatch(/Untitled/);
  });

  it('carries the version and PostScript name into the exported name table', () => {
    let doc = createNewFont({ familyName: 'Versioned', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    doc = { ...doc, meta: { ...doc.meta, version: 'Version 3.200', designer: 'Ada Lovelace' } };
    const { buffer } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: false } });
    const names = parseTtf(buffer).name;
    expect(names.version).toBe('Version 3.200');
    expect(names.designer).toBe('Ada Lovelace');
    expect(names.postScriptName).toBe('Versioned-Regular');
  });

  it('creates a font with author, version and an OFL license from the dialog', async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      useStore.getState().openModal({ type: 'newFont' });
    });

    type(/Family name/i, 'Dialog Font');
    type(/Style \/ subfamily/i, 'Medium');
    type(/Author \/ designer/i, 'Grace Hopper');
    type(/^Version$/, '2.000');

    // SIL OFL 1.1 is the default choice, so no click is needed
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create font/i }));
    });

    const doc = useStore.getState().fonts.A!;
    expect(doc.meta.fontFamily).toBe('Dialog Font');
    expect(doc.meta.designer).toBe('Grace Hopper');
    expect(doc.meta.version).toBe('Version 2.000');
    expect(doc.meta.copyright).toContain('Grace Hopper');
    const year = String(new Date().getFullYear());
    expect(doc.meta.copyright).toContain(year);

    // the full OFL text was generated and is embedded, ready for export
    expect(doc.meta.licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(doc.meta.licence).toContain(`Copyright (c) ${year}, Grace Hopper`);
    expect(doc.meta.licence).toContain('with Reserved Font Name Dialog Font.');
    expect(doc.meta.urlOfLicence).toBe('https://openfontlicense.org');
    expect(doc.meta.postScriptName).toBe('DialogFont-Medium');
  });

  it('can create a font without a license (None / custom)', async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      useStore.getState().openModal({ type: 'newFont' });
    });

    type(/Family name/i, 'Unlicensed');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /None \/ custom/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create font/i }));
    });

    const doc = useStore.getState().fonts.A!;
    expect(doc.meta.fontFamily).toBe('Unlicensed');
    expect(doc.meta.licence).toBe('');
    expect(doc.meta.designer).toBe('');
    // version falls back to the standard default
    expect(doc.meta.version).toBe('Version 1.000');
  });

  it('shows the app version and the selected font name in the UI', async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', createNewFont({ familyName: 'Status Font', styleName: 'Italic', gridWidth: 8, gridHeight: 8 }), 'status.ttf');
    });

    // the footer names the active font, its version and the app version
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('Status Font');
    expect(footer.textContent).toContain('Italic');
    expect(footer.textContent).toMatch(/Pixeel v\d+\.\d+\.\d+/);
    // and the header carries the same version next to the brand
    expect(document.body.textContent).toMatch(/Pixeel\s*v\d+\.\d+\.\d+/);
  });
});
