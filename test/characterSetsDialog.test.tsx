// @vitest-environment jsdom
/**
 * Acceptance criteria 2, 3, 5, 7 and 10 through the real UI: the Character
 * coverage dialog adds missing sets in one undoable step, never touches glyphs
 * that already exist, marks what it added as added, and drives the report from
 * artwork rather than from mappings.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { importAnyFont } from '../src/core/importAny';
import type { FontDoc } from '../src/core/types';
import { GEORGIAN_MKHEDRULI_POINTS, glyphHasArtwork } from '../src/core/charSets';
import { analyzeCoverage } from '../src/core/coverage';
import { allUnicodes } from '../src/core/unicodeMap';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
beforeEach(() => {
  // the store is a module-level singleton: reset it so tests cannot leak into each other
  useStore.setState({
    fonts: { A: null, B: null },
    toasts: [],
    modal: { type: 'none' },
    past: { A: [], B: [] },
    future: { A: [], B: [] },
  } as never);
});
afterEach(() => cleanup());

/** Lato (imported once, cloned per test — a fresh parse per test would dominate the runtime). */
let latoCache: Promise<FontDoc> | null = null;
function latoDoc(): Promise<FontDoc> {
  latoCache ??= importAnyFont(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'))).buffer,
    'Lato-Regular.ttf',
  ).then((r) => r.doc);
  return latoCache.then((doc) => structuredClone(doc));
}

async function openDialog() {
  const doc = await latoDoc();
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'Lato-Regular.ttf');
    s.setActive('A');
    s.openModal({ type: 'characterSets', slot: 'A' });
  });
  const dialog = await screen.findByRole('dialog');
  const coverageTable = within(dialog).getByRole('table', { name: 'Character coverage' });
  /**
   * The coverage row of a set as {present, missing, blank}. Cell 0 holds the
   * label + range, so the numbers start at cell 1.
   */
  const rowOf = (label: string) => {
    const cells = Array.from(within(coverageTable).getByText(label).closest('tr')!.querySelectorAll('td')).map(
      (td) => td.textContent ?? '',
    );
    return { present: cells[1], missing: cells[2], blank: cells[3], cells };
  };
  const button = (name: string | RegExp) => within(dialog).getByRole('button', { name }) as HTMLButtonElement;
  const check = (name: string) => within(dialog).getByRole('checkbox', { name }) as HTMLInputElement;
  return { dialog, coverageTable, rowOf, button, check };
}

