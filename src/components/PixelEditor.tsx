/**
 * Interactive pixel matrix editor.
 *
 * Pointer: pencil / eraser (right button erases), flood fill, line, rectangle,
 * marquee selection with move, drag-to-draw.
 * Keyboard: a cell cursor (arrows) with Space/Enter to act on it, so every
 * single pixel can be set exactly without the mouse; Shift+arrows nudge the
 * whole bitmap; Ctrl+A/C/X/V; Esc places a floating selection.
 * Rulers show exact column and row numbers; the status line reads out the cell
 * under the pointer or cursor. Mini previews show actual size, enlarged and as
 * an LED matrix.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { GlyphDoc, Slot } from '../core/types';
import { Bitmap } from '../core/bitmap';
import { setPixelData, snapGlyphToLed } from '../state/glyphActions';
import { tracePixelData } from '../core/trace';
import { contoursToPath2D } from '../render/glyphRender';
import { checkLedFont, glyphLedIssues, ledLabel } from '../core/ledMatrix';
import { Btn, IconBtn } from './ui';

/** Clipboard shared by all editor instances (pixels only). */
let appClipboard: Bitmap | null = null;

/** Pixels reserved for the rulers along the top and left edges. */
const RULER = 22;

type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'select';

interface Cell {
  /** column, 0 = left */
  x: number;
  /** bitmap row, 0 = bottom (matches the data model) */
  y: number;
}

interface Rect4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Selection {
  bm: Bitmap;
  x: number;
  y: number;
}

type DragState =
  | { kind: 'paint'; value: number; last: Cell; label: string }
  | { kind: 'shape'; value: number; start: Cell; cur: Cell }
  | { kind: 'marquee'; start: Cell; cur: Cell }
  | { kind: 'move'; startX: number; startY: number; origX: number; origY: number; x: number; y: number };

const css = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const inRect = (r: { x: number; y: number; bm: Bitmap }, c: Cell): boolean =>
  c.x >= r.x && c.x < r.x + r.bm.width && c.y >= r.y && c.y < r.y + r.bm.height;

