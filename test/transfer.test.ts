import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importFont } from '../src/core/fontCodec';
import { newTestFont, drawGlyph } from './helpers';
import { createNewFont } from '../src/core/fontFactory';
import { findConflicts, transferGlyphs, validateUnicodeAssignment } from '../src/core/transfer';
import { contourBounds } from '../src/core/contours';

function loadLato(): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('transferring glyphs between fonts', () => {
  it('scales outlines proportionally to units-per-em', async () => {
    const { doc: lato } = await importFont(loadLato(), 'Lato-Regular.ttf');
    let dst = createNewFont({ familyName: 'Big', styleName: 'Regular', gridWidth: 16, gridHeight: 16 });
    // force a different unitsPerEm
    dst = { ...dst, metrics: { ...dst.metrics, unitsPerEm: lato.metrics.unitsPerEm * 2 } };

    const srcA = lato.glyphs.find((g) => g.unicode === 65)!;
    const result = transferGlyphs(lato, dst, [srcA.id], {
      metricsMode: 'preserve',
      scaleByUpm: true,
      collision: 'skip',
    });
    expect(result.copied).toBe(1);
    const copied = result.doc.glyphs[result.doc.glyphs.length - 1];
    expect(copied.unicode).toBe(65);
    expect(copied.advanceWidth).toBe(Math.round(srcA.advanceWidth * 2));
    const srcB = contourBounds(srcA.contours)!;
    const dstB = contourBounds(copied.contours)!;
    expect(dstB.xMax).toBe(Math.round(srcB.xMax * 2));
    expect(dstB.yMax).toBe(Math.round(srcB.yMax * 2));
  });

  it('copies pixel glyphs between pixel fonts', () => {
    let a = newTestFont(8, 8, 'Src');
    const r = drawGlyph(a, 65, (bm) => bm.rect(1, 1, 5, 5, 1, true));
    a = r.doc;
    const b = newTestFont(8, 8, 'Dst');
    const src = a.glyphs.find((g) => g.unicode === 65)!;
    const out = transferGlyphs(a, b, [src.id], { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
    expect(out.copied).toBe(1);
    const copied = out.doc.glyphs[out.doc.glyphs.length - 1];
    expect(copied.pixel).toBeTruthy();
    expect(copied.pixel!.cellsB64).toBe(src.pixel!.cellsB64);
    expect(copied.id).not.toBe(src.id);
  });

  it('handles collisions: skip, replace, reassign', () => {
    let a = newTestFont(8, 8, 'Src');
    a = drawGlyph(a, 65, (bm) => bm.set(0, 0, 1)).doc;
    let b = newTestFont(8, 8, 'Dst');
    b = drawGlyph(b, 65, (bm) => bm.set(7, 7, 1)).doc;

    const srcA = a.glyphs.find((g) => g.unicode === 65)!;
    const conflicts = findConflicts(a, b, [srcA.id]);
    expect(conflicts).toHaveLength(1);

    // skip
    const skipped = transferGlyphs(a, b, [srcA.id], { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
    expect(skipped.skipped).toBe(1);
    expect(skipped.copied).toBe(0);

    // replace: old glyph unmapped but retained, new glyph mapped
    const replaced = transferGlyphs(a, b, [srcA.id], { metricsMode: 'preserve', scaleByUpm: false, collision: 'replace' });
    expect(replaced.replaced).toBe(1);
    const mapped = replaced.doc.glyphs.filter((g) => g.unicode === 65);
    expect(mapped).toHaveLength(1);
    expect(replaced.doc.glyphs.length).toBe(b.glyphs.length + 1);

    // reassign to another code point
    const reassigned = transferGlyphs(a, b, [srcA.id], {
      metricsMode: 'preserve',
      scaleByUpm: false,
      collision: 'reassign',
      reassignments: { [srcA.id]: 0x10d0 },
    });
    expect(reassigned.reassigned).toBe(1);
    expect(reassigned.doc.glyphs.find((g) => g.unicode === 0x10d0)).toBeTruthy();
  });

  it('flattens composites during transfer', async () => {
    const { doc: lato } = await importFont(loadLato(), 'Lato-Regular.ttf');
    const dst = newTestFont(16, 16, 'Dst');
    const comp = lato.glyphs.find((g) => g.kind === 'compound' && g.unicode !== null);
    expect(comp).toBeTruthy();
    const out = transferGlyphs(lato, dst, [comp!.id], { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
    expect(out.flattenedComposites).toBe(1);
    const copied = out.doc.glyphs[out.doc.glyphs.length - 1];
    expect(copied.compound).toBeNull();
    expect(copied.contours.length).toBeGreaterThan(0);
  });

  it('validates unicode assignment conflicts', () => {
    let doc = newTestFont();
    doc = drawGlyph(doc, 65, (bm) => bm.set(0, 0, 1)).doc;
    doc = drawGlyph(doc, 66, (bm) => bm.set(1, 1, 1)).doc;
    const b = doc.glyphs.find((g) => g.unicode === 66)!;
    expect(validateUnicodeAssignment(doc, b.id, 65)).toMatch(/already assigned/);
    expect(validateUnicodeAssignment(doc, b.id, 67)).toBeNull();
    expect(validateUnicodeAssignment(doc, b.id, null)).toBeNull();
    const notdef = doc.glyphs[0];
    expect(validateUnicodeAssignment(doc, notdef.id, 90)).toMatch(/\.notdef/);
  });
});
