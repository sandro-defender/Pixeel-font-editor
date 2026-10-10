import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../src/state/store';
import { newTestFont, drawGlyph, cellsOf } from './helpers';
import { createNewFont } from '../src/core/fontFactory';
import { transferGlyphs, sourceAfterMove } from '../src/core/transfer';
import {
  applyLedMatrix,
  resizeGrid,
  setAdvance,
  setGlyphBitmap,
  snapGlyphToLed,
} from '../src/state/glyphActions';
import {
  asciiToBitmap,
  bitmapToAscii,
  bitmapToColumnBytes,
  bitmapToColumnHex,
  checkLedFont,
  columnBytesToBitmap,
  defaultLedSpec,
  ledMetrics,
  normalizeLedSpec,
} from '../src/core/ledMatrix';
import { Bitmap } from '../src/core/bitmap';
import type { FontDoc } from '../src/core/types';

const SPEC = normalizeLedSpec({ rows: 7, cols: 5, spacing: 1, cellUnits: 100, descentRows: 0 });

function ledFont(family = 'Led'): FontDoc {
  return createNewFont({ familyName: family, styleName: 'Regular', gridWidth: SPEC.cols, gridHeight: SPEC.rows, led: SPEC });
}

describe('LED matrix fonts', () => {
  it('creates a font whose metrics are whole pixels and that passes the exact check', () => {
    const doc = ledFont();
    expect(doc.ledMatrix).toEqual(SPEC);
    expect(doc.metrics).toEqual(ledMetrics(SPEC));
    expect(doc.metrics.unitsPerEm).toBe(SPEC.rows * SPEC.cellUnits);
    const check = checkLedFont(doc);
    expect(check.applicable).toBe(true);
    expect(check.errors).toBe(0);
    expect(check.ok).toBe(true);
  });

  it('reports an advance that is not (width + spacing) × cell as a warning, not an error', () => {
    const doc = ledFont();
    const a = drawGlyph(doc, 65, (bm) => bm.set(1, 1, 1)).doc;
    const glyph = a.glyphs.find((g) => g.unicode === 65)!;
    // two whole pixels too wide for this glyph's width: off the (width + spacing) rule, but on the grid
    const bad = setAdvance(a, glyph.id, (glyph.pixel!.width + SPEC.spacing + 2) * SPEC.cellUnits);
    const check = checkLedFont(bad);
    expect(check.errors).toBe(0);
    expect(check.warnings).toBeGreaterThan(0);
    expect(check.issues.some((i) => i.glyphId === glyph.id && i.severity === 'warning')).toBe(true);
  });

  it('reports a non-integer cell size or off-grid origin as an error', () => {
    const drawn = drawGlyph(ledFont(), 66, (bm) => bm.set(0, 0, 1));
    const g = drawn.glyph;
    const bad = {
      ...drawn.doc,
      glyphs: drawn.doc.glyphs.map((x) => (x.id === g.id ? { ...x, pixel: { ...x.pixel!, unitsPerCell: 99.5 } } : x)),
    };
    const check = checkLedFont(bad);
    expect(check.errors).toBeGreaterThan(0);
    expect(check.ok).toBe(false);
  });

  it('refuses to change the grid height of an LED font but allows width changes', () => {
    const doc = ledFont();
    const { glyph, doc: d } = drawGlyph(doc, 67, (bm) => bm.set(2, 2, 1));
    expect(() => resizeGrid(d, glyph.id, 6, SPEC.rows + 1, 'crop')).toThrow();
    const wider = resizeGrid(d, glyph.id, 6, SPEC.rows, 'crop');
    const g = wider.glyphs.find((x) => x.id === glyph.id)!;
    expect(g.pixel!.width).toBe(6);
    expect(g.advanceWidth).toBe((6 + SPEC.spacing) * SPEC.cellUnits);
    expect(checkLedFont(wider).errors).toBe(0);
  });

  it('turns a standard pixel font into an exact LED font and back off', () => {
    const base = newTestFont(8, 8, 'Std');
    const drawn = drawGlyph(base, 65, (bm) => bm.rect(1, 1, 4, 5, 1, true)).doc;
    const led = applyLedMatrix(drawn, defaultLedSpec(5, 7));
    expect(led.ledMatrix).toBeTruthy();
    expect(checkLedFont(led).errors).toBe(0);
    const off = applyLedMatrix(led, null);
    expect(off.ledMatrix).toBeNull();
    // glyph pixels are kept when LED mode is switched off
    const g = off.glyphs.find((x) => x.unicode === 65)!;
    expect(g.pixel).toBeTruthy();
  });

  it('snaps a single glyph onto the grid without touching the others', () => {
    const doc = ledFont();
    const { doc: withA, glyph: a } = drawGlyph(doc, 65, (bm) => bm.set(0, 0, 1));
    const snapped = snapGlyphToLed(withA, a.id);
    expect(checkLedFont(snapped).errors).toBe(0);
  });
});

