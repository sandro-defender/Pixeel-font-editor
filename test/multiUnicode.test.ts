import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allUnicodes, codePointIndex, glyphForCodePoint, hasCodePoint, mappingConflicts, normalizeMappings, withoutCodePoint } from '../src/core/unicodeMap';
import { addUnicodeMapping, assignUnicode, duplicateGlyph, removeUnicodeMapping, setPrimaryUnicode } from '../src/state/glyphActions';
import { buildTtf, importFont } from '../src/core/fontCodec';
import { registerSource, getSource } from '../src/core/sourceRegistry';
import { transferGlyphs } from '../src/core/transfer';
import { useStore } from '../src/state/store';
import type { FontDoc } from '../src/core/types';
import { drawGlyph, newTestFont, parseTtf } from './helpers';

const A = 0x41, FULL_A = 0xff21, B = 0x42;

function font(): { doc: FontDoc; id: (cp: number) => string } {
  let doc = newTestFont(8, 8, 'MU');
  for (const cp of [A, B, 0x43]) doc = drawGlyph(doc, cp, (bm) => bm.set(1, 1, 1)).doc;
  return { doc, id: (cp) => doc.glyphs.find((g) => g.unicode === cp)!.id };
}
const glyph = (doc: FontDoc, id: string) => doc.glyphs.find((g) => g.id === id)!;

describe('unicodeMap helpers', () => {
  it('lists, finds and normalises mappings', () => {
    const { doc, id } = font();
    const g = { ...glyph(doc, id(A)), extraUnicodes: [FULL_A, A, FULL_A, 0xc0] };
    expect(allUnicodes(g)).toEqual([A, FULL_A, A, FULL_A, 0xc0]); // raw list is not deduped…
    const n = normalizeMappings(g);
    expect(allUnicodes(n)).toEqual([A, FULL_A, 0xc0]); // …normalise is
    expect(hasCodePoint(n, FULL_A)).toBe(true);
    expect(hasCodePoint(n, B)).toBe(false);
    expect(allUnicodes({ unicode: null, extraUnicodes: [1] })).toEqual([]);
    expect(normalizeMappings({ ...g, unicode: null, extraUnicodes: [0xc0, 0xc1] }).unicode).toBe(0xc0);
  });

  it('removing the primary promotes the next mapping', () => {
    const { doc, id } = font();
    const g = { ...glyph(doc, id(A)), extraUnicodes: [FULL_A, 0xc0] };
    expect(allUnicodes(withoutCodePoint(g, A))).toEqual([FULL_A, 0xc0]);
    expect(allUnicodes(withoutCodePoint(g, FULL_A))).toEqual([A, 0xc0]);
    expect(withoutCodePoint({ ...g, extraUnicodes: undefined }, A).unicode).toBeNull();
  });

  it('indexes code points and finds conflicts through extra mappings', () => {
    const { doc, id } = font();
    const withExtra = addUnicodeMapping(doc, id(A), FULL_A);
    expect(codePointIndex(withExtra).get(FULL_A)).toBe(id(A));
    expect(glyphForCodePoint(withExtra.glyphs, FULL_A)!.id).toBe(id(A));
    expect(mappingConflicts(withExtra, id(B), [FULL_A, 0x1234])).toEqual([{ codePoint: FULL_A, ownerId: id(A), ownerName: glyph(doc, id(A)).name }]);
    expect(mappingConflicts(withExtra, id(A), [FULL_A])).toEqual([]);
  });
});

