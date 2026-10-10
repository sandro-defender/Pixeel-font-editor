/**
 * Kerning pairs editor: searchable list (sorted by how common a pair is),
 * add by typing two characters / code points, edit with slider + number,
 * delete, and a live canvas preview with the edited pair highlighted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { Alert, Box, Button, Chip, IconButton, List, ListItemButton, MenuItem, Paper, Slider, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useStore } from '../state/store';
import type { FontDoc, KerningPair, Slot } from '../core/types';
import {
  MAX_IMPORTED_PAIRS,
  MAX_KERN_VALUE,
  deleteKerningPair,
  getKerning,
  kerningOf,
  kerningRows,
  layoutKerned,
  resolveGlyphInput,
  resolvePairText,
  setKerningPair,
  type KerningSort,
} from '../core/kerning';
import { drawGlyph } from '../render/glyphRender';
import { AppDialog, Hint, Section } from './ui';

const MAX_ROWS = 200;
const SAMPLE = 'AVATAR To Ty Wa';

const label = (g: { unicode: number | null; name: string }): string => (g.unicode !== null ? String.fromCodePoint(g.unicode) : g.name);

/** Two-line canvas: the text without kerning (faint) and with kerning, the chosen pair shaded. */
function KerningPreview(props: { doc: FontDoc; text: string; pairs: KerningPair[]; highlight: { left: string; right: string } | null }) {
  const { doc, text, pairs, highlight } = props;
  const theme = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cssW = canvas.clientWidth || 560;
    const cssH = 190;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const { unitsPerEm, ascent, descent } = doc.metrics;
    const plain = layoutKerned(doc, text, pairs, false);
    const kerned = layoutKerned(doc, text, pairs, true);
    const pad = 12;
    let emPx = 56;
    const widest = Math.max(plain.width, kerned.width, 1);
    emPx = Math.min(emPx, ((cssW - pad * 2) / widest) * unitsPerEm);
    const scale = emPx / unitsPerEm;
    const lineH = Math.max(emPx * ((ascent - descent) / unitsPerEm), 24);
    const rows: Array<{ laid: ReturnType<typeof layoutKerned>; title: string; faint: boolean }> = [
      { laid: plain, title: 'without kerning', faint: true },
      { laid: kerned, title: 'with kerning', faint: false },
    ];
    rows.forEach((row, i) => {
      const top = 14 + i * (cssH / 2);
      const baseline = top + 8 + (ascent / unitsPerEm) * emPx * 0.95;
      ctx.font = '10px system-ui';
      ctx.fillStyle = theme.palette.text.secondary;
      ctx.fillText(row.title, pad, top + 2);
      row.laid.glyphs.forEach((item, gi) => {
        const next = row.laid.glyphs[gi + 1];
        if (!row.faint && highlight && next && item.glyph.id === highlight.left && next.glyph.id === highlight.right) {
          const x0 = pad + item.x * scale;
          const x1 = pad + (next.x + next.glyph.advanceWidth) * scale;
          ctx.fillStyle = alpha(theme.palette.secondary.main, 0.25);
          ctx.fillRect(x0, baseline - (ascent / unitsPerEm) * emPx, x1 - x0, ((ascent - descent) / unitsPerEm) * emPx);
        }
        ctx.save();
        ctx.globalAlpha = row.faint ? 0.35 : 1;
        drawGlyph(ctx, item.glyph, doc.metrics, emPx, pad + item.x * scale, baseline, { color: theme.palette.text.primary });
        ctx.restore();
      });
    });
    void lineH;
  }, [doc, text, pairs, highlight, theme]);

  return <canvas ref={ref} role="img" aria-label="Kerning preview" style={{ width: '100%', height: 190, display: 'block' }} />;
}