describe('pixel text and column byte entry', () => {
  it('round-trips text art', () => {
    const bm = new Bitmap(4, 3);
    bm.set(0, 2, 1);
    bm.set(3, 0, 1);
    bm.set(1, 1, 1);
    const text = bitmapToAscii(bm);
    // y = 2 is the top row, so it is printed first
    expect(text.split('\n')).toEqual(['#...', '.#..', '...#']);
    const back = asciiToBitmap(text);
    expect(back.rows).toBe(3);
    expect(back.bitmap.toB64()).toBe(bm.toB64());
  });

  it('encodes LED columns with the top pixel in bit 0 of the first byte', () => {
    const bm = new Bitmap(3, 7);
    bm.set(0, 6, 1); // top-left pixel (row 6 counted from the bottom)
    bm.set(1, 0, 1); // bottom pixel of column 1
    const cols = bitmapToColumnBytes(bm);
    expect(cols[0]).toEqual([0x01]);
    expect(cols[1]).toEqual([0x40]);
    expect(cols[2]).toEqual([0x00]);
    expect(bitmapToColumnHex(bm).split('\n')[0]).toBe('0x01,');
  });

  it('round-trips column bytes for a 7-row grid', () => {
    const bm = new Bitmap(5, 7);
    bm.rect(0, 0, 4, 6, 1, false);
    const hex = bitmapToColumnHex(bm);
    const parsed = columnBytesToBitmap(hex, 7);
    expect(parsed.bitmap.toB64()).toBe(bm.toB64());
  });

  it('rejects a byte count that does not divide into whole columns', () => {
    expect(() => columnBytesToBitmap('0x01, 0x02, 0x03', 9)).toThrow();
  });

  it('applies a parsed bitmap to an LED glyph and keeps the advance on the grid', () => {
    const doc = ledFont();
    const { glyph, doc: d } = drawGlyph(doc, 68, () => {});
    const bm = new Bitmap(3, SPEC.rows);
    bm.set(1, 3, 1);
    const updated = setGlyphBitmap(d, glyph.id, bm);
    const g = updated.glyphs.find((x) => x.id === glyph.id)!;
    expect(g.pixel!.width).toBe(3);
    expect(g.advanceWidth).toBe((3 + SPEC.spacing) * SPEC.cellUnits);
    expect(checkLedFont(updated).errors).toBe(0);
    expect(() => setGlyphBitmap(d, glyph.id, new Bitmap(3, SPEC.rows - 1))).toThrow();
  });
});