describe('Character coverage dialog', () => {
  it('reports what a real imported font is missing and adds it in ONE undo step', async () => {
    const { rowOf, check, button } = await openDialog();
    const before = useStore.getState().fonts.A!;
    const pastBefore = useStore.getState().past.A.length;

    // the report is visible and honest: Lato has no Georgian letters at all
    expect(rowOf('Georgian Mkhedruli')).toMatchObject({ present: '0/33', missing: '33', blank: '0' });
    expect(rowOf('English uppercase')).toMatchObject({ present: '26/26', missing: '0', blank: '0' });
    expect(rowOf('Double-size alternative digits')).toMatchObject({ present: '0/10', missing: '10', blank: '0' });

    // the per-set action adds exactly that set
    fireEvent.click(button('Add 33'));
    const after = useStore.getState().fonts.A!;
    expect(after.glyphs.length).toBe(before.glyphs.length + 33);
    expect(useStore.getState().past.A.length).toBe(pastBefore + 1); // exactly one undo step
    expect(useStore.getState().dirty.A).toBe(true);

    // every original glyph object survived untouched, and the new ones are marked
    const byId = new Map(after.glyphs.map((g) => [g.id, g]));
    for (const g of before.glyphs) expect(byId.get(g.id)).toBe(g);
    for (const cp of GEORGIAN_MKHEDRULI_POINTS) {
      const g = after.glyphs.find((x) => allUnicodes(x).includes(cp))!;
      expect(g.origin).toBe('added');
      expect(g.edited).toBe(false);
      expect(glyphHasArtwork(g)).toBe(false);
    }

    // the report refreshes, but stays honest: nothing was added *with artwork*,
    // so the letters are counted blank, never present
    expect(rowOf('Georgian Mkhedruli')).toMatchObject({ present: '0/33', missing: '0', blank: '33' });
    expect(rowOf('Georgian Mkhedruli').cells.join(' ')).toMatch(/no artwork yet|still blank/);
    const report = analyzeCoverage(after);
    expect(report.setById.georgian.present).toBe(0);
    expect(report.setById.georgian.blank).toBe(33);

    // ...and a set added this way can be drawn later without losing anything
    act(() => useStore.getState().undo('A'));
    const undone = useStore.getState().fonts.A!;
    expect(undone.glyphs.length).toBe(before.glyphs.length);
    expect(undone.glyphs).toEqual(before.glyphs);
    expect(useStore.getState().dirty.A).toBe(false);
  });

  it('keeps a designed character when its set is added again', async () => {
    const { button } = await openDialog();
    const before = useStore.getState().fonts.A!;
    const aGlyph = before.glyphs.find((g) => g.unicode === 0x41)!;

    fireEvent.click(button('Select all'));
    fireEvent.click(button('Add now'));

    const after = useStore.getState().fonts.A!;
    expect(after.glyphs.find((g) => g.unicode === 0x41)).toBe(aGlyph);
    expect(after.glyphs.find((g) => g.unicode === 0x41)!.contours).toBe(aGlyph.contours);
    // it was still a single history entry
    expect(useStore.getState().past.A.length).toBe(1);
  });

  it('does not create an undo step when a set is already complete', async () => {
    const { button, check } = await openDialog();
    fireEvent.click(button('Select all'));
    fireEvent.click(button('Add now'));
    const afterFirst = useStore.getState().fonts.A!;
    const pastAfterFirst = useStore.getState().past.A.length;

    // the English sets are complete — asking for them again must be a no-op
    fireEvent.click(check('Add missing English uppercase'));
    fireEvent.click(check('Add missing English lowercase'));
    expect(button('Add now').disabled).toBe(false);
    fireEvent.click(button('Add now'));
    expect(useStore.getState().fonts.A).toBe(afterFirst);
    expect(useStore.getState().past.A.length).toBe(pastAfterFirst);
  });

  it('adds every missing character of every set after one confirmation', async () => {
    const { button } = await openDialog();
    const before = useStore.getState().fonts.A!;
    const allMissing = button(/^Add all missing \(/);
    expect(allMissing.textContent).toBe('Add all missing (45)'); // 33 Georgian + 10 large digits + 2 punctuation

    fireEvent.click(allMissing);
    // a batch this size asks first, and says what it will do
    const confirm = await screen.findByRole('dialog', { name: 'Add all missing characters?' });
    expect(within(confirm).getByText(/Georgian Mkhedruli/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Add missing characters' }));
    await act(async () => {}); // the confirmation resolves in a microtask

    const after = useStore.getState().fonts.A!;
    // 44 brand-new glyphs (33 Georgian + 10 large digits + ₾); the blank U+00A0
    // already exists in Lato and is only reported, never re-created
    expect(after.glyphs.length).toBe(before.glyphs.length + 44);
    expect(after.glyphs.filter((g) => g.origin === 'added')).toHaveLength(44);
    expect(useStore.getState().past.A.length).toBe(1); // one Ctrl+Z undoes the whole batch
    const report = analyzeCoverage(after);
    expect(report.totals.missing).toBe(0);
    expect(report.totals.blank).toBe(45);
    expect(report.sets.every((s) => s.missing === 0)).toBe(true);
    // the button now offers the remaining (undrawn) characters instead
    expect(button(/^Add all missing \(/).textContent).toBe('Add all missing (45)');

    // declining the confirmation changes nothing
    fireEvent.click(button(/^Add all missing \(/));
    const confirm2 = await screen.findByRole('dialog', { name: 'Add all missing characters?' });
    fireEvent.click(within(confirm2).getByRole('button', { name: 'Cancel' }));
    await act(async () => {});
    expect(useStore.getState().fonts.A).toBe(after);
    expect(useStore.getState().past.A.length).toBe(1);
  });

  it('fills only blank characters when that policy is chosen, and keeps designs', async () => {
    const { button, check, rowOf } = await openDialog();
    // a blank, mapped character that Lato ships (U+00A0 is blank in the report)
    expect(rowOf('Punctuation & common symbols')).toMatchObject({ missing: '1', blank: '1' });
    fireEvent.click(check('Add missing Punctuation & common symbols'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fill blanks' }));
    fireEvent.click(button('Add now'));
    const after = useStore.getState().fonts.A!;
    // the blank one was filled (still blank artwork — nothing is invented) …
    const blank = after.glyphs.filter((g) => allUnicodes(g).includes(0xa0));
    expect(blank).toHaveLength(1);
    expect(glyphHasArtwork(blank[0])).toBe(false);
    // … and a designed glyph was not touched
    expect(after.glyphs.find((g) => g.unicode === 0x2f)).toBe(
      useStore.getState().past.A[0].doc.glyphs.find((g) => g.unicode === 0x2f),
    );
  });
});
