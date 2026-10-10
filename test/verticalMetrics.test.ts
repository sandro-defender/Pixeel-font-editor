import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VERTICAL_PRESETS,
  applyVerticalPreset,
  checkVerticalMetrics,
  effectiveVertical,
  fontExtent,
  lineHeight,
  syncOs2ToHhea,
  validateVerticalMetrics,
} from '../src/core/verticalMetrics';
import { buildTtf, importFont, resolveGlyphContours } from '../src/core/fontCodec';
import { registerSource, getSource } from '../src/core/sourceRegistry';
import { setVerticalMetrics } from '../src/state/glyphActions';
import { useStore } from '../src/state/store';
import type { FontMetrics } from '../src/core/types';
import { drawGlyph, newTestFont, parseTtf } from './helpers';

const M: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: -200, lineGap: 0 };

function exportDoc(doc: ReturnType<typeof newTestFont>, sourceTtf?: any) {
  const sourceRef = sourceTtf ? registerSource(sourceTtf) : doc.sourceRef;
  const withRef = { ...doc, sourceRef };
  return parseTtf(
    buildTtf({ doc: withRef, sourceTtf: sourceRef ? (getSource(sourceRef) ?? null) : null, options: { preserveHinting: true, preserveKerning: true, validate: true } }).buffer,
  );
}

describe('vertical metrics helpers', () => {
  it('fills in typo / win from hhea when unset', () => {
    expect(effectiveVertical(M)).toMatchObject({ typoAscender: 800, typoDescender: -200, typoLineGap: 0, winAscent: 800, winDescent: 200, useTypoMetrics: false });
    expect(effectiveVertical({ ...M, typoAscender: 750, winAscent: 900, useTypoMetrics: true })).toMatchObject({ typoAscender: 750, winAscent: 900, useTypoMetrics: true });
  });

  it('computes line height', () => {
    expect(lineHeight(M)).toBe(1000);
    expect(lineHeight({ ascent: 905, descent: -212, lineGap: 33 })).toBe(1150);
  });

  it('allows a zero descent with a warning', () => {
    const r = validateVerticalMetrics({ ...M, descent: 0, typoDescender: 0, winDescent: 0 });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/Descent is 0/);
  });

  it('accepts valid metrics', () => {
    expect(validateVerticalMetrics(M).errors).toEqual([]);
  });

  it.each([
    [{ ascent: 0 }, /Ascent must be positive/],
    [{ ascent: -5 }, /Ascent must be positive/],
    [{ descent: 100 }, /Descent must be negative/],
    [{ lineGap: -1 }, /Line gap cannot be negative/],
    [{ ascent: 800.5 }, /whole numbers/],
    [{ ascent: NaN }, /must be numbers/],
    [{ typoAscender: 0 }, /Typo ascender must be positive/],
    [{ typoDescender: 10 }, /Typo descender/],
    [{ winAscent: -1 }, /Win ascent/],
    [{ winDescent: 70000 }, /Win descent/],
    [{ ascent: 40000 }, /within ±/],
    [{ unitsPerEm: 4 }, /Units per em/],
  ] as Array<[Partial<FontMetrics>, RegExp]>)('rejects %j', (patch, re) => {
    const { errors } = validateVerticalMetrics({ ...M, ...patch });
    expect(errors.join('\n')).toMatch(re);
  });

  it('warns about unusual or platform-inconsistent values', () => {
    expect(validateVerticalMetrics({ ...M, ascent: 500, descent: -100 }).warnings.join()).toMatch(/less than 0.8 em/);
    expect(validateVerticalMetrics({ ...M, lineGap: 1500 }).warnings.join()).toMatch(/more than 2.2 em/);
    expect(validateVerticalMetrics({ ...M, typoAscender: 600 }).warnings.join()).toMatch(/typo line height/);
    expect(validateVerticalMetrics({ ...M, winAscent: 100 }).warnings.join()).toMatch(/clipped on Windows/);
    expect(validateVerticalMetrics(M).warnings).toEqual([]);
  });

  it('warns when glyphs would be clipped, using the font extent', () => {
    let doc = newTestFont(8, 8, 'VM');
    doc = drawGlyph(doc, 65, (bm) => { for (let y = 0; y < 8; y++) bm.set(1, y, 1); }).doc;
    const extent = fontExtent(doc, (g) => resolveGlyphContours(g, doc.glyphs));
    expect(extent).not.toBeNull();
    const m = { ...doc.metrics, winAscent: 10, winDescent: 10 };
    expect(validateVerticalMetrics(m, extent).warnings.join()).toMatch(/tallest glyph/);
    expect(validateVerticalMetrics(m, extent).warnings.join()).toMatch(/deepest glyph/);
    expect(fontExtent(newTestFont(8, 8, 'Empty'), (g) => resolveGlyphContours(g, []))).toBeNull();
  });

  it('presets scale to the em and sync typo / win', () => {
    for (const p of VERTICAL_PRESETS) {
      const m = applyVerticalPreset({ ...M, unitsPerEm: 2048 }, p);
      expect(validateVerticalMetrics(m).errors, p.id).toEqual([]);
      expect(m.ascent).toBe(Math.round(2048 * p.ascent));
      expect(m.typoAscender).toBe(m.ascent);
      expect(m.winDescent).toBe(-m.descent);
    }
    const airy = applyVerticalPreset(M, VERTICAL_PRESETS.find((p) => p.id === 'airy')!);
    expect(lineHeight(airy)).toBe(1400);
  });

  it('syncOs2ToHhea copies hhea into typo and win', () => {
    expect(syncOs2ToHhea({ ...M, typoAscender: 1, winAscent: 1 })).toMatchObject({ typoAscender: 800, typoDescender: -200, typoLineGap: 0, winAscent: 800, winDescent: 200 });
  });

  it('checkVerticalMetrics rounds and throws on the first error', () => {
    expect(checkVerticalMetrics({ ...M, typoLineGap: 10.4 }).typoLineGap).toBe(10);
    expect(() => checkVerticalMetrics({ ...M, descent: 5 })).toThrow(/Descent/);
  });
});

