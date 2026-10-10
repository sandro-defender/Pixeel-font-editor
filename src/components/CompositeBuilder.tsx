/**
 * Composite glyph builder: place other glyphs as components (offset + scale),
 * by dragging on the canvas or typing numbers. Every change is one undo step
 * and the glyph stays a composite on export.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useStore } from '../state/store';
import type { GlyphDoc, Slot } from '../core/types';
import { glyphSvgPath } from '../render/glyphRender';
import { contourBounds } from '../core/contours';
import { addComponent, availableComponents, componentContours, componentInfos, matchBaseAdvance, moveComponent, removeComponent, updateComponent, type ComponentPatch } from '../core/composite';
import { snapToGrid, vectorSnapStep } from '../core/metrics';
import { charFromCodePoint } from '../core/unicodeNames';

const COLORS = ['#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];

const label = (g: GlyphDoc) => (g.unicode !== null ? `${charFromCodePoint(g.unicode)}  ${g.name}` : g.name);

/** A number box that commits on Enter / blur (one undo step per edit). */
function CommitField(props: { label: string; value: number; step?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) {
      setText(String(props.value));
      return;
    }
    if (v !== props.value) props.onCommit(v);
  };
  return (
    <TextField
      size="small"
      type="number"
      label={props.label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      slotProps={{ htmlInput: { 'aria-label': props.label, step: props.step ?? 1 } }}
    />
  );
}

interface DragState {
  index: number;
  start: { x: number; y: number };
  e0: number;
  f0: number;
  latest: { e: number; f: number };
  moved: boolean;
}