describe('moving and copying glyphs between fonts', () => {
  beforeEach(() => {
    const s = useStore.getState();
    s.loadFont('A', null, null);
    s.loadFont('B', null, null);
  });

  function setupFonts() {
    let a = newTestFont(8, 8, 'Src');
    a = drawGlyph(a, 65, (bm) => bm.set(0, 0, 1)).doc;
    a = drawGlyph(a, 66, (bm) => bm.set(1, 1, 1)).doc;
    const b = createNewFont({ familyName: 'Dst', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    useStore.getState().loadFont('A', a, null);
    useStore.getState().loadFont('B', b, null);
    return { a, b };
  }

  it('move removes the glyphs from the source and one undo restores both fonts', () => {
    const { a, b } = setupFonts();
    const ids = a.glyphs.filter((g) => g.unicode === 65 || g.unicode === 66).map((g) => g.id);
    let summary: ReturnType<typeof transferGlyphs> | null = null;
    const ok = useStore.getState().commitLinked('Move glyphs', [
      {
        slot: 'B',
        updater: (dst) => {
          summary = transferGlyphs(a, dst, ids, { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
          return summary.doc;
        },
      },
      { slot: 'A', updater: (src) => sourceAfterMove(src, (summary as unknown as { copiedSourceIds: string[] }).copiedSourceIds) },
    ]);
    expect(ok).toBe(true);
    const s1 = useStore.getState();
    expect(s1.fonts.B!.glyphs.filter((g) => g.unicode === 65 || g.unicode === 66).length).toBe(2);
    expect(s1.fonts.A!.glyphs.some((g) => g.unicode === 65 || g.unicode === 66)).toBe(false);
    expect(s1.fonts.A!.glyphs.some((g) => g.name === '.notdef')).toBe(true);

    // one undo in the destination reverts both fonts
    useStore.getState().undo('B');
    const s2 = useStore.getState();
    expect(s2.fonts.B!.glyphs.length).toBe(b.glyphs.length);
    expect(s2.fonts.A!.glyphs.filter((g) => g.unicode === 65 || g.unicode === 66).length).toBe(2);

    // and redo applies both again
    useStore.getState().redo('B');
    const s3 = useStore.getState();
    expect(s3.fonts.B!.glyphs.filter((g) => g.unicode === 65 || g.unicode === 66).length).toBe(2);
    expect(s3.fonts.A!.glyphs.some((g) => g.unicode === 65 || g.unicode === 66)).toBe(false);
  });

  it('keeps glyphs in the source when they were skipped because of a collision', () => {
    const { a, b } = setupFonts();
    // Destination already maps U+0041, so the incoming "A" collides and is skipped.
    const dst = drawGlyph(b, 65, (bm) => bm.set(2, 2, 1)).doc;
    useStore.getState().loadFont('B', dst, null);
    const ids = a.glyphs.filter((g) => g.unicode === 65 || g.unicode === 66).map((g) => g.id);
    let copiedIds: string[] = [];
    useStore.getState().commitLinked('Move glyphs', [
      {
        slot: 'B',
        updater: (d) => {
          const res = transferGlyphs(a, d, ids, { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
          copiedIds = res.copiedSourceIds;
          return res.doc;
        },
      },
      { slot: 'A', updater: (src) => sourceAfterMove(src, copiedIds) },
    ]);
    const srcAfter = useStore.getState().fonts.A!;
    // "A" stayed in the source because it was not copied; "B" moved
    expect(srcAfter.glyphs.some((g) => g.unicode === 65)).toBe(true);
    expect(srcAfter.glyphs.some((g) => g.unicode === 66)).toBe(false);
  });

  it('sourceAfterMove never removes .notdef', () => {
    const { a } = setupFonts();
    const notdef = a.glyphs.find((g) => g.name === '.notdef')!;
    const after = sourceAfterMove(a, [notdef.id]);
    expect(after.glyphs.some((g) => g.name === '.notdef')).toBe(true);
    expect(after).toBe(a); // nothing to remove → same object
  });

  it('copying into an LED font conforms glyphs to the matrix grid', () => {
    const { a } = setupFonts();
    const led = ledFont('LedDst');
    const id = a.glyphs.find((g) => g.unicode === 65)!.id;
    const res = transferGlyphs(a, led, [id], { metricsMode: 'preserve', scaleByUpm: true, collision: 'skip' });
    expect(res.copied).toBe(1);
    const copied = res.doc.glyphs.find((g) => g.unicode === 65)!;
    expect(copied.pixel!.height).toBe(SPEC.rows);
    expect(copied.advanceWidth % SPEC.cellUnits).toBe(0);
    expect(checkLedFont(res.doc).errors).toBe(0);
    expect(res.copiedSourceIds).toContain(id);
  });

  it('a copy keeps the source glyphs and reports the copied ids', () => {
    const { a, b } = setupFonts();
    const id = a.glyphs.find((g) => g.unicode === 66)!.id;
    const res = transferGlyphs(a, b, [id], { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
    expect(res.copiedSourceIds).toEqual([id]);
    expect(a.glyphs.some((g) => g.unicode === 66)).toBe(true);
    expect(cellsOf(res.doc.glyphs.find((g) => g.unicode === 66)!).equals(cellsOf(a.glyphs.find((g) => g.unicode === 66)!))).toBe(true);
  });
});