describe('mapping actions', () => {
  it('adds an extra mapping and keeps the primary', () => {
    const { doc, id } = font();
    const next = addUnicodeMapping(doc, id(A), FULL_A);
    expect(glyph(next, id(A)).unicode).toBe(A);
    expect(glyph(next, id(A)).extraUnicodes).toEqual([FULL_A]);
    expect(doc.glyphs.find((g) => g.id === id(A))!.extraUnicodes).toBeUndefined(); // input untouched
  });

  it('gives an unmapped glyph its first mapping as primary', () => {
    const { doc, id } = font();
    const unmapped = assignUnicode(doc, id(A), null);
    const next = addUnicodeMapping(unmapped, id(A), 0x61);
    expect(glyph(next, id(A))).toMatchObject({ unicode: 0x61 });
    expect(glyph(next, id(A)).extraUnicodes).toBeUndefined();
  });

  it('rejects conflicts naming the owner, unless reassign is requested', () => {
    const { doc, id } = font();
    expect(() => addUnicodeMapping(doc, id(A), B)).toThrow(/already assigned to .*Reassign/s);
    const next = addUnicodeMapping(doc, id(A), B, { reassign: true });
    expect(allUnicodes(glyph(next, id(A)))).toEqual([A, B]);
    expect(glyph(next, id(B)).unicode).toBeNull(); // the old owner lost it
    // a conflict with an EXTRA mapping of another glyph is detected too
    const e = addUnicodeMapping(doc, id(A), FULL_A);
    expect(() => addUnicodeMapping(e, id(B), FULL_A)).toThrow(/already assigned/);
    const stolen = addUnicodeMapping(e, id(B), FULL_A, { reassign: true });
    expect(glyph(stolen, id(A)).extraUnicodes).toBeUndefined();
    expect(glyph(stolen, id(B)).extraUnicodes).toEqual([FULL_A]);
  });

  it('rejects invalid input', () => {
    const { doc, id } = font();
    expect(() => addUnicodeMapping(doc, id(A), 0xd800)).toThrow(/valid Unicode/);
    expect(() => addUnicodeMapping(doc, id(A), 0x110000)).toThrow(/valid Unicode/);
    expect(() => addUnicodeMapping(doc, id(A), A)).toThrow(/already mapped to/);
    const notdef = doc.glyphs.find((g) => g.name === '.notdef')!;
    expect(() => addUnicodeMapping(doc, notdef.id, 0x1234)).toThrow(/notdef/);
  });

  it('removes mappings and promotes when the primary goes', () => {
    const { doc, id } = font();
    const two = addUnicodeMapping(addUnicodeMapping(doc, id(A), FULL_A), id(A), 0xc0);
    expect(allUnicodes(glyph(removeUnicodeMapping(two, id(A), FULL_A), id(A)))).toEqual([A, 0xc0]);
    const noPrimary = removeUnicodeMapping(two, id(A), A);
    expect(glyph(noPrimary, id(A)).unicode).toBe(FULL_A);
    expect(glyph(noPrimary, id(A)).extraUnicodes).toEqual([0xc0]);
    expect(() => removeUnicodeMapping(doc, id(A), 0x1234)).toThrow(/not mapped/);
  });

  it('changes the primary mapping without losing any code point', () => {
    const { doc, id } = font();
    const two = addUnicodeMapping(doc, id(A), FULL_A);
    const swapped = setPrimaryUnicode(two, id(A), FULL_A);
    expect(glyph(swapped, id(A)).unicode).toBe(FULL_A);
    expect(glyph(swapped, id(A)).extraUnicodes).toEqual([A]);
    expect(setPrimaryUnicode(two, id(A), A)).toBe(two);
    // assignUnicode to an existing extra swaps as well
    expect(allUnicodes(glyph(assignUnicode(two, id(A), FULL_A), id(A)))).toEqual([FULL_A, A]);
    // …and rejects a code point another glyph owns, extras included
    expect(() => assignUnicode(two, id(B), FULL_A)).toThrow(/already assigned/);
  });

  it('clearing the primary via assignUnicode(null) removes every mapping', () => {
    const { doc, id } = font();
    const two = addUnicodeMapping(doc, id(A), FULL_A);
    const cleared = glyph(assignUnicode(two, id(A), null), id(A));
    expect(cleared.unicode).toBeNull();
    expect(cleared.extraUnicodes).toBeUndefined();
  });

  it('duplicating a glyph does not copy its code points', () => {
    const { doc, id } = font();
    const two = addUnicodeMapping(doc, id(A), FULL_A);
    const { copy } = duplicateGlyph(two, id(A));
    expect(allUnicodes(copy)).toEqual([]);
  });

  it('is one undo step in the store', () => {
    const { doc, id } = font();
    useStore.getState().loadFont('A', doc, 'm.pixeel');
    const past = useStore.getState().past.A.length;
    useStore.getState().commit('A', 'Add Unicode mapping', (d) => addUnicodeMapping(d, id(A), FULL_A));
    expect(useStore.getState().past.A.length).toBe(past + 1);
    useStore.getState().undo('A');
    expect(glyph(useStore.getState().fonts.A!, id(A)).extraUnicodes).toBeUndefined();
  });
});

