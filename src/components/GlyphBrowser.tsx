/** Left pane: searchable, filterable, virtualised glyph grid with multi-select and transfer shortcuts. */
import { allUnicodes, hasCodePoint } from '../core/unicodeMap';
import React, { useEffect, useMemo, useRef } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, InputAdornment, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TranslateIcon from '@mui/icons-material/Translate';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import TuneIcon from '@mui/icons-material/Tune';
import { useStore } from '../state/store';
import type { FontMetrics, GlyphDoc, Slot } from '../core/types';
import { charFromCodePoint, describeCodePoint, unicodeName } from '../core/unicodeNames';
import { renderGlyphCard } from '../render/glyphRender';
import { basicSetGlyphs, georgianSetGlyphs } from '../core/fontFactory';
import { glyphDragType } from './glyphDrag';
import { SegmentedControl } from './ui';
import { VirtualGrid } from './VirtualGrid';
import { analyzeCoverage } from '../core/coverage';
import {
  CHAR_SET_BY_ID,
  type CharSetId,
  type GlyphCategory,
  GLYPH_STATE_LABEL,
  glyphState,
  largeDigitPoints,
  navigationGroupOf,
} from '../core/charSets';
import { addSingleCharacter } from '../core/addCharSets';
import { formatCp } from '../core/unicodeMap';

/** Compile the search box text into a predicate (char, U+hex, or a name fragment). */
export function parseSearch(q: string): (g: GlyphDoc) => boolean {
  const s = q.trim();
  if (!s) return () => true;
  if ([...s].length === 1) {
    const cp = s.codePointAt(0)!;
    return (g) => hasCodePoint(g, cp);
  }
  const hex = s.match(/^(?:u\+|0x)?([0-9a-f]{1,6})$/i);
  if (hex) {
    const cp = parseInt(hex[1], 16);
    return (g) => hasCodePoint(g, cp);
  }
  const lower = s.toLowerCase();
  return (g) => {
    if (g.name.toLowerCase().includes(lower)) return true;
    for (const cp of allUnicodes(g)) {
      const name = unicodeName(cp);
      if (name?.toLowerCase().includes(lower)) return true;
      if (describeCodePoint(cp).toLowerCase().includes(lower)) return true;
    }
    return false;
  };
}

