// @vitest-environment jsdom
/**
 * Acceptance criteria 5, 6 and 7 through the dialog: the double-size digits are
 * separate glyphs on configurable code points, a standard digit is copied into
 * its large counterpart and scaled ×2 with nearest-neighbour sampling, and
 * changing the mapping moves the glyphs (artwork intact) while refusing code
 * points that already belong to another character.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { DEFAULT_LARGE_DIGIT_POINTS, glyphHasArtwork, largeDigitPoints } from '../src/core/charSets';
import { analyzeCoverage } from '../src/core/coverage';
import { allUnicodes } from '../src/core/unicodeMap';
import { basicSetGlyphs } from '../src/core/fontFactory';
import { Bitmap } from '../src/core/bitmap';
import type { FontDoc, GlyphDoc } from '../src/core/types';
import { cellsOf, drawGlyph, newTestFont } from './helpers';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
beforeEach(() => {
  useStore.setState({
    fonts: { A: null, B: null },
    toasts: [],
    modal: { type: 'none' },
    past: { A: [], B: [] },
    future: { A: [], B: [] },
  } as never);
});
afterEach(() => cleanup());

/** A pixel font whose ten digits are drawn with a recognisable pattern. */
function digitFont(): FontDoc {
  let doc = newTestFont(8, 8, 'Digits');
  doc = { ...doc, glyphs: [...doc.glyphs, ...basicSetGlyphs(doc)] };
  for (let i = 0; i < 10; i++) {
    doc = drawGlyph(doc, 0x30 + i, (bm) => {
      bm.set(0, 0, 1); // a single corner pixel — nearest-neighbour scaling is easy to verify
      bm.rect(2, 1, 1, 6, 1, true);
      bm.set(i % 8, 7, 1);
    }).doc;
  }
  return doc;
}

async function openDialog(doc: FontDoc) {
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'digits.pixeel');
    s.setActive('A');
    s.openModal({ type: 'characterSets', slot: 'A' });
  });
  const dialog = await screen.findByRole('dialog');
  const workflow = within(dialog).getByRole('table', { name: 'Large digit workflow' });
  const row = (digit: number) => Array.from(workflow.querySelectorAll('tbody tr'))[digit] as HTMLElement;
  const button = (name: string | RegExp) => within(dialog).getByRole('button', { name }) as HTMLButtonElement;
  const glyph = (cp: number): GlyphDoc | undefined => useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(cp));
  return { dialog, workflow, row, button, glyph };
}

