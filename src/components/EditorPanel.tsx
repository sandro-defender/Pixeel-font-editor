/** Main editor: picks pixel vs outline mode for the selected glyph. */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import GridOnIcon from '@mui/icons-material/GridOn';
import GestureIcon from '@mui/icons-material/Gesture';
import LayersIcon from '@mui/icons-material/Layers';
import ImageIcon from '@mui/icons-material/Image';
import { useStore } from '../state/store';
import type { GlyphDoc, Slot } from '../core/types';
import { PixelEditor } from './PixelEditor';
import { OutlineEditor } from './OutlineEditor';
import { MetricsHUD } from './MetricsHUD';
import { flattenedGlyph } from '../core/fontCodec';
import { initializePixelGrid } from '../state/glyphActions';
import { checkLedFont, glyphLedIssues, ledLabel } from '../core/ledMatrix';

type Mode = 'pixel' | 'outline';

/** Which editor a glyph opens in when the user has not picked one. */
function defaultMode(glyph: GlyphDoc, createdFont: boolean): Mode {
  if (glyph.pixel) return 'pixel';
  if (glyph.contours.length || glyph.kind === 'vector' || glyph.kind === 'compound') return 'outline';
  return glyph.kind === 'empty' && createdFont ? 'pixel' : 'outline';
}

export function EditorPanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const glyphId = useStore((s) => s.ui[slot].glyphId);
  const commit = useStore((s) => s.commit);
  const openModal = useStore((s) => s.openModal);
  const toast = useStore((s) => s.toast);

  // the explicit choice only applies to the glyph it was made for
  const [choice, setChoice] = useState<{ glyphId: string | null; mode: Mode } | null>(null);

  const glyph = doc?.glyphs.find((g) => g.id === glyphId);
  const ledCheck = useMemo(() => (doc?.ledMatrix ? checkLedFont(doc) : null), [doc]);
  const ledErrors = glyph && ledCheck ? glyphLedIssues(ledCheck, glyph.id).filter((i) => i.severity === 'error') : [];

  if (!doc) return null;
  if (!glyph) {
    return (
      <Box component="section" aria-label="Glyph editor" sx={{ flex: 1, minWidth: 0, p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography color="text.secondary">Select a glyph on the left to start editing, or create a new one.</Typography>
      </Box>
    );
  }

  const hasOutline = glyph.contours.length > 0 || glyph.kind === 'vector' || glyph.kind === 'compound' || !!glyph.sourceContours;
  const explicit = choice && choice.glyphId === glyph.id ? choice.mode : null;
  const mode: Mode = explicit ?? defaultMode(glyph, doc.source?.format === 'created');
  const setMode = (m: Mode) => setChoice({ glyphId: glyph.id, mode: m });

  const flatten = () => {
    commit(slot, 'Flatten composite', (d) => {
      const g = d.glyphs.find((x) => x.id === glyph.id);
      if (!g) return d;
      const flat = flattenedGlyph(g, d.glyphs);
      return { ...d, glyphs: d.glyphs.map((x) => (x.id === g.id ? flat : x)) };
    });
    toast('success', `“${glyph.name}” converted to editable outlines.`);
    setMode('outline');
  };

  let body: React.ReactNode;
  if (mode === 'pixel' && glyph.pixel) {
    body = <PixelEditor key={glyph.id} slot={slot} glyph={glyph} />;
  } else if (mode === 'outline' && (glyph.contours.length > 0 || glyph.kind === 'vector')) {
    body = <OutlineEditor key={glyph.id} slot={slot} glyph={glyph} />;
  } else {
    body = (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          This glyph has no {mode === 'pixel' ? 'pixel grid' : 'outline data'} yet.
        </Typography>
        <Stack sx={{ justifyContent: 'center', flexWrap: 'wrap' }} direction="row" spacing={1} useFlexGap>
          {mode === 'pixel' && doc.glyphs.some((g) => g.pixel) && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<GridOnIcon />}
              title="Start drawing on a blank grid sized like the other glyphs"
              onClick={() => {
                commit(slot, 'Init pixel grid', (d) => initializePixelGrid(d, glyph.id));
              }}
            >
              Create pixel grid
            </Button>
          )}
          {mode === 'pixel' && !doc.glyphs.some((g) => g.pixel) && (
            <Button onClick={() => openModal({ type: 'rasterize', slot, glyphId: glyph.id })}>Create a pixel grid…</Button>
          )}
          {mode === 'outline' && hasOutline && <Button onClick={() => setMode('outline')}>Edit outlines</Button>}
        </Stack>
      </Paper>
    );
  }

  return (
    <Box component="section" aria-label="Glyph editor" sx={{ flex: 1, minWidth: 0, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, overflow: 'auto', position: 'relative' }}>
      <MetricsHUD slot={slot} />
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 800, minWidth: 40, textAlign: 'center' }} aria-hidden>
          {glyph.unicode !== null ? String.fromCodePoint(glyph.unicode) : '—'}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap title={glyph.name}>
          {glyph.name}
        </Typography>
        <Chip size="small" label={glyph.kind} />
        {doc.ledMatrix && <Chip size="small" color="secondary" title="Exact-pixel LED matrix font" label={`LED ${ledLabel(doc.ledMatrix)}`} />}
        {glyph.edited && <Chip size="small" color="primary" label="edited" />}
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label="Editing mode"
          value={mode}
          onChange={(_, v: Mode | null) => v && setMode(v)}
        >
          <ToggleButton value="pixel" disabled={!glyph.pixel} aria-label="Pixels">
            <Tooltip title={glyph.pixel ? 'Edit the pixel grid' : 'No pixel grid yet'}>
              <Stack sx={{ alignItems: 'center' }} direction="row" spacing={0.75}>
                <ImageIcon fontSize="small" />
                <span>Pixels</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="outline" disabled={!hasOutline} aria-label="Outline">
            <Tooltip title={hasOutline ? 'Edit vector contours' : 'No outline data'}>
              <Stack sx={{ alignItems: 'center' }} direction="row" spacing={0.75}>
                <GestureIcon fontSize="small" />
                <span>Outline</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        {glyph.kind === 'compound' && (
          <Button
            color="warning"
            variant="outlined"
            startIcon={<LayersIcon />}
            title="Composite glyphs reference other glyphs; flatten to edit the outlines directly"
            onClick={flatten}
          >
            Flatten composite
          </Button>
        )}
        {!doc.ledMatrix && !glyph.pixel && (glyph.kind === 'vector' || glyph.kind === 'compound' || glyph.contours.length > 0) && (
          <Button title="Rasterize this vector glyph into an editable pixel grid" onClick={() => openModal({ type: 'rasterize', slot, glyphId: glyph.id })}>
            Convert to pixels…
          </Button>
        )}
      </Stack>

      {doc.ledMatrix && ledErrors.length > 0 && (
        <Alert severity="warning" role="status">
          Not an exact LED pixel glyph yet: {ledErrors.slice(0, 2).map((i) => i.message).join(' ')}
        </Alert>
      )}

      {body}
    </Box>
  );
}