export function CompositeBuilder(props: { slot: Slot; glyph: GlyphDoc }) {
  const { slot, glyph } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const snapToPixelGrid = useStore((s) => s.snapToPixelGrid);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const theme = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [sel, setSel] = useState<number | null>(glyph.compound && glyph.compound.length ? 0 : null);
  const [live, setLive] = useState<{ index: number; e: number; f: number } | null>(null);
  const [lockScale, setLockScale] = useState(true);
  const [addValue, setAddValue] = useState<GlyphDoc | null>(null);

  const infos = useMemo(() => (doc ? componentInfos(doc, glyph) : []), [doc, glyph]);
  const options = useMemo(() => (doc ? availableComponents(doc, glyph.id) : []), [doc, glyph.id, doc?.glyphs.length]);
  const upem = doc?.metrics.unitsPerEm ?? 1000;
  const step = vectorSnapStep(upem);

  // what is drawn: each component at its (possibly live-dragged) offset
  const drawn = useMemo(() => {
    if (!doc) return [];
    return infos.map((info) => {
      const comp = live && live.index === info.index ? { ...info.comp, transform: { ...info.comp.transform, e: live.e, f: live.f } } : info.comp;
      return { info, contours: componentContours(doc, comp) };
    });
  }, [doc, infos, live]);

  if (!doc) return null;
  const allContours = drawn.flatMap((d) => d.contours);
  const bb = contourBounds(allContours);
  const margin = upem * 0.12;
  const view = {
    xMin: Math.min(bb?.xMin ?? 0, 0) - margin,
    xMax: Math.max(bb?.xMax ?? upem / 2, glyph.advanceWidth) + margin,
    yMin: Math.min(doc.metrics.descent, bb?.yMin ?? 0) - margin / 2,
    yMax: Math.max(doc.metrics.ascent, bb?.yMax ?? 0) + margin / 2,
  };
  const vw = view.xMax - view.xMin;
  const vh = view.yMax - view.yMin;
  const gy = (u: number) => view.yMax - u;
  const gx = (u: number) => u - view.xMin;
  const guide = theme.palette.text.secondary;

  const fromEvent = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: view.xMin + ((e.clientX - rect.left) / rect.width) * vw, y: view.yMax - ((e.clientY - rect.top) / rect.height) * vh };
  };

  const run = (labelText: string, fn: (d: NonNullable<typeof doc>) => NonNullable<typeof doc>) => {
    try {
      commit(slot, labelText, fn);
      return true;
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const onDown = (index: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setSel(index);
    const t = infos[index].comp.transform;
    dragRef.current = { index, start: fromEvent(e), e0: t.e, f0: t.f, latest: { e: t.e, f: t.f }, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = fromEvent(e);
    let ne = d.e0 + (p.x - d.start.x);
    let nf = d.f0 + (p.y - d.start.y);
    if (snapToPixelGrid) {
      ne = snapToGrid(ne, step);
      nf = snapToGrid(nf, step);
    }
    ne = Math.round(ne);
    nf = Math.round(nf);
    if (ne === d.latest.e && nf === d.latest.f && d.moved) return;
    if (ne !== d.e0 || nf !== d.f0) d.moved = true;
    d.latest = { e: ne, f: nf };
    setLive({ index: d.index, e: ne, f: nf });
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setLive(null);
    if (d.moved && (d.latest.e !== d.e0 || d.latest.f !== d.f0)) {
      run('Move component', (x) => updateComponent(x, glyph.id, d.index, { dx: d.latest.e, dy: d.latest.f }));
    }
  };

  const update = (index: number, patch: ComponentPatch, labelText = 'Edit component') => run(labelText, (x) => updateComponent(x, glyph.id, index, patch));

  const current = sel !== null ? infos[sel] : undefined;
  const missing = infos.filter((i) => !i.glyph);
  return (
    <Stack spacing={1.5} aria-label="Composite builder">
      <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
        Composite glyph — built from other glyphs. Drag a component to position it (snapping follows the “snap bearings to grid” setting) or type exact offsets and scales. It is exported as a composite; “Flatten composite” in the toolbar converts it to plain outlines.
      </Alert>

      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Autocomplete
          size="small"
          sx={{ minWidth: 260, flex: 1, maxWidth: 380 }}
          options={options}
          value={addValue}
          getOptionLabel={label}
          getOptionKey={(g) => g.id}
          onChange={(_, g) => {
            if (!g) return;
            const before = infos.length;
            if (run('Add component', (x) => addComponent(x, glyph.id, g.id))) setSel(before);
            setAddValue(null);
          }}
          renderInput={(params) => <TextField {...params} label="Add component" placeholder="Search by character or name" />}
        />
        <Tooltip title="Set this glyph's advance width to the first component's (the base letter)">
          <span>
            <Button disabled={infos.length === 0} onClick={() => run('Match base advance', (x) => matchBaseAdvance(x, glyph.id))}>
              Match base advance
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {missing.length > 0 && (
        <Alert severity="warning">
          {missing.length} component{missing.length === 1 ? ' refers' : 's refer'} to a deleted glyph and {missing.length === 1 ? 'is' : 'are'} not drawn. Remove {missing.length === 1 ? 'it' : 'them'} or the glyph exports as flattened outlines.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' }, gap: 1.5, alignItems: 'start' }}>
        <Paper sx={{ p: 1, overflow: 'auto', bgcolor: 'background.default' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${vw} ${vh}`}
            role="img"
            aria-label={`Composite builder canvas for ${glyph.name}`}
            style={{ display: 'block', width: '100%', maxWidth: 720, height: 'auto', touchAction: 'none', userSelect: 'none' }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerDown={(e) => {
              if (e.target === svgRef.current) setSel(null);
            }}
          >
            {[
              [0, 'baseline'],
              [doc.metrics.ascent, 'ascent'],
              [doc.metrics.descent, 'descent'],
            ].map(([u, lab]) => (
              <line key={lab as string} x1={0} x2={vw} y1={gy(u as number)} y2={gy(u as number)} stroke={guide} strokeDasharray="6 5" opacity={0.5} strokeWidth={vw / 500} />
            ))}
            {[0, glyph.advanceWidth].map((u, i) => (
              <line key={i} x1={gx(u)} x2={gx(u)} y1={0} y2={vh} stroke={guide} strokeDasharray="3 5" opacity={0.5} strokeWidth={vw / 600} />
            ))}
            {drawn.map(({ info, contours }) => {
              const color = COLORS[info.index % COLORS.length];
              const selected = sel === info.index;
              const d = glyphSvgPath(glyph, contours);
              return (
                <g key={info.index} transform={`translate(${-view.xMin} ${view.yMax}) scale(1 -1)`}>
                  <path
                    d={d}
                    fill={color}
                    fillOpacity={selected ? 0.6 : 0.35}
                    stroke={color}
                    strokeWidth={vw / (selected ? 250 : 500)}
                    style={{ cursor: 'move' }}
                    data-component={info.index}
                    data-testid={`component-${info.index}`}
                    aria-label={`Component ${info.index + 1}: ${info.glyph ? info.glyph.name : 'missing'}${selected ? ', selected' : ''}`}
                    onPointerDown={(e) => onDown(info.index, e)}
                  />
                </g>
              );
            })}
          </svg>
          {infos.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', pb: 1 }}>
              No components yet — search for a glyph above (for example the base letter, then the accent).
            </Typography>
          )}
        </Paper>

        <Stack spacing={1.25}>
          <Paper variant="outlined">
            <List dense disablePadding aria-label="Components">
              {infos.map((info) => (
                <ListItemButton key={info.index} selected={sel === info.index} onClick={() => setSel(info.index)} aria-label={`Select component ${info.index + 1}`}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLORS[info.index % COLORS.length], mr: 1.25, flex: 'none' }} />
                  <ListItemText
                    primary={info.glyph ? label(info.glyph) : '(deleted glyph)'}
                    secondary={`x ${info.dx}, y ${info.dy}${info.scaleX !== 1 || info.scaleY !== 1 ? ` · ×${+info.scaleX.toFixed(3)}${info.scaleY !== info.scaleX ? ` / ×${+info.scaleY.toFixed(3)}` : ''}` : ''}`}
                  />
                  {info.skewed && <Chip size="small" label="rotated" title="This component has a rotation/skew from the source font; it is kept as is" />}
                </ListItemButton>
              ))}
              {infos.length === 0 && (
                <Box sx={{ p: 1.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    Components appear here.
                  </Typography>
                </Box>
              )}
            </List>
          </Paper>

          {current && (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack spacing={1.25} aria-label="Selected component">
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
                    {current.glyph ? label(current.glyph) : 'Deleted glyph'}
                  </Typography>
                  <Tooltip title="Select this component's glyph">
                    <span>
                      <Button size="small" disabled={!current.glyph} onClick={() => current.glyph && selectGlyph(slot, current.glyph.id)}>
                        Open
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                  <CommitField label="Offset X" value={current.dx} onCommit={(v) => update(current.index, { dx: v })} />
                  <CommitField label="Offset Y" value={current.dy} onCommit={(v) => update(current.index, { dy: v })} />
                  <CommitField label="Scale X" value={+current.scaleX.toFixed(4)} step={0.05} onCommit={(v) => update(current.index, lockScale ? { scaleX: v, scaleY: v } : { scaleX: v })} />
                  <CommitField label="Scale Y" value={+current.scaleY.toFixed(4)} step={0.05} onCommit={(v) => update(current.index, lockScale ? { scaleX: v, scaleY: v } : { scaleY: v })} />
                </Box>
                <FormControlLabel control={<Checkbox size="small" checked={lockScale} onChange={(e) => setLockScale(e.target.checked)} />} label="Keep scale uniform" slotProps={{ typography: { variant: 'body2' } }} />
                <FormControlLabel
                  control={<Checkbox size="small" checked={!!current.comp.useMyMetrics} onChange={(e) => update(current.index, { useMyMetrics: e.target.checked })} />}
                  label="Use this component's metrics"
                  slotProps={{ typography: { variant: 'body2' } }}
                />
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Draw earlier (move up in the list)">
                    <span>
                      <IconButton size="small" aria-label="Move component up" disabled={current.index === 0} onClick={() => { if (run('Reorder component', (x) => moveComponent(x, glyph.id, current.index, current.index - 1))) setSel(current.index - 1); }}>
                        <ArrowUpwardIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Draw later (move down in the list)">
                    <span>
                      <IconButton size="small" aria-label="Move component down" disabled={current.index >= infos.length - 1} onClick={() => { if (run('Reorder component', (x) => moveComponent(x, glyph.id, current.index, current.index + 1))) setSel(current.index + 1); }}>
                        <ArrowDownwardIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => { if (run('Remove component', (x) => removeComponent(x, glyph.id, current.index))) setSel(null); }}>
                    Remove
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
