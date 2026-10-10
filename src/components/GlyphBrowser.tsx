/** Left pane: searchable, filterable, virtualised glyph grid with multi-select and transfer shortcuts. */
import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Button, ButtonBase, Chip, InputAdornment, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useStore } from '../state/store';
import type { FontMetrics, GlyphDoc, Slot } from '../core/types';
import { charFromCodePoint, describeCodePoint, unicodeName } from '../core/unicodeNames';
import { renderGlyphCard } from '../render/glyphRender';
import { basicSetGlyphs } from '../core/fontFactory';
import { glyphDragType } from './glyphDrag';
import { SegmentedControl } from './ui';
import { VirtualGrid } from './VirtualGrid';

/** Compile the search box text into a predicate (char, U+hex, or a name fragment). */
export function parseSearch(q: string): (g: GlyphDoc) => boolean {
  const s = q.trim();
  if (!s) return () => true;
  if ([...s].length === 1) {
    const cp = s.codePointAt(0)!;
    return (g) => g.unicode === cp;
  }
  const hex = s.match(/^(?:u\+|0x)?([0-9a-f]{1,6})$/i);
  if (hex) {
    const cp = parseInt(hex[1], 16);
    return (g) => g.unicode === cp;
  }
  const lower = s.toLowerCase();
  return (g) => {
    if (g.name.toLowerCase().includes(lower)) return true;
    if (g.unicode !== null) {
      const name = unicodeName(g.unicode);
      if (name?.toLowerCase().includes(lower)) return true;
      if (describeCodePoint(g.unicode).toLowerCase().includes(lower)) return true;
    }
    return false;
  };
}

interface CardProps {
  slot: Slot;
  glyph: GlyphDoc;
  metrics: FontMetrics;
  selected: boolean;
  multiSelected: boolean;
  dark: boolean;
}

/**
 * One glyph tile. Memoised: it only redraws when its own glyph (immutable
 * data, replaced on every edit to that glyph), the metrics or the theme change,
 * so editing one glyph does not repaint the whole grid.
 */
