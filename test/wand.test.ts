import { describe, expect, it } from 'vitest';
import { wandSelect, mergeWandIntoSelection, fillWithSelection, computeTileStats } from '../src/core/wand';
import { Bitmap } from '../src/core/bitmap';

describe('wandSelect', () => {
  it('selects contiguous filled region', () => {
    const bm = new Bitmap(4, 4);
    bm.set(0, 0, 1);
    bm.set(1, 0, 1);
    bm.set(0, 1, 1);
    // isolated
    bm.set(3, 3, 1);
    const res = wandSelect(bm, 0, 0);
    expect(res).not.toBeNull();
    expect(res!.w).toBe(2);
    expect(res!.h).toBe(2);
    expect(res!.mask.count()).toBe(3);
    expect(res!.value).toBe(1);
  });

  it('selects contiguous empty region', () => {
    const bm = new Bitmap(3, 3);
    // all empty except center
    bm.set(1, 1, 1);
    const res = wandSelect(bm, 0, 0);
    expect(res).not.toBeNull();
    expect(res!.value).toBe(0);
    // empty region should be 8 cells (all except center)
    expect(res!.mask.count()).toBe(8);
  });

  it('returns null out of bounds', () => {
    const bm = new Bitmap(2, 2);
    expect(wandSelect(bm, 5, 5)).toBeNull();
  });
});

describe('mergeWandIntoSelection', () => {
  it('replace mode', () => {
    const bm = new Bitmap(2, 2);
    bm.set(0, 0, 1);
    const wand = { x: 1, y: 1, w: 1, h: 1, mask: bm, value: 1 };
    const merged = mergeWandIntoSelection(null, wand as any, 'replace', 4, 4);
    expect(merged).not.toBeNull();
    expect(merged!.x).toBe(1);
    expect(merged!.y).toBe(1);
  });

  it('add mode merges', () => {
    const bm1 = new Bitmap(1, 1);
    bm1.set(0, 0, 1);
    const existing = { x: 0, y: 0, bm: bm1 };
    const bm2 = new Bitmap(1, 1);
    bm2.set(0, 0, 1);
    const wand = { x: 1, y: 0, w: 1, h: 1, mask: bm2, value: 1 };
    const merged = mergeWandIntoSelection(existing, wand as any, 'add', 4, 4);
    expect(merged).not.toBeNull();
    expect(merged!.bm.count()).toBe(2);
  });

  it('subtract mode removes', () => {
    const bm1 = new Bitmap(2, 1);
    bm1.set(0, 0, 1);
    bm1.set(1, 0, 1);
    const existing = { x: 0, y: 0, bm: bm1 };
    const bm2 = new Bitmap(1, 1);
    bm2.set(0, 0, 1);
    const wand = { x: 0, y: 0, w: 1, h: 1, mask: bm2, value: 1 };
    const merged = mergeWandIntoSelection(existing, wand as any, 'subtract', 4, 4);
    expect(merged).not.toBeNull();
    expect(merged!.bm.count()).toBe(1);
  });
});

describe('fillWithSelection', () => {
  it('fills selection area', () => {
    const bm = new Bitmap(3, 3);
    const selBm = new Bitmap(2, 2);
    selBm.set(0, 0, 1);
    selBm.set(1, 0, 1);
    const sel = { x: 0, y: 0, bm: selBm };
    const filled = fillWithSelection(bm, 0, 0, 1, sel, true);
    expect(filled.get(0, 0)).toBe(1);
    expect(filled.get(1, 0)).toBe(1);
    expect(filled.get(2, 0)).toBe(0);
  });

  it('contiguous flood fill without selection', () => {
    const bm = new Bitmap(3, 3);
    bm.set(0, 0, 1);
    bm.set(1, 0, 1);
    const filled = fillWithSelection(bm, 0, 0, 0, null, true);
    expect(filled.get(0, 0)).toBe(0);
    expect(filled.get(1, 0)).toBe(0);
    expect(filled.get(0, 1)).toBe(0); // was empty, not filled because target was 1
  });
});

describe('tile preview stats', () => {
  it('counts edge pixels', () => {
    const stats = computeTileStats(3, 3, [
      [0, 0],
      [1, 0],
      [2, 2],
      [1, 1],
    ]);
    // edge: (0,0) and (1,0) and (2,2) are edges, (1,1) not
    expect(stats.edge).toBe(3);
    expect(stats.total).toBe(4);
  });
});