/** One entry of the character grid: an existing glyph or a placeholder for a missing character. */
export type BrowserItem =
  | { kind: 'glyph'; key: string; glyph: GlyphDoc }
  | { kind: 'missing'; key: string; codePoint: number; set: CharSetId; status: 'missing' | 'blank'; glyphId: string | null; glyphName: string | null };

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
  const extra = glyph.extraUnicodes?.length ?? 0;
  const state = glyphState(glyph);
  const title = `${
    glyph.unicode !== null
      ? `${glyph.name} — ${describeCodePoint(glyph.unicode)}${extra ? ` (+${extra} more: ${glyph.extraUnicodes!.map((c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')).join(', ')})` : ''}`
      : `${glyph.name} — no Unicode assignment`
  } · ${GLYPH_STATE_LABEL[state]}`;

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
        borderColor: selected ? 'primary.main' : state === 'blank' ? 'warning.main' : 'divider',
        bgcolor: selected ? 'action.selected' : 'background.paper',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 0.5,
        position: 'relative',
        '&:hover': { borderColor: 'secondary.main' },
        cursor: 'pointer',
      }}
      data-glyph-state={state}
    >
      {multiSelected && <Chip label="✓" size="small" color="primary" sx={{ position: 'absolute', top: 2, left: 2, height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
      <Stack direction="row" spacing={0.25} sx={{ position: 'absolute', top: 2, right: 2 }}>
        {extra > 0 && <Chip label={`+${extra}`} size="small" color="info" title={`${extra} more code point${extra === 1 ? '' : 's'} mapped to this glyph`} sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
        {glyph.kind === 'compound' && <Chip label="C" size="small" title="Composite glyph" sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
        {state === 'modified' && <Chip label="✎" size="small" color="primary" title={GLYPH_STATE_LABEL.modified} sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
        {state === 'added' && <Chip label="+" size="small" color="success" title={GLYPH_STATE_LABEL.added} sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
        {state === 'blank' && <Chip label="◻" size="small" color="warning" title={GLYPH_STATE_LABEL.blank} sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }} />}
      </Stack>
      <Box component="canvas" ref={canvasRef} sx={{ width: 44, height: 44, mt: 1 }} />
      <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%', fontSize: 10, lineHeight: 1.2 }}>
        {label}
      </Typography>
    </ButtonBase>
  );
});

/** Placeholder card for a required character that has no glyph yet (or only a blank one). */
function MissingCard(props: {
  slot: Slot;
  item: Extract<BrowserItem, { kind: 'missing' }>;
  setName: string;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const { item } = props;
  const blank = item.status === 'blank';
  const title = blank
    ? `${describeCodePoint(item.codePoint)} — “${item.glyphName}” exists but has no artwork yet (${props.setName}). Click to open it and draw.`
    : `${describeCodePoint(item.codePoint)} — not in this font (${props.setName}). Click to add it as an editable blank glyph.`;
  return (
    <ButtonBase
      role="listitem"
      aria-label={title}
      title={title}
      onClick={blank ? props.onOpen : props.onAdd}
      sx={{
        width: '100%',
        height: '100%',
        borderRadius: 1.5,
        border: 1,
        borderStyle: 'dashed',
        borderColor: blank ? 'warning.main' : 'error.main',
        bgcolor: 'background.paper',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 0.5,
        position: 'relative',
        color: 'text.secondary',
        '&:hover': { borderColor: 'secondary.main', bgcolor: 'action.hover' },
      }}
      data-glyph-state={blank ? 'blank' : 'missing'}
    >
      <Chip
        label={blank ? 'blank' : 'missing'}
        size="small"
        color={blank ? 'warning' : 'error'}
        sx={{ position: 'absolute', top: 2, right: 2, height: 16, '& .MuiChip-label': { px: 0.5, fontSize: 10 } }}
      />
      <Stack sx={{ mt: 1, alignItems: 'center' }} spacing={0.25}>
        <Typography sx={{ fontSize: 26, lineHeight: 1, opacity: 0.55 }} aria-hidden>
          {charFromCodePoint(item.codePoint)}
        </Typography>
        <AddIcon fontSize="small" sx={{ opacity: 0.6 }} />
      </Stack>
      <Typography variant="caption" component="div" noWrap sx={{ maxWidth: '100%', fontSize: 10, lineHeight: 1.2, textAlign: 'center' }}>
        {formatCp(item.codePoint)}
      </Typography>
    </ButtonBase>
  );
}

const CATEGORY_LABEL: Record<GlyphCategory, string> = {
  all: 'All Glyphs',
  english: 'English',
  georgian: 'Georgian',
  digits: 'Standard Digits',
  largeDigits: 'Large Digits',
  punct: 'Punctuation & Symbols',
  missing: 'Missing Glyphs',
  other: 'Other',
};

export function GlyphBrowser(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const ui = useStore((s) => s.ui[slot]);
  const theme = useStore((s) => s.theme);
  const setListSearch = useStore((s) => s.setListSearch);
  const setListFilter = useStore((s) => s.setListFilter);
  const setListCategory = useStore((s) => s.setListCategory);
  const openModal = useStore((s) => s.openModal);
  const setMultiSelect = useStore((s) => s.setMultiSelect);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const other: Slot = slot === 'A' ? 'B' : 'A';

  const coverage = useMemo(() => (doc ? analyzeCoverage(doc) : null), [doc]);
  const altPoints = useMemo(() => (doc ? largeDigitPoints(doc) : []), [doc]);

  const items: BrowserItem[] = useMemo(() => {
    if (!doc) return [];
    const match = parseSearch(ui.glyphListSearch);
    const category = ui.glyphListCategory;

    if (category === 'missing') {
      const out: BrowserItem[] = [];
      for (const set of coverage?.sets ?? []) {
        for (const entry of set.entries) {
          if (entry.status === 'present') continue;
          const glyph = entry.glyphId ? doc.glyphs.find((g) => g.id === entry.glyphId) : undefined;
          if (glyph && !match(glyph)) continue;
          out.push({
            kind: 'missing',
            key: `missing_${set.def.id}_${entry.codePoint}`,
            codePoint: entry.codePoint,
            set: set.def.id,
            status: entry.status === 'blank' ? 'blank' : 'missing',
            glyphId: entry.glyphId,
            glyphName: entry.glyphName,
          });
        }
      }
      return out;
    }

    const glyphs = doc.glyphs.filter((g) => {
      if (!match(g)) return false;
      if (category !== 'all') {
        const cps = allUnicodes(g);
        const group = cps.length ? navigationGroupOf(cps[0], altPoints) : 'other';
        const inGroup = cps.some((cp) => navigationGroupOf(cp, altPoints) === category);
        if (!inGroup && group !== category) return false;
      }
      switch (ui.glyphListFilter) {
        case 'mapped': return g.unicode !== null;
        case 'unmapped': return g.unicode === null;
        case 'multi': return (g.extraUnicodes?.length ?? 0) > 0;
        case 'edited': return g.edited;
        default: return true;
      }
    });
    const out: BrowserItem[] = glyphs.map((g) => ({ kind: 'glyph' as const, key: g.id, glyph: g }));

    // A set view shows the characters of that set that are still missing (or
    // blank) right next to the existing ones, so a set is never "empty" when it
    // is in fact incomplete. The 'all' view lists the existing glyphs only.
    if (category !== 'all' && ui.glyphListFilter === 'all') {
      const set = coverage?.sets.find((s) => s.def.id === category);
      for (const entry of set?.entries ?? []) {
        if (entry.status === 'present') continue;
        const glyph = entry.glyphId ? doc.glyphs.find((g) => g.id === entry.glyphId) : undefined;
        if (glyph && !match(glyph)) continue;
        if (glyph && out.some((it) => it.kind === 'glyph' && it.glyph.id === glyph.id)) continue;
        out.push({
          kind: 'missing',
          key: `missing_${category}_${entry.codePoint}`,
          codePoint: entry.codePoint,
          set: category as CharSetId,
          status: entry.status === 'blank' ? 'blank' : 'missing',
          glyphId: entry.glyphId,
          glyphName: entry.glyphName,
        });
      }
    }
    return out;
  }, [doc, ui.glyphListSearch, ui.glyphListFilter, ui.glyphListCategory, coverage, altPoints]);

  if (!doc) return null;
  const dark = theme === 'dark';

  const addBasicSet = () => {
    const current = useStore.getState().fonts[slot];
    if (!current) return;
    const glyphs = basicSetGlyphs(current);
    if (glyphs.length === 0) {
      toast('info', 'All basic Latin, digit, punctuation and modern Georgian Mkhedruli glyphs already exist.');
      return;
    }
    commit(slot, 'Add basic set', (d) => ({ ...d, glyphs: [...d.glyphs, ...glyphs] }));
    toast('success', `Added ${glyphs.length} starter glyphs (Latin, digits, punctuation and 33 Mkhedruli letters).`);
  };

  const addGeorgianSet = () => {
    const current = useStore.getState().fonts[slot];
    if (!current) return;
    const glyphs = georgianSetGlyphs(current);
    if (glyphs.length === 0) {
      toast('info', 'All Georgian letter glyphs already exist.');
      return;
    }
    commit(slot, 'Add full Georgian set', (d) => ({ ...d, glyphs: [...d.glyphs, ...glyphs] }));
    toast('success', `Added ${glyphs.length} Georgian letter glyphs across Mkhedruli, Mtavruli, Asomtavruli and Nuskhuri.`);
  };

  /** Clicking a missing placeholder adds exactly that character (one undo step). */
  const addMissing = (cp: number) => {
    const current = useStore.getState().fonts[slot];
    if (!current) return;
    try {
      const { doc: next, plan } = addSingleCharacter(current, cp);
      if (!plan) return;
      commit(slot, 'Add missing character', () => next);
      toast('success', `${charFromCodePoint(cp)} ${formatCp(cp)} added as a blank glyph — draw it in the pixel editor.`);
      plan.warnings.forEach((w) => toast('warning', w));
      const created = next.glyphs.find((g) => allUnicodes(g).includes(cp));
      if (created) useStore.getState().selectGlyph(slot, created.id);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const selectionCount = ui.multiSelected.length;
  const missingCount = coverage ? coverage.sets.reduce((n, s) => n + s.missingPoints.length, 0) : 0;
  const categoryCount = (id: GlyphCategory): number | null => {
    if (!coverage) return null;
    if (id === 'missing') return missingCount;
    if (id === 'all' || id === 'other') return null;
    if (id === 'english') return coverage.setById.latinUpper.total + coverage.setById.latinLower.total;
    const mapping: Record<'georgian' | 'digits' | 'largeDigits' | 'punct', keyof typeof coverage.setById> = {
      georgian: 'georgian',
      digits: 'digits',
      largeDigits: 'largeDigits',
      punct: 'punct',
    };
    const set = coverage.setById[mapping[id as 'georgian' | 'digits' | 'largeDigits' | 'punct']];
    return set ? set.total : null;
  };

  return (
    <Paper
      component="aside"
      aria-label={`Glyph browser for Font ${slot}`}
      square
      sx={{ width: { xs: '100%', lg: 320 }, height: { xs: 460, lg: 'auto' }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, borderWidth: 0, borderRight: { lg: 1 }, borderBottom: { xs: 1, lg: 0 }, borderColor: 'divider' }}
    >
      <Stack spacing={1} sx={{ p: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1}>
          <TextField
            placeholder="Search char, U+10D0, name…"
            value={ui.glyphListSearch}
            onChange={(e) => setListSearch(slot, e.target.value)}
            aria-label="Search glyphs"
            fullWidth
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

        {/* character-set navigation */}
        <Box role="tablist" aria-label="Character sets" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {(['all', 'english', 'georgian', 'digits', 'largeDigits', 'punct', 'missing'] as GlyphCategory[]).map((id) => {
            const active = ui.glyphListCategory === id;
            const count = categoryCount(id);
            const isMissingTab = id === 'missing';
            return (
              <Chip
                key={id}
                role="tab"
                aria-selected={active}
                clickable
                size="small"
                color={active ? 'primary' : isMissingTab && missingCount ? 'warning' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                label={`${CATEGORY_LABEL[id]}${count !== null ? ` ${count}` : ''}`}
                title={`${CATEGORY_LABEL[id]}${count !== null ? ` — ${count} required character(s)` : ''}`}
                onClick={() => setListCategory(slot, id)}
                sx={{ height: 24, '& .MuiChip-label': { px: 1, fontSize: 11 } }}
              />
            );
          })}
        </Box>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={() => openModal({ type: 'addGlyph', slot })} sx={{ flexShrink: 0 }}>
            Glyph
          </Button>
          <Tooltip title="Character coverage report and Add Character Sets (English, Georgian, digits, large digits, punctuation)">
            <Button onClick={() => openModal({ type: 'characterSets', slot })} sx={{ flexShrink: 0 }} startIcon={<TuneIcon fontSize="small" />}>
              Sets
            </Button>
          </Tooltip>
          <Tooltip title="Add Latin, digits, punctuation and the 33 modern Georgian Mkhedruli letters as blank glyphs">
            <Button onClick={addBasicSet} sx={{ flexShrink: 0 }}>
              Aa+
            </Button>
          </Tooltip>
          <Tooltip title="Add all assigned Georgian letters: Mkhedruli, Mtavruli, Asomtavruli and Nuskhuri">
            <Button aria-label="Add full Georgian letter set" onClick={addGeorgianSet} sx={{ flexShrink: 0, minWidth: 42, px: 0.75 }}>
              <TranslateIcon fontSize="small" sx={{ mr: 0.35 }} />ქ+
            </Button>
          </Tooltip>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SegmentedControl
              ariaLabel="Filter glyphs"
              fullWidth
              value={ui.glyphListFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'mapped', label: 'Mapped', tip: 'Glyphs with a Unicode assignment' },
                { value: 'unmapped', label: 'Unmapped', tip: 'Glyphs without a Unicode assignment' },
                { value: 'multi', label: 'Multi', tip: 'Glyphs with more than one code point' },
                { value: 'edited', label: 'Edited', tip: 'Glyphs you changed' },
              ]}
              onChange={(v) => setListFilter(slot, v)}
            />
          </Box>
          <Tooltip title="Legend: solid card = in the font · ✎ modified · + newly added · ◻ blank (needs drawing) · dashed card = required character that is not in the font yet">
            <Chip size="small" variant="outlined" label="legend" />
          </Tooltip>
        </Stack>

        {ui.glyphListCategory === 'missing' && (
          <Alert severity={missingCount ? 'warning' : 'success'} role="status" icon={false} sx={{ py: 0 }}>
            <Typography variant="caption">
              {missingCount
                ? `${missingCount} required character(s) missing or still blank. Click a card to add it as an editable blank glyph (dashed = no glyph yet, orange = blank glyph).`
                : 'Every required character of every set is present.'}
            </Typography>
          </Alert>
        )}

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

      {items.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          {doc.glyphs.length === 0
            ? 'This font has no glyphs yet. Add one with “+ Glyph” or “Aa+”.'
            : ui.glyphListCategory === 'missing'
              ? 'Nothing missing — every required character of this font has artwork.'
              : 'No glyphs match the search or filter.'}
        </Typography>
      )}
      <VirtualGrid
        ariaLabel="Glyphs"
        items={items}
        itemKey={(it) => it.key}
        renderItem={(it) =>
          it.kind === 'glyph' ? (
            <GlyphCard
              slot={slot}
              glyph={it.glyph}
              metrics={doc.metrics}
              selected={ui.glyphId === it.glyph.id}
              multiSelected={ui.multiSelected.includes(it.glyph.id)}
              dark={dark}
            />
          ) : (
            <MissingCard
              slot={slot}
              item={it}
              setName={CHAR_SET_BY_ID[it.set].label}
              onAdd={() => addMissing(it.codePoint)}
              onOpen={() => {
                if (it.glyphId) useStore.getState().selectGlyph(slot, it.glyphId);
              }}
            />
          )
        }
      />
      <Box sx={{ px: 1.25, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {items.length === doc.glyphs.length
            ? `${doc.glyphs.length} glyphs`
            : `${items.length} of ${doc.glyphs.length} glyphs`}
          {ui.glyphListCategory === 'missing' ? ` · ${missingCount} missing character(s)` : ''} · drag cards onto a Font tab to copy
        </Typography>
      </Box>
    </Paper>
  );
}
