/** Interactive pixel matrix editor (pointer events, tools, selection, zoom). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { GlyphDoc, Slot } from '../core/types';
import { Bitmap } from '../core/bitmap';
import { setPixelData } from '../state/glyphActions';
import { tracePixelData } from '../core/trace';
import { contoursToPath2D } from '../render/glyphRender';
import { Btn, IconBtn } from './ui';

let appClipboard: Bitmap | null = null;

interface Selection {
  bm: Bitmap;
  x: number;
  y: number;
}

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actualRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [stroke, setStroke] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragMode, setDragMode] = useState<'none' | 'draw' | 'marquee' | 'move'>('none');
  const liveRef = useRef<Bitmap | null>(null); // working copy during a stroke
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const moveRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const pixel = glyph.pixel;
  const zoom = ui.zoom;
  const gridW = pixel?.width ?? 0;
  const gridH = pixel?.height ?? 0;

  const baseBitmap = useMemo(() => (pixel ? Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64) : null), [pixel]);

  const currentBitmap = useCallback((): Bitmap | null => liveRef.current ?? baseBitmap, [baseBitmap]);

  const commitBitmap = useCallback(
    (bm: Bitmap, label: string) => {
      commit(slot, label, (d) => setPixelData(d, glyph.id, { ...pixel!, cellsB64: bm.toB64(), width: bm.width, height: bm.height }));
    },
    [commit, slot, glyph.id, pixel],
  );

  // ---------------------------------------------------------------- drawing
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixel) return;
    const ctx = canvas.getContext('2d')!;
    const W = gridW * zoom;
    const H = gridH * zoom;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#fff';
    ctx.fillRect(0, 0, W, H);

    const bm = currentBitmap();
    if (bm) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
      for (let y = 0; y < bm.height; y++) {
        for (let x = 0; x < bm.width; x++) {
          if (bm.get(x, y)) ctx.fillRect(x * zoom, (gridH - 1 - y) * zoom, zoom, zoom);
        }
      }
    }

    // selection content (floating)
    if (sel) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#26c';
      for (let y = 0; y < sel.bm.height; y++) {
        for (let x = 0; x < sel.bm.width; x++) {
          if (sel.bm.get(x, y)) ctx.fillRect((sel.x + x) * zoom, (gridH - 1 - (sel.y + y)) * zoom, zoom, zoom);
        }
      }
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d40';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sel.x * zoom + 0.5, (gridH - sel.y - sel.bm.height) * zoom + 0.5, sel.bm.width * zoom - 1, sel.bm.height * zoom - 1);
      ctx.setLineDash([]);
    }

    // grid lines
    if (ui.showGrid && zoom >= 5) {
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || 'rgba(0,0,0,0.12)';
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
    const gc = getComputedStyle(document.documentElement).getPropertyValue('--guide').trim() || '#26c';
    guide(yFor(0), gc, 'baseline');
    guide(yFor(doc.metrics.ascent), gc, 'ascent');
    guide(yFor(doc.metrics.descent), gc, 'descent');
    // origin & advance
    const xOrigin = -pixel.offsetX / upc * zoom;
    const xAdv = (glyph.advanceWidth - pixel.offsetX) / upc * zoom;
    for (const [x, lab] of [[xOrigin, 'origin'], [xAdv, 'advance']] as Array<[number, string]>) {
      if (x < -20 || x > W + 20) continue;
      ctx.strokeStyle = gc;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = gc;
      ctx.font = '10px system-ui';
      ctx.fillText(lab, Math.max(2, Math.min(W - 40, x + 3)), H - 4);
    }

    // reference overlay glyph
    if (ui.overlayGlyphId) {
      const og = doc.glyphs.find((g) => g.id === ui.overlayGlyphId);
      if (og && og.id !== glyph.id) {
        let contours = og.kind === 'pixel' && og.pixel ? tracePixelData(og.pixel) : og.contours;
        if (contours.length) {
          const map = (x: number, y: number): [number, number] => [
            ((x - pixel.offsetX) / upc) * zoom,
            H - (pixel.baselineRow + y / upc) * zoom,
          ];
          const path = contoursToPath2D(contours, map);
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = gc;
          ctx.fill(path, 'nonzero');
          ctx.restore();
        }
      }
    }

    // stroke preview (line / rect / marquee)
    if (stroke && (ui.tool === 'line' || ui.tool === 'rect')) {
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d40';
      ctx.lineWidth = Math.max(2, zoom * 0.6);
      ctx.beginPath();
      const cx = (c: number) => c * zoom + zoom / 2;
      const cy = (r: number) => (gridH - 1 - r) * zoom + zoom / 2;
      if (ui.tool === 'line') {
        ctx.moveTo(cx(stroke.x0), cy(stroke.y0));
        ctx.lineTo(cx(stroke.x1), cy(stroke.y1));
      } else {
        const xa = Math.min(stroke.x0, stroke.x1) * zoom;
        const ya = (gridH - Math.max(stroke.y0, stroke.y1) - 1) * zoom;
        const w = (Math.abs(stroke.x1 - stroke.x0) + 1) * zoom;
        const h = (Math.abs(stroke.y1 - stroke.y0) + 1) * zoom;
        ctx.strokeRect(xa + 1, ya + 1, w - 2, h - 2);
      }
      ctx.stroke();
    }
    if (marqueeRef.current && dragMode === 'marquee') {
      const m = marqueeRef.current;
      const xa = Math.min(m.x0, m.x1) * zoom;
      const ya = (gridH - Math.max(m.y0, m.y1) - 1) * zoom;
      ctx.strokeStyle = gc;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(xa, ya, (Math.abs(m.x1 - m.x0) + 1) * zoom, (Math.abs(m.y1 - m.y0) + 1) * zoom);
      ctx.setLineDash([]);
    }
  }, [zoom, gridW, gridH, pixel, sel, stroke, ui.showGrid, ui.tool, ui.overlayGlyphId, doc, glyph, currentBitmap, dragMode]);

  useEffect(() => {
    draw();
  }, [draw]);

  // mini previews (actual size + enlarged)
  useEffect(() => {
    const bm = currentBitmap();
    if (!bm) return;
    const render = (canvas: HTMLCanvasElement | null, scale: number) => {
      if (!canvas) return;
      canvas.width = bm.width * scale;
      canvas.height = bm.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
      for (let y = 0; y < bm.height; y++) {
        for (let x = 0; x < bm.width; x++) {
          if (bm.get(x, y)) ctx.fillRect(x * scale, (bm.height - 1 - y) * scale, scale, scale);
        }
      }
    };
    render(actualRef.current, 1);
    const bigScale = Math.max(1, Math.floor(72 / Math.max(bm.width, bm.height)));
    render(bigRef.current, bigScale);
  }, [baseBitmap, currentBitmap, gridW, gridH]);

  // ------------------------------------------------------------ interaction
  const cellFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = gridH - 1 - Math.floor((e.clientY - rect.top) / zoom);
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pixel || !baseBitmap) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    canvasRef.current?.focus();
    const cell = cellFromEvent(e);

    // moving an existing selection?
    if (sel && ui.tool === 'select' && cell.x >= sel.x && cell.x < sel.x + sel.bm.width && cell.y >= sel.y && cell.y < sel.y + sel.bm.height) {
      setDragMode('move');
      moveRef.current = { startX: cell.x, startY: cell.y, origX: sel.x, origY: sel.y };
      return;
    }

    liveRef.current = baseBitmap.clone();
    const bm = liveRef.current;

    switch (ui.tool) {
      case 'pencil':
      case 'eraser': {
        const v = ui.tool === 'pencil' ? 1 : 0;
        // erase area under a floating selection first
        if (sel && ui.tool === 'pencil') applySelectionTo(bm);
        bm.set(cell.x, cell.y, v);
        lastCellRef.current = cell;
        setDragMode('draw');
        break;
      }
      case 'fill': {
        if (sel) applySelectionTo(bm);
        bm.floodFill(cell.x, cell.y, bm.get(cell.x, cell.y) ? 0 : 1);
        commitBitmap(bm, 'Fill');
        liveRef.current = null;
        break;
      }
      case 'line':
      case 'rect':
        setStroke({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
        setDragMode('draw');
        break;
      case 'select':
        marqueeRef.current = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
        setDragMode('marquee');
        break;
    }
    draw();
  };

  /** Burn the floating selection into a bitmap at its position. */
  const applySelectionTo = (bm: Bitmap) => {
    if (!sel) return;
    bm.paste(sel.bm, sel.x, sel.y, 'or');
    setSel(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pixel || dragMode === 'none') return;
    const cell = cellFromEvent(e);
    const clamp = (c: { x: number; y: number }) => ({
      x: Math.max(0, Math.min(gridW - 1, c.x)),
      y: Math.max(0, Math.min(gridH - 1, c.y)),
    });
    const c = clamp(cell);

    if (dragMode === 'move' && sel && moveRef.current) {
      const dx = c.x - moveRef.current.startX;
      const dy = c.y - moveRef.current.startY;
      setSel({ ...sel, x: moveRef.current.origX + dx, y: moveRef.current.origY + dy });
      return;
    }
    if (dragMode === 'marquee' && marqueeRef.current) {
      marqueeRef.current = { ...marqueeRef.current, x1: c.x, y1: c.y };
      draw();
      return;
    }
    if (ui.tool === 'line' || ui.tool === 'rect') {
      setStroke((s) => (s ? { ...s, x1: c.x, y1: c.y } : s));
      return;
    }
    // pencil / eraser drag
    const bm = liveRef.current;
    if (bm && lastCellRef.current) {
      bm.line(lastCellRef.current.x, lastCellRef.current.y, c.x, c.y, ui.tool === 'pencil' ? 1 : 0);
      lastCellRef.current = c;
      draw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (dragMode === 'move' && sel) {
      // commit move into the bitmap
      const bm = baseBitmap!.clone();
      bm.paste(sel.bm, sel.x, sel.y, 'or');
      // clear old footprint: re-extract is complex; simply OR-merge (documented)
      commitBitmap(bm, 'Move selection');
      setSel(null);
    } else if (dragMode === 'marquee' && marqueeRef.current) {
      const m = marqueeRef.current;
      const xa = Math.min(m.x0, m.x1);
      const ya = Math.min(m.y0, m.y1);
      const w = Math.abs(m.x1 - m.x0) + 1;
      const h = Math.abs(m.y1 - m.y0) + 1;
      const extracted = baseBitmap!.extract(xa, ya, w, h);
      if (extracted.count() > 0) {
        // cut the selected pixels out of the base
        const bm = baseBitmap!.clone();
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (extracted.get(x, y)) bm.set(xa + x, ya + y, 0);
        commitBitmap(bm, 'Select pixels');
        setSel({ bm: extracted, x: xa, y: ya });
      }
      marqueeRef.current = null;
    } else if (dragMode === 'draw' && liveRef.current && (ui.tool === 'pencil' || ui.tool === 'eraser')) {
      if (!liveRef.current.equals(baseBitmap!)) commitBitmap(liveRef.current, ui.tool === 'pencil' ? 'Draw' : 'Erase');
      liveRef.current = null;
    } else if (dragMode === 'draw' && stroke && (ui.tool === 'line' || ui.tool === 'rect')) {
      const bm = baseBitmap!.clone();
      if (ui.tool === 'line') bm.line(stroke.x0, stroke.y0, stroke.x1, stroke.y1, 1);
      else bm.rect(stroke.x0, stroke.y0, stroke.x1, stroke.y1, 1, false);
      commitBitmap(bm, ui.tool === 'line' ? 'Line' : 'Rectangle');
      setStroke(null);
      liveRef.current = null;
    }
    setDragMode('none');
    lastCellRef.current = null;
  };

  // ----------------------------------------------------------------- actions
  const transform = (label: string, fn: (bm: Bitmap) => Bitmap | void) => {
    if (!baseBitmap) return;
    if (sel) {
      const merged = baseBitmap.clone();
      applySelectionToNoState(merged);
      const out = fn(merged);
      commitBitmap(out instanceof Bitmap ? out : merged, label);
      setSel(null);
    } else {
      const bm = baseBitmap.clone();
      const out = fn(bm);
      commitBitmap(out instanceof Bitmap ? out : bm, label);
    }
  };
  const applySelectionToNoState = (bm: Bitmap) => {
    if (sel) bm.paste(sel.bm, sel.x, sel.y, 'or');
  };

  const copySel = () => {
    if (!baseBitmap) return;
    const merged = baseBitmap.clone();
    if (sel) merged.paste(sel.bm, sel.x, sel.y, 'or');
    appClipboard = sel ? sel.bm.clone() : merged;
    toast('info', sel ? 'Selection copied.' : 'Whole grid copied.');
  };
  const cutSel = () => {
    if (!baseBitmap) return;
    if (sel) {
      appClipboard = sel.bm.clone();
      const bm = baseBitmap.clone();
      commitBitmap(bm, 'Cut selection');
      setSel(null);
    } else {
      appClipboard = baseBitmap.clone();
      const bm = new Bitmap(baseBitmap.width, baseBitmap.height);
      commitBitmap(bm, 'Cut grid');
    }
  };
  const pasteSel = () => {
    if (!appClipboard || !baseBitmap) {
      toast('warning', 'Clipboard is empty.');
      return;
    }
    const bm = baseBitmap.clone();
    const clip = appClipboard;
    const x = sel ? sel.x : Math.max(0, Math.floor((gridW - clip.width) / 2));
    const y = sel ? sel.y : Math.max(0, Math.floor((gridH - clip.height) / 2));
    if (sel) {
      // replace selection
      setSel({ bm: clip.clone(), x, y });
    } else {
      for (let yy = 0; yy < clip.height; yy++) for (let xx = 0; xx < clip.width; xx++) if (clip.get(xx, yy)) bm.set(x + xx, y + yy, 0);
      bm.paste(clip, x, y);
      commitBitmap(bm, 'Paste');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handled = () => e.preventDefault();

    if (ctrl && key === 'z') {
      handled();
      undo(slot);
      return;
    }
    if (ctrl && (key === 'y' || (e.shiftKey && key === 'z'))) {
      handled();
      redo(slot);
      return;
    }
    if (ctrl && key === 'c') { handled(); copySel(); return; }
    if (ctrl && key === 'x') { handled(); cutSel(); return; }
    if (ctrl && key === 'v') { handled(); pasteSel(); return; }

    if (key.startsWith('arrow')) {
      handled();
      const d = { arrowup: [0, 1], arrowdown: [0, -1], arrowleft: [-1, 0], arrowright: [1, 0] }[key]!;
      if (sel) {
        setSel({ ...sel, x: sel.x + d[0], y: sel.y + d[1] });
      } else {
        transform('Shift bitmap', (bm) => bm.shift(d[0], d[1]));
      }
      return;
    }

    switch (key) {
      case 'b': case 'p': setTool(slot, 'pencil'); handled(); break;
      case 'e': setTool(slot, 'eraser'); handled(); break;
      case 'f': setTool(slot, 'fill'); handled(); break;
      case 'l': setTool(slot, 'line'); handled(); break;
      case 'r': setTool(slot, 'rect'); handled(); break;
      case 'm': case 's': setTool(slot, 'select'); handled(); break;
      case 'g': toggleGridLines(slot); handled(); break;
      case 'i': transform('Invert', (bm) => bm.invert()); handled(); break;
      case 'delete': case 'backspace': {
        handled();
        if (sel) {
          setSel(null);
        } else {
          transform('Clear grid', (bm) => bm.clear());
        }
        break;
      }
      case 'escape': setSel(null); setStroke(null); handled(); break;
      case '+': case '=': setZoom(slot, zoom + (zoom >= 16 ? 8 : 2)); handled(); break;
      case '-': setZoom(slot, zoom - (zoom > 16 ? 8 : 2)); handled(); break;
    }
  };

  if (!pixel) {
    return <div className="muted">This glyph has no pixel grid. Use “Convert to pixels…” or create a pixel font.</div>;
  }

  const toolBtn = (tool: typeof ui.tool, icon: string, tip: string) => (
    <IconBtn icon={icon} tip={tip} active={ui.tool === tool} onClick={() => setTool(slot, tool)} />
  );

  return (
    <div style={{ display: 'contents' }} onKeyDown={onKeyDown} tabIndex={0} aria-label="Pixel editor keyboard area">
      <div className="editor-toolbar" role="toolbar" aria-label="Pixel tools">
        {toolBtn('pencil', '✏️', 'Pencil — draw pixels (B)')}
        {toolBtn('eraser', '🧽', 'Eraser — remove pixels (E)')}
        {toolBtn('fill', '🪣', 'Flood fill (F)')}
        {toolBtn('line', '📏', 'Line tool (L)')}
        {toolBtn('rect', '▭', 'Rectangle tool (R)')}
        {toolBtn('select', '⬚', 'Select / move pixels (M)')}
        <span className="sep" />
        <IconBtn icon="⧉" tip="Copy selection / grid (Ctrl+C)" onClick={copySel} />
        <IconBtn icon="✂" tip="Cut selection / grid (Ctrl+X)" onClick={cutSel} />
        <IconBtn icon="📋" tip="Paste (Ctrl+V)" onClick={pasteSel} />
        <span className="sep" />
        <IconBtn icon="⬅" tip="Shift bitmap left (←)" onClick={() => transform('Shift left', (bm) => bm.shift(-1, 0))} />
        <IconBtn icon="➡" tip="Shift bitmap right (→)" onClick={() => transform('Shift right', (bm) => bm.shift(1, 0))} />
        <IconBtn icon="⬆" tip="Shift bitmap up (↑)" onClick={() => transform('Shift up', (bm) => bm.shift(0, 1))} />
        <IconBtn icon="⬇" tip="Shift bitmap down (↓)" onClick={() => transform('Shift down', (bm) => bm.shift(0, -1))} />
        <span className="sep" />
        <IconBtn icon="⇋" tip="Flip horizontal" onClick={() => transform('Flip horizontal', (bm) => bm.flipHorizontal())} />
        <IconBtn icon="⇅" tip="Flip vertical" onClick={() => transform('Flip vertical', (bm) => bm.flipVertical())} />
        <IconBtn icon="⟳" tip="Rotate 90° counter-clockwise" onClick={() => transform('Rotate 90°', (bm) => bm.rotate90())} />
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
        <Btn tip="Change the grid size (crop/pad or resample)" onClick={() => useStore.getState().openModal({ type: 'resizeGrid', slot, glyphId: glyph.id })}>
          Grid {gridW}×{gridH}…
        </Btn>
      </div>

      <div className="editor-body">
        <div className="editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={gridW * zoom}
            height={gridH * zoom}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label={`Pixel grid, ${gridW} by ${gridH}`}
          />
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
          <div className="small muted">
            advance {glyph.advanceWidth} · LSB {glyph.leftSideBearing} · cell {pixel.unitsPerCell}u · baseline row {pixel.baselineRow}
          </div>
        </div>
      </div>
    </div>
  );
}
