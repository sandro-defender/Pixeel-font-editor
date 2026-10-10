/** Magic wand selection: contiguous region of same value. */
import { Bitmap } from './bitmap';

export interface WandResult {
  /** Bounding box of the contiguous region */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mask bitmap where 1 = part of selection */
  mask: Bitmap;
  /** Value of the region (0 = empty, 1 = filled) */
  value: number;
}

/** Flood fill to find contiguous region of same value starting at (sx,sy). Returns mask and bbox. */
export function wandSelect(bm: Bitmap, sx: number, sy: number): WandResult | null {
  if (sx < 0 || sy < 0 || sx >= bm.width || sy >= bm.height) return null;
  const targetValue = bm.get(sx, sy);
  const visited = new Bitmap(bm.width, bm.height);
  const queue: Array<[number, number]> = [[sx, sy]];
  visited.set(sx, sy, 1);

  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bm.width || ny >= bm.height) continue;
      if (visited.get(nx, ny)) continue;
      if (bm.get(nx, ny) !== targetValue) continue;
      visited.set(nx, ny, 1);
      queue.push([nx, ny]);
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
    }
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const mask = new Bitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (visited.get(minX + x, minY + y)) mask.set(x, y, 1);
    }
  }

  return { x: minX, y: minY, w, h, mask, value: targetValue };
}

/** Merge a wand result into an existing selection (or create new). Handles add/subtract. */
export function mergeWandIntoSelection(
  existing: { x: number; y: number; bm: Bitmap } | null,
  wand: WandResult,
  mode: 'replace' | 'add' | 'subtract',
  gridW: number,
  gridH: number,
): { x: number; y: number; bm: Bitmap } | null {
  if (mode === 'replace' || !existing) {
    return { x: wand.x, y: wand.y, bm: wand.mask };
  }

  // For add/subtract, we need to merge masks that may have different positions
  const ex = existing;
  const minX = Math.min(ex.x, wand.x);
  const minY = Math.min(ex.y, wand.y);
  const maxX = Math.max(ex.x + ex.bm.width - 1, wand.x + wand.w - 1);
  const maxY = Math.max(ex.y + ex.bm.height - 1, wand.y + wand.h - 1);
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;

  if (W > gridW || H > gridH) {
    // clamp to grid
    const clampedW = Math.min(W, gridW);
    const clampedH = Math.min(H, gridH);
    // for simplicity, if merged exceeds grid, we still create but will be clamped later by paste logic
  }

  const merged = new Bitmap(W, H);
  // copy existing
  for (let y = 0; y < ex.bm.height; y++) {
    for (let x = 0; x < ex.bm.width; x++) {
      if (ex.bm.get(x, y)) {
        merged.set(ex.x - minX + x, ex.y - minY + y, 1);
      }
    }
  }

  if (mode === 'add') {
    for (let y = 0; y < wand.h; y++) {
      for (let x = 0; x < wand.w; x++) {
        if (wand.mask.get(x, y)) merged.set(wand.x - minX + x, wand.y - minY + y, 1);
      }
    }
  } else if (mode === 'subtract') {
    for (let y = 0; y < wand.h; y++) {
      for (let x = 0; x < wand.w; x++) {
        if (wand.mask.get(x, y)) merged.set(wand.x - minX + x, wand.y - minY + y, 0);
      }
    }
  }

  // If merged is empty, return null (clear selection)
  if (merged.count() === 0) return null;

  // Compute tight bbox of merged
  const bbox = merged.bounds();
  if (!bbox) return null;
  const tight = merged.extract(bbox.x, bbox.y, bbox.w, bbox.h);
  return { x: minX + bbox.x, y: minY + bbox.y, bm: tight };
}

/** Fill that respects selection: if selection exists, fill only within selection bounds, otherwise flood fill. */
export function fillWithSelection(
  bm: Bitmap,
  x: number,
  y: number,
  value: number,
  selection: { x: number; y: number; bm: Bitmap } | null,
  contiguous: boolean,
): Bitmap {
  const work = bm.clone();
  if (selection) {
    // Fill the selection area: set all cells in selection mask to value
    // But only where selection mask is 1
    for (let sy = 0; sy < selection.bm.height; sy++) {
      for (let sx = 0; sx < selection.bm.width; sx++) {
        if (selection.bm.get(sx, sy)) {
          work.set(selection.x + sx, selection.y + sy, value);
        }
      }
    }
    return work;
  }

  if (contiguous) {
    // flood fill contiguous region
    const target = bm.get(x, y);
    if (target === value) return work;
    const queue: Array<[number, number]> = [[x, y]];
    const visited = new Bitmap(bm.width, bm.height);
    visited.set(x, y, 1);
    work.set(x, y, value);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (queue.length) {
      const [cx, cy] = queue.shift()!;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= bm.width || ny >= bm.height) continue;
        if (visited.get(nx, ny)) continue;
        if (bm.get(nx, ny) !== target) continue;
        visited.set(nx, ny, 1);
        work.set(nx, ny, value);
        queue.push([nx, ny]);
      }
    }
    return work;
  } else {
    // fill whole grid? No, fill with rect? For non-contiguous, fill all cells with same value? We'll just flood fill anyway for simplicity
    // But spec says contiguous option, so non-contiguous would fill all similar? Let's implement fill all with same value
    const target = bm.get(x, y);
    if (target === value) return work;
    for (let yy = 0; yy < bm.height; yy++) {
      for (let xx = 0; xx < bm.width; xx++) {
        if (bm.get(xx, yy) === target) work.set(xx, yy, value);
      }
    }
    return work;
  }
}


export function computeTileStats(width: number, height: number, filled: Array<[number, number]>) {
  const bm = new Bitmap(width, height);
  for (const [x, y] of filled) bm.set(x, y, 1);
  let edge = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bm.get(x, y) && (x === 0 || x === width - 1 || y === 0 || y === height - 1)) edge++;
    }
  }
  return { edge, total: filled.length };
}
