/** Canvas rendering of GlyphDoc models (no TTF rebuild needed). */
import type { Contour, FontDoc, FontMetrics, GlyphDoc } from '../core/types';
import { contourToSegments, contourBoundsTight } from '../core/contours';
import { tracePixelData } from '../core/trace';

export interface GlyphRenderOpts {
  color?: string;
  /** draw baseline/ascent/descent/advance guides */
  guides?: boolean;
  guideColor?: string;
}

/**
 * Draw a glyph into ctx.
 * @param emPx height of the em square in pixels
 * @param originX canvas x where the glyph origin (x=0) sits
 * @param baselineY canvas y of the baseline
 * @returns advance in px
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: GlyphDoc,
  metrics: FontMetrics,
  emPx: number,
  originX: number,
  baselineY: number,
  opts: GlyphRenderOpts = {},
): number {
  const scale = emPx / metrics.unitsPerEm;
  const color = opts.color ?? '#222';

  let contours: Contour[] = [];
  if (glyph.kind === 'pixel' && glyph.pixel) {
    contours = tracePixelData(glyph.pixel);
  } else if (glyph.contours.length) {
    contours = glyph.contours;
  }

  if (contours.length) {
    const path = contoursToPath2D(contours, (x, y) => [originX + x * scale, baselineY - y * scale]);
    ctx.fillStyle = color;
    ctx.fill(path, 'nonzero');
  }

  if (opts.guides) {
    const gc = opts.guideColor ?? 'rgba(120,120,255,0.5)';
    ctx.save();
    ctx.strokeStyle = gc;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const w = ctx.canvas.width;
    const yAscent = baselineY - metrics.ascent * scale;
    const yDescent = baselineY - metrics.descent * scale;
    line(ctx, 0, baselineY, w, baselineY);
    ctx.strokeStyle = gc.replace(/[\d.]+\)$/, '0.3)');
    line(ctx, 0, yAscent, w, yAscent);
    line(ctx, 0, yDescent, w, yDescent);
    ctx.setLineDash([2, 3]);
    line(ctx, originX, 0, originX, ctx.canvas.height);
    line(ctx, originX + glyph.advanceWidth * scale, 0, originX + glyph.advanceWidth * scale, ctx.canvas.height);
    ctx.restore();
  }
  return glyph.advanceWidth * scale;
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function contoursToPath2D(
  contours: Contour[],
  map: (x: number, y: number) => [number, number],
): Path2D {
  const path = new Path2D();
  for (const contour of contours) {
    const segs = contourToSegments(contour);
    for (const seg of segs) {
      const [fx, fy] = map(seg.from.x, seg.from.y);
      const [tx, ty] = map(seg.to.x, seg.to.y);
      if (seg === segs[0]) path.moveTo(fx, fy);
      if (seg.ctrl) {
        const [cx, cy] = map(seg.ctrl.x, seg.ctrl.y);
        path.quadraticCurveTo(cx, cy, tx, ty);
      } else {
        path.lineTo(tx, ty);
      }
    }
    path.closePath();
  }
  return path;
}

/** Render a glyph centered into a square canvas cell (glyph browser cards). */
export function renderGlyphCard(canvas: HTMLCanvasElement, glyph: GlyphDoc, metrics: FontMetrics, color: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 56;
  const cssH = canvas.clientHeight || 56;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bb =
    glyph.kind === 'pixel' && glyph.pixel
      ? contourBoundsTight(tracePixelData(glyph.pixel))
      : contourBoundsTight(glyph.contours);
  const pad = 6;
  let emPx = cssH - pad * 2;
  let baselineY = cssH - pad + metrics.descent * (emPx / metrics.unitsPerEm);
  let originX = pad;
  if (bb) {
    // fit the drawing into the cell
    const bw = Math.max(1, bb.xMax - bb.xMin);
    const bh = Math.max(1, bb.yMax - bb.yMin);
    const s = Math.min((cssW - pad * 2) / bw, (cssH - pad * 2) / bh, (cssH * 1.6) / metrics.unitsPerEm);
    emPx = s * metrics.unitsPerEm;
    baselineY = cssH / 2 + ((bb.yMax + bb.yMin) / 2) * s;
    originX = cssW / 2 - ((bb.xMax + bb.xMin) / 2) * s;
  } else {
    // empty glyph (space etc): draw a faint box
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.strokeRect(pad, pad, cssW - pad * 2, cssH - pad * 2);
    ctx.globalAlpha = 1;
    return;
  }
  drawGlyph(ctx, glyph, metrics, emPx, originX, baselineY, { color });
}

/** Build an SVG path d-string for a glyph (used by the outline editor). */
export function glyphSvgPath(glyph: GlyphDoc, contours?: Contour[]): string {
  const cs = contours ?? (glyph.kind === 'pixel' && glyph.pixel ? tracePixelData(glyph.pixel) : glyph.contours);
  let d = '';
  for (const contour of cs) {
    const segs = contourToSegments(contour);
    for (const seg of segs) {
      if (seg === segs[0]) d += `M ${seg.from.x} ${seg.from.y} `;
      if (seg.ctrl) d += `Q ${seg.ctrl.x} ${seg.ctrl.y} ${seg.to.x} ${seg.to.y} `;
      else d += `L ${seg.to.x} ${seg.to.y} `;
    }
    d += 'Z ';
  }
  return d;
}
