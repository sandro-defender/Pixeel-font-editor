// @vitest-environment jsdom
/** The composite builder UI: start, add, drag, numbers, reorder, remove, undo. */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { useStore } from '../src/state/store';
import { addComponent, startComposite } from '../src/core/composite';
import { drawGlyph, newTestFont } from './helpers';

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  (SVGElement.prototype as any).setPointerCapture = () => {};
  (SVGElement.prototype as any).releasePointerCapture = () => {};
});
afterEach(() => cleanup());

function baseFont() {
  let doc = newTestFont(8, 8, 'CB');
  doc = drawGlyph(doc, 0x41, (bm) => { for (let y = 0; y < 6; y++) bm.set(1, y, 1); }).doc;
  doc = drawGlyph(doc, 0xb4, (bm) => bm.set(3, 6, 1)).doc;
  doc = drawGlyph(doc, 0xc1, (bm) => bm.set(0, 0, 1)).doc;
  const id = (cp: number) => doc.glyphs.find((g) => g.unicode === cp)!.id;
  return { doc, A: id(0x41), acute: id(0xb4), Aacute: id(0xc1) };
}

async function mount(doc: ReturnType<typeof baseFont>['doc'], select: string) {
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    const s = useStore.getState();
    s.loadFont('A', doc, 'c.pixeel');
    s.setActive('A');
    s.selectGlyph('A', select);
  });
}
const comp = (id: string, i = 0) => useStore.getState().fonts.A!.glyphs.find((g) => g.id === id)!.compound![i];
const glyphOf = (id: string) => useStore.getState().fonts.A!.glyphs.find((g) => g.id === id)!;