export function KerningDialog(props: { slot: Slot; left?: string; right?: string }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const closeModal = useStore((s) => s.closeModal);
  const askConfirm = useStore((s) => s.askConfirm);
  const toast = useStore((s) => s.toast);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<KerningSort>('frequency');
  const [selected, setSelected] = useState<{ left: string; right: string } | null>(props.left && props.right ? { left: props.left, right: props.right } : null);
  const [draft, setDraft] = useState<number | null>(null);
  const [addLeft, setAddLeft] = useState(() => {
    const g = props.left && doc ? doc.glyphs.find((x) => x.id === props.left) : null;
    return g ? label(g) : '';
  });
  const [addRight, setAddRight] = useState(() => {
    const g = props.right && doc ? doc.glyphs.find((x) => x.id === props.right) : null;
    return g ? label(g) : '';
  });
  const [addValue, setAddValue] = useState('-50');
  const [addError, setAddError] = useState<string | null>(null);
  const [sample, setSample] = useState(SAMPLE);

  const rows = useMemo(() => (doc ? kerningRows(doc, query, sort) : []), [doc, query, sort]);

  // The selection follows the document (undo may remove the pair)
  const selectedValue = doc && selected ? getKerning(doc, selected.left, selected.right) : 0;
  const selectedExists = !!doc && !!selected && kerningOf(doc).some((p) => p.left === selected.left && p.right === selected.right);
  const selLeft = doc && selected ? doc.glyphs.find((g) => g.id === selected.left) : undefined;
  const selRight = doc && selected ? doc.glyphs.find((g) => g.id === selected.right) : undefined;

  const previewPairs = useMemo(() => {
    const base = doc ? kerningOf(doc) : [];
    if (!selected || draft === null) return base;
    const has = base.some((p) => p.left === selected.left && p.right === selected.right);
    return has ? base.map((p) => (p.left === selected.left && p.right === selected.right ? { ...p, value: draft } : p)) : [...base, { ...selected, value: draft }];
  }, [doc, selected, draft]);

  // pre-fill the preview with the selected pair so it is always visible
  const previewText = useMemo(() => {
    const pair = selLeft && selRight && selLeft.unicode !== null && selRight.unicode !== null ? label(selLeft) + label(selRight) : '';
    return pair ? `${pair} ${sample}` : sample;
  }, [selLeft, selRight, sample]);

  if (!doc) {
    return (
      <AppDialog title="Kerning pairs" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning">This font no longer exists.</Alert>
      </AppDialog>
    );
  }

  const upem = doc.metrics.unitsPerEm;
  const total = kerningOf(doc).length;
  const unreadable = !!doc.source?.hasKerning && doc.kerning === undefined;
  const truncated = !doc.kerningEdited && total >= MAX_IMPORTED_PAIRS;

  const apply = (l: string, r: string, value: number, labelText: string) => {
    commit(slot, labelText, (d) => setKerningPair(d, l, r, value));
  };

  const addPair = () => {
    setAddError(null);
    let left = resolveGlyphInput(doc, addLeft);
    let right = resolveGlyphInput(doc, addRight);
    if (!right && !addRight.trim()) {
      // "AV" / "A V" typed into the first box
      const both = resolvePairText(doc, addLeft);
      if (both) {
        left = both.left;
        right = both.right;
      }
    }
    if (!left) return setAddError(`No glyph for “${addLeft || '…'}” in the first field. Type a character, a code point (U+0041) or a glyph name.`);
    if (!right) return setAddError(`No glyph for “${addRight || '…'}” in the second field.`);
    const value = Number(addValue.trim() === '' ? 0 : addValue);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_KERN_VALUE) return setAddError(`The value must be a number between −${MAX_KERN_VALUE} and ${MAX_KERN_VALUE}.`);
    const existed = kerningOf(doc).some((p) => p.left === left!.id && p.right === right!.id);
    apply(left.id, right.id, value, existed ? 'Edit kerning pair' : 'Add kerning pair');
    setSelected({ left: left.id, right: right.id });
    setDraft(null);
    setAddLeft('');
    setAddRight('');
    if (existed) toast('info', 'That pair already existed — its value was updated.');
  };

  const commitValue = (value: number) => {
    if (!selected) return;
    setDraft(null);
    if (!Number.isFinite(value) || value === selectedValue) return;
    apply(selected.left, selected.right, Math.max(-MAX_KERN_VALUE, Math.min(MAX_KERN_VALUE, value)), 'Edit kerning pair');
  };

  const removePair = (left: string, right: string) => {
    commit(slot, 'Delete kerning pair', (d) => deleteKerningPair(d, left, right));
    if (selected && selected.left === left && selected.right === right) setSelected(null);
    setDraft(null);
  };

  const clearAll = async () => {
    const ok = await askConfirm({
      title: 'Remove all kerning pairs?',
      message: `Remove all ${total.toLocaleString()} kerning pairs from this font? You can undo this with Ctrl+Z.`,
      confirmLabel: 'Remove all',
      danger: true,
    });
    if (!ok) return;
    commit(slot, 'Clear kerning', (d) => ({ ...d, kerning: [], kerningEdited: true }));
    setSelected(null);
    setDraft(null);
  };

  const shown = draft ?? selectedValue;
  const range = Math.max(Math.round(upem / 2), Math.abs(shown));

  return (
    <AppDialog
      title={`Kerning pairs — Font ${slot}`}
      maxWidth="md"
      onClose={closeModal}
      actions={
        <>
          <Button color="error" disabled={total === 0} onClick={clearAll}>
            Remove all pairs
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Close</Button>
        </>
      }
    >
      {unreadable && (
        <Alert severity="warning">
          This font has kerning tables Pixeel cannot read (for example Apple <code>kerx</code>). They are exported unchanged until you add or edit a pair — after that only the pairs listed here are written.
        </Alert>
      )}
      {truncated && (
        <Alert severity="info">
          Only the {MAX_IMPORTED_PAIRS.toLocaleString()} most common pairs of this font's (much larger, class-based) kerning were loaded. Until you edit kerning, the original tables are exported untouched; after the first edit only the pairs listed here are written.
        </Alert>
      )}

      <Section title="Live preview">
        <Paper variant="outlined" sx={{ p: 0.5, bgcolor: 'background.default' }}>
          <KerningPreview doc={doc} text={previewText} pairs={previewPairs} highlight={selected} />
        </Paper>
        <TextField size="small" label="Preview text" value={sample} onChange={(e) => setSample(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Kerning preview text' } }} />
      </Section>

      <Section title="Add a pair">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            size="small"
            label="Left glyph"
            value={addLeft}
            onChange={(e) => setAddLeft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPair()}
            placeholder="A, U+0041 or AV"
            slotProps={{ htmlInput: { 'aria-label': 'Left glyph' } }}
            sx={{ width: { sm: 150 } }}
          />
          <TextField
            size="small"
            label="Right glyph"
            value={addRight}
            onChange={(e) => setAddRight(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPair()}
            placeholder="V or U+0056"
            slotProps={{ htmlInput: { 'aria-label': 'Right glyph' } }}
            sx={{ width: { sm: 150 } }}
          />
          <TextField
            size="small"
            label="Value"
            type="number"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPair()}
            slotProps={{ htmlInput: { 'aria-label': 'New pair value' } }}
            sx={{ width: { sm: 110 } }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={addPair} sx={{ mt: { sm: 0.25 } }}>
            Add pair
          </Button>
        </Stack>
        {addError && (
          <Alert severity="error" role="alert">
            {addError}
          </Alert>
        )}
        <Hint>Type two characters, code points (U+0041, 0x41, 65) or glyph names. Negative values pull the right glyph closer. Font units (1 em = {upem}).</Hint>
      </Section>

      <Section title={`Pairs (${total.toLocaleString()})`}>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Search pairs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="AV, U+0054, Aacute, -60"
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { 'aria-label': 'Search kerning pairs' } }}
          />
          <TextField size="small" select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as KerningSort)} sx={{ minWidth: 150 }} slotProps={{ htmlInput: { 'aria-label': 'Sort kerning pairs' } }}>
            <MenuItem value="frequency">Frequency</MenuItem>
            <MenuItem value="value">Largest adjustment</MenuItem>
            <MenuItem value="left">Left glyph</MenuItem>
          </TextField>
        </Stack>
        {total === 0 ? (
          <Alert severity="info">No kerning pairs yet. Add one above — for example A + V = −80.</Alert>
        ) : rows.length === 0 ? (
          <Alert severity="info">No pair matches “{query}”.</Alert>
        ) : (
          <Paper variant="outlined" sx={{ maxHeight: 260, overflow: 'auto' }}>
            <List dense disablePadding aria-label="Kerning pairs">
              {rows.slice(0, MAX_ROWS).map((row) => {
                const isSel = !!selected && selected.left === row.pair.left && selected.right === row.pair.right;
                return (
                  <ListItemButton
                    key={`${row.pair.left}|${row.pair.right}`}
                    selected={isSel}
                    onClick={() => {
                      setSelected({ left: row.pair.left, right: row.pair.right });
                      setDraft(null);
                    }}
                    sx={{ gap: 1.5 }}
                    aria-label={`Pair ${row.leftChar || row.left.name} ${row.rightChar || row.right.name}, ${row.pair.value}`}
                  >
                    <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, minWidth: 48 }}>
                      {label(row.left)}
                      {label(row.right)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                      {row.left.name} + {row.right.name}
                    </Typography>
                    <Chip size="small" variant="outlined" color={row.pair.value === 0 ? 'default' : 'primary'} label={row.pair.value} />
                    <Tooltip title="Delete this pair">
                      <IconButton
                        size="small"
                        aria-label={`Delete pair ${label(row.left)}${label(row.right)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removePair(row.pair.left, row.pair.right);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemButton>
                );
              })}
            </List>
            {rows.length > MAX_ROWS && (
              <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
                Showing {MAX_ROWS} of {rows.length.toLocaleString()} — use search to narrow the list.
              </Typography>
            )}
          </Paper>
        )}
      </Section>

      {selected && selLeft && selRight && (
        <Section title={`Edit pair ${label(selLeft)}${label(selRight)}`}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <Slider
              aria-label="Kerning value slider"
              min={-range}
              max={range}
              step={1}
              value={shown}
              onChange={(_, v) => setDraft(v as number)}
              onChangeCommitted={(_, v) => commitValue(v as number)}
              sx={{ flex: 1, mx: 1 }}
              valueLabelDisplay="auto"
            />
            <TextField
              size="small"
              type="number"
              label="Value"
              value={draft ?? selectedValue}
              onChange={(e) => setDraft(e.target.value === '' ? 0 : Number(e.target.value))}
              onBlur={() => draft !== null && commitValue(draft)}
              onKeyDown={(e) => e.key === 'Enter' && draft !== null && commitValue(draft)}
              slotProps={{ htmlInput: { 'aria-label': 'Kerning value', step: 1 } }}
              sx={{ width: 120 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70 }}>
              {(shown / upem).toFixed(3)} em
            </Typography>
            {selectedExists && (
              <Button color="error" startIcon={<DeleteIcon />} onClick={() => removePair(selected.left, selected.right)}>
                Delete
              </Button>
            )}
          </Stack>
          {!selectedExists && <Hint>This pair is not in the font yet — change the value to add it.</Hint>}
        </Section>
      )}
    </AppDialog>
  );
}