const GlyphCard = React.memo(function GlyphCard({ slot, glyph, metrics, selected, multiSelected, dark }: CardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) renderGlyphCard(canvasRef.current, glyph, metrics, dark ? '#e8eaf2' : '#1c2030');
  }, [glyph, metrics, dark]);

  const unmapped = glyph.unicode === null;
  const label =
    glyph.unicode !== null ? `${charFromCodePoint(glyph.unicode)} · U+${glyph.unicode.toString(16).toUpperCase().padStart(4, '0')}` : glyph.name;
  const title = glyph.unicode !== null ? `${glyph.name} — ${describeCodePoint(glyph.unicode)}` : `${glyph.name} — no Unicode assignment`;

  return (
    <ButtonBase
      role="listitem"
      aria-pressed={selected}
      aria-label={title}
      title={title}
      draggable
      onDragStart={(e) => {
        // dragging a selected card moves the whole selection; otherwise just this card
        const sel = useStore.getState().ui[slot].multiSelected;
        const ids = sel.includes(glyph.id) ? sel : [glyph.id];
        e.dataTransfer.setData(glyphDragType(slot), JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onClick={(e) => {
        const st = useStore.getState();
        if (e.shiftKey || e.ctrlKey || e.metaKey) st.toggleMultiSelect(slot, glyph.id);
        else st.selectGlyph(slot, glyph.id);
      }}
      sx={{
        width: '100%',
        height: '100%',
        borderRadius: 1.5,
        border: 1,
        borderStyle: unmapped ? 'dashed' : 'solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'action.selected' : 'background.paper',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 0.5,
        position: 'relative',
        '&:hover': { borderColor: 'secondary.main' },
        cursor: 'pointer',
      }}
    >
      {multiSelected && <Chip label="✓" size="small" color="primary" sx={{ position: 'absolute', top: 2, left: 2, height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
      <Stack direction="row" spacing={0.25} sx={{ position: 'absolute', top: 2, right: 2 }}>
        {glyph.kind === 'compound' && <Chip label="C" size="small" title="Composite glyph" sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
        {glyph.edited && <Chip label="✎" size="small" color="primary" title="Edited" sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
      </Stack>
      <Box component="canvas" ref={canvasRef} sx={{ width: 44, height: 44, mt: 1 }} />
      <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%', fontSize: 10, lineHeight: 1.2 }}>
        {label}
      </Typography>
    </ButtonBase>
  );
});

export function GlyphBrowser(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const ui = useStore((s) => s.ui[slot]);
  const theme = useStore((s) => s.theme);
  const setListSearch = useStore((s) => s.setListSearch);
  const setListFilter = useStore((s) => s.setListFilter);
  const openModal = useStore((s) => s.openModal);
  const setMultiSelect = useStore((s) => s.setMultiSelect);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const other: Slot = slot === 'A' ? 'B' : 'A';

  const glyphs = useMemo(() => {
    if (!doc) return [];
    const match = parseSearch(ui.glyphListSearch);
    return doc.glyphs.filter((g) => {
      if (!match(g)) return false;
      switch (ui.glyphListFilter) {
        case 'mapped': return g.unicode !== null;
        case 'unmapped': return g.unicode === null;
        case 'edited': return g.edited;
        default: return true;
      }
    });
  }, [doc, ui.glyphListSearch, ui.glyphListFilter]);

  if (!doc) return null;
  const dark = theme === 'dark';

  const addBasicSet = () => {
    const current = useStore.getState().fonts[slot];
    if (!current) return;
    const glyphs = basicSetGlyphs(current);
    if (glyphs.length === 0) {
      toast('info', 'All basic Latin, digit, punctuation and Georgian glyphs already exist.');
      return;
    }
    commit(slot, 'Add basic set', (d) => ({ ...d, glyphs: [...d.glyphs, ...glyphs] }));
    toast('success', `Added ${glyphs.length} starter glyphs (Latin, digits, punctuation, Georgian).`);
  };

  const selectionCount = ui.multiSelected.length;

  return (
    <Paper
      component="aside"
      aria-label={`Glyph browser for Font ${slot}`}
      square
      sx={{ width: { xs: '100%', lg: 300 }, height: { xs: 420, lg: 'auto' }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, borderWidth: 0, borderRight: { lg: 1 }, borderBottom: { xs: 1, lg: 0 }, borderColor: 'divider' }}
    >
      <Stack spacing={1} sx={{ p: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1}>
          <TextField
            placeholder="Search char, U+10D0, name…"
            value={ui.glyphListSearch}
            onChange={(e) => setListSearch(slot, e.target.value)}
            aria-label="Search glyphs"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: ui.glyphListSearch ? (
                  <InputAdornment position="end">
                    <Button size="small" variant="text" aria-label="Clear search" onClick={() => setListSearch(slot, '')} sx={{ minWidth: 0, p: 0.25 }}>
                      <ClearIcon fontSize="small" />
                    </Button>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={() => openModal({ type: 'addGlyph', slot })} sx={{ flexShrink: 0 }}>
            Glyph
          </Button>
          <Tooltip title="Add empty glyphs for basic Latin, digits, punctuation and Georgian Mkhedruli">
            <Button onClick={addBasicSet} sx={{ flexShrink: 0 }}>
              Aa+
            </Button>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SegmentedControl
              ariaLabel="Filter glyphs"
              fullWidth
              value={ui.glyphListFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'mapped', label: 'Mapped', tip: 'Glyphs with a Unicode assignment' },
                { value: 'unmapped', label: 'Unmapped', tip: 'Glyphs without a Unicode assignment' },
                { value: 'edited', label: 'Edited', tip: 'Glyphs you changed' },
              ]}
              onChange={(v) => setListFilter(slot, v)}
            />
          </Box>
        </Stack>
        {selectionCount > 0 && (
          <Stack sx={{ alignItems: 'center', flexWrap: 'wrap' }} direction="row" spacing={1} useFlexGap>
            <Chip label={`${selectionCount} selected`} color="primary" onDelete={() => setMultiSelect(slot, [])} />
            <Button
              variant="contained"
              color="primary"
              onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: ui.multiSelected, mode: 'copy' })}
              title={`Copy the selected glyphs to Font ${other} (source is kept)`}
            >
              Copy → {other}
            </Button>
            <Button
              onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: ui.multiSelected, mode: 'move' })}
              title={`Move the selected glyphs to Font ${other}; removes them from this font (one undo restores both)`}
            >
              Move → {other}
            </Button>
          </Stack>
        )}
      </Stack>

      {glyphs.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          {doc.glyphs.length === 0 ? 'This font has no glyphs yet. Add one with “+ Glyph” or “Aa+”.' : 'No glyphs match the search or filter.'}
        </Typography>
      )}
      <VirtualGrid
        ariaLabel="Glyphs"
        items={glyphs}
        itemKey={(g) => g.id}
        renderItem={(g) => (
          <GlyphCard
            slot={slot}
            glyph={g}
            metrics={doc.metrics}
            selected={ui.glyphId === g.id}
            multiSelected={ui.multiSelected.includes(g.id)}
            dark={dark}
          />
        )}
      />
      <Box sx={{ px: 1.25, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {glyphs.length === doc.glyphs.length ? `${doc.glyphs.length} glyphs` : `${glyphs.length} of ${doc.glyphs.length} glyphs`} · drag cards onto a Font tab to copy
        </Typography>
      </Box>
    </Paper>
  );
}
