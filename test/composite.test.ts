import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_COMPONENT_SCALE,
  addComponent,
  availableComponents,
  componentContours,
  componentInfos,
  componentProblem,
  dependsOn,
  hasOwnArtwork,
  matchBaseAdvance,
  moveComponent,
  removeComponent,
  startComposite,
  updateComponent,
} from '../src/core/composite';
import { buildTtf, importFont, resolveGlyphContours } from '../src/core/fontCodec';
import { registerSource, getSource } from '../src/core/sourceRegistry';
import { removeGlyphs } from '../src/state/glyphActions';
import { contourBounds } from '../src/core/contours';
import { useStore } from '../src/state/store';
import type { FontDoc, GlyphDoc } from '../src/core/types';
import { drawGlyph, newTestFont, parseTtf } from './helpers';

const OPTS = { preserveHinting: false, preserveKerning: false, validate: true };

/** A (wide), acute (small, drawn high), and an empty target Á. */
function setup() {
  let doc = newTestFont(8, 8, 'Comp');
  doc = drawGlyph(doc, 0x41, (bm) => { for (let y = 0; y < 6; y++) bm.set(1, y, 1); bm.set(2, 5, 1); }).doc;
  doc = drawGlyph(doc, 0xb4, (bm) => bm.set(3, 6, 1)).doc;
  doc = drawGlyph(doc, 0xc1, (bm) => bm.set(0, 0, 1)).doc;
  const id = (cp: number) => doc.glyphs.find((g) => g.unicode === cp)!.id;
  return { doc, A: id(0x41), acute: id(0xb4), Aacute: id(0xc1) };
}
const glyph = (doc: FontDoc, id: string): GlyphDoc => doc.glyphs.find((g) => g.id === id)!;

