/** SVG contour editor: select contours/points, move points, reverse, delete. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { Alert, Box, Button, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import BackspaceIcon from '@mui/icons-material/Backspace';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import StraightenIcon from '@mui/icons-material/Straighten';
import AdjustIcon from '@mui/icons-material/Adjust';
import { useStore } from '../state/store';
import type { Contour, GlyphDoc, Slot } from '../core/types';
import { contourBoundsTight, reverseContour } from '../core/contours';
import { glyphSvgPath } from '../render/glyphRender';
import { revertToSource, setContours, setGlyphMetrics, syncLsbFromContours } from '../state/glyphActions';
import { computeRSB, glyphBoxWidth, dragAdvance, dragOrigin, sameMetrics, vectorSnapStep, type HMetrics } from '../core/metrics';

interface PtRef {
  c: number; // contour index
  p: number; // point index
}

interface DragState {
  start: { x: number; y: number };
  moved: boolean;
  orig: Contour[];
  /** points that move with the pointer, fixed when the drag starts */
  moving: PtRef[];
  /** latest preview, committed on pointer up */
  next: Contour[] | null;
}

/** Dragging the origin or advance line (bearing handles). */
interface MetricsDrag {
  which: 'origin' | 'advance';
  startClientX: number;
  start: HMetrics;
  latest: HMetrics;
}

const sameRef = (a: PtRef, c: number, p: number) => a.c === c && a.p === p;