export function PixelEditor(props: { slot: Slot; glyph: GlyphDoc }) {
  const { slot, glyph } = props;
  const doc = useStore((s) => s.fonts[slot])!;
  const ui = useStore((s) => s.ui[slot]);
  const commit = useStore((s) => s.commit);
  const setTool = useStore((s) => s.setTool);
  const setZoom = useStore((s) => s.setZoom);
  const setOverlayGlyph = useStore((s) => s.setOverlayGlyph);
  const toggleGridLines = useStore((s) => s.toggleGridLines);
  const toast = useStore((s) => s.toast);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openModal = useStore((s) => s.openModal);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actualRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const ledRef = useRef<HTMLCanvasElement>(null);

  const pixel = glyph.pixel;
  const zoom = ui.zoom;
  const gridW = pixel?.width ?? 0;
  const gridH = pixel?.height ?? 0;
  const led = doc.ledMatrix ?? null;
  const tool = ui.tool;

  const baseBitmap = useMemo(
    () => (pixel ? Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64) : null),
    [pixel],
  );

  // transient editing state
  const [sel, setSel] = useState<Selection | null>(null);
  const [stroke, setStroke] = useState<{ x0: number; y0: number; x1: number; y1: number; value: number } | null>(null);
  const [marquee, setMarquee] = useState<Rect4 | null>(null);
  const [cursor, setCursor] = useState<Cell>({ x: 0, y: 0 });
  const [hover, setHover] = useState<Cell | null>(null);
  const [kbAnchor, setKbAnchor] = useState<Cell | null>(null);
  const [tick, setTick] = useState(0);
  const liveRef = useRef<Bitmap | null>(null); // working copy during a paint stroke
  const dragRef = useRef<DragState | null>(null);
  const bump = () => setTick((t) => t + 1);

  // start each glyph with the cursor at the top-left and no leftovers
  useEffect(() => {
    setCursor({ x: 0, y: Math.max(0, gridH - 1) });
    setKbAnchor(null);
    setStroke(null);
    setMarquee(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyph.id]);

  useEffect(() => {
    setKbAnchor(null);
    setStroke(null);
    setMarquee(null);
  }, [tool]);

  // LED-font facts shown in the toolbar
  const ledCheck = useMemo(() => (doc.ledMatrix ? checkLedFont(doc) : null), [doc]);
  const needsSnap = !!ledCheck && glyphLedIssues(ledCheck, glyph.id).some((i) => i.severity === 'error');

  // ------------------------------------------------------------- helpers
  /** The bitmap with any floating selection pressed into it (no state change). */
  const withSel = (src: Bitmap): Bitmap => {
    const out = src.clone();
    if (sel) out.paste(sel.bm, sel.x, sel.y, 'or');
    return out;
  };

  const commitBitmap = (bm: Bitmap, label: string) => {
    commit(slot, label, (d) => setPixelData(d, glyph.id, { ...pixel!, cellsB64: bm.toB64(), width: bm.width, height: bm.height }));
  };

  /** Commit `work` if it differs from the base, and drop the floating selection. */
  const commitWork = (work: Bitmap, label: string) => {
    if (baseBitmap && !work.equals(baseBitmap)) commitBitmap(work, label);
    setSel(null);
  };

  const clampCell = (c: Cell): Cell => ({
    x: Math.max(0, Math.min(gridW - 1, c.x)),
    y: Math.max(0, Math.min(gridH - 1, c.y)),
  });

  /** Map a pointer position to a grid cell (raw: may lie outside the grid). */
  const cellAt = (e: { clientX: number; clientY: number }): Cell & { inside: boolean } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * sx - RULER;
    const py = (e.clientY - rect.top) * sy - RULER;
    const x = Math.floor(px / zoom);
    const screenRow = Math.floor(py / zoom);
    const y = gridH - 1 - screenRow;
    const inside = px >= 0 && py >= 0 && x >= 0 && x < gridW && screenRow >= 0 && screenRow < gridH;
    return { x, y, inside };
  };

  /** Fill / flood region at a cell. Left: toggles the region; right: clears it. */
  const floodAt = (cell: Cell, right: boolean) => {
    const work = withSel(baseBitmap!);
    const target = work.get(cell.x, cell.y);
    const value = right || target ? 0 : 1;
    if (target !== value) work.floodFill(cell.x, cell.y, value);
    commitWork(work, 'Fill');
  };

  /** Extract a rectangle (marquee) as a floating selection. */
  const finishMarquee = (a: Cell, b: Cell) => {
    if (!baseBitmap) return;
    const xa = Math.max(0, Math.min(gridW - 1, Math.min(a.x, b.x)));
    const xb = Math.max(0, Math.min(gridW - 1, Math.max(a.x, b.x)));
    const ya = Math.max(0, Math.min(gridH - 1, Math.min(a.y, b.y)));
    const yb = Math.max(0, Math.min(gridH - 1, Math.max(a.y, b.y)));
    const w = xb - xa + 1;
    const h = yb - ya + 1;
    const merged = withSel(baseBitmap);
    const extracted = merged.extract(xa, ya, w, h);
    if (extracted.count() > 0) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (extracted.get(x, y)) merged.set(xa + x, ya + y, 0);
      commitBitmap(merged, 'Select pixels');
      setSel({ bm: extracted, x: xa, y: ya });
    } else {
      commitWork(merged, 'Place selection');
    }
  };

  // ------------------------------------------------------------- drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixel || !baseBitmap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = gridW * zoom;
    const H = gridH * zoom;
    const cw = W + RULER;
    const ch = H + RULER;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const cPanel = css('--panel', '#fff');
    const cPanel2 = css('--panel-2', '#f3f4f7');
    const cText = css('--text', '#111');
    const cDim = css('--text-dim', '#888');
    const cAccent = css('--accent', '#d40');
    const cAccent2 = css('--accent-2', '#26c');
    const cGrid = css('--grid', 'rgba(0,0,0,0.12)');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = cPanel2;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = cPanel;
    ctx.fillRect(RULER, RULER, W, H);

    const bm = liveRef.current ?? baseBitmap;

    // --- grid content (drawn in cell space, origin = top-left of the grid)
    ctx.save();
    ctx.translate(RULER, RULER);
    ctx.fillStyle = cText;
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        if (bm.get(x, y)) ctx.fillRect(x * zoom, (gridH - 1 - y) * zoom, zoom, zoom);
      }
    }

    // floating selection
    if (sel) {
      ctx.fillStyle = cAccent2;
      for (let y = 0; y < sel.bm.height; y++) {
        for (let x = 0; x < sel.bm.width; x++) {
          if (sel.bm.get(x, y)) ctx.fillRect((sel.x + x) * zoom, (gridH - 1 - (sel.y + y)) * zoom, zoom, zoom);
        }
      }
      ctx.strokeStyle = cAccent;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sel.x * zoom + 0.5, (gridH - sel.y - sel.bm.height) * zoom + 0.5, sel.bm.width * zoom - 1, sel.bm.height * zoom - 1);
      ctx.setLineDash([]);
    }

    // hover + keyboard cursor
    if (hover && !dragRef.current) {
      ctx.fillStyle = 'rgba(38,102,204,0.18)';
      ctx.fillRect(hover.x * zoom, (gridH - 1 - hover.y) * zoom, zoom, zoom);
    }
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 2;
    ctx.strokeRect(cursor.x * zoom + 1, (gridH - 1 - cursor.y) * zoom + 1, zoom - 2, zoom - 2);

    // grid lines
    if (ui.showGrid && zoom >= 5) {
      ctx.strokeStyle = cGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= gridW; x++) {
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, H);
      }
      for (let y = 0; y <= gridH; y++) {
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(W, y * zoom + 0.5);
      }
      ctx.stroke();
    }

    // metric guides
    const upc = pixel.unitsPerCell;
    const yFor = (units: number) => H - (pixel.baselineRow + units / upc) * zoom;
    const guide = (y: number, color: string, label: string) => {
      if (y < -20 || y > H + 20) return;
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '10px system-ui';
      ctx.fillText(label, 3, Math.max(10, Math.min(H - 3, y - 3)));
    };
    guide(yFor(0), cAccent2, 'baseline');
    guide(yFor(doc.metrics.ascent), cAccent2, 'ascent');
    guide(yFor(doc.metrics.descent), cAccent2, 'descent');
    const xOrigin = (-pixel.offsetX / upc) * zoom;
    const xAdv = ((glyph.advanceWidth - pixel.offsetX) / upc) * zoom;
    for (const [x, lab] of [[xOrigin, 'origin'], [xAdv, 'advance']] as Array<[number, string]>) {
      if (x < -20 || x > W + 20) continue;
      ctx.strokeStyle = cAccent2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cAccent2;
      ctx.font = '10px system-ui';
      ctx.fillText(lab, Math.max(2, Math.min(W - 40, x + 3)), H - 4);
    }

    // reference overlay (trace another glyph)
    if (ui.overlayGlyphId) {
      const og = doc.glyphs.find((g) => g.id === ui.overlayGlyphId);
      if (og && og.id !== glyph.id) {
        const contours = og.kind === 'pixel' && og.pixel ? tracePixelData(og.pixel) : og.contours;
        if (contours.length) {
          const map = (x: number, y: number): [number, number] => [
            ((x - pixel.offsetX) / upc) * zoom,
            H - (pixel.baselineRow + y / upc) * zoom,
          ];
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = cAccent2;
          ctx.fill(contoursToPath2D(contours, map), 'nonzero');
          ctx.restore();
        }
      }
    }

    // shape preview: drag stroke, or keyboard two-step (anchor → cursor)
    const cx = (c: number) => c * zoom + zoom / 2;
    const cy = (r: number) => (gridH - 1 - r) * zoom + zoom / 2;
    const shapeFrom = stroke
      ? { x0: stroke.x0, y0: stroke.y0, x1: stroke.x1, y1: stroke.y1 }
      : kbAnchor && (tool === 'line' || tool === 'rect')
        ? { x0: kbAnchor.x, y0: kbAnchor.y, x1: cursor.x, y1: cursor.y }
        : null;
    if (shapeFrom && (tool === 'line' || tool === 'rect')) {
      ctx.strokeStyle = cAccent;
      ctx.lineWidth = Math.max(2, zoom * 0.6);
      ctx.beginPath();
      if (tool === 'line') {
        ctx.moveTo(cx(shapeFrom.x0), cy(shapeFrom.y0));
        ctx.lineTo(cx(shapeFrom.x1), cy(shapeFrom.y1));
      } else {
        const xa = Math.min(shapeFrom.x0, shapeFrom.x1) * zoom;
        const ya = (gridH - Math.max(shapeFrom.y0, shapeFrom.y1) - 1) * zoom;
        const w = (Math.abs(shapeFrom.x1 - shapeFrom.x0) + 1) * zoom;
        const h = (Math.abs(shapeFrom.y1 - shapeFrom.y0) + 1) * zoom;
        ctx.strokeRect(xa + 1, ya + 1, w - 2, h - 2);
      }
      ctx.stroke();
    }

    // marquee (drag, or keyboard anchor for select)
    const mq = marquee ?? (kbAnchor && tool === 'select' ? { x0: kbAnchor.x, y0: kbAnchor.y, x1: cursor.x, y1: cursor.y } : null);
    if (mq) {
      const xa = Math.min(mq.x0, mq.x1) * zoom;
      const ya = (gridH - Math.max(mq.y0, mq.y1) - 1) * zoom;
      ctx.strokeStyle = cText;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(xa + 0.5, ya + 0.5, (Math.abs(mq.x1 - mq.x0) + 1) * zoom - 1, (Math.abs(mq.y1 - mq.y0) + 1) * zoom - 1);
      ctx.setLineDash([]);
    }
    ctx.restore();

    // --- rulers: exact column numbers (top) and row numbers from the top (left)
    const step = zoom >= 14 ? 1 : zoom >= 8 ? 2 : zoom >= 5 ? 5 : 10;
    const cursorScreenRow = gridH - 1 - cursor.y;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = cDim;
    for (let x = 0; x < gridW; x++) {
      const on = x % step === 0 || x === cursor.x;
      if (!on) continue;
      ctx.fillStyle = x === cursor.x ? cAccent : cDim;
      ctx.fillText(String(x), RULER + x * zoom + zoom / 2, RULER / 2);
    }
    ctx.textAlign = 'right';
    for (let r = 0; r < gridH; r++) {
      const on = r % step === 0 || r === cursorScreenRow;
      if (!on) continue;
      ctx.fillStyle = r === cursorScreenRow ? cAccent : cDim;
      ctx.fillText(String(r), RULER - 3, RULER + r * zoom + zoom / 2);
    }
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RULER + 0.5, 0);
    ctx.lineTo(RULER + 0.5, ch);
    ctx.moveTo(0, RULER + 0.5);
    ctx.lineTo(cw, RULER + 0.5);
    ctx.stroke();
  }, [tick, zoom, gridW, gridH, pixel, baseBitmap, sel, stroke, marquee, cursor, hover, kbAnchor, ui.showGrid, tool, ui.overlayGlyphId, doc, glyph, slot]);

  // mini previews: actual size, enlarged, LED matrix
  useEffect(() => {
    if (!baseBitmap) return;
    const bm = liveRef.current ?? baseBitmap;
    const cellPaint = (canvas: HTMLCanvasElement | null, scale: number) => {
      if (!canvas) return;
      canvas.width = bm.width * scale;
      canvas.height = bm.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = css('--text', '#111');
      for (let y = 0; y < bm.height; y++) {
        for (let x = 0; x < bm.width; x++) {
          if (bm.get(x, y)) ctx.fillRect(x * scale, (bm.height - 1 - y) * scale, scale, scale);
        }
      }
    };
    cellPaint(actualRef.current, 1);
    const bigScale = Math.max(1, Math.floor(72 / Math.max(bm.width, bm.height)));
    cellPaint(bigRef.current, bigScale);

    const led = ledRef.current;
    if (led) {
      const dot = Math.max(3, Math.floor(160 / Math.max(bm.width, bm.height)));
      led.width = bm.width * dot + 4;
      led.height = bm.height * dot + 4;
      const ctx = led.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0b0d10';
      ctx.fillRect(0, 0, led.width, led.height);
      const r = dot * 0.36;
      for (let y = 0; y < bm.height; y++) {
        for (let x = 0; x < bm.width; x++) {
          const on = bm.get(x, y) === 1;
          const cx = 2 + x * dot + dot / 2;
          const cy = 2 + (bm.height - 1 - y) * dot + dot / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          if (on) {
            ctx.shadowColor = '#ff6a2b';
            ctx.shadowBlur = dot >= 6 ? dot * 0.7 : 0;
            ctx.fillStyle = '#ff6a2b';
          } else {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#23262e';
          }
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    }
  }, [tick, baseBitmap, gridW, gridH]);

  // ------------------------------------------------------------ pointer
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pixel || !baseBitmap || (e.button !== 0 && e.button !== 2)) return;
    const c = cellAt(e);
    if (!c.inside) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    wrapRef.current?.focus();
    const right = e.button === 2;
    const cell: Cell = { x: c.x, y: c.y };
    setCursor(cell);

    if (tool === 'select' && sel && inRect(sel, cell)) {
      dragRef.current = { kind: 'move', startX: cell.x, startY: cell.y, origX: sel.x, origY: sel.y, x: sel.x, y: sel.y };
      return;
    }

    switch (tool) {
      case 'pencil':
      case 'eraser': {
        const value = tool === 'eraser' || right ? 0 : 1;
        const work = withSel(baseBitmap);
        if (sel) setSel(null);
        work.set(cell.x, cell.y, value);
        liveRef.current = work;
        dragRef.current = { kind: 'paint', value, last: cell, label: value ? 'Draw' : 'Erase' };
        bump();
        break;
      }
      case 'fill':
        floodAt(cell, right);
        break;
      case 'line':
      case 'rect': {
        const value = right ? 0 : 1;
        dragRef.current = { kind: 'shape', value, start: cell, cur: cell };
        setStroke({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y, value });
        break;
      }
      case 'select':
        dragRef.current = { kind: 'marquee', start: cell, cur: cell };
        setMarquee({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
        break;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pixel) return;
    const c = cellAt(e);
    setHover(c.inside ? { x: c.x, y: c.y } : null);
    const d = dragRef.current;
    if (!d) return;
    const cell = clampCell(c);
    switch (d.kind) {
      case 'paint': {
        const bm = liveRef.current;
        if (bm) bm.line(d.last.x, d.last.y, cell.x, cell.y, d.value);
        d.last = cell;
        bump();
        break;
      }
      case 'shape':
        d.cur = cell;
        setStroke((s) => (s ? { ...s, x1: cell.x, y1: cell.y } : s));
        break;
      case 'marquee':
        d.cur = cell;
        setMarquee({ x0: d.start.x, y0: d.start.y, x1: cell.x, y1: cell.y });
        break;
      case 'move': {
        const nx = d.origX + (c.x - d.startX);
        const ny = d.origY + (c.y - d.startY);
        d.x = nx;
        d.y = ny;
        setSel((s) => (s ? { ...s, x: nx, y: ny } : s));
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !baseBitmap) return;
    switch (d.kind) {
      case 'paint': {
        const bm = liveRef.current;
        liveRef.current = null;
        if (bm && !bm.equals(baseBitmap)) commitBitmap(bm, d.label);
        bump();
        break;
      }
      case 'shape': {
        const work = withSel(baseBitmap);
        if (tool === 'line') work.line(d.start.x, d.start.y, d.cur.x, d.cur.y, d.value);
        else work.rect(d.start.x, d.start.y, d.cur.x, d.cur.y, d.value, false);
        commitWork(work, tool === 'line' ? 'Line' : 'Rectangle');
        setStroke(null);
        break;
      }
      case 'marquee':
        finishMarquee(d.start, d.cur);
        setMarquee(null);
        break;
      case 'move': {
        const moved = d.x !== d.origX || d.y !== d.origY;
        if (moved && sel) {
          const work = baseBitmap.clone();
          work.paste(sel.bm, d.x, d.y, 'or');
          commitBitmap(work, 'Move selection');
          setSel(null);
        }
        break;
      }
    }
  };

  // ------------------------------------------------------------ actions
  const transform = (label: string, fn: (bm: Bitmap) => Bitmap | void) => {
    if (!baseBitmap) return;
    const work = withSel(baseBitmap);
    const out = fn(work);
    setSel(null);
    commitBitmap(out instanceof Bitmap ? out : work, label);
  };

  const copySel = () => {
    if (!baseBitmap) return;
    appClipboard = sel ? sel.bm.clone() : baseBitmap.clone();
    toast('info', sel ? 'Selection copied.' : 'Whole grid copied.');
  };

  const cutSel = () => {
    if (!baseBitmap) return;
    if (sel) {
      appClipboard = sel.bm.clone();
      setSel(null);
      commitBitmap(baseBitmap.clone(), 'Cut selection');
    } else {
      appClipboard = baseBitmap.clone();
      commitBitmap(new Bitmap(baseBitmap.width, baseBitmap.height), 'Cut grid');
    }
  };

  /** Paste the clipboard with its top-left at the cursor (opaque, overwrites its rectangle). */
  const pasteAtCursor = () => {
    if (!appClipboard || !baseBitmap) {
      toast('warning', 'Clipboard is empty.');
      return;
    }
    const clip = appClipboard;
    const work = withSel(baseBitmap);
    const dx = cursor.x;
    const dy = cursor.y - clip.height + 1;
    for (let yy = 0; yy < clip.height; yy++) {
      for (let xx = 0; xx < clip.width; xx++) work.set(dx + xx, dy + yy, 0);
    }
    work.paste(clip, dx, dy);
    setSel(null);
    commitBitmap(work, 'Paste');
  };

  const nudgeSelection = (dx: number, dy: number) => {
    if (sel) setSel({ ...sel, x: sel.x + dx, y: sel.y + dy });
  };

  /** Space / Enter: act on the cell under the keyboard cursor with the current tool. */
  const actAtCursor = (shift: boolean) => {
    if (!baseBitmap) return;
    switch (tool) {
      case 'pencil':
      case 'eraser': {
        const value = tool === 'eraser' || shift ? 0 : 1;
        const work = withSel(baseBitmap);
        work.set(cursor.x, cursor.y, value);
        commitWork(work, value ? 'Draw' : 'Erase');
        break;
      }
      case 'fill':
        floodAt(cursor, shift);
        break;
      case 'line':
      case 'rect': {
        if (!kbAnchor) {
          setKbAnchor(cursor);
          break;
        }
        const work = withSel(baseBitmap);
        const value = shift ? 0 : 1;
        if (tool === 'line') work.line(kbAnchor.x, kbAnchor.y, cursor.x, cursor.y, value);
        else work.rect(kbAnchor.x, kbAnchor.y, cursor.x, cursor.y, value, false);
        setKbAnchor(null);
        commitWork(work, tool === 'line' ? 'Line' : 'Rectangle');
        break;
      }
      case 'select':
        if (!kbAnchor) {
          setKbAnchor(cursor);
          break;
        }
        finishMarquee(kbAnchor, cursor);
        setKbAnchor(null);
        break;
    }
  };

  const shiftBitmap = (dx: number, dy: number) => transform('Shift bitmap', (bm) => bm.shift(dx, dy));

  const rotate = () => {
    if (led) {
      toast('warning', 'LED matrix glyphs keep their height — rotation would change it.');
      return;
    }
    transform('Rotate 90°', (bm) => bm.rotate90());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handled = () => {
      e.preventDefault();
      // keep the global window shortcuts (undo, redo, save) from running twice
      e.stopPropagation();
    };

    if (ctrl) {
      if (key === 'z' && !e.shiftKey) { handled(); undo(slot); return; }
      if (key === 'y' || (key === 'z' && e.shiftKey)) { handled(); redo(slot); return; }
      if (key === 'c') { handled(); copySel(); return; }
      if (key === 'x') { handled(); cutSel(); return; }
      if (key === 'v') { handled(); pasteAtCursor(); return; }
      if (key === 'a') { handled(); finishMarquee({ x: 0, y: 0 }, { x: gridW - 1, y: gridH - 1 }); return; }
      return;
    }

    const arrows: Record<string, [number, number]> = {
      arrowup: [0, 1],
      arrowdown: [0, -1],
      arrowleft: [-1, 0],
      arrowright: [1, 0],
    };
    if (arrows[key]) {
      handled();
      const [dx, dy] = arrows[key];
      if (sel) nudgeSelection(dx, dy);
      else if (e.shiftKey || e.altKey) shiftBitmap(dx, dy);
      else setCursor((c) => clampCell({ x: c.x + dx, y: c.y + dy }));
      return;
    }

    if (key === ' ' || key === 'enter') {
      // let focused buttons keep their own Space/Enter behaviour
      if (target.tagName === 'BUTTON') return;
      handled();
      actAtCursor(e.shiftKey);
      return;
    }

    switch (key) {
      case 't': {
        handled();
        if (baseBitmap) {
          const work = withSel(baseBitmap);
          work.toggle(cursor.x, cursor.y);
          commitWork(work, 'Toggle pixel');
        }
        break;
      }
      case 'b': case 'p': setTool(slot, 'pencil'); handled(); break;
      case 'e': setTool(slot, 'eraser'); handled(); break;
      case 'f': setTool(slot, 'fill'); handled(); break;
      case 'l': setTool(slot, 'line'); handled(); break;
      case 'r': setTool(slot, 'rect'); handled(); break;
      case 'm': case 's': setTool(slot, 'select'); handled(); break;
      case 'g': toggleGridLines(slot); handled(); break;
      case 'i': transform('Invert', (bm) => bm.invert()); handled(); break;
      case 'delete':
      case 'backspace': {
        handled();
        if (sel) setSel(null); // deleting a floating selection removes its pixels
        else transform('Clear grid', (bm) => bm.clear());
        break;
      }
      case 'escape': {
        handled();
        if (kbAnchor) setKbAnchor(null);
        else if (sel) commitWork(withSel(baseBitmap!), 'Place selection');
        setStroke(null);
        setMarquee(null);
        break;
      }
      case '+': case '=': handled(); setZoom(slot, zoom + (zoom >= 16 ? 8 : 2)); break;
      case '-': handled(); setZoom(slot, zoom - (zoom > 16 ? 8 : 2)); break;
    }
  };

  if (!pixel) {
    return <div className="muted">This glyph has no pixel grid. Use “Convert to pixels…” or create a pixel font.</div>;
  }

  const toolBtn = (t: Tool, icon: string, tip: string) => (
    <IconBtn icon={icon} tip={tip} active={tool === t} onClick={() => setTool(slot, t)} />
  );
  const info = hover ?? cursor;
  const infoValue = baseBitmap ? (sel && inRect(sel, info) ? sel.bm.get(info.x - sel.x, info.y - sel.y) : baseBitmap.get(info.x, info.y)) : 0;

  return (
    <div style={{ display: 'contents' }} onKeyDown={onKeyDown} tabIndex={0} aria-label="Pixel editor keyboard area" ref={wrapRef}>
      <div className="editor-toolbar" role="toolbar" aria-label="Pixel tools">
        {toolBtn('pencil', '✏️', 'Pencil — draw pixels (B). Right-drag erases.')}
        {toolBtn('eraser', '🧽', 'Eraser — remove pixels (E)')}
        {toolBtn('fill', '🪣', 'Flood fill (F)')}
        {toolBtn('line', '📏', 'Line tool (L)')}
        {toolBtn('rect', '▭', 'Rectangle tool (R)')}
        {toolBtn('select', '⬚', 'Select / move pixels (M). Ctrl+A selects all.')}
        <span className="sep" />
        <IconBtn icon="⧉" tip="Copy selection / grid (Ctrl+C)" onClick={copySel} />
        <IconBtn icon="✂" tip="Cut selection / grid (Ctrl+X)" onClick={cutSel} />
        <IconBtn icon="📋" tip="Paste at the cursor (Ctrl+V)" onClick={pasteAtCursor} />
        <span className="sep" />
        <IconBtn icon="⬅" tip="Shift bitmap left (Shift+←)" onClick={() => shiftBitmap(-1, 0)} />
        <IconBtn icon="➡" tip="Shift bitmap right (Shift+→)" onClick={() => shiftBitmap(1, 0)} />
        <IconBtn icon="⬆" tip="Shift bitmap up (Shift+↑)" onClick={() => shiftBitmap(0, 1)} />
        <IconBtn icon="⬇" tip="Shift bitmap down (Shift+↓)" onClick={() => shiftBitmap(0, -1)} />
        <span className="sep" />
        <IconBtn icon="⇋" tip="Flip horizontal" onClick={() => transform('Flip horizontal', (bm) => bm.flipHorizontal())} />
        <IconBtn icon="⇅" tip="Flip vertical" onClick={() => transform('Flip vertical', (bm) => bm.flipVertical())} />
        <IconBtn icon="⟳" tip={led ? 'Rotation disabled for LED matrix fonts (height is fixed)' : 'Rotate 90° counter-clockwise'} onClick={rotate} disabled={!!led} />
        <IconBtn icon="◑" tip="Invert pixels (I)" onClick={() => transform('Invert', (bm) => bm.invert())} />
        <IconBtn icon="🗑" tip="Clear grid (Delete)" onClick={() => transform('Clear', (bm) => bm.clear())} />
        <span className="sep" />
        <IconBtn icon="⊞" tip="Toggle grid lines (G)" active={ui.showGrid} onClick={() => toggleGridLines(slot)} />
        <IconBtn icon="−" tip="Zoom out (-)" onClick={() => setZoom(slot, zoom - (zoom > 16 ? 8 : 2))} />
        <span className="zoom-label">{zoom}px / cell</span>
        <IconBtn icon="＋" tip="Zoom in (+)" onClick={() => setZoom(slot, zoom + (zoom >= 16 ? 8 : 2))} />
        <span className="sep" />
        <label className="small muted" title="Show another glyph semi-transparent for tracing">
          Trace:{' '}
          <select
            value={ui.overlayGlyphId ?? ''}
            onChange={(e) => setOverlayGlyph(slot, e.target.value || null)}
            aria-label="Reference overlay glyph"
          >
            <option value="">off</option>
            {doc.glyphs
              .filter((g) => g.id !== glyph.id && (g.contours.length || g.pixel))
              .slice(0, 400)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.unicode !== null ? String.fromCodePoint(g.unicode) + ' ' : ''}{g.name}
                </option>
              ))}
          </select>
        </label>
        <span className="spacer" />
        {needsSnap && (
          <Btn
            kind="primary"
            tip="This glyph is not on the LED matrix grid yet. Snap it (vector outlines are rasterized)."
            onClick={() => commit(slot, 'Snap to LED grid', (d) => snapGlyphToLed(d, glyph.id))}
          >
            Snap to LED grid
          </Btn>
        )}
        <Btn tip="Enter the exact pixels as text art (#/.) or as LED column bytes (0x3E, …)" onClick={() => openModal({ type: 'pixelCode', slot, glyphId: glyph.id })}>
          ⌨ Pixel code…
        </Btn>
        <Btn
          tip={led ? 'Change the glyph width (the matrix height is fixed)' : 'Change the grid size (crop/pad or resample)'}
          onClick={() => openModal({ type: 'resizeGrid', slot, glyphId: glyph.id })}
        >
          {led ? `Width ${gridW} px…` : `Grid ${gridW}×${gridH}…`}
        </Btn>
      </div>

      <div className="editor-body">
        <div className="editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={gridW * zoom + RULER}
            height={gridH * zoom + RULER}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Pixel grid, ${gridW} columns by ${gridH} rows${led ? `, LED matrix ${ledLabel(led)}` : ''}`}
          />
        </div>
        <div className="pixel-status small" aria-live="polite">
          <span className="chip">{hover ? 'pointer' : 'cursor'}: col {info.x} · row {gridH - 1 - info.y} from top</span>
          <span className="chip">{infoValue ? 'on' : 'off'}</span>
          <span className="muted">
            cursor col {cursor.x}, row {gridH - 1 - cursor.y} · arrows move · Space/Enter act · Shift+Space erases · T toggles
          </span>
          {kbAnchor && <span className="chip warn-chip">{tool} started at col {kbAnchor.x}, row {gridH - 1 - kbAnchor.y} — arrows extend it, Space finishes, Esc cancels</span>}
        </div>
        <div className="editor-preview-strip">
          <div className="mini-preview">
            <canvas ref={actualRef} />
            <div className="cap">actual size</div>
          </div>
          <div className="mini-preview">
            <canvas ref={bigRef} />
            <div className="cap">enlarged</div>
          </div>
          <div className="mini-preview">
            <canvas ref={ledRef} />
            <div className="cap">LED matrix</div>
          </div>
          <div className="small muted">
            {led ? <span className="chip led-chip">LED {ledLabel(led)} · {led.cellUnits} units/px · spacing {led.spacing}px</span> : null}{' '}
            advance {glyph.advanceWidth} · LSB {glyph.leftSideBearing} · cell {pixel.unitsPerCell}u · baseline row {pixel.baselineRow}
          </div>
        </div>
      </div>
    </div>
  );
}