describe('double-size alternative digits', () => {
  it('adds the set, copies a standard digit into its counterpart and scales it ×2 (nearest neighbour)', async () => {
    const doc = digitFont();
    const { row, button, glyph } = await openDialog(doc);
    const stdThree = doc.glyphs.find((g) => allUnicodes(g).includes(0x33))!;

    // 1) add the ten large-digit code points as their own blank glyphs
    fireEvent.click(button('Add the large-digit set'));
    expect(useStore.getState().past.A).toHaveLength(1); // one undo step
    for (const cp of DEFAULT_LARGE_DIGIT_POINTS) {
      const g = glyph(cp)!;
      expect(g).toBeTruthy();
      expect(g.origin).toBe('added');
      expect(g.edited).toBe(false);
      expect(glyphHasArtwork(g)).toBe(false);
    }
    // the standard digits were not touched
    expect(useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(0x33))).toBe(stdThree);

    // 2) copy the standard digit into the large digit of the same value
    fireEvent.click(within(row(3)).getByRole('button', { name: 'Copy' }));
    expect(useStore.getState().past.A).toHaveLength(2);
    const largeThree = glyph(0xe003)!;
    expect(glyphHasArtwork(largeThree)).toBe(true);
    expect(largeThree.pixel!.width).toBe(stdThree.pixel!.width);
    expect(cellsOf(largeThree).toB64()).toBe(cellsOf(stdThree).toB64());
    expect(largeThree.advanceWidth).toBe(stdThree.advanceWidth);
    expect(largeThree.edited).toBe(false); // copied artwork is not a fresh design
    expect(glyph(0xe000)!.pixel!.cellsB64).not.toBe(stdThree.pixel!.cellsB64);

    // 3) ×2 with nearest-neighbour sampling
    fireEvent.click(within(row(3)).getByRole('button', { name: '×2' }));
    expect(useStore.getState().past.A).toHaveLength(3);
    const scaled = glyph(0xe003)!;
    expect(scaled.pixel!.width).toBe(stdThree.pixel!.width * 2);
    expect(scaled.pixel!.height).toBe(stdThree.pixel!.height * 2);
    expect(scaled.advanceWidth).toBe(stdThree.advanceWidth * 2);
    const scaledCells = cellsOf(scaled);
    // the single corner pixel became a 2×2 block (never a smoothed/interpolated edge)
    expect([scaledCells.get(0, 0), scaledCells.get(1, 0), scaledCells.get(0, 1), scaledCells.get(1, 1)]).toEqual([1, 1, 1, 1]);
    expect([scaledCells.get(2, 0), scaledCells.get(0, 2)]).toEqual([0, 0]); // the block is exactly 2×2, not blurred
    // every 2×2 block of a nearest-neighbour ×2 is uniform (no interpolation anywhere)
    for (let y = 0; y < 16; y += 2) {
      for (let x = 0; x < 16; x += 2) {
        const v = scaledCells.get(x, y);
        expect([scaledCells.get(x + 1, y), scaledCells.get(x, y + 1), scaledCells.get(x + 1, y + 1)]).toEqual([v, v, v]);
      }
    }
    // the original standard digit is untouched, so both sizes can be used together
    expect(cellsOf(glyph(0x33)!).toB64()).toBe(cellsOf(stdThree).toB64());

    // 4) one undo restores the pre-scaling large digit
    act(() => useStore.getState().undo('A'));
    expect(glyph(0xe003)!.pixel!.width).toBe(stdThree.pixel!.width);
  });

  it('moves the mapping to new code points and keeps the artwork, in one undo step', async () => {
    const doc = digitFont();
    const { dialog, button, glyph } = await openDialog(doc);
    fireEvent.click(button('Add the large-digit set'));
    const before = useStore.getState().fonts.A!;
    const ownedBefore = DEFAULT_LARGE_DIGIT_POINTS.map((cp) => glyph(cp)!.id);
    const pastBefore = useStore.getState().past.A.length;

    const target = Array.from({ length: 10 }, (_, i) => 0xf200 + i);
    target.forEach((cp, i) => {
      const field = within(dialog).getByLabelText(`Alternative code point for digit ${i}`) as HTMLInputElement;
      fireEvent.change(field, { target: { value: `U+${cp.toString(16).toUpperCase()}` } });
    });
    fireEvent.click(button('Apply mapping'));
    expect(useStore.getState().past.A.length).toBe(pastBefore + 1);

    const after = useStore.getState().fonts.A!;
    expect(after.glyphs).toHaveLength(before.glyphs.length); // moved, not re-created
    expect(largeDigitPoints(after)).toEqual(target);
    target.forEach((cp, i) => {
      const g = glyph(cp)!;
      expect(g.id).toBe(ownedBefore[i]); // the same glyph objects, under new code points
      expect(allUnicodes(g)).toEqual([cp]);
    });
    for (const cp of DEFAULT_LARGE_DIGIT_POINTS) expect(after.glyphs.find((g) => allUnicodes(g).includes(cp))).toBeUndefined();
    expect(analyzeCoverage(after).setById.largeDigits.points).toEqual(target);

    act(() => useStore.getState().undo('A'));
    expect(largeDigitPoints(useStore.getState().fonts.A!)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
    expect(useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(0xe000))!.id).toBe(ownedBefore[0]);
  });

  it('keeps a drawn large digit intact when the mapping changes', async () => {
    const doc = digitFont();
    const { dialog, button, glyph } = await openDialog(doc);
    fireEvent.click(button('Add the large-digit set'));
    fireEvent.click(within(row3(screen.getByRole('dialog'))).getByRole('button', { name: 'Copy' }));
    // give the large digit some artwork of its own
    act(() => {
      const g = glyph(0xe003)!;
      const bm = Bitmap.fromB64(g.pixel!.width, g.pixel!.height, g.pixel!.cellsB64);
      bm.rect(0, 0, 3, 3, 1, true);
      useStore.getState().commit('A', 'draw', (d) => ({
        ...d,
        glyphs: d.glyphs.map((x) => (x.id === g.id ? { ...x, pixel: { ...x.pixel!, cellsB64: bm.toB64() }, edited: true } : x)),
      }));
    });
    const drawn = glyph(0xe003)!;
    const cells = drawn.pixel!.cellsB64;
    const advance = drawn.advanceWidth;

    const field = within(dialog).getByLabelText('Alternative code point for digit 3') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '0xF303' } });
    fireEvent.click(button('Apply mapping'));

    const moved = glyph(0xf303)!;
    expect(moved.pixel!.cellsB64).toBe(cells); // identical artwork, no re-creation
    expect(moved.advanceWidth).toBe(advance);
    expect(moved.edited).toBe(true);
    expect(moved.name).toBe(drawn.name);
    expect(glyph(0xe003)).toBeUndefined();
  });

  it('refuses a code point that already belongs to another character and says why', async () => {
    const doc = digitFont();
    const { dialog, button, glyph } = await openDialog(doc);
    fireEvent.click(button('Add the large-digit set'));
    const before = useStore.getState().fonts.A!;
    const pastBefore = useStore.getState().past.A.length;

    // "A" is a designed character in this font
    const field0 = within(dialog).getByLabelText('Alternative code point for digit 0') as HTMLInputElement;
    fireEvent.change(field0, { target: { value: 'A' } });
    fireEvent.click(button('Apply mapping'));

    const alert = await findMappingError(dialog, /already used by/);
    expect(alert.textContent).toMatch(/already used by “uni41”|already used by “A”/);
    expect(alert.textContent).toMatch(/Pick another code point|change that glyph/);
    expect(useStore.getState().fonts.A).toBe(before); // nothing changed
    expect(useStore.getState().past.A.length).toBe(pastBefore); // not even an undo step
    expect(largeDigitPoints(useStore.getState().fonts.A!)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
    // the existing character is untouched: same object, still exactly as it was
    expect(glyph(0x41)).toBe(before.glyphs.find((g) => allUnicodes(g).includes(0x41)));
    expect(glyph(0x41)!.edited).toBe(false);

    // a duplicate inside the mapping is rejected as well
    const field1 = within(dialog).getByLabelText('Alternative code point for digit 1') as HTMLInputElement;
    fireEvent.change(field0, { target: { value: 'U+E009' } });
    fireEvent.change(field1, { target: { value: 'U+E009' } });
    fireEvent.click(button('Apply mapping'));
    expect((await findMappingError(dialog, /two alternative digits/)).textContent).toMatch(/two alternative digits/);

    // and a standard digit cannot be used as an alternative digit
    fireEvent.change(field0, { target: { value: '7' } });
    fireEvent.change(field1, { target: { value: 'U+E001' } });
    fireEvent.click(button('Apply mapping'));
    expect((await findMappingError(dialog, /standard digit/)).textContent).toMatch(/standard digit/);
    expect(useStore.getState().fonts.A).toBe(before);
  });
});

