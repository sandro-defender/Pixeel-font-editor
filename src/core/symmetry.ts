/** Symmetry modes for pixel editing. */

import type { SymmetryMode } from './types';
export type { SymmetryMode };

export const SYMMETRY_MODES: Array<{ id: SymmetryMode; label: string; description: string }> = [
  { id: 'none', label: 'None', description: 'No symmetry' },
  { id: 'horizontal', label: '↔ Horizontal', description: 'Mirror left ↔ right' },
  { id: 'vertical', label: '↕ Vertical', description: 'Mirror top ↕ bottom' },
  { id: 'quad', label: '⊞ Quad', description: 'Mirror both axes (4-way)' },
  { id: 'radial', label: '✧ Radial', description: 'Rotational symmetry (4-way around center)' },
];

export function isSymmetryMode(v: string): v is SymmetryMode {
  return (SYMMETRY_MODES as any).some((m: any) => m.id === v);
}

/** Given a cell (x,y) in a W×H grid (y=0 bottom), return all symmetric positions including original, deduped. */
export function symmetricPoints(x: number, y: number, w: number, h: number, mode: SymmetryMode): Array<{ x: number; y: number }> {
  if (mode === 'none') return [{ x, y }];
  const pts: Array<{ x: number; y: number }> = [];
  const add = (px: number, py: number) => {
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    if (!pts.some((p) => p.x === px && p.y === py)) pts.push({ x: px, y: py });
  };
  add(x, y);
  if (mode === 'horizontal' || mode === 'quad' || mode === 'radial') {
    add(w - 1 - x, y);
  }
  if (mode === 'vertical' || mode === 'quad' || mode === 'radial') {
    add(x, h - 1 - y);
  }
  if (mode === 'quad' || mode === 'radial') {
    add(w - 1 - x, h - 1 - y);
  }
  if (mode === 'radial') {
    // For radial, also add 90° rotations around center
    // Center in cell coordinates: (w-1)/2, (h-1)/2
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const dx = x - cx;
    const dy = y - cy;
    // 90°, 180°, 270° rotations
    const rots = [
      { x: cx - dy, y: cy + dx },
      { x: cx - dx, y: cy - dy },
      { x: cx + dy, y: cy - dx },
    ];
    for (const r of rots) {
      const rx = Math.round(r.x);
      const ry = Math.round(r.y);
      add(rx, ry);
      // also include mirrors of rotations for richer radial? keep simple for now, but also mirror them if needed
      if (mode === 'radial') {
        // for radial we already have mirrors via horizontal/vertical, but ensure rotated mirrors also
        add(w - 1 - rx, ry);
        add(rx, h - 1 - ry);
        add(w - 1 - rx, h - 1 - ry);
      }
    }
  }
  return pts;
}

/** Paint a value at (x,y) with symmetry into a bitmap-like object that has set(x,y,value) and width/height. */
export function paintWithSymmetry(
  set: (x: number, y: number, value: number) => void,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: SymmetryMode,
  value: number,
) {
  for (const p of symmetricPoints(x, y, w, h, mode)) {
    set(p.x, p.y, value);
  }
}

export function lineWithSymmetry(
  lineFn: (x0: number, y0: number, x1: number, y1: number, value: number) => void,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  h: number,
  mode: SymmetryMode,
  value: number,
) {
  // For simplicity, draw symmetric lines by drawing each symmetric pair of endpoints
  const startPts = symmetricPoints(x0, y0, w, h, mode);
  const endPts = symmetricPoints(x1, y1, w, h, mode);
  // Pair by index — if counts differ (due to dedup), draw all combinations that make sense
  // The simplest: draw line for each symmetric start to its symmetric end
  const count = Math.min(startPts.length, endPts.length);
  if (count > 0 && startPts.length === endPts.length) {
    for (let i = 0; i < count; i++) {
      lineFn(startPts[i].x, startPts[i].y, endPts[i].x, endPts[i].y, value);
    }
  } else {
    // fallback: draw all start→end combos for first pair and also individual points
    for (const sp of startPts) {
      for (const ep of endPts) {
        // Only draw if they are roughly same symmetry index? We'll just draw one line from original to original mirrored
        // To avoid too many lines, draw lines for each symmetry of the original line
        // Compute mirrored endpoints for each mode
        // For quad/horizontal/vertical, we can compute mirrored line endpoints directly
        // Here we approximate by drawing line for each symmetric start to symmetric end with same index if possible
      }
    }
    // For fallback, just draw the original line plus its mirrored versions using direct mirroring math
    // Horizontal mirror
    if (mode === 'horizontal' || mode === 'quad' || mode === 'radial') {
      lineFn(w - 1 - x0, y0, w - 1 - x1, y1, value);
    }
    if (mode === 'vertical' || mode === 'quad' || mode === 'radial') {
      lineFn(x0, h - 1 - y0, x1, h - 1 - y1, value);
    }
    if (mode === 'quad' || mode === 'radial') {
      lineFn(w - 1 - x0, h - 1 - y0, w - 1 - x1, h - 1 - y1, value);
    }
    // Always draw original
    lineFn(x0, y0, x1, y1, value);
  }
}
