/** Utilities for TrueType-style contours (on-curve / off-curve points). */
import type { Contour, VectorPoint } from './types';

export interface QuadSegment {
  from: VectorPoint;
  /** null for straight lines */
  ctrl: VectorPoint | null;
  to: VectorPoint;
}

/**
 * Expand a TrueType contour into quadratic segments.
 * Handles implied on-curve points between consecutive off-curve points.
 */
export function contourToSegments(contour: Contour): QuadSegment[] {
  const pts = contour.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const segs: QuadSegment[] = [];
  const n = pts.length;
  if (n < 2) return segs;

  // Find the first on-curve point; if none, synthesize one (implied midpoint).
  let start = pts.findIndex((p) => p.onCurve);
  let synthetic: VectorPoint | null = null;
  if (start === -1) {
    synthetic = {
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
      onCurve: true,
    };
    start = 0;
  }

  let prev: VectorPoint = synthetic ?? pts[start];
  let i = 0;
  while (i < n) {
    const idx = (start + 1 + i) % n;
    const p = pts[idx];
    if (p.onCurve) {
      segs.push({ from: prev, ctrl: null, to: p });
      prev = p;
      i += 1;
    } else {
      const nextIdx = (start + 2 + i) % n;
      const q = pts[nextIdx];
      if (q.onCurve) {
        segs.push({ from: prev, ctrl: p, to: q });
        prev = q;
        i += 2;
      } else {
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, onCurve: true };
        segs.push({ from: prev, ctrl: p, to: mid });
        prev = mid;
        i += 1;
      }
    }
  }
  return segs;
}

/** Flatten quadratic segments into polyline points (does not repeat start). */
export function segmentsToPolyline(segs: QuadSegment[], stepsPerCurve = 12): VectorPoint[] {
  const out: VectorPoint[] = [];
  for (const s of segs) {
    out.push(s.from);
    if (s.ctrl) {
      for (let i = 1; i <= stepsPerCurve; i++) {
        const t = i / stepsPerCurve;
        const mt = 1 - t;
        out.push({
          x: mt * mt * s.from.x + 2 * mt * t * s.ctrl.x + t * t * s.to.x,
          y: mt * mt * s.from.y + 2 * mt * t * s.ctrl.y + t * t * s.to.y,
          onCurve: true,
        });
      }
    }
  }
  return out;
}

export function contourBounds(contours: Contour[]): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  if (!contours.length) return null;
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.x > xMax) xMax = p.x;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (xMin === Infinity) return null;
  return { xMin, yMin, xMax, yMax };
}

/** Approximate bbox of a quadratic curve (endpoints + extremum of the curve). */
function quadExtrema(a: number, c: number, b: number): number[] {
  // quadratic: (1-t)^2 a + 2(1-t)t c + t^2 b ; derivative zero at t = (a-c)/(a-2c+b)
  const denom = a - 2 * c + b;
  const ts = [0, 1];
  if (Math.abs(denom) > 1e-9) {
    const t = (a - c) / denom;
    if (t > 0 && t < 1) ts.push(t);
  }
  return ts.map((t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b);
}

/** Tight(ish) bounds including curve bulges. */
export function contourBoundsTight(contours: Contour[]): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  if (!contours.length) return null;
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const consider = (x: number, y: number) => {
    if (x < xMin) xMin = x;
    if (y < yMin) yMin = y;
    if (x > xMax) xMax = x;
    if (y > yMax) yMax = y;
  };
  for (const c of contours) {
    for (const seg of contourToSegments(c)) {
      consider(seg.from.x, seg.from.y);
      consider(seg.to.x, seg.to.y);
      if (seg.ctrl) {
        for (const ex of quadExtrema(seg.from.x, seg.ctrl.x, seg.to.x)) consider(ex, seg.from.y);
        for (const ey of quadExtrema(seg.from.y, seg.ctrl.y, seg.to.y)) consider(seg.from.x, ey);
      }
    }
  }
  if (xMin === Infinity) return null;
  return { xMin, yMin, xMax, yMax };
}

export function transformContours(
  contours: Contour[],
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
  round = true,
): Contour[] {
  return contours.map((c) =>
    c.map((p) => {
      const x = m.a * p.x + m.c * p.y + m.e;
      const y = m.b * p.x + m.d * p.y + m.f;
      return { x: round ? Math.round(x) : x, y: round ? Math.round(y) : y, onCurve: p.onCurve };
    }),
  );
}

export function scaleContours(contours: Contour[], s: number, round = true): Contour[] {
  return transformContours(contours, { a: s, b: 0, c: 0, d: s, e: 0, f: 0 }, round);
}

export function translateContours(contours: Contour[], dx: number, dy: number): Contour[] {
  return contours.map((c) => c.map((p) => ({ x: p.x + dx, y: p.y + dy, onCurve: p.onCurve })));
}

export function reverseContour(contour: Contour): Contour {
  return [...contour].reverse();
}

/** Signed area (shoelace) of a contour treated as straight-line polygon. */
export function signedArea(contour: Contour): number {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    const q = contour[(i + 1) % contour.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}

/**
 * Winding number of point (px, py) against contours (curves flattened).
 * Nonzero winding ⇒ inside for TrueType fill rule.
 */
export function windingNumber(contours: Contour[], px: number, py: number, stepsPerCurve = 8): number {
  let winding = 0;
  for (const c of contours) {
    const pts = segmentsToPolyline(contourToSegments(c), stepsPerCurve);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y <= py) {
        if (b.y > py && isLeft(a, b, px, py) > 0) winding += 1;
      } else if (b.y <= py && isLeft(a, b, px, py) < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

function isLeft(a: VectorPoint, b: VectorPoint, px: number, py: number): number {
  return (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
}

/** Normalize a contour: integer coords, drop redundant collinear on-curve points. */
export function normalizeContour(contour: Contour): Contour {
  const pts = contour.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), onCurve: p.onCurve }));
  // drop duplicate consecutive points
  const dedup: Contour = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) dedup.push(p);
  }
  if (dedup.length > 1) {
    const f = dedup[0];
    const l = dedup[dedup.length - 1];
    if (f.x === l.x && f.y === l.y) dedup.pop();
  }
  return dedup;
}

export function cloneContours(contours: Contour[]): Contour[] {
  return contours.map((c) => c.map((p) => ({ ...p })));
}
