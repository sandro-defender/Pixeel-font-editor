import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KERN_PAIRS_PER_SUBTABLE,
  buildKernTable,
  deleteKerningPair,
  getKerning,
  kerningRows,
  kerningToIndexPairs,
  layoutKerned,
  pairFrequencyRank,
  parseGposKerning,
  parseKernTable,
  resolveGlyphInput,
  resolvePairText,
  setKerningPair,
} from '../src/core/kerning';
import { buildTtf, glyphOrderPreserved, importFont } from '../src/core/fontCodec';
import { registerSource } from '../src/core/sourceRegistry';
import { applyLedMatrix, removeGlyphs, setGlyphMetrics } from '../src/state/glyphActions';
import { normalizeLedSpec } from '../src/core/ledMatrix';
import type { FontDoc } from '../src/core/types';
import { drawGlyph, newTestFont, parseTtf } from './helpers';

function lato(): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A small pixel font with glyphs A V T o. */
function kernFont(): { doc: FontDoc; id: (ch: string) => string } {
  let doc = newTestFont(8, 8, 'KernTest');
  for (const ch of 'AVTo') doc = drawGlyph(doc, ch.codePointAt(0)!, (bm) => bm.set(1, 1, 1)).doc;
  const id = (ch: string) => doc.glyphs.find((g) => g.unicode === ch.codePointAt(0))!.id;
  return { doc, id };
}

describe('kern table codec', () => {
  it('round-trips pairs (negative values, sorted, zero values skipped)', () => {
    const bytes = buildKernTable([
      { left: 5, right: 9, value: -120 },
      { left: 2, right: 3, value: 40 },
      { left: 2, right: 1, value: -1 },
      { left: 7, right: 7, value: 0 },
    ]);
    const parsed = parseKernTable(bytes);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.pairs).toEqual([
      { left: 2, right: 1, value: -1 },
      { left: 2, right: 3, value: 40 },
      { left: 5, right: 9, value: -120 },
    ]);
  });

  it('writes nothing for no effective pairs and keeps the last of duplicate pairs', () => {
    expect(buildKernTable([])).toEqual([]);
    expect(buildKernTable([{ left: 1, right: 2, value: 0 }])).toEqual([]);
    const dup = parseKernTable(buildKernTable([{ left: 1, right: 2, value: 10 }, { left: 1, right: 2, value: 20 }]));
    expect(dup.pairs).toEqual([{ left: 1, right: 2, value: 20 }]);
  });

  it('splits very large lists across subtables and reads them all back', () => {
    const n = KERN_PAIRS_PER_SUBTABLE + 500;
    const pairs = Array.from({ length: n }, (_, i) => ({ left: Math.floor(i / 200), right: i % 200, value: (i % 50) + 1 }));
    const bytes = buildKernTable(pairs);
    expect((bytes[2] << 8) | bytes[3]).toBe(2); // two subtables
    expect(parseKernTable(bytes).pairs.length).toBe(n);
  });

  it('warns about Apple-layout and damaged tables instead of throwing', () => {
    expect(parseKernTable([0, 1, 0, 0, 0, 0, 0, 0]).warnings.join(' ')).toMatch(/Apple/);
    expect(parseKernTable([0, 0, 0, 1, 0, 0, 0, 200, 0, 0]).pairs).toEqual([]);
  });
});

describe('importing kerning from a real font', () => {
  it('reads the GPOS kern feature (class pairs expanded) with plausible values', async () => {
    const { doc, warnings } = await importFont(lato(), 'Lato-Regular.ttf');
    expect(doc.kerning!.length).toBeGreaterThan(5000);
    expect(doc.kerning!.length).toBeLessThanOrEqual(25000);
    expect(warnings.join(' ')).toMatch(/most common/);
    expect(doc.kerningEdited).toBeUndefined();
    const A = doc.glyphs.find((g) => g.unicode === 65)!;
    const V = doc.glyphs.find((g) => g.unicode === 86)!;
    const T = doc.glyphs.find((g) => g.unicode === 84)!;
    expect(getKerning(doc, A.id, V.id)).toBeLessThan(0); // AV is the textbook kerning pair
    expect(getKerning(doc, A.id, T.id)).toBeLessThan(0);
    expect(getKerning(doc, V.id, A.id)).toBeLessThan(0);
  });

  it('GPOS parsing is robust to garbage', () => {
    expect(parseGposKerning([1, 2, 3]).pairs).toEqual([]);
    const junk = Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff);
    expect(() => parseGposKerning(junk)).not.toThrow();
  });
});

