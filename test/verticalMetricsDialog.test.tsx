// @vitest-environment jsdom
/** The vertical metrics dialog: edit, validate, presets, LED fonts, undo. */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { createNewFont } from '../src/core/fontFactory';
import { normalizeLedSpec } from '../src/core/ledMatrix';
import { drawGlyph, newTestFont } from './helpers';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => cleanup());

async function open(doc = drawGlyph(newTestFont(8, 8, 'VD'), 65, (bm) => bm.set(1, 3, 1)).doc) {
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'v.pixeel');
    s.setActive('A');
    s.openModal({ type: 'verticalMetrics', slot: 'A' });
  });
  const dialog = await screen.findByRole('dialog');
  const field = (name: string) => within(dialog).getByLabelText(name) as HTMLInputElement;
  const apply = () => within(dialog).getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
  return { dialog, field, apply };
}
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const metrics = () => useStore.getState().fonts.A!.metrics;

describe('vertical metrics dialog', () => {
  it('shows the font values, the preview and a disabled Apply when nothing changed', async () => {
    const { dialog, field, apply } = await open();
    expect(field('Ascent').value).toBe(String(metrics().ascent));
    expect(field('Descent').value).toBe(String(metrics().descent));
    expect(field('Win descent').value).toBe(String(-metrics().descent));
    expect(within(dialog).getByRole('img', { name: 'Vertical metrics preview' })).toBeTruthy();
    expect(apply().disabled).toBe(true);
  });

  it('applies edits as one undo step and undoes them', async () => {
    const { field, apply } = await open();
    const before = metrics();
    const past = useStore.getState().past.A.length;
    type(field('Ascent'), '900');
    type(field('Descent'), '-300');
    type(field('Line gap'), '40');
    type(field('Typo ascender'), '880');
    type(field('Win ascent'), '1000');
    fireEvent.click(screen.getByLabelText(/Use typo metrics/));
    expect(apply().disabled).toBe(false);
    fireEvent.click(apply());
    expect(metrics()).toMatchObject({ ascent: 900, descent: -300, lineGap: 40, typoAscender: 880, winAscent: 1000, useTypoMetrics: true });
    expect(useStore.getState().past.A.length).toBe(past + 1);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useStore.getState().undo('A'));
    expect(metrics()).toEqual(before);
  });

  it('blocks Apply and explains validation errors', async () => {
    const { dialog, field, apply } = await open();
    type(field('Ascent'), '-5');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Ascent must be positive/);
    expect(apply().disabled).toBe(true);
    type(field('Ascent'), '800');
    type(field('Descent'), '40');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Descent must be negative/);
    type(field('Descent'), '');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/must be (a number|numbers)/);
    expect(apply().disabled).toBe(true);
    type(field('Descent'), '-200');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows warnings without blocking Apply', async () => {
    const { dialog, field, apply } = await open();
    type(field('Win ascent'), '10');
    expect(within(dialog).getByLabelText('Metric warnings').textContent).toMatch(/clipped on Windows/);
    expect(apply().disabled).toBe(false);
  });

  it('presets fill every field, Sync copies hhea into typo / win, Reset restores', async () => {
    const { dialog, field } = await open();
    const upem = metrics().unitsPerEm;
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /preset/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Airy/ }));
    expect(field('Ascent').value).toBe(String(Math.round(upem * 0.95)));
    expect(field('Line gap').value).toBe(String(Math.round(upem * 0.2)));
    expect(field('Typo ascender').value).toBe(field('Ascent').value);
    expect(field('Win descent').value).toBe(String(Math.round(upem * 0.25)));

    type(field('Typo ascender'), '1');
    fireEvent.click(within(dialog).getByRole('button', { name: /Sync typo/ }));
    expect(field('Typo ascender').value).toBe(field('Ascent').value);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    expect(field('Ascent').value).toBe(String(metrics().ascent));
  });

  it('disables hhea fields for LED fonts but still edits typo / win', async () => {
    const spec = normalizeLedSpec({ rows: 7, cols: 5, spacing: 1, cellUnits: 100, descentRows: 0 });
    const led = createNewFont({ familyName: 'Led', styleName: 'Regular', gridWidth: 5, gridHeight: 7, led: spec });
    const { dialog, field, apply } = await open(led);
    expect(field('Ascent').disabled).toBe(true);
    expect(field('Line gap').disabled).toBe(true);
    expect(within(dialog).getByRole('combobox', { name: /preset/i }).getAttribute('aria-disabled')).toBe('true');
    const hhea = { ascent: metrics().ascent, descent: metrics().descent, lineGap: metrics().lineGap };
    type(field('Win ascent'), '777');
    fireEvent.click(apply());
    expect(metrics()).toMatchObject({ ...hhea, winAscent: 777 });
  });
});

describe('vertical metrics entry points', () => {
  it('opens from the command palette', async () => {
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      const s = useStore.getState();
      s.loadFont('A', newTestFont(8, 8, 'VD'), 'v.pixeel');
      s.setActive('A');
    });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/Type a command/);
    type(input, 'vertical metrics');
    fireEvent.click(await screen.findByText('Vertical metrics…'));
    expect(await screen.findByRole('dialog', { name: /Vertical metrics/ })).toBeTruthy();
  });
});
