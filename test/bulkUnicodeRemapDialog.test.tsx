// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { newTestFont, drawGlyph } from './helpers';
import { DEFAULT_LARGE_DIGIT_POINTS } from '../src/core/charSets';
import { allUnicodes } from '../src/core/unicodeMap';
import { remapGlyphs } from '../src/core/unicodeRemap';
import type { FontDoc } from '../src/core/types';

afterEach(() => cleanup());
beforeEach(() => {
  useStore.setState({
    fonts: { A: null, B: null },
    toasts: [],
    modal: { type: 'none' },
    past: { A: [], B: [] },
    future: { A: [], B: [] },
  } as never);
});

function withDigits(): FontDoc {
  let doc = newTestFont(8, 8, 'Bulk remap');
  for (let i = 0; i < 10; i++) {
    doc = drawGlyph(doc, 0x30 + i, (bitmap) => bitmap.set(i % 8, 2, 1)).doc;
    doc = drawGlyph(doc, DEFAULT_LARGE_DIGIT_POINTS[i], (bitmap) => bitmap.set(i % 8, 3, 1)).doc;
  }
  return doc;
}

async function mountRemap(doc: FontDoc, glyphIds: string[], targetPreset: 'georgian' | 'digits', initialMode: 'move' | 'alias' = 'move') {
  await act(async () => { render(<App />); });
  await act(async () => {
    const store = useStore.getState();
    store.loadFont('A', doc, 'remap.pixeel');
    store.openModal({ type: 'unicodeRemap', slot: 'A', glyphIds, targetPreset, initialMode });
  });
  return screen.findByRole('dialog');
}

describe('bulk Unicode remapping dialog', () => {
  it('opens from the glyph-browser multi-selection bar', async () => {
    let doc = newTestFont(8, 8, 'Browser remap');
    doc = drawGlyph(doc, 0x41, (bitmap) => bitmap.set(1, 1, 1)).doc;
    doc = drawGlyph(doc, 0x42, (bitmap) => bitmap.set(2, 2, 1)).doc;
    await act(async () => { render(<App />); });
    await act(async () => useStore.getState().loadFont('A', doc, 'browser-remap.pixeel'));

    fireEvent.click(await screen.findByRole('listitem', { name: /LATIN CAPITAL LETTER A/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('listitem', { name: /LATIN CAPITAL LETTER B/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Move to set…' }));

    expect(await screen.findByRole('dialog', { name: /Move 2 selected glyphs to another character set/ })).toBeTruthy();
  });

  it('remaps selected glyphs to Georgian in one undoable edit without changing their artwork', async () => {
    let doc = newTestFont(8, 8, 'Georgian remap');
    doc = drawGlyph(doc, 0x41, (bitmap) => bitmap.set(1, 1, 1)).doc;
    doc = drawGlyph(doc, 0x42, (bitmap) => bitmap.set(2, 2, 1)).doc;
    const selected = [doc.glyphs.find((g) => g.unicode === 0x41)!, doc.glyphs.find((g) => g.unicode === 0x42)!];
    const dialog = await mountRemap(doc, selected.map((g) => g.id), 'georgian');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move mappings' }));

    const after = useStore.getState().fonts.A!;
    expect(after.glyphs.find((g) => g.id === selected[0].id)!.unicode).toBe(0x10d0);
    expect(after.glyphs.find((g) => g.id === selected[1].id)!.unicode).toBe(0x10d1);
    expect(after.glyphs.find((g) => g.id === selected[0].id)!.pixel!.cellsB64).toBe(selected[0].pixel!.cellsB64);
    expect(after.glyphs.find((g) => g.id === selected[1].id)!.advanceWidth).toBe(selected[1].advanceWidth);
    expect(useStore.getState().past.A).toHaveLength(1);
    expect(useStore.getState().ui.A.multiSelected).toEqual([]);

    act(() => useStore.getState().undo('A'));
    expect(useStore.getState().fonts.A!.glyphs.find((g) => g.id === selected[0].id)!.unicode).toBe(0x41);
  });

  it('requires an explicit take-and-confirm when ASCII digits already belong to other glyphs, and can keep PUA aliases', async () => {
    const doc = withDigits();
    const large = DEFAULT_LARGE_DIGIT_POINTS.map((cp) => doc.glyphs.find((g) => g.unicode === cp)!);
    const standard = Array.from({ length: 10 }, (_, i) => doc.glyphs.find((g) => g.unicode === 0x30 + i)!);
    const dialog = await mountRemap(doc, large.map((g) => g.id), 'digits', 'alias');

    expect(within(dialog).getByText(/Code points already in use \(10\)/)).toBeTruthy();
    const apply = within(dialog).getByRole('button', { name: 'Add mappings' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Take these code points from their current glyphs/ }));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);

    const confirmation = await screen.findByRole('dialog', { name: 'Take 10 existing Unicode mappings?' });
    expect(within(confirmation).getByText(/The old glyphs and their artwork will stay/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(confirmation).getByRole('button', { name: 'Take mappings' })); });

    const after = useStore.getState().fonts.A!;
    large.forEach((g, i) => {
      expect(allUnicodes(after.glyphs.find((x) => x.id === g.id)!)).toEqual([DEFAULT_LARGE_DIGIT_POINTS[i], 0x30 + i]);
    });
    standard.forEach((g) => {
      expect(allUnicodes(after.glyphs.find((x) => x.id === g.id)!)).toEqual([]);
      expect(after.glyphs.find((x) => x.id === g.id)!.pixel!.cellsB64).toBe(g.pixel!.cellsB64);
    });
    expect(useStore.getState().past.A).toHaveLength(1);
  });

  it('offers a direct MAX7219 action that opens the alias remap for the ten large digits', async () => {
    const doc = withDigits();
    await act(async () => { render(<App />); });
    await act(async () => {
      const store = useStore.getState();
      store.loadFont('A', doc, 'remap.pixeel');
      store.openModal({ type: 'export', slot: 'A' });
    });
    const exportDialog = await screen.findByRole('dialog');
    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Use large digits for time…' }));

    const remapDialog = await screen.findByRole('dialog', { name: /Map 10 selected glyphs to another character set/ });
    expect(within(remapDialog).getByRole('combobox', { name: 'Character set' }).textContent).toMatch(/ASCII digits/);
    expect(within(remapDialog).getByRole('radio', { name: /Add as an alias/ })).toBeTruthy();
    expect(within(remapDialog).getByText(/ASCII digits \(0–9\)/)).toBeTruthy();
  });

  it('shows the MAX7219 shortcut as ready when large digits already have ASCII mappings', async () => {
    const doc = withDigits();
    const large = DEFAULT_LARGE_DIGIT_POINTS.map((cp) => doc.glyphs.find((g) => g.unicode === cp)!);
    const mapped = remapGlyphs(doc, large.map((g) => g.id), Array.from({ length: 10 }, (_, i) => 0x30 + i), {
      mode: 'alias',
      takeExistingMappings: true,
    });
    await act(async () => { render(<App />); });
    await act(async () => {
      const store = useStore.getState();
      store.loadFont('A', mapped, 'remap.pixeel');
      store.openModal({ type: 'export', slot: 'A' });
    });

    const button = await screen.findByRole('button', { name: 'Large digits ready ✓' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