describe('multi-unicode export and import', () => {
  it('writes every code point to the cmap and reads them all back', async () => {
    const { doc, id } = font();
    const multi = addUnicodeMapping(addUnicodeMapping(doc, id(A), FULL_A), id(A), 0xc0);
    const { buffer, report } = buildTtf({ doc: multi, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: true } });
    expect(report.validation?.ok).toBe(true);
    expect(report.validation?.checks.some((c) => c.name === 'Multiple code points per glyph' && c.ok)).toBe(true);

    const ttf = parseTtf(buffer);
    const idx = multi.glyphs.findIndex((g) => g.id === id(A));
    expect(ttf.cmap[A]).toBe(idx);
    expect(ttf.cmap[FULL_A]).toBe(idx);
    expect(ttf.cmap[0xc0]).toBe(idx);

    const back = (await importFont(buffer, 'mu.ttf')).doc;
    const g = back.glyphs[idx];
    expect([...allUnicodes(g)].sort((a, b) => a - b)).toEqual([A, 0xc0, FULL_A]);
    expect(back.glyphs.find((x) => x.unicode === B)!.extraUnicodes).toBeUndefined();
  });

  it('a second export round trip keeps the same mappings', async () => {
    const { doc, id } = font();
    const multi = addUnicodeMapping(doc, id(B), 0xff22);
    const once = (await importFont(buildTtf({ doc: multi, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: false } }).buffer, 'a.ttf')).doc;
    const twice = (await importFont(buildTtf({ doc: once, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: false } }).buffer, 'b.ttf')).doc;
    const map = (d: FontDoc) => [...codePointIndex(d).entries()].map(([cp, gid]) => [cp, d.glyphs.findIndex((g) => g.id === gid)]).sort((a, b) => a[0] - b[0]);
    expect(map(twice)).toEqual(map(once));
    expect(map(twice).filter(([, i]) => i === multi.glyphs.findIndex((g) => g.id === id(B))).map(([cp]) => cp)).toEqual([B, 0xff22]);
  });

  it('keeps the shared code points of a real font (Lato) through an unedited export', async () => {
    const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const { doc, sourceTtf } = await importFont(ab, 'Lato-Regular.ttf');
    const shared = doc.glyphs.filter((g) => (g.extraUnicodes?.length ?? 0) > 0);
    expect(shared.length).toBeGreaterThan(0);
    const sourceCmap = parseTtf(ab).cmap as Record<string, number>;
    const ref = registerSource(sourceTtf);
    const out = parseTtf(buildTtf({ doc: { ...doc, sourceRef: ref }, sourceTtf: getSource(ref) ?? null, options: { preserveHinting: true, preserveKerning: true, validate: true } }).buffer);
    for (const g of shared) {
      const idx = doc.glyphs.indexOf(g);
      for (const cp of allUnicodes(g)) {
        expect(out.cmap[cp], `U+${cp.toString(16)}`).toBe(idx);
        expect(sourceCmap[cp]).toBe(idx);
      }
    }
  });

  it('survives project save and load', async () => {
    const { serializeProject, deserializeProject } = await import('../src/core/project');
    const { doc, id } = font();
    const multi = addUnicodeMapping(doc, id(A), FULL_A);
    const json = JSON.stringify(serializeProject({ A: multi, B: null }, 'A', { theme: 'light' }));
    const back = deserializeProject(json).project.fonts.A!;
    expect(glyph(back, id(A)).extraUnicodes).toEqual([FULL_A]);
  });
});

describe('transfers with several code points', () => {
  const opts = { scaleByUpm: false, metricsMode: 'preserve', collision: 'skip' } as const;

  it('copies extra mappings that are free in the destination', () => {
    const { doc, id } = font();
    const src = addUnicodeMapping(doc, id(A), FULL_A);
    const dst = newTestFont(8, 8, 'Dst');
    const res = transferGlyphs(src, dst, [id(A)], opts as any);
    const copied = res.doc.glyphs.find((g) => g.unicode === A)!;
    expect(allUnicodes(copied)).toEqual([A, FULL_A]);
  });

  it('drops extra mappings the destination already uses and says so', () => {
    const { doc, id } = font();
    const src = addUnicodeMapping(doc, id(A), FULL_A);
    let dst = newTestFont(8, 8, 'Dst');
    dst = drawGlyph(dst, FULL_A, (bm) => bm.set(2, 2, 1)).doc;
    const res = transferGlyphs(src, dst, [id(A)], opts as any);
    const copied = res.doc.glyphs.find((g) => g.unicode === A)!;
    expect(allUnicodes(copied)).toEqual([A]);
    expect(res.notes.join(' ')).toMatch(/extra code point/);
    expect(res.doc.glyphs.find((g) => g.unicode === FULL_A)!.extraUnicodes).toBeUndefined();
  });

  it('detects a conflict through the destination\'s extra mappings', () => {
    const { doc, id } = font();
    const dst = addUnicodeMapping(doc, id(B), 0x61);
    const { doc: src, id: sid } = font();
    const withLower = drawGlyph(src, 0x61, (bm) => bm.set(1, 1, 1)).doc;
    const res = transferGlyphs(withLower, dst, [withLower.glyphs.find((g) => g.unicode === 0x61)!.id], opts as any);
    expect(res.skipped).toBe(1);
    void sid;
  });
});
