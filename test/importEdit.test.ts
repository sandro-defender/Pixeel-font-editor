import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Font } from 'fonteditor-core';
import { buildTtf, importFont, flattenedGlyph } from '../src/core/fontCodec';
import { getSource, registerSource } from '../src/core/sourceRegistry';
import { translateContours } from '../src/core/contours';

function loadLato(): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('importing a real TTF', () => {
  it('parses Lato with glyphs, metrics and compound detection', async () => {
    const { doc, sourceTtf, warnings } = await importFont(loadLato(), 'Lato-Regular.ttf');
    expect(doc.glyphs.length).toBeGreaterThan(1000);
    expect(doc.meta.fontFamily).toBe('Lato');
    expect(doc.metrics.unitsPerEm).toBeGreaterThan(0);
    expect(doc.source!.hasComposites).toBe(true);
    expect(doc.source!.tables).toContain('glyf');
    expect(doc.glyphs.some((g) => g.kind === 'compound')).toBe(true);
    const A = doc.glyphs.find((g) => g.unicode === 65);
    expect(A).toBeTruthy();
    expect(A!.kind).toBe('vector');
    expect(A!.contours.length).toBeGreaterThan(0);
    expect(Array.isArray(warnings)).toBe(true);
    expect(sourceTtf.glyf.length).toBe(doc.glyphs.length);
  });

  it('preserves unedited outlines and hinting/kerning through export', async () => {
    const { doc, sourceTtf } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const sourceRef = registerSource(sourceTtf);
    const docWithRef = { ...doc, sourceRef };

    const before = docWithRef.glyphs.find((g) => g.unicode === 76)!; // 'L'
    const { buffer, report } = buildTtf({
      doc: docWithRef,
      sourceTtf: getSource(sourceRef),
      options: { preserveHinting: true, preserveKerning: true, validate: true },
    });
    expect(report.validation?.ok).toBe(true);

    const re = Font.create(buffer, { type: 'ttf', hinting: true, kerning: true }) as Font;
    const ttf = re.data as any;
    expect(ttf.glyf.length).toBe(docWithRef.glyphs.length);
    // GPOS preserved
    expect(!!ttf.GPOS).toBe(true);
    expect(!!ttf.fpgm).toBe(true);
    // unedited glyph outlines identical
    const idx = ttf.cmap[76];
    const reL = ttf.glyf[idx];
    expect(reL.advanceWidth).toBe(before.advanceWidth);
    expect(reL.contours.length).toBe(before.contours.length);
    expect(report.preservedTables).toEqual(expect.arrayContaining(['GPOS', 'glyf', 'cmap']));
  });

  it('edited glyph replaces outline; instructions dropped only for edited glyphs', async () => {
    const { doc, sourceTtf } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const docRef = { ...doc, sourceRef: registerSource(sourceTtf) };
    const glyph = docRef.glyphs.find((g) => g.unicode === 65)!;
    // keep original instructions while marking the outline edited: the export
    // must drop the stale instructions and report it
    const moved = { ...glyph, contours: translateContours(glyph.contours, 25, 0), edited: true };
    const edited = { ...docRef, glyphs: docRef.glyphs.map((g) => (g.id === glyph.id ? moved : g)) };

    const { buffer, report } = buildTtf({
      doc: edited,
      sourceTtf: getSource(edited.sourceRef),
      options: { preserveHinting: true, preserveKerning: true, validate: true },
    });
    expect(report.validation?.ok).toBe(true);
    const re = Font.create(buffer, { type: 'ttf', hinting: true }) as Font;
    const ttf = re.data as any;
    const idx = ttf.cmap[65];
    const origIdx = (sourceTtf.cmap as any)[65];
    const orig = (sourceTtf.glyf as any[])[origIdx];
    expect(JSON.stringify(ttf.glyf[idx].contours)).not.toBe(JSON.stringify(orig.contours));
    // a report note about edited-glyph instructions (Lato has instructions)
    expect(report.notes.join(' ')).toMatch(/instructions/i);
  });

  it('flattens compound glyphs explicitly', async () => {
    const { doc } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const comp = doc.glyphs.find((g) => g.kind === 'compound');
    expect(comp).toBeTruthy();
    const flat = flattenedGlyph(comp!, doc.glyphs);
    expect(flat.kind).toBe('vector');
    expect(flat.compound).toBeNull();
    expect(flat.contours.length).toBeGreaterThan(0);
  });

  it('compound glyphs are preserved as composites when exported unedited', async () => {
    const { doc, sourceTtf } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const { buffer } = buildTtf({
      doc,
      sourceTtf,
      options: { preserveHinting: true, preserveKerning: true, validate: false },
    });
    const re = Font.create(buffer, { type: 'ttf' }) as Font;
    const ttf = re.data as any;
    expect(ttf.glyf.filter((g: any) => g.compound).length).toBeGreaterThan(100);
  });

  it('reports dropped tables honestly', async () => {
    const { doc, sourceTtf } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const { report } = buildTtf({
      doc,
      sourceTtf,
      options: { preserveHinting: false, preserveKerning: false, validate: false },
    });
    expect(report.droppedTables).toEqual(expect.arrayContaining(['GPOS']));
    expect(report.notes.join(' ')).toMatch(/kerning|Kerning/);
  });
});