describe('pair editing', () => {
  it('adds, edits and deletes pairs by glyph id', () => {
    const { doc, id } = kernFont();
    const a = setKerningPair(doc, id('A'), id('V'), -80);
    expect(getKerning(a, id('A'), id('V'))).toBe(-80);
    expect(a.kerningEdited).toBe(true);
    expect(doc.kerning).toBeUndefined(); // original not mutated
    const b = setKerningPair(a, id('A'), id('V'), -95.4);
    expect(b.kerning).toHaveLength(1);
    expect(getKerning(b, id('A'), id('V'))).toBe(-95);
    const c = deleteKerningPair(b, id('A'), id('V'));
    expect(c.kerning).toHaveLength(0);
    expect(deleteKerningPair(c, id('A'), id('V'))).toBe(c);
  });

  it('validates glyphs and range', () => {
    const { doc, id } = kernFont();
    expect(() => setKerningPair(doc, id('A'), 'nope', 1)).toThrow(/not found/);
    expect(() => setKerningPair(doc, id('A'), id('V'), 40000)).toThrow(/between/);
    expect(() => setKerningPair(doc, id('A'), id('V'), NaN)).toThrow();
  });

  it('is one undo step through the store', async () => {
    const { useStore } = await import('../src/state/store');
    const { doc, id } = kernFont();
    useStore.getState().loadFont('A', doc, 'k.pixeel');
    const before = useStore.getState().past.A.length;
    useStore.getState().commit('A', 'Set kerning', (d) => setKerningPair(d, id('A'), id('V'), -50));
    expect(useStore.getState().past.A.length).toBe(before + 1);
    useStore.getState().undo('A');
    expect(useStore.getState().fonts.A!.kerning).toBeUndefined();
  });

  it('resolves characters, code points and glyph names', () => {
    const { doc, id } = kernFont();
    expect(resolveGlyphInput(doc, 'A')?.id).toBe(id('A'));
    expect(resolveGlyphInput(doc, 'U+0056')?.id).toBe(id('V'));
    expect(resolveGlyphInput(doc, '0x54')?.id).toBe(id('T'));
    expect(resolveGlyphInput(doc, '111')?.id).toBe(id('o')); // decimal
    expect(resolveGlyphInput(doc, 'Q')).toBeNull();
    expect(resolvePairText(doc, 'AV')).toMatchObject({ left: { id: id('A') }, right: { id: id('V') } });
    expect(resolvePairText(doc, 'U+0041 U+0056')?.right.id).toBe(id('V'));
    expect(resolvePairText(doc, 'A V')?.left.id).toBe(id('A'));
    expect(resolvePairText(doc, 'AVT')).toBeNull();
    expect(resolvePairText(doc, 'AQ')).toBeNull();
  });
});

