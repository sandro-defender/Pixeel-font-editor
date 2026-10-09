/** SVG contour editor: select contours/points, move points, reverse, delete. */
import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Contour, GlyphDoc, Slot } from '../core/types';
import { contourBoundsTight } from '../core/contours';
import { glyphSvgPath } from '../render/glyphRender';
import { setContours, syncLsbFromContours } from '../state/glyphActions';
import { Btn, IconBtn } from './ui';

interface PtRef {
  c: number; // contour index
  p: number; // point index
}

export function OutlineEditor(props: { slot: Slot; glyph: GlyphDoc }) {
  const { slot, glyph } = props;
  const doc = useStore((s) => s.fonts[slot])!;
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const svgRef = useRef<SVGSVGElement>(null);

  const [selPts, setSelPts] = useState<PtRef[]>([]);
  const [selContour, setSelContour] = useState<number | null>(null);
  const dragRef = useRef<{ start: { x: number; y: number }; moved: boolean; orig: Contour[] } | null>(null);

  const contours = glyph.contours;
  const bb = useMemo(() => contourBoundsTight(contours), [contours]);
  const margin = doc.metrics.unitsPerEm * 0.12;
  const view = {
    xMin: (bb?.xMin ?? 0) - margin,
    xMax: (bb?.xMax ?? doc.metrics.unitsPerEm) + margin,
    yMin: doc.metrics.descent - margin / 2,
    yMax: doc.metrics.ascent + margin / 2,
  };
  const vw = view.xMax - view.xMin;
  const vh = view.yMax - view.yMin;
  const pxW = 640;
  const pxH = Math.round((pxW * vh) / vw);

  const toSvg = (x: number, y: number): [number, number] => [x - view.xMin, view.yMax - y];
  const fromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = view.xMin + ((e.clientX - rect.left) / rect.width) * vw;
    const y = view.yMax - ((e.clientY - rect.top) / rect.height) * vh;
    return { x: Math.round(x), y: Math.round(y) };
  };

  const isSel = (c: number, p: number) => selPts.some((r) => r.c === c && r.p === p);

  const commitContours = (next: Contour[], label: string) => {
    commit(slot, label, (d) => syncLsbFromContours(setContours(d, glyph.id, next), glyph.id));
    setSelPts([]);
    setSelContour(null);
  };

  const clickPoint = (c: number, p: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelContour(c);
    setSelPts((prev) => {
      if (e.shiftKey) {
        return prev.some((r) => r.c === c && r.p === p) ? prev.filter((r) => !(r.c === c && r.p === p)) : [...prev, { c, p }];
      }
      return [{ c, p }];
    });
  };

  const clickContour = (c: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelContour(c);
    setSelPts(contours[c].map((_, p) => ({ c, p })));
  };

  const onPointDown = (e: React.PointerEvent) => {
    if (selPts.length === 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { start: fromEvent(e), moved: false, orig: contours.map((c) => c.map((p) => ({ ...p }))) };
  };

  const onPointMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const cur = fromEvent(e);
    const dx = Math.round(cur.x - drag.start.x);
    const dy = Math.round(cur.y - drag.start.y);
    if (!drag.moved && dx === 0 && dy === 0) return;
    drag.moved = true;
    const next = drag.orig.map((c, ci) =>
      c.map((p, pi) => {
        if (selPts.some((r) => r.c === ci && r.p === pi)) return { ...p, x: p.x + dx, y: p.y + dy };
        return p;
      }),
    );
    // live update without history spam: set into store as a transient commit on up;
    // for responsiveness we mutate a local copy via direct re-render state
    setLive(next);
  };

  const [live, setLive] = useState<Contour[] | null>(null);

  const onPointUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch { /* noop */ }
    if (drag?.moved && live) {
      commitContours(live, 'Move points');
      setLive(null);
    }
  };

  const shown = live ?? contours;

  const deleteSelected = () => {
    if (selPts.length === 0) return;
    const removeSet = new Set(selPts.map((r) => `${r.c}:${r.p}`));
    const next: Contour[] = [];
    contours.forEach((c, ci) => {
      const kept = c.filter((_, pi) => !removeSet.has(`${ci}:${pi}`));
      if (kept.length >= 3) next.push(kept);
    });
    if (next.length === 0 && contours.length > 0) {
      toast('warning', 'A contour needs at least 3 points — contour removed instead.');
    }
    commitContours(next, 'Delete points');
  };

  const deleteContour = () => {
    if (selContour === null) return;
    const next = contours.filter((_, i) => i !== selContour);
    commitContours(next, 'Delete contour');
  };

  const reverseContour = () => {
    if (selContour === null) return;
    const next = contours.map((c, i) => (i === selContour ? [...c].reverse() : c));
    commitContours(next, 'Reverse contour');
    toast('info', 'Contour direction reversed (winding flipped).');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (selPts.length) deleteSelected();
      else deleteContour();
    }
  };

  const guideY = (units: number) => view.yMax - units;
  const ptSize = Math.max(2.5, vw / 220);

  return (
    <div style={{ display: 'contents' }} onKeyDown={onKeyDown} tabIndex={0} aria-label="Outline editor keyboard area">
      <div className="editor-toolbar" role="toolbar" aria-label="Outline tools">
        <span className="small muted">
          {contours.length} contour{contours.length === 1 ? '' : 's'} · {contours.reduce((n, c) => n + c.length, 0)} points
        </span>
        <span className="sep" />
        <IconBtn icon="⇄" tip="Reverse the selected contour's direction" onClick={reverseContour} disabled={selContour === null} />
        <IconBtn icon="🗑" tip="Delete selected points (Del)" onClick={deleteSelected} disabled={selPts.length === 0} />
        <IconBtn icon="⌫" tip="Delete whole selected contour" onClick={deleteContour} disabled={selContour === null} />
        <span className="spacer" />
        <span className="hint">Click a contour to select it · Shift-click points to multi-select · Drag points to move</span>
      </div>
      <div className="editor-body">
        <div className="outline-wrap">
          <svg
            ref={svgRef}
            className="outline-svg"
            width={pxW}
            height={pxH}
            viewBox={`0 0 ${vw} ${vh}`}
            onPointerUp={onPointUp}
            aria-label={`Outline of glyph ${glyph.name}`}
          >
            {/* guides */}
            {[
              [0, 'baseline'],
              [doc.metrics.ascent, 'ascent'],
              [doc.metrics.descent, 'descent'],
            ].map(([u, lab]) => (
              <g key={lab as string}>
                <line x1={0} x2={vw} y1={guideY(u as number)} y2={guideY(u as number)} stroke="var(--guide)" strokeDasharray="6 5" opacity={0.5} strokeWidth={vw / 500} />
              </g>
            ))}
            <line x1={-view.xMin} x2={-view.xMin} y1={0} y2={vh} stroke="var(--guide)" strokeDasharray="3 5" opacity={0.4} strokeWidth={vw / 600} />
            <line
              x1={glyph.advanceWidth - view.xMin}
              x2={glyph.advanceWidth - view.xMin}
              y1={0}
              y2={vh}
              stroke="var(--guide)"
              strokeDasharray="3 5"
              opacity={0.4}
              strokeWidth={vw / 600}
            />
            {/* filled shape */}
            <path d={glyphSvgPath(glyph, shown)} fill="var(--text)" fillOpacity={0.85} fillRule="nonzero" onClick={() => { setSelPts([]); setSelContour(null); }} />
            {/* contour outlines + points */}
            {shown.map((c, ci) => (
              <g key={ci}>
                <path
                  d={glyphSvgPath(glyph, [c])}
                  fill="none"
                  stroke={selContour === ci ? 'var(--warn)' : 'var(--accent-2)'}
                  strokeOpacity={selContour === ci ? 0.9 : 0.35}
                  strokeWidth={vw / (selContour === ci ? 300 : 450)}
                  onClick={(e) => clickContour(ci, e)}
                  style={{ cursor: 'pointer' }}
                />
                {c.map((p, pi) => {
                  const [x, y] = toSvg(p.x, p.y);
                  return (
                    <circle
                      key={pi}
                      cx={x}
                      cy={y}
                      r={ptSize * (p.onCurve ? 1 : 0.75)}
                      className={`${p.onCurve ? 'pt-on' : 'pt-off'} ${isSel(ci, pi) ? 'pt-sel' : ''}`}
                      onClick={(e) => clickPoint(ci, pi, e)}
                      onPointerDown={onPointDown}
                      onPointerMove={onPointMove}
                    />
                  );
                })}
              </g>
            ))}
          </svg>
        </div>
        <div className="row">
          <Btn
            tip="Replace the edited outline with the original imported outline"
            disabled={!glyph.sourceContours}
            onClick={() => {
              commit(slot, 'Revert to source', (d) => {
                const g = d.glyphs.find((x) => x.id === glyph.id)!;
                return {
                  ...d,
                  glyphs: d.glyphs.map((x) =>
                    x.id === glyph.id
                      ? { ...x, contours: g.sourceContours!.map((c) => c.map((p) => ({ ...p }))), pixel: null, kind: g.sourceContours!.length ? 'vector' : 'empty', edited: false }
                      : x,
                  ),
                };
              });
              setSelPts([]);
              setSelContour(null);
            }}
          >
            ⟲ Revert to original outline
          </Btn>
        </div>
      </div>
    </div>
  );
}