/** The mapping error alert of the dialog (there are other alerts on screen). */
async function findMappingError(dialog: HTMLElement, pattern: RegExp): Promise<HTMLElement> {
  await waitFor(() => {
    const hit = within(dialog).queryAllByRole('alert').find((a) => pattern.test(a.textContent ?? ''));
    if (!hit) {
      throw new Error(`no alert matching ${pattern} (${within(dialog).queryAllByRole('alert').map((a) => a.textContent).join(' | ')})`);
    }
  });
  return within(dialog).queryAllByRole('alert').find((a) => pattern.test(a.textContent ?? ''))!;
}

/** The workflow table row for digit 3 of an open dialog. */
function row3(dialog: HTMLElement): HTMLElement {
  const workflow = within(dialog).getByRole('table', { name: 'Large digit workflow' });
  return Array.from(workflow.querySelectorAll('tbody tr'))[3] as HTMLElement;
}

describe('the Sets tab of the side panel', () => {
  it('reports per-set numbers, adds a set and drives the large-digit workflow', async () => {
    const doc = digitFont();
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', doc, 'digits.pixeel');
      s.setActive('A');
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Sets' }));

    // per-set numbers, honest about what has no artwork yet
    expect(screen.getByText(/English 0\/52 · Georgian 0\/33 · Digits 10\/10 · Large digits 0\/10/)).toBeTruthy();
    expect(screen.getByText('0/33 present · 33 blank')).toBeTruthy(); // present as blank grids only
    expect(screen.getByText('0/10 present · 10 missing')).toBeTruthy();
    expect(screen.getByText(/required character\(s\) exist only as blank glyphs/)).toBeTruthy();

    // the per-set add button adds exactly that set (one undo step) and jumps to it
    const before = useStore.getState().fonts.A!;
    fireEvent.click(screen.getByTitle(/Add the 10 missing character\(s\) of this set as blank glyphs/));
    expect(useStore.getState().fonts.A!.glyphs.length).toBe(before.glyphs.length + 10);
    expect(useStore.getState().past.A).toHaveLength(1);
    expect(useStore.getState().ui.A.glyphListCategory).toBe('largeDigits');
    expect(screen.getByText('0/10 present · 10 blank')).toBeTruthy();
    // a set that already exists is not re-created
    fireEvent.click(screen.getByTitle(/Add the 33 missing character\(s\) of this set as blank glyphs/));
    expect(useStore.getState().fonts.A!.glyphs.length).toBe(before.glyphs.length + 10);
    expect(useStore.getState().past.A).toHaveLength(1);

    // the large-digit workflow panel copies a standard digit with ×2 in one click
    fireEvent.click(screen.getByRole('button', { name: 'Copy digit 3 at 2x' }));
    const std = useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(0x33))!;
    const large = useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(0xe003))!;
    expect(large.pixel!.width).toBe(std.pixel!.width * 2);
    expect(large.advanceWidth).toBe(std.advanceWidth * 2);
    expect(useStore.getState().ui.A.glyphId).toBe(large.id);

    // "Sets…" opens the dialog that owns the mapping
    fireEvent.click(screen.getByRole('button', { name: 'Sets…' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Alternative code point for digit 0') as HTMLInputElement).value).toBe('U+E000');
    expect(within(dialog).getByRole('button', { name: 'Apply mapping' })).toBeTruthy();
    expect(within(dialog).getByRole('table', { name: 'Large digit workflow' })).toBeTruthy();
    expect(within(dialog).getByRole('table', { name: 'Character coverage' })).toBeTruthy();

    // the dialog hands over to the export dialog, which verifies the written file
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open export…' }));
    expect(useStore.getState().modal).toMatchObject({ type: 'export', slot: 'A' });
  });
});

describe('overwriting existing artwork on purpose', () => {
  it('asks first, keeps everything when declined, and replaces only what was confirmed', async () => {
    const doc = digitFont();
    const { dialog, row, button, glyph } = await openDialog(doc);
    fireEvent.click(button('Add the large-digit set'));
    fireEvent.click(within(row(3)).getByRole('button', { name: 'Copy' }));
    const drawn = glyph(0xe003)!;
    const cellsBefore = drawn.pixel!.cellsB64;
    const pastBefore = useStore.getState().past.A.length;
    const docBefore = useStore.getState().fonts.A!;

    // complete the set from the matching standard digits, double-size, overwriting
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Add missing Double-size alternative digits' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy template' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '×2 nearest' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }));

    fireEvent.click(button('Add now'));
    const confirm = await screen.findByRole('dialog', { name: /Replace the artwork of 1 existing character/ });
    expect(within(confirm).getByText(/U\+E003/)).toBeTruthy(); // it names exactly what it would replace
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await act(async () => {});
    expect(useStore.getState().fonts.A).toBe(docBefore); // nothing happened
    expect(useStore.getState().past.A).toHaveLength(pastBefore);
    expect(glyph(0xe003)!.pixel!.cellsB64).toBe(cellsBefore);
    expect(glyph(0xe000)!.pixel!.width).toBe(8); // untouched: still the blank grid

    // try again and confirm
    fireEvent.click(button('Add now'));
    const confirm2 = await screen.findByRole('dialog', { name: /Replace the artwork of 1 existing character/ });
    fireEvent.click(within(confirm2).getByRole('button', { name: 'Replace the artwork' }));
    await act(async () => {});
    expect(useStore.getState().past.A.length).toBe(pastBefore + 1); // one undo step for the batch
    const std = glyph(0x30 + 3)!;
    expect(glyph(0xe003)!.pixel!.width).toBe(std.pixel!.width * 2);
    expect(glyph(0xe003)!.pixel!.cellsB64).not.toBe(cellsBefore);
    expect(glyph(0xe000)!.pixel!.width).toBe(16); // a blank one was filled in the same batch
    expect(glyph(0x30 + 3)!.pixel!.cellsB64).toBe(std.pixel!.cellsB64); // the source is untouched

    act(() => useStore.getState().undo('A'));
    expect(glyph(0xe003)!.pixel!.cellsB64).toBe(cellsBefore);
  });
});