describe('composite builder', () => {
  it('starts a composite from a glyph (asking before discarding artwork) and adds components', async () => {
    const { doc, A, acute, Aacute } = baseFont();
    await mount(doc, Aacute);
    fireEvent.click(await screen.findByRole('button', { name: /Build as composite/ }));
    // the glyph has its own drawing → confirmation
    fireEvent.click(await screen.findByRole('button', { name: 'Build composite' }));
    expect(await screen.findByLabelText('Composite builder')).toBeTruthy();
    expect(glyphOf(Aacute).kind).toBe('compound');

    const input = screen.getByRole('combobox', { name: 'Add component' });
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'A' } });
    const option = await screen.findByRole('option', { name: /\bA\b/ });
    fireEvent.click(option);
    expect(glyphOf(Aacute).compound!.map((c) => c.glyphId)).toEqual([A]);

    const past = useStore.getState().past.A.length;
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Add component' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Add component' }), { target: { value: '´' } });
    fireEvent.click(await screen.findByRole('option', { name: /´/ }));
    expect(glyphOf(Aacute).compound!.map((c) => c.glyphId)).toEqual([A, acute]);
    expect(useStore.getState().past.A.length).toBe(past + 1);
    act(() => useStore.getState().undo('A'));
    expect(glyphOf(Aacute).compound!.length).toBe(1);
  });

  it('does not offer the glyph itself as a component', async () => {
    const { doc, Aacute } = baseFont();
    await mount(startComposite(doc, Aacute), Aacute);
    const input = await screen.findByRole('combobox', { name: 'Add component' });
    fireEvent.mouseDown(input);
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(names.some((n) => /Aacute/.test(n ?? ''))).toBe(false);
    expect(names.some((n) => /^A\s+A\b/.test(n ?? '') || /\bA$/.test(n ?? ''))).toBe(true);
  });

  it('commits typed offsets and scale as one undo step each', async () => {
    const { doc, A, acute, Aacute } = baseFont();
    const d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    await mount(d, Aacute);
    fireEvent.click(await screen.findByRole('button', { name: 'Select component 2' }));
    const past = useStore.getState().past.A.length;
    const x = screen.getByLabelText('Offset X');
    fireEvent.change(x, { target: { value: '80' } });
    fireEvent.blur(x);
    expect(comp(Aacute, 1).transform.e).toBe(80);
    expect(useStore.getState().past.A.length).toBe(past + 1);
    const sx = screen.getByLabelText('Scale X');
    fireEvent.change(sx, { target: { value: '0.5' } });
    fireEvent.keyDown(sx, { key: 'Enter' });
    expect(comp(Aacute, 1).transform).toMatchObject({ a: 0.5, d: 0.5 }); // uniform by default
    expect(useStore.getState().past.A.length).toBe(past + 2);
    // invalid input is rejected and the box reverts
    fireEvent.change(sx, { target: { value: '9' } });
    fireEvent.blur(sx);
    expect(comp(Aacute, 1).transform.a).toBe(0.5);
    expect(useStore.getState().past.A.length).toBe(past + 2);
    act(() => useStore.getState().undo('A'));
    expect(comp(Aacute, 1).transform.a).toBe(1);
  });

  it('drags a component on the canvas — live while dragging, one undo step on release', async () => {
    const { doc, A, acute, Aacute } = baseFont();
    const d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    await mount(d, Aacute);
    useStore.getState().setSnapToPixelGrid(false);
    const svg = (await screen.findByRole('img', { name: /Composite builder canvas/ })) as unknown as SVGSVGElement;
    const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect; // 1 px = 1 unit
    const before = comp(Aacute, 1).transform;
    const past = useStore.getState().past.A.length;
    const path = screen.getByTestId('component-1');
    fireEvent.pointerDown(path, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 80, pointerId: 1 });
    // live: the document is untouched until release
    expect(comp(Aacute, 1).transform.e).toBe(before.e);
    expect(useStore.getState().past.A.length).toBe(past);
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 150, clientY: 60, pointerId: 1 });
    expect(comp(Aacute, 1).transform.e).toBe(before.e + 50);
    expect(comp(Aacute, 1).transform.f).toBe(before.f + 40); // screen up = font +y
    expect(useStore.getState().past.A.length).toBe(past + 1);
    act(() => useStore.getState().undo('A'));
    expect(comp(Aacute, 1).transform.e).toBe(before.e);
  });

  it('snaps a drag to the grid when snapping is on', async () => {
    const { doc, A, acute, Aacute } = baseFont();
    const d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    await mount(d, Aacute);
    useStore.getState().setSnapToPixelGrid(true);
    const svg = (await screen.findByRole('img', { name: /Composite builder canvas/ })) as unknown as SVGSVGElement;
    const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(screen.getByTestId('component-1'), { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 137, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 137, clientY: 100, pointerId: 1 });
    expect(comp(Aacute, 1).transform.e % 20).toBe(0);
    expect(comp(Aacute, 1).transform.e).not.toBe(0);
  });

  it('reorders and removes components, flattens, and shows missing ones', async () => {
    const { doc, A, acute, Aacute } = baseFont();
    const d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    await mount(d, Aacute);
    fireEvent.click(await screen.findByRole('button', { name: 'Select component 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move component down' }));
    expect(glyphOf(Aacute).compound!.map((c) => c.glyphId)).toEqual([acute, A]);
    // the selection follows the moved component, so Remove takes out A (now second)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(glyphOf(Aacute).compound!.map((c) => c.glyphId)).toEqual([acute]);
    fireEvent.click(screen.getByRole('button', { name: /Flatten composite/ }));
    expect(glyphOf(Aacute).kind).toBe('vector');
    expect(glyphOf(Aacute).compound).toBeNull();
    expect(glyphOf(Aacute).contours.length).toBeGreaterThan(0);
  });

  it('warns about components whose glyph was deleted', async () => {
    const { doc, A, acute, Aacute } = baseFont();
    let d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    const { removeGlyphs } = await import('../src/state/glyphActions');
    d = removeGlyphs(d, [acute]);
    await mount(d, Aacute);
    expect(await screen.findByText(/refers to a deleted glyph/)).toBeTruthy();
    expect(screen.getByText('(deleted glyph)')).toBeTruthy();
  });
});