describe('list: search and frequency sort', () => {
  it('ranks classic kerning pairs and common bigrams before the rest', () => {
    expect(pairFrequencyRank('A', 'V')).toBeLessThan(pairFrequencyRank('t', 'h'));
    expect(pairFrequencyRank('t', 'h')).toBeLessThan(pairFrequencyRank('x', 'q'));
    expect(pairFrequencyRank('x', 'q')).toBe(Number.POSITIVE_INFINITY);
    expect(pairFrequencyRank(null, 'a')).toBe(Number.POSITIVE_INFINITY);
  });

  it('sorts by frequency (default), value or left glyph, and filters by search', () => {
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('o'), id('T'), -5);
    doc = setKerningPair(doc, id('T'), id('o'), -60);
    doc = setKerningPair(doc, id('A'), id('V'), -90);
    doc = setKerningPair(doc, id('A'), id('T'), -70);
    const chars = (q: string, sort: 'frequency' | 'value' | 'left') => kerningRows(doc, q, sort).map((r) => r.leftChar + r.rightChar);
    expect(chars('', 'frequency').slice(0, 3)).toEqual(['AV', 'AT', 'To']);
    expect(chars('', 'frequency')[3]).toBe('oT'); // unranked pair last
    expect(chars('', 'value')).toEqual(['AV', 'AT', 'To', 'oT']);
    expect(chars('', 'left')).toEqual(['AT', 'AV', 'To', 'oT']);
    expect(chars('av', 'frequency')).toEqual(['AV']);
    expect(chars('U+0054', 'left')).toEqual(['AT', 'To', 'oT']);
    expect(chars('-60', 'left')).toEqual(['To']);
    expect(chars('zzz', 'left')).toEqual([]);
  });
});

describe('layout with kerning', () => {
  it('moves the next glyph by the pair value and reports it', () => {
    const { doc, id } = kernFont();
    const k = setKerningPair(doc, id('A'), id('V'), -30);
    const plain = layoutKerned(k, 'AVT', k.kerning, false);
    const kerned = layoutKerned(k, 'AVT');
    const adv = k.glyphs.find((g) => g.id === id('A'))!.advanceWidth;
    expect(plain.glyphs[1].x).toBe(adv);
    expect(kerned.glyphs[1].x).toBe(adv - 30);
    expect(kerned.glyphs[0].kern).toBe(-30);
    expect(kerned.glyphs[1].kern).toBe(0);
    expect(kerned.width).toBe(plain.width - 30);
    expect(layoutKerned(k, 'A?V').glyphs).toHaveLength(2); // unmapped characters are skipped
  });
});

describe('export / re-import round trip', () => {
  it('writes a kern table from the editor pairs and re-imports the same pairs', async () => {
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('A'), id('V'), -80);
    doc = setKerningPair(doc, id('T'), id('o'), -60);
    doc = setKerningPair(doc, id('V'), id('A'), 0); // zero pairs are not exported
    const { buffer, report } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);
    expect(report.validation?.checks.find((c) => c.name === 'Kerning pairs')?.ok).toBe(true);
    expect(report.writtenTables).toContain('kern');
    expect(report.notes.join(' ')).toMatch(/2 pairs/);

    const re = await importFont(buffer, 'out.ttf');
    const byId = new Map(re.doc.glyphs.map((g) => [g.id, g]));
    const got = re.doc.kerning!.map((p) => `${String.fromCodePoint(byId.get(p.left)!.unicode!)}${String.fromCodePoint(byId.get(p.right)!.unicode!)}:${p.value}`).sort();
    expect(got).toEqual(['AV:-80', 'To:-60']);
  });

  it('omits kerning when the option is off', async () => {
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('A'), id('V'), -80);
    const { buffer, report } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: false, validate: false } });
    expect(report.writtenTables).not.toContain('kern');
    expect(parseTtf(buffer).kern).toBeUndefined();
  });

  it('unedited imported kerning is passed through untouched (GPOS kept)', async () => {
    const { doc, sourceTtf } = await importFont(lato(), 'Lato-Regular.ttf');
    const withRef = { ...doc, sourceRef: registerSource(sourceTtf) };
    expect(glyphOrderPreserved(withRef)).toBe(true);
    const { buffer, report } = buildTtf({ doc: withRef, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    expect(report.preservedTables).toContain('GPOS');
    expect(parseTtf(buffer).GPOS).toBeTruthy();
    expect(parseTtf(buffer).kern).toBeUndefined();
  });

  it('edited imported kerning is rewritten as a kern table and reports the GPOS replacement', async () => {
    const { doc, sourceTtf } = await importFont(lato(), 'Lato-Regular.ttf');
    const A = doc.glyphs.find((g) => g.unicode === 65)!;
    const V = doc.glyphs.find((g) => g.unicode === 86)!;
    const edited = setKerningPair(doc, A.id, V.id, -123);
    const expected = kerningToIndexPairs(edited).filter((p) => p.value !== 0).length;
    const { buffer, report } = buildTtf({ doc: edited, sourceTtf, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);
    expect(report.droppedTables).toContain('GPOS');
    expect(report.notes.join(' ')).toMatch(/GPOS table was replaced/);
    const ttf = parseTtf(buffer);
    expect(ttf.GPOS).toBeUndefined();
    const re = await importFont(buffer, 'x.ttf');
    expect(re.doc.kerning!.length).toBe(expected);
    const A2 = re.doc.glyphs.find((g) => g.unicode === 65)!;
    const V2 = re.doc.glyphs.find((g) => g.unicode === 86)!;
    expect(getKerning(re.doc, A2.id, V2.id)).toBe(-123);
  });

  it('deleting a glyph keeps kerning consistent (pairs purged, kern table rewritten)', async () => {
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('A'), id('V'), -80);
    doc = setKerningPair(doc, id('T'), id('o'), -60);
    const removed = removeGlyphs(doc, [id('V')]);
    expect(removed.kerning).toHaveLength(1);
    const { buffer } = buildTtf({ doc: removed, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: false } });
    const re = await importFont(buffer, 'x.ttf');
    expect(re.doc.kerning).toHaveLength(1);
  });

  it('a changed glyph order forces a rewrite for imported fonts', async () => {
    const { doc } = await importFont(lato(), 'Lato-Regular.ttf');
    const victim = doc.glyphs.find((g) => g.unicode === 0x20ac) ?? doc.glyphs[10];
    const removed = removeGlyphs(doc, [victim.id]);
    expect(glyphOrderPreserved(removed)).toBe(false);
  });
});