describe('building a composite', () => {
  it('turns a glyph into an empty composite, discarding its drawing', () => {
    const { doc, Aacute } = setup();
    expect(hasOwnArtwork(glyph(doc, Aacute))).toBe(true);
    const next = startComposite(doc, Aacute);
    expect(glyph(next, Aacute)).toMatchObject({ kind: 'compound', compound: [], contours: [], pixel: null, edited: true });
    expect(hasOwnArtwork(glyph(next, Aacute))).toBe(false);
    expect(startComposite(next, Aacute)).toBe(next); // already a composite
  });

  it('refuses .notdef and LED fonts', () => {
    const { doc } = setup();
    expect(() => startComposite(doc, doc.glyphs[0].id)).toThrow(/notdef/);
    expect(() => startComposite({ ...doc, ledMatrix: { rows: 7, cols: 5, spacing: 1, cellUnits: 100, descentRows: 0 } as any }, glyph(doc, doc.glyphs[1].id).id)).toThrow(/LED/);
  });

  it('adds components and refreshes the flattened outline and LSB', () => {
    const { doc, A, acute, Aacute } = setup();
    let d = startComposite(doc, Aacute);
    d = addComponent(d, Aacute, A);
    d = addComponent(d, Aacute, acute, { dx: 40, dy: -20 });
    const g = glyph(d, Aacute);
    expect(g.kind).toBe('compound');
    expect(g.compound!.map((c) => c.glyphId)).toEqual([A, acute]);
    expect(g.compound![1].transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 40, f: -20 });
    const aBox = contourBounds(resolveGlyphContours(glyph(d, A), d.glyphs))!;
    const flat = contourBounds(g.contours)!;
    expect(flat.xMax).toBeGreaterThanOrEqual(aBox.xMax);
    expect(g.leftSideBearing).toBe(flat.xMin);
    // the accent sits where we put it
    const acuteBox = contourBounds(resolveGlyphContours(glyph(d, acute), d.glyphs))!;
    const placed = contourBounds(componentContours(d, g.compound![1]))!;
    expect(placed.xMin - acuteBox.xMin).toBe(40);
    expect(placed.yMin - acuteBox.yMin).toBe(-20);
    expect(g.edited).toBe(true);
  });

  it('only components that exist and would not loop are offered', () => {
    const { doc, A, acute, Aacute } = setup();
    let d = startComposite(doc, Aacute);
    d = addComponent(d, Aacute, A);
    expect(componentProblem(d, Aacute, Aacute)).toMatch(/itself/);
    expect(componentProblem(d, Aacute, 'nope')).toMatch(/does not exist/);
    expect(componentProblem(d, Aacute, d.glyphs[0].id)).toMatch(/notdef/);
    // A cannot include Aacute, which already includes A
    let d2 = startComposite(d, A);
    expect(() => addComponent(d2, A, Aacute)).toThrow(/loop/);
    expect(dependsOn(d, Aacute, A)).toBe(true);
    expect(dependsOn(d, A, Aacute)).toBe(false);
    expect(availableComponents(d, Aacute).map((g) => g.id)).toContain(acute);
    expect(availableComponents(d, Aacute).map((g) => g.id)).not.toContain(Aacute);
  });

  it('detects a loop through an intermediate composite', () => {
    const { doc, A, acute, Aacute } = setup();
    let d = startComposite(startComposite(doc, Aacute), acute);
    d = addComponent(d, Aacute, A);
    d = addComponent(d, acute, Aacute); // acute ⊃ Aacute ⊃ A
    expect(() => addComponent(d, Aacute, acute)).toThrow(/loop/); // Aacute ⊂ acute already
    const dA = startComposite(d, A);
    expect(() => addComponent(dA, A, acute)).toThrow(/loop/);
  });

  it('edits offsets and scale, rounding offsets and F2Dot14-quantising scale', () => {
    const { doc, A, acute, Aacute } = setup();
    let d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    d = updateComponent(d, Aacute, 1, { dx: 12.6, dy: -3.2, scaleX: 0.5, scaleY: 0.5 });
    const t = glyph(d, Aacute).compound![1].transform;
    expect(t).toMatchObject({ e: 13, f: -3, a: 0.5, d: 0.5, b: 0, c: 0 });
    d = updateComponent(d, Aacute, 1, { scaleX: 0.3333 });
    expect(Math.abs(glyph(d, Aacute).compound![1].transform.a - 0.3333)).toBeLessThan(1 / 16384);
    expect(glyph(d, Aacute).compound![1].transform.d).toBe(0.5); // untouched
    const placed = contourBounds(componentContours(d, glyph(d, Aacute).compound![1]))!;
    const orig = contourBounds(resolveGlyphContours(glyph(d, acute), d.glyphs))!;
    expect(placed.xMax - placed.xMin).toBeLessThan(orig.xMax - orig.xMin);
  });

  it('validates numbers', () => {
    const { doc, A, Aacute } = setup();
    const d = addComponent(startComposite(doc, Aacute), Aacute, A);
    for (const bad of [0, NaN, Infinity, MAX_COMPONENT_SCALE + 0.01, -2.5]) {
      expect(() => updateComponent(d, Aacute, 0, { scaleX: bad })).toThrow(/Scale X/);
    }
    expect(() => updateComponent(d, Aacute, 0, { dx: NaN })).toThrow(/Offset X/);
    expect(() => updateComponent(d, Aacute, 0, { dy: 40000 })).toThrow(/Offset Y/);
    expect(() => updateComponent(d, Aacute, 5, { dx: 1 })).toThrow(/No such component/);
    expect(updateComponent(d, Aacute, 0, { scaleX: -1 }).glyphs).toBeTruthy(); // mirrored is allowed
  });

  it('keeps a rotation/skew it cannot edit', () => {
    const { doc, A, Aacute } = setup();
    let d = addComponent(startComposite(doc, Aacute), Aacute, A);
    d = { ...d, glyphs: d.glyphs.map((g) => (g.id === Aacute ? { ...g, compound: g.compound!.map((c) => ({ ...c, transform: { ...c.transform, b: 0.25 } })) } : g)) };
    d = updateComponent(d, Aacute, 0, { dx: 10 });
    expect(glyph(d, Aacute).compound![0].transform.b).toBe(0.25);
    expect(componentInfos(d, glyph(d, Aacute))[0].skewed).toBe(true);
  });

  it('removes and reorders components', () => {
    const { doc, A, acute, Aacute } = setup();
    let d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    d = moveComponent(d, Aacute, 0, 1);
    expect(glyph(d, Aacute).compound!.map((c) => c.glyphId)).toEqual([acute, A]);
    expect(moveComponent(d, Aacute, 1, 1)).toBe(d);
    expect(() => moveComponent(d, Aacute, 0, 4)).toThrow();
    d = removeComponent(d, Aacute, 0);
    expect(glyph(d, Aacute).compound!.map((c) => c.glyphId)).toEqual([A]);
    d = removeComponent(d, Aacute, 0);
    expect(glyph(d, Aacute)).toMatchObject({ kind: 'compound', compound: [], contours: [] });
    expect(() => removeComponent(d, Aacute, 0)).toThrow();
  });

  it('matches the base advance', () => {
    const { doc, A, Aacute } = setup();
    let d = addComponent(startComposite(doc, Aacute), Aacute, A);
    d = { ...d, glyphs: d.glyphs.map((g) => (g.id === Aacute ? { ...g, advanceWidth: 11 } : g)) };
    expect(glyph(matchBaseAdvance(d, Aacute), Aacute).advanceWidth).toBe(glyph(d, A).advanceWidth);
    expect(() => matchBaseAdvance(startComposite(doc, Aacute), Aacute)).toThrow(/Add a component/);
  });

  it('is one undo step per change in the store', () => {
    const { doc, A, Aacute } = setup();
    useStore.getState().loadFont('A', startComposite(doc, Aacute), 'c.pixeel');
    const past = useStore.getState().past.A.length;
    useStore.getState().commit('A', 'Add component', (d) => addComponent(d, Aacute, A));
    expect(useStore.getState().past.A.length).toBe(past + 1);
    useStore.getState().undo('A');
    expect(glyph(useStore.getState().fonts.A!, Aacute).compound).toEqual([]);
  });
});

