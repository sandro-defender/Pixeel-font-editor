// @vitest-environment jsdom
/**
 * Acceptance criteria 2, 4 and 10 in the glyph browser: the set navigation
 * shows what is missing, clicking a missing card adds exactly that one
 * character (one undo step), blank characters are opened for drawing instead of
 * being re-created, and added characters are visibly marked until they are drawn.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { analyzeCoverage } from '../src/core/coverage';
import { glyphState, largeDigitName } from '../src/core/charSets';
import { allUnicodes } from '../src/core/unicodeMap';
import { basicSetGlyphs } from '../src/core/fontFactory';
import type { FontDoc } from '../src/core/types';
import { drawGlyph, newTestFont } from './helpers';

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

/**
 * A pixel font with the starter set (Latin, digits, punctuation and the 33
 * Mkhedruli letters — all mapped but still blank) plus "A" and "a" drawn.
 */
function smallFont(): FontDoc {
  let doc = newTestFont(8, 8, 'Browser');
  doc = { ...doc, glyphs: [...doc.glyphs, ...basicSetGlyphs(doc)] };
  doc = drawGlyph(doc, 0x41, (bm) => bm.rect(1, 1, 5, 6, 1, true)).doc;
  doc = drawGlyph(doc, 0x61, (bm) => bm.rect(1, 1, 5, 6, 1, true)).doc;
  return doc;
}

async function openBrowser(doc: FontDoc) {
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'browser.pixeel');
    s.setActive('A');
  });
  return { report: analyzeCoverage(doc) };
}

const tab = (name: string | RegExp) => screen.getByRole('tab', { name }) as HTMLElement;

