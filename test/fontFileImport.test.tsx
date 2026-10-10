// @vitest-environment jsdom
/** Opening fonts through the real UI paths: drop zone and file picker, for BDF and WOFF. */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { FONT_FILE_ACCEPT, FONT_FILE_RE } from '../src/core/fontFiles';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
beforeEach(() => useStore.setState({ fonts: { A: null, B: null }, toasts: [] } as never));
afterEach(() => cleanup());

const fixture = (name: string, type = 'application/octet-stream') => {
  const b = readFileSync(resolve(__dirname, 'fixtures', name));
  const bytes = new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const f = new File([bytes], name, { type });
  // jsdom's File may lack arrayBuffer()
  if (typeof f.arrayBuffer !== 'function') (f as any).arrayBuffer = async () => bytes.buffer.slice(0);
  return f;
};

function drop(files: File[]) {
  const ev = new Event('drop', { bubbles: true, cancelable: true }) as any;
  ev.dataTransfer = { files, types: ['Files'] };
  act(() => {
    window.dispatchEvent(ev);
  });
}

describe('font file types', () => {
  it('the picker and drop zone accept every supported format', () => {
    for (const ext of ['.ttf', '.otf', '.woff', '.woff2', '.bdf']) expect(FONT_FILE_ACCEPT).toContain(ext);
    for (const n of ['a.TTF', 'a.otf', 'a.woff', 'a.WOFF2', 'a.bdf']) expect(FONT_FILE_RE.test(n)).toBe(true);
    expect(FONT_FILE_RE.test('a.png')).toBe(false);
  });
});

describe('opening fonts in the app', () => {
  it('dropping a .bdf opens it as an editable pixel font', async () => {
    render(<App />);
    drop([fixture('spleen-8x16.bdf', 'text/plain')]);
    await waitFor(() => expect(useStore.getState().fonts.A).toBeTruthy(), { timeout: 15000 });
    const doc = useStore.getState().fonts.A!;
    expect(doc.source?.format).toBe('bdf');
    expect(doc.glyphs.length).toBe(1002);
    expect(doc.glyphs.find((g) => g.unicode === 0x41)?.pixel?.height).toBe(16);
    expect(doc.sourceRef).toBeNull();
    expect(useStore.getState().toasts.some((t) => /8×16 px cells \(monospaced\)/.test(t.text))).toBe(true);
    expect(useStore.getState().active).toBe('A');
  });

  it('choosing a .woff in the file picker opens it and says it exports as .ttf', async () => {
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('.woff2');
    expect(input.accept).toContain('.bdf');
    fireEvent.change(input, { target: { files: [fixture('Lato-Regular.woff', 'font/woff')] } });
    await waitFor(() => expect(useStore.getState().fonts.A).toBeTruthy(), { timeout: 30000 });
    const doc = useStore.getState().fonts.A!;
    expect(doc.source?.container).toBe('woff');
    expect(doc.meta.fontFamily).toBe('Lato');
    expect(doc.sourceRef).toBeTruthy(); // the original is kept so hinting/kerning survive export
    expect(useStore.getState().toasts.some((t) => /plain \.ttf/.test(t.text))).toBe(true);
  });

  it('a broken .woff gives a readable error and leaves the workspace empty', async () => {
    render(<App />);
    const bad = fixture('Lato-Regular.woff', 'font/woff');
    const half = new File([await bad.arrayBuffer().then((b) => b.slice(0, 4000))], 'broken.woff');
    if (typeof half.arrayBuffer !== 'function') {
      const part = (await bad.arrayBuffer()).slice(0, 4000);
      (half as any).arrayBuffer = async () => part;
    }
    drop([half]);
    await waitFor(() => expect(useStore.getState().toasts.some((t) => t.kind === 'error' && /Import failed: .*truncated/.test(t.text))).toBe(true), { timeout: 15000 });
    expect(useStore.getState().fonts.A).toBeNull();
  });

  it('a non-font file is ignored with a hint listing the supported types', async () => {
    render(<App />);
    drop([new File(['x'], 'notes.txt')]);
    await waitFor(() => expect(useStore.getState().toasts.some((t) => /\.woff2/.test(t.text) && /\.bdf/.test(t.text))).toBe(true));
    expect(useStore.getState().fonts.A).toBeNull();
  });
});