describe('composites in exported fonts', () => {
  it('are written as composites with their offsets and scale, and read back', async () => {
    const { doc, A, acute, Aacute } = setup();
    let d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute, { dx: 64, dy: 32, scaleX: 0.5 });
    const { buffer, report } = buildTtf({ doc: d, sourceTtf: null, options: OPTS });
    expect(report.validation?.ok).toBe(true);
    expect(report.notes.join(' ')).not.toMatch(/Aacute|flattened/);
    const idx = (id: string) => d.glyphs.findIndex((g) => g.id === id);
    const ttf = parseTtf(buffer);
    const out = ttf.glyf[idx(Aacute)];
    expect(out.compound).toBe(true);
    expect(out.glyfs.map((c: any) => c.glyphIndex)).toEqual([idx(A), idx(acute)]);
    expect(out.glyfs[1].transform).toMatchObject({ e: 64, f: 32 });
    expect(out.glyfs[1].transform.a).toBeCloseTo(0.5, 3);

    const back = (await importFont(buffer, 'c.ttf')).doc;
    const bg = back.glyphs[idx(Aacute)];
    expect(bg.kind).toBe('compound');
    expect(bg.compound!.map((c) => c.srcGlyphIndex)).toEqual([idx(A), idx(acute)]);
    expect(bg.compound![1].transform).toMatchObject({ e: 64, f: 32 });
    expect(bg.compound![1].transform.a).toBeCloseTo(0.5, 3);
    expect(bg.compound![1].transform.d).toBeCloseTo(0.5, 3);
    // components are real glyphs of the re-imported font
    expect(bg.compound!.every((c) => c.glyphId === back.glyphs[c.srcGlyphIndex].id)).toBe(true);
  });

  it('survive a second export/import unchanged', async () => {
    const { doc, A, acute, Aacute } = setup();
    const d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute, { dx: 64, dy: 32 });
    const once = (await importFont(buildTtf({ doc: d, sourceTtf: null, options: OPTS }).buffer, 'a.ttf')).doc;
    const twice = (await importFont(buildTtf({ doc: once, sourceTtf: null, options: OPTS }).buffer, 'b.ttf')).doc;
    const strip = (x: FontDoc) => x.glyphs.filter((g) => g.kind === 'compound').map((g) => g.compound!.map((c) => [c.srcGlyphIndex, c.transform]));
    expect(strip(twice)).toEqual(strip(once));
    expect(strip(once).length).toBe(1);
  });

  it('an empty composite exports as an empty glyph', () => {
    const { doc, Aacute } = setup();
    const { buffer, report } = buildTtf({ doc: startComposite(doc, Aacute), sourceTtf: null, options: OPTS });
    expect(report.validation?.ok).toBe(true);
    const g = parseTtf(buffer).glyf[doc.glyphs.findIndex((x) => x.id === Aacute)];
    expect(g.compound).toBeFalsy();
    expect(g.contours?.length ?? 0).toBe(0);
  });

  it('export flattens a composite whose component was deleted, and says so', () => {
    const { doc, A, acute, Aacute } = setup();
    let d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute);
    d = removeGlyphs(d, [acute]);
    expect(componentInfos(d, glyph(d, Aacute)).filter((i) => !i.glyph).length).toBe(1);
    const { buffer, report } = buildTtf({ doc: d, sourceTtf: null, options: OPTS });
    expect(report.notes.join(' ')).toMatch(/flattened/);
    const g = parseTtf(buffer).glyf[d.glyphs.findIndex((x) => x.id === Aacute)];
    expect(g.compound).toBeFalsy();
    expect(g.contours.length).toBeGreaterThan(0);
  });

  it('survive project save and load', async () => {
    const { serializeProject, deserializeProject } = await import('../src/core/project');
    const { doc, A, acute, Aacute } = setup();
    const d = addComponent(addComponent(startComposite(doc, Aacute), Aacute, A), Aacute, acute, { dx: 5 });
    const json = JSON.stringify(serializeProject({ A: d, B: null }, 'A', { theme: 'light' }));
    const back = deserializeProject(json).project.fonts.A!;
    expect(glyph(back, Aacute).compound).toEqual(glyph(d, Aacute).compound);
    expect(glyph(back, Aacute).kind).toBe('compound');
  });
});