describe('vertical metrics edits', () => {
  it('setVerticalMetrics replaces all values and rejects bad input without changing the font', () => {
    const doc = newTestFont(8, 8, 'VM');
    const next = setVerticalMetrics(doc, { ...doc.metrics, ascent: 900, descent: -300, lineGap: 50, typoAscender: 880, winAscent: 950, useTypoMetrics: true });
    expect(next.metrics).toMatchObject({ ascent: 900, descent: -300, lineGap: 50, typoAscender: 880, winAscent: 950, useTypoMetrics: true });
    expect(doc.metrics.ascent).not.toBe(900);
    expect(() => setVerticalMetrics(doc, { ...doc.metrics, ascent: -1 })).toThrow();
  });

  it('is one undoable step in the store', () => {
    const s = useStore.getState();
    s.loadFont('A', newTestFont(8, 8, 'VM'), 'vm.pixeel');
    const before = useStore.getState().fonts.A!.metrics;
    const past = useStore.getState().past.A.length;
    useStore.getState().commit('A', 'Edit vertical metrics', (d) => setVerticalMetrics(d, { ...d.metrics, ascent: 777, typoAscender: 777 }));
    expect(useStore.getState().fonts.A!.metrics.ascent).toBe(777);
    expect(useStore.getState().past.A.length).toBe(past + 1);
    useStore.getState().undo('A');
    expect(useStore.getState().fonts.A!.metrics).toEqual(before);
    useStore.getState().redo('A');
    expect(useStore.getState().fonts.A!.metrics.typoAscender).toBe(777);
  });

  it('survives project save and load', async () => {
    const { serializeProject, deserializeProject } = await import('../src/core/project');
    const doc = newTestFont(8, 8, 'VM');
    const edited = setVerticalMetrics(doc, { ...doc.metrics, typoAscender: 7, typoDescender: -2, typoLineGap: 1, winAscent: 11, winDescent: 4, useTypoMetrics: true });
    const json = JSON.stringify(serializeProject({ A: edited, B: null }, 'A', { theme: 'light' }));
    expect(deserializeProject(json).project.fonts.A!.metrics).toEqual(edited.metrics);
  });
});

describe('vertical metrics export and import', () => {
  it('writes hhea, typo, win and the use-typo flag to the font', () => {
    const doc = newTestFont(8, 8, 'VM');
    const edited = setVerticalMetrics(doc, { ...doc.metrics, ascent: 900, descent: -300, lineGap: 40, typoAscender: 850, typoDescender: -250, typoLineGap: 20, winAscent: 950, winDescent: 350, useTypoMetrics: true });
    const ttf = exportDoc(edited);
    expect(ttf.hhea).toMatchObject({ ascent: 900, descent: -300, lineGap: 40 });
    expect(ttf['OS/2']).toMatchObject({ sTypoAscender: 850, sTypoDescender: -250, sTypoLineGap: 20, usWinAscent: 950, usWinDescent: 350 });
    expect(ttf['OS/2'].fsSelection & 0x80).toBe(0x80);
    const cleared = setVerticalMetrics(edited, { ...edited.metrics, useTypoMetrics: false });
    expect(exportDoc(cleared)['OS/2'].fsSelection & 0x80).toBe(0);
  });

  it('round-trips typo / win / flag through export and re-import', async () => {
    const doc = newTestFont(8, 8, 'VM');
    const edited = setVerticalMetrics(doc, { ...doc.metrics, typoAscender: 830, typoDescender: -270, typoLineGap: 15, winAscent: 990, winDescent: 310, useTypoMetrics: true });
    const { buffer } = buildTtf({ doc: edited, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: true } });
    const back = (await importFont(buffer, 'vm.ttf')).doc.metrics;
    expect(back).toMatchObject({ ascent: edited.metrics.ascent, descent: edited.metrics.descent, lineGap: edited.metrics.lineGap, typoAscender: 830, typoDescender: -270, typoLineGap: 15, winAscent: 990, winDescent: 310, useTypoMetrics: true });
  });

  it('keeps an imported font\'s own OS/2 values through an unedited export', async () => {
    const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const { doc, sourceTtf } = await importFont(ab, 'Lato-Regular.ttf');
    const srcOs2 = parseTtf(ab)['OS/2'];
    expect(doc.metrics).toMatchObject({ typoAscender: srcOs2.sTypoAscender, typoDescender: srcOs2.sTypoDescender, typoLineGap: srcOs2.sTypoLineGap, winAscent: srcOs2.usWinAscent, winDescent: srcOs2.usWinDescent });
    const ttf = exportDoc(doc, sourceTtf);
    expect(ttf['OS/2']).toMatchObject({ sTypoAscender: srcOs2.sTypoAscender, sTypoDescender: srcOs2.sTypoDescender, sTypoLineGap: srcOs2.sTypoLineGap, usWinAscent: srcOs2.usWinAscent, usWinDescent: srcOs2.usWinDescent });
    expect(ttf['OS/2'].fsSelection & 0x80).toBe(srcOs2.fsSelection & 0x80);
  });
});