export function OutlineEditor(props: { slot: Slot; glyph: GlyphDoc }) {
  const { slot, glyph } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const snapToPixelGrid = useStore((s) => s.snapToPixelGrid);
  const showBearingHandles = useStore((s) => s.showBearingHandles);
  const toggleSnapToPixelGrid = useStore((s) => s.toggleSnapToPixelGrid);
  const toggleBearingHandles = useStore((s) => s.toggleBearingHandles);
  const liveMetricsAll = useStore((s) => s.liveMetrics);
  const setLiveMetrics = useStore((s) => s.setLiveMetrics);
  const theme = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);

  const [selPts, setSelPts] = useState<PtRef[]>([]);
  const [selContour, setSelContour] = useState<number | null>(null);
  const [live, setLive] = useState<Contour[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const metricsDragRef = useRef<MetricsDrag | null>(null);
  const liveMetrics = liveMetricsAll && liveMetricsAll.slot === slot && liveMetricsAll.glyphId === glyph.id ? liveMetricsAll : null;
  useEffect(() => () => setLiveMetrics(null), [setLiveMetrics]);

  const contours = glyph.contours;
  const bb = useMemo(() => contourBoundsTight(contours), [contours]);
  const upem = doc?.metrics.unitsPerEm ?? 1000;
  const margin = upem * 0.12;
  const view = {
    xMin: Math.min(bb?.xMin ?? 0, 0) - margin,
    xMax: Math.max(bb?.xMax ?? upem, glyph.advanceWidth) + margin,
    yMin: (doc?.metrics.descent ?? 0) - margin / 2,
    yMax: (doc?.metrics.ascent ?? upem) + margin / 2,
  };
  const vw = view.xMax - view.xMin;
  const vh = view.yMax - view.yMin;

  const fromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = view.xMin + ((e.clientX - rect.left) / rect.width) * vw;
    const y = view.yMax - ((e.clientY - rect.top) / rect.height) * vh;
    return { x: Math.round(x), y: Math.round(y) };
  };

  const isSel = (c: number, p: number) => selPts.some((r) => sameRef(r, c, p));

  const commitContours = (next: Contour[], label: string) => {
    commit(slot, label, (d) => syncLsbFromContours(setContours(d, glyph.id, next), glyph.id));
    setSelPts([]);
    setSelContour(null);
  };

  const clickContour = (c: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelContour(c);
    setSelPts(contours[c].map((_, p) => ({ c, p })));
  };

  /** Pointer down on a point: select it (Shift toggles) and start dragging the selection. */
  const onPointDown = (c: number, p: number, e: React.PointerEvent<SVGCircleElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setSelContour(c);
    let nextSel: PtRef[];
    if (e.shiftKey) {
      nextSel = selPts.some((r) => sameRef(r, c, p))
        ? selPts.filter((r) => !sameRef(r, c, p))
        : [...selPts, { c, p }];
    } else if (selPts.some((r) => sameRef(r, c, p))) {
      nextSel = selPts; // dragging part of an existing selection keeps it
    } else {
      nextSel = [{ c, p }];
    }
    setSelPts(nextSel);
    dragRef.current = {
      start: fromEvent(e),
      moved: false,
      orig: contours.map((cc) => cc.map((pt) => ({ ...pt }))),
      moving: nextSel,
      next: null,
    };
  };

  const snapOpts = { snap: snapToPixelGrid, step: vectorSnapStep(upem) };

  /** Pointer down on the origin / advance line or its marker. */
  const onMetricsDown = (which: 'origin' | 'advance', e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    const start: HMetrics = { advance: glyph.advanceWidth, lsb: glyph.leftSideBearing };
    metricsDragRef.current = { which, startClientX: e.clientX, start, latest: start };
    setLiveMetrics({ slot, glyphId: glyph.id, ...start });
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const md = metricsDragRef.current;
    if (md) {
      const rect = svgRef.current!.getBoundingClientRect();
      const deltaUnits = ((e.clientX - md.startClientX) / rect.width) * vw;
      const next = md.which === 'advance' ? dragAdvance(md.start, deltaUnits, snapOpts) : dragOrigin(md.start, deltaUnits, snapOpts);
      if (!sameMetrics(next, md.latest)) {
        md.latest = next;
        setLiveMetrics({ slot, glyphId: glyph.id, ...next });
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const cur = fromEvent(e);
    const dx = Math.round(cur.x - drag.start.x);
    const dy = Math.round(cur.y - drag.start.y);
    if (!drag.moved && dx === 0 && dy === 0) return;
    drag.moved = true;
    const next = drag.orig.map((cc, ci) =>
      cc.map((pt, pi) => (drag.moving.some((r) => sameRef(r, ci, pi)) ? { ...pt, x: pt.x + dx, y: pt.y + dy } : pt)),
    );
    drag.next = next;
    setLive(next);
  };

  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const md = metricsDragRef.current;
    if (md) {
      metricsDragRef.current = null;
      try {
        svgRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
      setLiveMetrics(null);
      // one commit = one undo step for the whole drag
      if (!sameMetrics(md.latest, md.start)) {
        commit(slot, md.which === 'advance' ? 'Drag advance width' : 'Drag left side bearing', (d) => setGlyphMetrics(d, glyph.id, md.latest));
      }
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (drag?.moved && drag.next) commitContours(drag.next, 'Move points');
    setLive(null);
  };

  const shown = live ?? contours;

  const deleteSelected = () => {
    if (selPts.length === 0) return;
    const removeSet = new Set(selPts.map((r) => `${r.c}:${r.p}`));
    const next: Contour[] = [];
    let dropped = false;
    contours.forEach((c, ci) => {
      const kept = c.filter((_, pi) => !removeSet.has(`${ci}:${pi}`));
      if (kept.length >= 3) next.push(kept);
      else dropped = true;
    });
    if (dropped) toast('warning', 'A contour needs at least 3 points — contours that became too small were removed.');
    commitContours(next, 'Delete points');
  };

  const deleteContour = () => {
    if (selContour === null) return;
    commitContours(contours.filter((_, i) => i !== selContour), 'Delete contour');
  };

  const reverseSelected = () => {
    if (selContour === null) return;
    const next = contours.map((c, i) => (i === selContour ? reverseContour(c) : c));
    commitContours(next, 'Reverse contour');
    toast('info', 'Contour direction reversed (winding flipped).');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape' && metricsDragRef.current) {
      metricsDragRef.current = null;
      setLiveMetrics(null);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (selPts.length) deleteSelected();
      else deleteContour();
    }
  };

  if (!doc) return null;

  const guideY = (units: number) => view.yMax - units;
  const ptSize = Math.max(2.5, vw / 220);
  const guideColor = theme.palette.text.secondary;
  const fillColor = theme.palette.text.primary;
  const accent = theme.palette.secondary.main;
  const warn = theme.palette.primary.main;
  // live metrics while a handle is dragged; the glyph content is drawn unmoved, so the lines shift instead
  const advNow = liveMetrics?.advance ?? glyph.advanceWidth;
  const lsbNow = liveMetrics?.lsb ?? glyph.leftSideBearing;
  const shift = liveMetrics ? liveMetrics.lsb - glyph.leftSideBearing : 0;
  const boxWidth = glyphBoxWidth(glyph);
  const originX = -shift - view.xMin;
  const advanceX = advNow - shift - view.xMin;
  const pointCount = contours.reduce((n, c) => n + c.length, 0);

  return (
    <Box onKeyDown={onKeyDown} tabIndex={0} aria-label="Outline editor keyboard area" sx={{ display: 'flex', flexDirection: 'column', gap: 1, outline: 'none', minWidth: 0 }}>
      <Paper sx={{ p: 0.75 }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
            {contours.length} contour{contours.length === 1 ? '' : 's'} · {pointCount} points
          </Typography>
          <Tooltip title="Reverse the selected contour's direction">
            <span>
              <IconButton size="small" aria-label="Reverse contour" onClick={reverseSelected} disabled={selContour === null}>
                <SwapVertIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Delete selected points (Del)">
            <span>
              <IconButton size="small" aria-label="Delete selected points" onClick={deleteSelected} disabled={selPts.length === 0}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Delete whole selected contour">
            <span>
              <IconButton size="small" aria-label="Delete contour" onClick={deleteContour} disabled={selContour === null}>
                <BackspaceIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Snap advance / bearing handles to a grid">
            <IconButton size="small" aria-label="Snap bearings to grid" color={snapToPixelGrid ? 'primary' : 'default'} onClick={toggleSnapToPixelGrid}>
              <AdjustIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Show draggable advance / bearing handles">
            <IconButton size="small" aria-label="Bearing handles" color={showBearingHandles ? 'primary' : 'default'} onClick={toggleBearingHandles}>
              <StraightenIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }} aria-live="polite">
            adv {advNow} · LSB {lsbNow} · RSB {computeRSB(advNow, lsbNow, boxWidth)}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            title="Replace the edited outline with the original imported outline"
            startIcon={<SettingsBackupRestoreIcon />}
            disabled={!glyph.sourceContours}
            onClick={() => {
              commit(slot, 'Revert to source', (d) => revertToSource(d, glyph.id));
              setSelPts([]);
              setSelContour(null);
            }}
          >
            Revert to original outline
          </Button>
        </Stack>
      </Paper>

      <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
        Click a contour to select it · Shift-click points to multi-select · Drag points to move · Del removes the selection · Drag the vertical origin / advance lines to change the bearings
      </Alert>

      <Paper sx={{ p: 1, overflow: 'auto', bgcolor: 'background.default' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${vw} ${vh}`}
          role="img"
          style={{ display: 'block', width: '100%', maxWidth: 720, height: 'auto', touchAction: 'none', userSelect: 'none' }}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
          onPointerDown={(e) => {
            // background (or the filled shape) clears the selection; points and contours handle their own clicks
            const target = e.target as Element;
            if (target === svgRef.current || target.getAttribute('data-fill') !== null) {
              setSelPts([]);
              setSelContour(null);
            }
          }}
          aria-label={`Outline of glyph ${glyph.name}`}
        >
          {/* guides */}
          {[
            [0, 'baseline'],
            [doc.metrics.ascent, 'ascent'],
            [doc.metrics.descent, 'descent'],
          ].map(([u, lab]) => (
            <line
              key={lab as string}
              x1={0}
              x2={vw}
              y1={guideY(u as number)}
              y2={guideY(u as number)}
              stroke={guideColor}
              strokeDasharray="6 5"
              opacity={0.5}
              strokeWidth={vw / 500}
            />
          ))}
          {showBearingHandles && bb && (
            <>
              <rect x={Math.min(originX, bb.xMin - view.xMin)} y={0} width={Math.abs(bb.xMin - view.xMin - originX)} height={vh} fill={accent} opacity={0.1} />
              <rect x={Math.min(bb.xMax - view.xMin, advanceX)} y={0} width={Math.abs(advanceX - (bb.xMax - view.xMin))} height={vh} fill={accent} opacity={0.1} />
            </>
          )}
          {([['origin', originX], ['advance', advanceX]] as Array<['origin' | 'advance', number]>).map(([which, x]) => (
            <g key={which}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={vh}
                stroke={showBearingHandles ? accent : guideColor}
                strokeDasharray={liveMetrics ? undefined : '3 5'}
                opacity={showBearingHandles ? 0.8 : 0.4}
                strokeWidth={vw / (liveMetrics ? 300 : 600)}
              />
              {showBearingHandles && (
                <>
                  {/* wide invisible hit area */}
                  <line
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={vh}
                    stroke="transparent"
                    strokeWidth={vw / 60}
                    style={{ cursor: 'ew-resize' }}
                    onPointerDown={(e) => onMetricsDown(which, e)}
                    data-testid={`${which}-handle`}
                    aria-label={which === 'origin' ? 'Drag origin line (left side bearing)' : 'Drag advance width line'}
                  />
                  <polygon
                    points={`${x - vw / 90},0 ${x + vw / 90},0 ${x},${vw / 45}`}
                    fill={accent}
                    style={{ cursor: 'ew-resize' }}
                    onPointerDown={(e) => onMetricsDown(which, e)}
                  />
                </>
              )}
            </g>
          ))}
          {/* filled shape */}
          <path d={glyphSvgPath(glyph, shown)} fill={fillColor} fillOpacity={0.85} fillRule="nonzero" data-fill="" />
          {/* contour outlines + points */}
          {shown.map((c, ci) => (
            <g key={ci}>
              <path
                d={glyphSvgPath(glyph, [c])}
                fill="none"
                stroke={selContour === ci ? warn : accent}
                strokeOpacity={selContour === ci ? 0.9 : 0.35}
                strokeWidth={vw / (selContour === ci ? 300 : 450)}
                onClick={(e) => clickContour(ci, e)}
                style={{ cursor: 'pointer' }}
              />
              {c.map((p, pi) => {
                const x = p.x - view.xMin;
                const y = view.yMax - p.y;
                const selected = isSel(ci, pi);
                return (
                  <circle
                    key={pi}
                    cx={x}
                    cy={y}
                    r={ptSize * (p.onCurve ? 1 : 0.75)}
                    fill={selected ? warn : p.onCurve ? accent : theme.palette.background.paper}
                    stroke={p.onCurve ? accent : warn}
                    strokeWidth={vw / 600}
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => onPointDown(ci, pi, e)}
                    aria-label={`${p.onCurve ? 'On-curve' : 'Off-curve'} point ${pi + 1} of contour ${ci + 1}${selected ? ', selected' : ''}`}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </Paper>
    </Box>
  );
}
