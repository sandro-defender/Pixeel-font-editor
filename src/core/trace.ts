/**
 * Convert a pixel bitmap into TrueType vector contours.
 *
 * Strategy: build the set of directed boundary edges (fill always on the
 * left of the travel direction), then walk them into closed loops. Shared
 * edges between two filled pixels are never emitted, so the result has no
 * overlapping internal edges; runs of pixels merge into single straight
 * segments, preserving sharp corners. Holes become separate loops with the
 * opposite winding, which TrueType's non-zero fill rule renders as counters.
 */
import { Bitmap } from './bitmap';
import type { Contour, PixelData } from './types';
import { normalizeContour } from './contours';

// direction vectors; 0=+x, 1=+y, 2=-x, 3=-y
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

interface Edge {
  x: number;
  y: number;
  dir: number;
  used: boolean;
}

/**
 * Outgoing edges per vertex, keyed by direction. At most one boundary edge
 * leaves a vertex in each of the 4 directions, so this is a clean rotation
 * system for face traversal.
 */

/**
 * Trace the bitmap into contours in GRID space (integer corner coords,
 * x: 0..width, y: 0..height, y-up). Outer loops are counter-clockwise
 * (positive signed area), holes clockwise.
 */
export function traceBitmap(bitmap: Bitmap): Contour[] {
  const { width: W, height: H } = bitmap;
  // outgoing edges per corner vertex key, indexed by direction
  const outgoing = new Map<number, Array<Edge | undefined>>();
  const key = (x: number, y: number) => y * (W + 1) + x;

  const addEdge = (x: number, y: number, dir: number) => {
    const e: Edge = { x, y, dir, used: false };
    const k = key(x, y);
    let list = outgoing.get(k);
    if (!list) {
      list = [undefined, undefined, undefined, undefined];
      outgoing.set(k, list);
    }
    list[dir] = e;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!bitmap.get(x, y)) continue;
      // bottom edge: boundary when neighbour below is empty
      if (y === 0 || !bitmap.get(x, y - 1)) addEdge(x, y, 0);
      // right edge
      if (x === W - 1 || !bitmap.get(x + 1, y)) addEdge(x + 1, y, 1);
      // top edge
      if (y === H - 1 || !bitmap.get(x, y + 1)) addEdge(x + 1, y + 1, 2);
      // left edge
      if (x === 0 || !bitmap.get(x - 1, y)) addEdge(x, y + 1, 3);
    }
  }

  const contours: Contour[] = [];

  for (const list of outgoing.values()) {
    for (const edge of list) {
      if (!edge || edge.used) continue;
      // walk a loop
      const pts: Contour = [];
      let cur: Edge = edge;
      let guard = 0;
      const maxSteps = W * H * 4 + 4;
      while (!cur.used && guard++ < maxSteps) {
        cur.used = true;
        pts.push({ x: cur.x, y: cur.y, onCurve: true });
        const nx = cur.x + DX[cur.dir];
        const ny = cur.y + DY[cur.dir];
        const candidates = outgoing.get(key(nx, ny));
        if (!candidates) break;
        const next = pickNext(candidates, cur.dir);
        if (!next) break;
        cur = next;
        if (cur === edge) break; // closed the loop
      }
      if (pts.length >= 3) contours.push(pts);
    }
  }

  // merge collinear runs and normalize
  return contours.map(simplifyOrthogonal).map(normalizeContour);
}

/**
 * Half-edge "next" rule for face traversal: from an edge arriving with
 * direction d, take the outgoing edge whose direction is the first one found
 * by sweeping clockwise from the reverse direction (d+2). This pairs edges
 * into correct faces at pinch/saddle vertices (diagonally touching pixels),
 * keeping filled regions 4-connected and holes as separate loops.
 */
function pickNext(candidates: Array<Edge | undefined>, incomingDir: number): Edge | null {
  const reverse = (incomingDir + 2) % 4;
  for (let step = 0; step < 4; step++) {
    const dir = (reverse - step + 8) % 4; // clockwise sweep
    const e = candidates[dir];
    if (e && !e.used) return e;
  }
  return null;
}

/** Merge consecutive collinear points (orthogonal contours only). */
function simplifyOrthogonal(contour: Contour): Contour {
  if (contour.length < 3) return contour;
  const out: Contour = [];
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const prev = contour[(i - 1 + n) % n];
    const cur = contour[i];
    const next = contour[(i + 1) % n];
    const d1x = cur.x - prev.x;
    const d1y = cur.y - prev.y;
    const d2x = next.x - cur.x;
    const d2y = next.y - cur.y;
    // skip cur if prev->cur and cur->next are collinear same direction
    if (d1x * d2y - d1y * d2x === 0 && d1x * d2x + d1y * d2y > 0) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : contour;
}

const traceCache = new WeakMap<PixelData, Contour[]>();

/**
 * Trace a placed pixel grid into font-unit contours.
 * Applies the grid→units mapping from PixelData. PixelData objects are never
 * mutated (edits create new objects), so results are cached per object identity.
 */
export function tracePixelData(pixel: PixelData): Contour[] {
  const cached = traceCache.get(pixel);
  if (cached) return cached;
  const bitmap = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
  const grid = traceBitmap(bitmap);
  const { unitsPerCell: u, offsetX, baselineRow } = pixel;
  const out = grid.map((c) =>
    c.map((p) => ({
      x: Math.round(offsetX + p.x * u),
      y: Math.round((p.y - baselineRow) * u),
      onCurve: true,
    })),
  );
  traceCache.set(pixel, out);
  return out;
}

/** Winding classification: true when the loop encloses fill (CCW, area>0). */
export function isOuterLoop(contour: Contour): boolean {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    const q = contour[(i + 1) % contour.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area > 0;
}
