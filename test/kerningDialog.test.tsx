// @vitest-environment jsdom
/** The kerning editor dialog: add, search, edit, delete, undo. */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { getKerning } from '../src/core/kerning';
import { drawGlyph, newTestFont } from './helpers';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => cleanup());

async function open() {
  let doc = newTestFont(8, 8, 'KD');
  for (const ch of 'AVTo') doc = drawGlyph(doc, ch.codePointAt(0)!, (bm) => bm.set(1, 1, 1)).doc;
  const id = (ch: string) => doc.glyphs.find((g) => g.unicode === ch.codePointAt(0))!.id;
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'k.pixeel');
    s.setActive('A');
    s.openModal({ type: 'kerning', slot: 'A' });
  });
  const dialog = await screen.findByRole('dialog');
  const kern = (l: string, r: string) => getKerning(useStore.getState().fonts.A!, id(l), id(r));
  return { dialog, id, kern };
}

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe('kerning dialog', () => {
  it('adds a pair from two characters, one undo step', async () => {
    const { dialog, kern } = await open();
    expect(within(dialog).getByText(/No kerning pairs yet/)).toBeTruthy();
    const past = useStore.getState().past.A.length;
    type(within(dialog).getByLabelText('Left glyph'), 'A');
    type(within(dialog).getByLabelText('Right glyph'), 'V');
    type(within(dialog).getByLabelText('New pair value'), '-80');
    fireEvent.click(within(dialog).getByRole('button', { name: /Add pair/ }));
    expect(kern('A', 'V')).toBe(-80);
    expect(useStore.getState().past.A.length).toBe(past + 1);
    expect(within(dialog).getByLabelText('Kerning value')).toHaveProperty('value', '-80');
    act(() => useStore.getState().undo('A'));
    expect(kern('A', 'V')).toBe(0);
  });

  it('accepts code points and a single "AV" entry, and rejects unknown glyphs', async () => {
    const { dialog, kern } = await open();
    type(within(dialog).getByLabelText('Left glyph'), 'U+0054');
    type(within(dialog).getByLabelText('Right glyph'), '111'); // decimal 'o'
    type(within(dialog).getByLabelText('New pair value'), '-30');
    fireEvent.click(within(dialog).getByRole('button', { name: /Add pair/ }));
    expect(kern('T', 'o')).toBe(-30);

    type(within(dialog).getByLabelText('Left glyph'), 'AV');
    type(within(dialog).getByLabelText('Right glyph'), '');
    fireEvent.click(within(dialog).getByRole('button', { name: /Add pair/ }));
    expect(kern('A', 'V')).toBe(-30); // the value field keeps its last value

    type(within(dialog).getByLabelText('Left glyph'), 'Q');
    type(within(dialog).getByLabelText('Right glyph'), 'V');
    fireEvent.click(within(dialog).getByRole('button', { name: /Add pair/ }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/No glyph for “Q”/);
  });

  it('searches, edits through the number field and deletes', async () => {
    const { dialog, kern } = await open();
    for (const [l, r, v] of [['A', 'V', '-80'], ['T', 'o', '-60'], ['o', 'T', '-5']]) {
      type(within(dialog).getByLabelText('Left glyph'), l);
      type(within(dialog).getByLabelText('Right glyph'), r);
      type(within(dialog).getByLabelText('New pair value'), v);
      fireEvent.click(within(dialog).getByRole('button', { name: /Add pair/ }));
    }
    const items = () => within(dialog).getAllByRole('button', { name: /^Pair / }).map((b) => b.getAttribute('aria-label'));
    expect(items()).toEqual(['Pair A V, -80', 'Pair T o, -60', 'Pair o T, -5']); // frequency order

    type(within(dialog).getByLabelText('Search kerning pairs'), 'To');
    expect(items()).toEqual(['Pair T o, -60']);
    type(within(dialog).getByLabelText('Search kerning pairs'), '');

    // edit
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pair T o, -60' }));
    const num = within(dialog).getByLabelText('Kerning value');
    const past = useStore.getState().past.A.length;
    type(num, '-90');
    expect(kern('T', 'o')).toBe(-60); // not committed while typing
    fireEvent.keyDown(num, { key: 'Enter' });
    expect(kern('T', 'o')).toBe(-90);
    expect(useStore.getState().past.A.length).toBe(past + 1);

    // delete via the list
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete pair AV' }));
    expect(kern('A', 'V')).toBe(0);
    expect(items()).toEqual(['Pair T o, -90', 'Pair o T, -5']);
    act(() => useStore.getState().undo('A'));
    expect(kern('A', 'V')).toBe(-80);
  });

  it('shows the pair in the live preview', async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole('img', { name: 'Kerning preview' })).toBeTruthy();
  });
});