describe('related edits', () => {
  it('scales pair values when an LED matrix changes the em size', () => {
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('A'), id('V'), -100);
    const spec = normalizeLedSpec({ rows: 8, cols: 8, spacing: 1, cellUnits: 50, descentRows: 0 });
    const next = applyLedMatrix(doc, spec);
    const ratio = next.metrics.unitsPerEm / doc.metrics.unitsPerEm;
    expect(getKerning(next, id('A'), id('V'))).toBe(Math.round(-100 * ratio));
  });

  it('leaves kerning untouched by metric edits', () => {
    const { doc, id } = kernFont();
    const k = setKerningPair(doc, id('A'), id('V'), -10);
    const m = setGlyphMetrics(k, id('A'), { advance: 700, lsb: 0 });
    expect(m.kerning).toBe(k.kerning);
  });
});

describe('highlighting kerned pairs in a text', () => {
  it('groups characters joined by non-zero pairs into runs', async () => {
    const { kernedRuns } = await import('../src/core/kerning');
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('A'), id('V'), -40);
    doc = setKerningPair(doc, id('V'), id('T'), 0); // zero: no highlight
    const { runs, pairCount } = kernedRuns(doc, 'oAVTo');
    expect(runs).toEqual([
      { text: 'o', kerned: false },
      { text: 'AV', kerned: true },
      { text: 'To', kerned: false },
    ]);
    expect(pairCount).toBe(1);
    expect(kernedRuns(doc, '').runs).toEqual([]);
    expect(kernedRuns(doc, 'A?V').pairCount).toBe(0); // an unmapped character breaks the pair
  });
});

describe('project files', () => {
  it('keep kerning pairs through save and load', async () => {
    const { serializeProject, deserializeProject } = await import('../src/core/project');
    let { doc, id } = kernFont();
    doc = setKerningPair(doc, id('A'), id('V'), -80);
    const json = JSON.stringify(serializeProject({ A: doc, B: null }, 'A', { theme: 'light' }));
    const back = deserializeProject(json).project.fonts.A!;
    expect(back.kerning).toEqual(doc.kerning);
    expect(back.kerningEdited).toBe(true);
  });
});