describe('missing characters in the glyph browser', () => {
  it('shows a Missing Glyphs tab with the real count of unusable characters', async () => {
    const { report } = await openBrowser(smallFont());
    const expected = report.totals.missing + report.totals.blank;
    expect(expected).toBeGreaterThan(10); // the large digits and several symbols are simply absent
    expect(report.setById.georgian.blank).toBe(33); // present as blank grids only
    expect(tab(new RegExp(`^Missing Glyphs ${expected}$`))).toBeTruthy();
    // every set tab carries its number of required characters
    expect(tab('Georgian 33')).toBeTruthy();
    expect(tab('Large Digits 10')).toBeTruthy();
  });

  it('adds one missing character when its placeholder card is clicked, and undoes it', async () => {
    const doc = smallFont();
    const { report } = await openBrowser(doc);
    const before = useStore.getState().fonts.A!;
    const pastBefore = useStore.getState().past.A.length;
    // a required symbol that has no glyph at all in this font
    const absent = report.sets
      .flatMap((s) => s.entries)
      .find((e) => e.status === 'missing' && e.codePoint > 0x20)!;
    const hex = 'U+' + absent.codePoint.toString(16).toUpperCase().padStart(4, '0');

    fireEvent.click(tab(/^Missing Glyphs /));
    const card = await screen.findByRole('listitem', { name: new RegExp(`^${hex.replace('+', '\\+')}\\b`) });
    expect(card.getAttribute('data-glyph-state')).toBe('missing');
    fireEvent.click(card);

    const after = useStore.getState().fonts.A!;
    expect(after.glyphs.length).toBe(before.glyphs.length + 1);
    expect(useStore.getState().past.A.length).toBe(pastBefore + 1); // one undo step
    expect(useStore.getState().dirty.A).toBe(true);
    const added = after.glyphs.find((g) => allUnicodes(g).includes(absent.codePoint))!;
    expect(added.origin).toBe('added');
    expect(added.edited).toBe(false);
    // a readable suggested name (never a claim that anything was designed)
    const owner = report.sets.find((s) => s.entries.includes(absent))!;
    const expectedName =
      owner.def.id === 'largeDigits'
        ? largeDigitName(owner.points.indexOf(absent.codePoint))
        : `uni${absent.codePoint.toString(16).toUpperCase()}`;
    expect(added.name).toBe(expectedName);
    // everything else is untouched
    for (const g of before.glyphs) expect(after.glyphs.find((x) => x.id === g.id)).toBe(g);

    // the placeholder is now a *blank* card: the character exists but has no
    // artwork yet, so it is still reported as unusable (and clicking opens it)
    const card2 = await screen.findByRole('listitem', { name: new RegExp(`^${hex.replace('+', '\\+')}\\b`) });
    expect(card2.getAttribute('data-glyph-state')).toBe('blank');
    expect(card2.getAttribute('aria-label')).toMatch(/no artwork yet/);
    expect(within(card2).getByText('blank')).toBeTruthy();

    act(() => useStore.getState().undo('A'));
    expect(useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(absent.codePoint))).toBeUndefined();
  });

  it('lists the missing characters of a set inside that set view too', async () => {
    await openBrowser(smallFont());
    fireEvent.click(tab('Large Digits 10'));
    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(10);
    expect(cards[0].getAttribute('data-glyph-state')).toBe('missing');
    expect(cards[0].getAttribute('aria-label')).toMatch(/U\+E000/);
    // the code point column of the browser announces the configured mapping
    expect(screen.getByTitle(/Large Digits/)).toBeTruthy();
  });

  it('opens a blank character for drawing instead of re-creating it', async () => {
    const doc = smallFont();
    await openBrowser(doc);
    const b = doc.glyphs.find((g) => allUnicodes(g).includes(0x10d0))!;
    expect(b.edited).toBe(false);
    expect(b.pixel).toBeTruthy();
    // the report does not count it: a bare mapping is not artwork
    expect(analyzeCoverage(doc).setById.georgian.entries.find((e) => e.codePoint === 0x10d0)!.status).toBe('blank');

    fireEvent.click(tab('Georgian 33'));
    const card = await screen.findByRole('listitem', { name: /^uni10D0/ });
    expect(card.getAttribute('data-glyph-state')).toBe('blank');
    fireEvent.click(card);
    // no new glyph, no history entry — the existing one is selected for drawing
    expect(useStore.getState().fonts.A).toBe(doc);
    expect(useStore.getState().ui.A.glyphId).toBe(b.id);
    expect(useStore.getState().past.A).toHaveLength(0);
  });

  it('keeps a designed character and marks an edited one instead of replacing it', async () => {
    const doc = smallFont();
    await openBrowser(doc);
    const designed = useStore.getState().fonts.A!.glyphs.find((g) => allUnicodes(g).includes(0x41))!;
    // a glyph drawn here is reported as modified, never as imported/added
    expect(glyphState(designed)).toBe('modified');
    const card = await screen.findByRole('listitem', { name: /U\+0041/ });
    expect(card.getAttribute('data-glyph-state')).toBe('modified');
    expect(card.getAttribute('aria-label')).toMatch(/modified/);

    // adding the Georgian set through the dialog does not touch it
    await act(async () => {
      useStore.getState().openModal({ type: 'characterSets', slot: 'A' });
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 33' }));
    const after = useStore.getState().fonts.A!;
    expect(after.glyphs.find((g) => allUnicodes(g).includes(0x41))).toBe(designed);
    expect(glyphState(after.glyphs.find((g) => allUnicodes(g).includes(0x41))!)).toBe('modified');
  });
});

describe('command palette entry points', () => {
  const openPalette = async () => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = (await screen.findByPlaceholderText(/Type a command or a character/)) as HTMLInputElement;
    return { palette: input.closest('[role="dialog"]') as HTMLElement, input };
  };

  it('opens the coverage dialog (and its large-digit section) from the palette', async () => {
    await openBrowser(smallFont());
    const first = await openPalette();
    fireEvent.change(first.input, { target: { value: 'coverage' } });
    expect(within(first.palette).getByText(/Character coverage & sets/)).toBeTruthy();
    expect(useStore.getState().modal).toEqual({ type: 'none' }); // nothing opened yet
    fireEvent.keyDown(first.input, { key: 'Enter' });
    // the palette closes first and runs the command a tick later (focus trap)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(useStore.getState().modal).toEqual({ type: 'characterSets', slot: 'A' });
    expect(await screen.findByRole('table', { name: 'Character coverage' })).toBeTruthy();

    // close the dialog and run the second entry: same dialog, focused on the mapping
    await act(async () => {
      useStore.getState().closeModal();
    });
    const second = await openPalette();
    fireEvent.change(second.input, { target: { value: 'large digits' } });
    expect(within(second.palette).getByText(/Double-size large digits/)).toBeTruthy();
    fireEvent.keyDown(second.input, { key: 'Enter' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(useStore.getState().modal).toEqual({ type: 'characterSets', slot: 'A', focus: 'largeDigits' });
  });
});