describe('real font composites (Lato)', () => {
  function lato(): ArrayBuffer {
    const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  it('keeps every composite as a composite with identical components when unedited', async () => {
    const src = parseTtf(lato());
    const { doc, sourceTtf } = await importFont(lato(), 'Lato-Regular.ttf');
    const ref = registerSource(sourceTtf);
    const out = parseTtf(buildTtf({ doc: { ...doc, sourceRef: ref }, sourceTtf: getSource(ref) ?? null, options: { preserveHinting: true, preserveKerning: true, validate: false } }).buffer);
    let checked = 0;
    src.glyf.forEach((g: any, i: number) => {
      if (!g.compound) return;
      checked += 1;
      expect(out.glyf[i].compound, `glyph ${i}`).toBe(true);
      expect(out.glyf[i].glyfs.map((c: any) => c.glyphIndex)).toEqual(g.glyfs.map((c: any) => c.glyphIndex));
      expect(out.glyf[i].glyfs.map((c: any) => [c.transform.e, c.transform.f])).toEqual(g.glyfs.map((c: any) => [c.transform.e, c.transform.f]));
    });
    expect(checked).toBeGreaterThan(100);
  });

  it('edits one composite in the builder and exports it as a composite with the new offset', async () => {
    const { doc } = await importFont(lato(), 'Lato-Regular.ttf');
    const target = doc.glyphs.find((g) => g.kind === 'compound' && g.compound!.length >= 2 && g.compound!.every((c) => c.glyphId))!;
    const before = target.compound![1].transform;
    const edited = updateComponent(doc, target.id, 1, { dx: before.e + 30, dy: before.f + 10 });
    const out = parseTtf(buildTtf({ doc: edited, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: false } }).buffer);
    const idx = doc.glyphs.indexOf(target);
    expect(out.glyf[idx].compound).toBe(true);
    expect(out.glyf[idx].glyfs[1].transform).toMatchObject({ e: before.e + 30, f: before.f + 10 });
    // other composites are untouched
    const other = doc.glyphs.findIndex((g, i) => g.kind === 'compound' && i !== idx);
    expect(out.glyf[other].compound).toBe(true);
  });
});
