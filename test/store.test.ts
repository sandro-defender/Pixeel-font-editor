import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../src/state/store';
import { newTestFont, drawGlyph } from './helpers';
import { createNewFont } from '../src/core/fontFactory';
import { transferGlyphs } from '../src/core/transfer';
import { setAdvance } from '../src/state/glyphActions';

function freshStore() {
  const s = useStore.getState();
  s.loadFont('A', null, null);
  s.loadFont('B', null, null);
}

describe('store undo/redo and transfers', () => {
  beforeEach(freshStore);

  it('undo/redo round-trips a drawing commit', () => {
    const s = useStore.getState();
    s.loadFont('A', newTestFont(8, 8, 'UndoFont'), 'x.ttf');
    const doc = useStore.getState().fonts.A!;
    const { doc: drawn, glyph } = drawGlyph(doc, 65, (bm) => bm.set(1, 1, 1));
    useStore.getState().commit('A', 'draw', () => drawn);

    let cur = useStore.getState().fonts.A!;
    expect(cur.glyphs.find((g) => g.id === glyph.id)).toBeTruthy();

    useStore.getState().undo('A');
    cur = useStore.getState().fonts.A!;
    expect(cur.glyphs.find((g) => g.id === glyph.id)).toBeUndefined();

    useStore.getState().redo('A');
    cur = useStore.getState().fonts.A!;
    expect(cur.glyphs.find((g) => g.id === glyph.id)).toBeTruthy();

    useStore.getState().undo('A');
    expect(useStore.getState().fonts.A!.glyphs.length).toBe(doc.glyphs.length);
  });

  it('makes a batch transfer a single undo step in the destination font', () => {
    const s = useStore.getState();
    let a = newTestFont(8, 8, 'Src');
    a = drawGlyph(a, 65, (bm) => bm.set(0, 0, 1)).doc;
    a = drawGlyph(a, 66, (bm) => bm.set(1, 1, 1)).doc;
    const b = createNewFont({ familyName: 'Dst', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    s.loadFont('A', a, null);
    s.loadFont('B', b, null);

    const ids = a.glyphs.filter((g) => g.unicode === 65 || g.unicode === 66).map((g) => g.id);
    useStore.getState().commit('B', 'transfer', (dst) => {
      const res = transferGlyphs(a, dst, ids, { metricsMode: 'preserve', scaleByUpm: false, collision: 'skip' });
      return res.doc;
    });
    expect(useStore.getState().fonts.B!.glyphs.length).toBe(b.glyphs.length + 2);

    // one undo removes the whole batch
    useStore.getState().undo('B');
    expect(useStore.getState().fonts.B!.glyphs.length).toBe(b.glyphs.length);
    useStore.getState().redo('B');
    expect(useStore.getState().fonts.B!.glyphs.length).toBe(b.glyphs.length + 2);
  });

  it('collision replace keeps glyph count stable and remaps unicode', () => {
    const s = useStore.getState();
    let a = newTestFont(8, 8, 'Src');
    a = drawGlyph(a, 65, (bm) => bm.set(0, 0, 1)).doc;
    let b = newTestFont(8, 8, 'Dst');
    b = drawGlyph(b, 65, (bm) => bm.set(7, 7, 1)).doc;
    s.loadFont('A', a, null);
    s.loadFont('B', b, null);

    const srcGlyph = a.glyphs.find((g) => g.unicode === 65)!;
    useStore.getState().commit('B', 'transfer-replace', (dst) => {
      const res = transferGlyphs(a, dst, [srcGlyph.id], { metricsMode: 'preserve', scaleByUpm: false, collision: 'replace' });
      return res.doc;
    });
    const b2 = useStore.getState().fonts.B!;
    expect(b2.glyphs.filter((g) => g.unicode === 65)).toHaveLength(1);
    expect(b2.glyphs.length).toBe(b.glyphs.length + 1); // old glyph kept, unmapped
  });

  it('metric edits are undoable', () => {
    const s = useStore.getState();
    s.loadFont('A', newTestFont(), 'x');
    const glyph = useStore.getState().fonts.A!.glyphs[1];
    useStore.getState().commit('A', 'advance', (d) => setAdvance(d, glyph.id, 999));
    expect(useStore.getState().fonts.A!.glyphs[1].advanceWidth).toBe(999);
    useStore.getState().undo('A');
    expect(useStore.getState().fonts.A!.glyphs[1].advanceWidth).not.toBe(999);
  });
});
