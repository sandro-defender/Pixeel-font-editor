/**
 * Side-panel tab "Sets": the coverage report at a glance plus the quick actions
 * of the character-set workflow — add the missing characters of one set, jump to
 * the missing glyphs, or run the large-digit copy/scale steps without leaving
 * the editor.
 */
import React, { useMemo } from 'react';
import { Alert, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import TuneIcon from '@mui/icons-material/Tune';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { analyzeCoverage, coverageSummaryLine } from '../core/coverage';
import { type CharSetId, glyphHasArtwork, largeDigitPoints } from '../core/charSets';
import { copyArtworkInto, planAddSets, scaleGlyphNearest } from '../core/addCharSets';
import { allUnicodes, formatCp } from '../core/unicodeMap';
import { charFromCodePoint } from '../core/unicodeNames';
import { Hint, Section } from './ui';

/** Which glyph-browser group a set navigates to. */
const NAV_OF_SET: Record<CharSetId, string> = {
  latinUpper: 'english',
  latinLower: 'english',
  georgian: 'georgian',
  digits: 'digits',
  largeDigits: 'largeDigits',
  punct: 'punct',
};

export function CoveragePanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const openModal = useStore((s) => s.openModal);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const setListCategory = useStore((s) => s.setListCategory);

  const report = useMemo(() => (doc ? analyzeCoverage(doc) : null), [doc]);
  if (!doc || !report) return <Typography color="text.secondary">Load a font to inspect its character coverage.</Typography>;

  const glyphFor = (cp: number) => doc.glyphs.find((g) => allUnicodes(g).includes(cp));
  const incomplete = report.sets.filter((s) => s.present !== s.total);

  const addSet = (id: CharSetId) => {
    try {
      const plan = planAddSets(doc, { sets: [id], existing: 'keep', template: 'blank' });
      if (!plan.changes.length) {
        toast('info', 'Every character of that set already exists.');
        return;
      }
      commit(slot, `Add missing ${id}`, () => plan.nextDoc);
      toast('success', `${plan.changes.length} blank character(s) added — draw them in the pixel editor.`);
      plan.warnings.forEach((w) => toast('warning', w));
      setListCategory(slot, NAV_OF_SET[id] as never);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const gotoMissing = (id: CharSetId) => {
    setListCategory(slot, 'missing');
    const set = report.setById[id];
    const first = set.entries.find((e) => e.status !== 'present' && e.glyphId);
    if (first?.glyphId) selectGlyph(slot, first.glyphId);
    else toast('info', `${set.def.label}: ${set.missingPoints.length} character(s) to add — click a placeholder card in the grid.`);
  };

  const copyDigit = (index: number, scale: number) => {
    const std = glyphFor(0x30 + index);
    const large = glyphFor(largeDigitPoints(doc)[index]);
    if (!std || !large) {
      toast('warning', 'Add the standard digits and the large-digit set first.');
      return;
    }
    if (!glyphHasArtwork(std)) {
      toast('warning', `“${std.name}” is still blank — draw the standard digit first.`);
      return;
    }
    try {
      const { doc: next, warnings } = copyArtworkInto(doc, large.id, std.id, { scale, adaptAdvance: scale !== 1 });
      commit(slot, `Copy digit ${index} into the large digit`, () => next);
      toast('success', `Copied into “${large.name}”${scale !== 1 ? ` and scaled ×${scale} (nearest neighbour)` : ''}.`);
      warnings.forEach((w) => toast('warning', w));
      selectGlyph(slot, large.id);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const scaleDigit = (index: number, factor: number) => {
    const large = glyphFor(largeDigitPoints(doc)[index]);
    if (!large) {
      toast('warning', 'Add the large-digit set first.');
      return;
    }
    if (!glyphHasArtwork(large)) {
      toast('warning', `“${large.name}” is blank — copy a standard digit into it first.`);
      return;
    }
    try {
      const { doc: next, width, height } = scaleGlyphNearest(doc, large.id, factor, { adaptAdvance: true });
      commit(slot, 'Scale large digit (nearest neighbour)', () => next);
      toast('success', `“${large.name}” is now ${width}×${height} cells.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const altPoints = largeDigitPoints(doc);

  return (
    <Stack spacing={1.5}>
      <Section
        title="Character coverage"
        action={
          <Button size="small" startIcon={<TuneIcon fontSize="small" />} onClick={() => openModal({ type: 'characterSets', slot })}>
            Sets…
          </Button>
        }
      >
        <Typography variant="caption" color="text.secondary">
          {coverageSummaryLine(report)}
        </Typography>
        <Stack spacing={0.75}>
          {report.sets.map((s) => {
            const complete = s.present === s.total;
            return (
              <Box
                key={s.def.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap title={s.def.label}>
                    {s.def.navLabel}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {s.present}/{s.total} present
                    {s.missing ? ` · ${s.missing} missing` : ''}
                    {s.blank ? ` · ${s.blank} blank` : ''}
                  </Typography>
                </Box>
                {complete ? (
                  <Chip size="small" color="success" label="✓" title="Complete" />
                ) : (
                  <>
                    <Button size="small" onClick={() => gotoMissing(s.def.id)} title="Show the missing characters in the glyph grid">
                      Show
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddCircleIcon fontSize="small" />}
                      onClick={() => addSet(s.def.id)}
                      title={`Add the ${s.missingPoints.length} missing character(s) of this set as blank glyphs`}
                    >
                      {s.missingPoints.length}
                    </Button>
                  </>
                )}
              </Box>
            );
          })}
        </Stack>
        {incomplete.length === 0 && <Alert severity="success">Every required character set is complete in this font.</Alert>}
        {report.warnings.map((w, i) => (
          <Alert key={i} severity="warning" role="alert">
            <Typography variant="caption">{w}</Typography>
          </Alert>
        ))}
      </Section>

      <Section
        title="Large digits workflow"
        action={
          <Button size="small" onClick={() => openModal({ type: 'characterSets', slot, focus: 'largeDigits' })}>
            Mapping…
          </Button>
        }
      >
        <Typography variant="caption" color="text.secondary">
          {formatCp(altPoints[0])}–{formatCp(altPoints[9])} · separate glyphs, independent metrics
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 0.75 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const std = glyphFor(0x30 + i);
            const large = glyphFor(altPoints[i]);
            const hasLarge = !!large && glyphHasArtwork(large);
            return (
              <Box key={i} sx={{ border: 1, borderColor: hasLarge ? 'success.main' : 'divider', borderRadius: 1, p: 0.5 }}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {charFromCodePoint(0x30 + i)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    →
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, opacity: hasLarge ? 1 : 0.4 }}>
                    {charFromCodePoint(altPoints[i])}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {hasLarge ? <Chip size="small" color="success" label="✓" sx={{ height: 16 }} /> : <Chip size="small" color="warning" label="blank" sx={{ height: 16 }} />}
                </Stack>
                <Stack direction="row" spacing={0.25} sx={{ mt: 0.25 }}>
                  <Tooltip title="Copy the standard digit here">
                    <span>
                      <Button size="small" sx={{ minWidth: 0, px: 0.5 }} disabled={!std || !large} onClick={() => copyDigit(i, 1)} aria-label={`Copy digit ${i} into the large digit`}>
                        <ContentCopyIcon fontSize="inherit" />
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title="Copy and scale ×2 (nearest neighbour)">
                    <span>
                      <Button size="small" sx={{ minWidth: 0, px: 0.5 }} disabled={!std || !large} onClick={() => copyDigit(i, 2)} aria-label={`Copy digit ${i} at 2x`}>
                        ×2
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title="Scale the large digit ×2 (nearest neighbour)">
                    <span>
                      <Button size="small" sx={{ minWidth: 0, px: 0.5 }} disabled={!large || !hasLarge} onClick={() => scaleDigit(i, 2)} aria-label={`Scale large digit ${i} by 2`}>
                        <ZoomOutMapIcon fontSize="inherit" />
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title="Edit this large digit in the pixel editor">
                    <span>
                      <Button
                        size="small"
                        sx={{ minWidth: 0, px: 0.5 }}
                        disabled={!large}
                        onClick={() => {
                          if (large) {
                            selectGlyph(slot, large.id);
                            setListCategory(slot, 'largeDigits');
                          }
                        }}
                        aria-label={`Edit large digit ${i}`}
                      >
                        ✎
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              </Box>
            );
          })}
        </Box>
        <Hint>
          Copy needs a drawn standard digit and an existing large-digit glyph. Scaling is always nearest-neighbour and explicit; the advance width
          follows the copy.
        </Hint>
      </Section>
    </Stack>
  );
}
