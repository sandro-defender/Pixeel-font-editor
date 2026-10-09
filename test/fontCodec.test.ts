import { describe, expect, it } from 'vitest';
import { drawGlyph, newTestFont, parseTtf } from './helpers';
import { buildTtf, importFont, validateExport } from '../src/core/fontCodec';
import { tracePixelData } from '../src/core/trace';
import type { FontDoc } from '../src/core/types';

function exportDoc(doc: FontDoc) {
  return buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
}

describe('create → draw → export → reimport', () => {
  it('exports a valid TTF with real glyf outlines and correct unicode mapping', async () => {
    let doc = newTestFont(8, 8, 'RoundTrip');
    const r1 = drawGlyph(doc, 65, (bm) => {
      // letter "A"-ish: two columns + crossbar
      bm.rect(1, 0, 1, 6, 1, true);
      bm.rect(6, 0, 6, 6, 1, true);
      bm.rect(2, 3, 5, 3, 1, true);
      bm.rect(2, 6, 5, 6, 1, true);
    });
    doc = r1.doc;
    const r2 = drawGlyph(doc, 66, (bm) => bm.rect(0, 0, 7, 7, 1, true));
    doc = r2.doc;

    const { buffer, report } = exportDoc(doc);
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(report.validation?.ok).toBe(true);

    // re-import through our own importer
    const { doc: reDoc } = await importFont(buffer, 'exported.ttf');
    expect(reDoc.meta.fontFamily).toBe('RoundTrip');
    expect(reDoc.metrics.unitsPerEm).toBe(doc.metrics.unitsPerEm);
    const a = reDoc.glyphs.find((g) => g.unicode === 65);
    const b = reDoc.glyphs.find((g) => g.unicode === 66);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.kind).toBe('vector');
    expect(a!.contours.length).toBeGreaterThanOrEqual(1);
    expect(a!.advanceWidth).toBe(doc.glyphs.find((g) => g.unicode === 65)!.advanceWidth);
    expect(reDoc.glyphs[0].name).toBe('.notdef');
  });

  it('round-trips glyph with a hole, preserving the counter', async () => {
    let doc = newTestFont(8, 8, 'HoleFont');
    const r = drawGlyph(doc, 79, (bm) => {
      bm.rect(0, 0, 7, 7, 1, true);
      bm.rect(2, 2, 5, 5, 0, true); // punch a hole
    });
    doc = r.doc;
    const glyph = doc.glyphs.find((g) => g.unicode === 79)!;
    const contours = tracePixelData(glyph.pixel!);
    expect(contours.length).toBe(2);

    const { buffer } = exportDoc(doc);
    const parsed = { data: parseTtf(buffer) };
    const ttf = parsed.data as any;
    const idx = ttf.cmap[79];
    expect(idx).toBeGreaterThan(0);
    expect(ttf.glyf[idx].contours.length).toBe(2);
  });

  it('exports glyphs with holes AND disconnected pixels in the same glyph', async () => {
    let doc = newTestFont(16, 16, 'Complex');
    const r = drawGlyph(doc, 88, (bm) => {
      bm.rect(1, 1, 8, 8, 1, true);
      bm.rect(3, 3, 6, 6, 0, true); // hole
      bm.set(13, 13, 1); // disconnected dot
      bm.set(14, 12, 1);
    });
    doc = r.doc;
    const { buffer, report } = exportDoc(doc);
    expect(report.validation?.ok).toBe(true);
    const parsed = { data: parseTtf(buffer) };
    const ttf = parsed.data as any;
    const g = ttf.glyf[ttf.cmap[88]];
    // ring outer + hole + two diagonally-touching dots (diagonal contact
    // splits into sharp, non-overlapping loops by design)
    expect(g.contours.length).toBe(4);
  });

  it('keeps .notdef valid and unmapped', async () => {
    const doc = newTestFont();
    const { buffer } = exportDoc(doc);
    const parsed = { data: parseTtf(buffer) };
    const ttf = parsed.data as any;
    expect(ttf.glyf.length).toBe(doc.glyphs.length);
    expect(Object.values(ttf.cmap)).not.toContain(0);
  });

  it('supports 8×8, 16×16, 32×32 and custom grid sizes end-to-end', async () => {
    for (const [w, h] of [[8, 8], [16, 16], [32, 32], [12, 7]] as Array<[number, number]>) {
      let doc = newTestFont(w, h, `Grid${w}x${h}`);
      const r = drawGlyph(doc, 65, (bm) => {
        bm.set(0, 0, 1);
        bm.set(Math.min(w - 1, 3), Math.min(h - 1, 3), 1);
      });
      doc = r.doc;
      const { buffer, report } = exportDoc(doc);
      expect(report.validation?.ok, `grid ${w}x${h}`).toBe(true);
      const parsed = { data: parseTtf(buffer) };
      const ttf = parsed.data as any;
      const glyph = ttf.glyf[ttf.cmap[65]];
      expect(glyph.contours.length, `grid ${w}x${h} should export two pixel squares`).toBe(2);
      // sharp edges: all coordinates are multiples of unitsPerCell
      const upc = doc.glyphs.find((g) => g.unicode === 65)!.pixel!.unitsPerCell;
      for (const c of glyph.contours) {
        for (const p of c) {
          expect(p.x % upc).toBe(0);
        }
      }
    }
  });

  it('validation catches a broken export', () => {
    const doc = newTestFont();
    const v = validateExport(new ArrayBuffer(8), doc);
    expect(v.ok).toBe(false);
  });

  it('rejects unicode duplicates before export', async () => {
    let doc = newTestFont();
    const r1 = drawGlyph(doc, 65, (bm) => bm.set(0, 0, 1));
    doc = r1.doc;
    const r2 = drawGlyph(doc, 66, (bm) => bm.set(1, 1, 1));
    doc = r2.doc;
    // force a duplicate mapping
    const glyphs = doc.glyphs.map((g) => (g.unicode === 66 ? { ...g, unicode: 65 } : g));
    doc = { ...doc, glyphs };
    expect(() => exportDoc(doc)).toThrow();
  });
});
