// @vitest-environment jsdom
/** The Unicode mappings dialog: add, conflict + reassign, primary, remove, undo, browser badge/filter. */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { allUnicodes } from '../src/core/unicodeMap';
import { parseSearch } from '../src/components/GlyphBrowser';
import { addUnicodeMapping } from '../src/state/glyphActions';
import { drawGlyph, newTestFont } from './helpers';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => cleanup());

async function open(prepare = (d: ReturnType<typeof newTestFont>) => d) {
  let doc = newTestFont(8, 8, 'UD');
  for (const ch of 'AB') doc = drawGlyph(doc, ch.codePointAt(0)!, (bm) => bm.set(1, 1, 1)).doc;
  doc = prepare(doc);
  const id = (ch: string) => doc.glyphs.find((g) => g.unicode === ch.codePointAt(0))!.id;
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'u.pixeel');
    s.setActive('A');
    s.selectGlyph('A', id('A'));
    s.openModal({ type: 'unicodeMappings', slot: 'A', glyphId: id('A') });
  });
  const dialog = await screen.findByRole('dialog');
  const g = (ch: string) => useStore.getState().fonts.A!.glyphs.find((x) => x.id === id(ch))!;
  return { dialog, id, g };
}
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe('unicode mappings dialog', () => {
  it('lists the primary mapping and adds another one (one undo step)', async () => {
    const { dialog, g } = await open();
    expect(within(dialog).getByText('primary')).toBeTruthy();
    const past = useStore.getState().past.A.length;
    type(within(dialog).getByLabelText('Code point to add'), 'U+FF21');
    expect(within(dialog).getByText(/is free/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add mapping' }));
    expect(allUnicodes(g('A'))).toEqual([0x41, 0xff21]);
    expect(useStore.getState().past.A.length).toBe(past + 1);
    expect(within(dialog).getByRole('list', { name: 'Mapped code points' }).querySelectorAll('li').length).toBe(2);
    act(() => useStore.getState().undo('A'));
    expect(allUnicodes(g('A'))).toEqual([0x41]);
  });

  it('accepts a literal character and decimal input', async () => {
    const { dialog, g } = await open();
    type(within(dialog).getByLabelText('Code point to add'), 'Ａ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add mapping' }));
    type(within(dialog).getByLabelText('Code point to add'), '192');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add mapping' }));
    expect(allUnicodes(g('A'))).toEqual([0x41, 0xff21, 0xc0]);
  });

  it('detects a conflict, blocks the plain add and offers reassignment', async () => {
    const { dialog, g, id } = await open();
    type(within(dialog).getByLabelText('Code point to add'), 'B');
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toMatch(/U\+0042 is already mapped to/);
    expect((within(dialog).getByRole('button', { name: 'Add mapping' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(alert).getByRole('button', { name: 'Reassign here' }));
    expect(allUnicodes(g('A'))).toEqual([0x41, 0x42]);
    expect(useStore.getState().fonts.A!.glyphs.find((x) => x.name === useStore.getState().fonts.A!.glyphs.find((y) => y.id === id('B') || false)?.name)).toBeTruthy();
    act(() => useStore.getState().undo('A'));
    expect(allUnicodes(g('A'))).toEqual([0x41]);
    expect(useStore.getState().fonts.A!.glyphs.some((x) => x.unicode === 0x42)).toBe(true);
  });

  it('reports invalid and duplicate input', async () => {
    const { dialog } = await open();
    type(within(dialog).getByLabelText('Code point to add'), 'zzzz!');
    expect(within(dialog).getByText(/Not a single character or code point/)).toBeTruthy();
    type(within(dialog).getByLabelText('Code point to add'), 'A');
    expect(within(dialog).getByText(/already mapped to this glyph/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Add mapping' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('makes an extra mapping primary and removes mappings', async () => {
    const { dialog, g } = await open((d) => addUnicodeMapping(d, d.glyphs.find((x) => x.unicode === 0x41)!.id, 0xff21));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make U+FF21 primary' }));
    expect(g('A')).toMatchObject({ unicode: 0xff21, extraUnicodes: [0x41] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove U+FF21' }));
    expect(g('A')).toMatchObject({ unicode: 0x41 });
    expect(g('A').extraUnicodes).toBeUndefined();
  });
});

describe('glyph browser with several code points', () => {
  it('search matches every mapped code point', async () => {
    let doc = newTestFont(8, 8, 'UD');
    doc = drawGlyph(doc, 0x41, (bm) => bm.set(1, 1, 1)).doc;
    doc = addUnicodeMapping(doc, doc.glyphs.find((x) => x.unicode === 0x41)!.id, 0x10d0);
    const match = parseSearch('ა');
    expect(doc.glyphs.filter(match).map((g) => g.unicode)).toEqual([0x41]);
    expect(doc.glyphs.filter(parseSearch('U+10D0')).length).toBe(1);
    expect(doc.glyphs.filter(parseSearch('georgian letter an')).length).toBe(1);
  });

  it('shows a +N badge and the Multi filter', async () => {
    const { dialog } = await open((d) => addUnicodeMapping(d, d.glyphs.find((x) => x.unicode === 0x41)!.id, 0xff21));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await act(async () => {});
    const list = await screen.findByRole('list');
    expect(within(list).getAllByTitle(/1 more code point mapped/).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Multi' }));
    const cards = within(await screen.findByRole('list')).getAllByRole('listitem');
    expect(cards.length).toBe(1);
  });
});
