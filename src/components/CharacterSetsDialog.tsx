/**
 * Character coverage & character sets.
 *
 * One dialog, three jobs:
 *
 *  1. **Coverage report** — for every required set: total / present / missing,
 *     the missing characters as a visual list, and a button that adds exactly
 *     those.
 *  2. **Add Character Sets** — pick one or more sets, choose what happens to
 *     characters that already exist (keep / fill blanks / overwrite), whether
 *     new glyphs start blank or from a template, preview the exact change list,
 *     then apply it as ONE undo step.
 *  3. **Large digits** — the configurable alternative-digit mapping plus the
 *     copy/scale workflow that turns a standard digit into a double-size one.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import GridOnIcon from '@mui/icons-material/GridOn';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import { useStore } from '../state/store';
import type { FontDoc, GlyphDoc, Slot } from '../core/types';
import { analyzeCoverage, coverageSummaryLine, type CoverageReport, type SetCoverage } from '../core/coverage';
import {
  ALL_CHAR_SET_IDS,
  CHAR_SETS,
  CHAR_SET_BY_ID,
  DEFAULT_LARGE_DIGIT_POINTS,
  type CharSetId,
  glyphHasArtwork,
  largeDigitPoints,
} from '../core/charSets';
import {
  copyArtworkInto,
  planAddSets,
  reconfigureAltDigits,
  scaleGlyphNearest,
  validateAltDigitPoints,
  type AddSetsPlan,
  type ExistingPolicy,
} from '../core/addCharSets';
import { allUnicodes, formatCp } from '../core/unicodeMap';
import { charFromCodePoint as charOf, describeCodePoint, parseCodePointInput } from '../core/unicodeNames';
import { AppDialog, Hint, Section } from './ui';

/** A compact, themed list of characters (used for the missing-character lists). */
function CharList(props: { points: number[]; limit?: number; tone?: 'warning' | 'error' | 'default' }) {
  const limit = props.limit ?? 48;
  const shown = props.points.slice(0, limit);
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.4 }} useFlexGap aria-label="Missing characters">
      {shown.map((cp) => (
        <Tooltip key={cp} title={describeCodePoint(cp)}>
          <Chip
            size="small"
            variant="outlined"
            color={props.tone ?? 'default'}
            aria-label={describeCodePoint(cp)}
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5 }}>
                <Box component="span" sx={{ fontSize: 14, lineHeight: 1 }}>
                  {charOf(cp)}
                </Box>
                <Box component="span" sx={{ fontSize: 10, opacity: 0.75, fontFamily: 'ui-monospace, monospace' }}>
                  {formatCp(cp)}
                </Box>
              </Box>
            }
            sx={{ height: 22 }}
          />
        </Tooltip>
      ))}
      {props.points.length > shown.length && (
        <Chip size="small" variant="outlined" label={`+${props.points.length - shown.length} more`} sx={{ height: 22 }} />
      )}
    </Stack>
  );
}

/** Coverage row: counts, missing list, "add missing" action. */
function CoverageRow(props: {
  slot: Slot;
  doc: FontDoc;
  set: SetCoverage;
  onAdd: (ids: CharSetId[]) => void;
}) {
  const { slot, doc, set } = props;
  const selectGlyph = useStore((s) => s.selectGlyph);
  const closeModal = useStore((s) => s.closeModal);
  const missing = set.missingPoints;
  const incomplete = set.present !== set.total;
  const blankOnly = set.blank > 0 && set.missing === 0;

  return (
    <TableRow hover>
      <TableCell sx={{ verticalAlign: 'top', minWidth: 190 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {set.def.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {set.def.range}
        </Typography>
        {set.def.id === 'largeDigits' && (
          <Typography variant="caption" color="text.secondary" component="div">
            {largeDigitPoints(doc)
              .map((cp) => formatCp(cp))
              .join(' ')}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {set.present}/{set.total}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: set.missing ? 'error.main' : undefined }}>
        {set.missing}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: set.blank ? 'warning.main' : undefined }}>
        {set.blank}
      </TableCell>
      <TableCell>
        {missing.length === 0 ? (
          <Typography variant="caption" color="success.main">
            {set.blank ? 'all present, but some are still blank' : 'complete'}
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            <CharList points={missing} tone="warning" />
            {blankOnly && <Typography variant="caption" color="text.secondary">Mapped, but with no artwork yet.</Typography>}
          </Stack>
        )}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        {incomplete ? (
          <Button size="small" variant="outlined" onClick={() => props.onAdd([set.def.id])} title={`Add the ${missing.length} missing ${set.def.label} character(s); existing glyphs are kept`}>
            Add {missing.length || 'missing'}
          </Button>
        ) : (
          <Chip size="small" color="success" label="✓" title="Every character of this set is present" />
        )}
        {set.blank > 0 && (
          <Button
            size="small"
            sx={{ ml: 0.5 }}
            title="Select the first blank glyph and start drawing"
            onClick={() => {
              const first = set.entries.find((e) => e.status === 'blank' && e.glyphId);
              if (!first?.glyphId) return;
              selectGlyph(slot, first.glyphId);
              closeModal();
            }}
          >
            Draw
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function CharacterSetsDialog(props: { slot: Slot; focus?: 'coverage' | 'add' | 'largeDigits' }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const closeModal = useStore((s) => s.closeModal);
  const toast = useStore((s) => s.toast);
  const askConfirm = useStore((s) => s.askConfirm);
  const selectGlyph = useStore((s) => s.selectGlyph);

  const [selected, setSelected] = useState<CharSetId[]>([]);
  const [existing, setExisting] = useState<ExistingPolicy>('keep');
  const [templateMode, setTemplateMode] = useState<'blank' | 'copy'>('blank');
  const [templateScale, setTemplateScale] = useState(1);
  const [templateGlyphId, setTemplateGlyphId] = useState<string>('');
  const [adaptAdvance, setAdaptAdvance] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<AddSetsPlan | null>(null);
  const [altInputs, setAltInputs] = useState<string[] | null>(null);
  const [altError, setAltError] = useState<string | null>(null);

  const report: CoverageReport | null = useMemo(() => (doc ? analyzeCoverage(doc) : null), [doc]);

  if (!doc || !report) {
    return (
      <AppDialog title="Character coverage" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning" role="alert">
          No font is loaded in this workspace. Import a .ttf/.otf/.woff/.woff2/.bdf file (or create a font) and try again.
        </Alert>
      </AppDialog>
    );
  }

  const altPoints = largeDigitPoints(doc);
  /**
   * Glyphs that can serve as an explicit template. Anything with artwork
   * qualifies — an explicitly picked template is also the only way the
   * "Overwrite" policy may replace an existing design.
   */
  const templateCandidates = useMemo(
    () =>
      doc.glyphs
        .filter((g) => g.name !== '.notdef' && glyphHasArtwork(g))
        .slice(0, 80)
        .map((g) => ({
          id: g.id,
          label: `${g.name}${g.unicode !== null ? ` · ${formatCp(g.unicode)} ${charOf(g.unicode)}` : ' · unmapped'}`,
        })),
    [doc],
  );
  const inputs = altInputs ?? altPoints.map((cp) => formatCp(cp));
  const incompleteSets = report.sets.filter((s) => s.present !== s.total).map((s) => s.def.id);
  const glyphFor = (cp: number): GlyphDoc | undefined => doc.glyphs.find((g) => allUnicodes(g).includes(cp));

  // --- applying
  const applyOptions = {
    existing,
    template: templateMode,
    templateScale,
    adaptAdvance,
    templateGlyphId: templateMode === 'copy' && templateGlyphId ? templateGlyphId : undefined,
  } as const;

  const applyPlan = (plan: AddSetsPlan, label: string, okMessage: string) => {
    commit(slot, label, () => plan.nextDoc);
    toast('success', okMessage);
    plan.warnings.forEach((w) => toast('warning', w));
    setPreviewPlan(null);
    setSelected([]);
  };

  /**
   * Apply a plan. A plan that would discard existing artwork asks for an
   * explicit yes first (that is the only path where this is asynchronous).
   */
  const applyGuarded = (plan: AddSetsPlan, label: string, okMessage: string): void => {
    const losing = plan.changes.filter((c) => c.replacedArtwork);
    if (!losing.length) {
      applyPlan(plan, label, okMessage);
      return;
    }
    void (async () => {
      const ok = await askConfirm({
        title: `Replace the artwork of ${losing.length} existing character(s)?`,
        message: `Their designs are replaced by the template and can only be recovered with Ctrl+Z. Affected: ${losing
          .slice(0, 12)
          .map((c) => `${charOf(c.codePoint)} (${formatCp(c.codePoint)})`)
          .join(', ')}${losing.length > 12 ? `, … +${losing.length - 12} more` : ''}.`,
        confirmLabel: 'Replace the artwork',
        danger: true,
      });
      if (ok) applyPlan(plan, label, okMessage);
    })();
  };

  const runAdd = (ids: CharSetId[], label: string) => {
    try {
      const plan = planAddSets(doc, { sets: ids, ...applyOptions, altDigitPoints: ids.includes('largeDigits') ? altPoints : undefined });
      if (!plan.changes.length) {
        toast('info', 'Nothing to add — every character of the selected set(s) already exists with artwork.');
        return null;
      }
      applyGuarded(
        plan,
        label,
        `${plan.changes.length} character(s) written (${plan.additions.length} new, ${plan.replacements.length} replaced, ${plan.skipped.length} kept). Draw them in the pixel editor.`,
      );
      return plan;
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const previewChanges = () => {
    if (!selected.length) {
      toast('warning', 'Select at least one character set first.');
      return;
    }
    try {
      setPreviewPlan(planAddSets(doc, { sets: selected, ...applyOptions, altDigitPoints: selected.includes('largeDigits') ? altPoints : undefined }));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  // --- alternative digit mapping
  const applyAltMapping = () => {
    const parsed: number[] = [];
    for (const [i, text] of inputs.entries()) {
      const cp = text.trim() === '' ? null : parseCodePointInput(text.trim());
      if (cp === null) {
        setAltError(`Digit ${i}: “${text}” is not a character or code point (try U+E000 or a single character).`);
        return;
      }
      parsed.push(cp);
    }
    const check = validateAltDigitPoints(doc, parsed);
    if (!check.ok) {
      setAltError(check.error ?? 'Invalid mapping.');
      return;
    }
    setAltError(null);
    try {
      if (commit(slot, 'Change alternative digit mapping', (d) => reconfigureAltDigits(d, parsed))) {
        toast('success', `Alternative digits mapped to ${formatCp(parsed[0])}…${formatCp(parsed[9])}; the existing large-digit designs were kept.`);
        setAltInputs(null);
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const copyStandardDigit = (index: number) => {
    const std = glyphFor(0x30 + index);
    const large = glyphFor(altPoints[index]);
    if (!std) {
      toast('warning', `Standard digit “${charOf(0x30 + index)}” does not exist yet — add the standard digits first.`);
      return;
    }
    if (!large) {
      toast('warning', `The large digit for ${formatCp(altPoints[index])} does not exist yet — add the large-digit set first.`);
      return;
    }
    if (!glyphHasArtwork(std)) {
      toast('warning', `Standard digit “${std.name}” is still blank — draw it first, then copy it over.`);
      return;
    }
    try {
      const { doc: next, warnings } = copyArtworkInto(doc, large.id, std.id, { scale: 1, adaptAdvance });
      commit(slot, 'Copy digit into large digit', () => next);
      toast('success', `Copied “${std.name}” into “${large.name}”.`);
      warnings.forEach((w) => toast('warning', w));
      selectGlyph(slot, large.id);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const scaleLargeDigit = (index: number, factor: number) => {
    const large = glyphFor(altPoints[index]);
    if (!large) {
      toast('warning', 'Add the large-digit set first.');
      return;
    }
    if (!glyphHasArtwork(large)) {
      toast('warning', `“${large.name}” is still blank — copy a standard digit into it first, then scale it.`);
      return;
    }
    try {
      const { doc: next, width, height } = scaleGlyphNearest(doc, large.id, factor, { adaptAdvance: true });
      commit(slot, `Scale ×${factor} (nearest neighbour)`, () => next);
      toast('success', `“${large.name}” rescaled to ${width}×${height} cells with nearest-neighbour sampling.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const addMissingEverywhere = async () => {
    if (!incompleteSets.length) return;
    const ok = await askConfirm({
      title: 'Add all missing characters?',
      message: `Add the missing characters of every incomplete set (${incompleteSets
        .map((id) => CHAR_SET_BY_ID[id].label)
        .join(', ')})? Existing glyphs are kept exactly as they are; the new characters start as blank pixel grids. One Ctrl+Z undoes the whole batch.`,
      confirmLabel: 'Add missing characters',
    });
    if (!ok) return;
    runAdd(incompleteSets, 'Add all missing character sets');
  };

  return (
    <AppDialog
      title={`Character coverage — ${doc.meta.fontFamily} ${doc.meta.fontSubFamily}`}
      onClose={closeModal}
      maxWidth="lg"
      actions={
        <>
          <Button onClick={closeModal}>Close</Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            disabled={!incompleteSets.length}
            onClick={addMissingEverywhere}
            title="Add every missing character of every set, keeping the existing glyphs"
          >
            Add all missing ({report.sets.reduce((n, s) => n + s.missingPoints.length, 0)})
          </Button>
        </>
      }
    >
      <Alert severity={report.unusable ? 'error' : incompleteSets.length ? 'info' : 'success'} role="status">
        <Stack spacing={0.5}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {report.unusable ? 'This font cannot be modified' : incompleteSets.length ? 'Missing characters' : 'Complete coverage'}
          </Typography>
          <Typography variant="caption">{coverageSummaryLine(report)}</Typography>
          <Typography variant="caption">
            {report.glyphCount} glyphs in the editor · {report.glyphStates.existing} from the font · {report.glyphStates.added} added here ·{' '}
            {report.glyphStates.modified} modified · {report.glyphStates.blank} still blank
          </Typography>
        </Stack>
      </Alert>

      {report.warnings.map((w, i) => (
        <Alert key={i} severity="warning" role="alert">
          {w}
        </Alert>
      ))}

      {/* ------------------------------------------------ coverage report */}
      <Section title="Coverage report">
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Character coverage">
            <TableHead>
              <TableRow>
                <TableCell>Character set</TableCell>
                <TableCell align="right">Present</TableCell>
                <TableCell align="right">Missing</TableCell>
                <TableCell align="right">Blank</TableCell>
                <TableCell>Missing characters</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.sets.map((s) => (
                <CoverageRow key={s.def.id} slot={slot} doc={doc} set={s} onAdd={(ids) => runAdd(ids, `Add ${CHAR_SET_BY_ID[ids[0]].label}`)} />
              ))}
            </TableBody>
          </Table>
        </Box>
        <Hint>
          A character counts as present only when its glyph really has artwork — a code point that maps to .notdef or to a blank glyph is reported
          as missing/blank instead. Punctuation and symbols of the imported font that are not in the list above are never modified. The large
          digits are separate glyphs: they never replace the standard digits in ordinary text.
        </Hint>
      </Section>

      {/* ------------------------------------------------ add character sets */}
      <Section
        title="Add Character Sets"
        action={
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => setSelected([...ALL_CHAR_SET_IDS])}>
              Select all
            </Button>
            <Button size="small" onClick={() => setSelected([])} disabled={!selected.length}>
              Clear
            </Button>
          </Stack>
        }
      >
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }} useFlexGap>
          {CHAR_SETS.map((def) => {
            const cov = report.setById[def.id];
            const checked = selected.includes(def.id);
            return (
              <Box
                key={def.id}
                sx={{
                  border: 1,
                  borderColor: checked ? 'primary.main' : 'divider',
                  borderRadius: 1.5,
                  p: 1,
                  minWidth: 210,
                  flex: '1 1 210px',
                  bgcolor: checked ? 'action.selected' : 'background.default',
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, def.id] : cur.filter((x) => x !== def.id)))}
                      slotProps={{ input: { 'aria-label': `Add missing ${def.label}` } as never }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {def.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {def.description} · {def.range}
                      </Typography>
                      <Typography variant="caption" component="div" color={cov.present === cov.total ? 'success.main' : 'warning.main'}>
                        {cov.present}/{cov.total} present · {cov.missing} missing · {cov.blank} blank
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start', m: 0, width: '100%' }}
                />
              </Box>
            );
          })}
        </Stack>

        {existing === 'overwrite' && (
          <Alert severity={templateMode === 'copy' ? 'warning' : 'info'} role="status">
            Overwrite replaces the artwork of characters that already exist. It only does so when the plan has a template that belongs to that
            character (the matching standard digit for a large digit, or a template glyph you pick yourself) — otherwise the existing designs are
            kept. You are asked to confirm before any design is replaced, and one Ctrl+Z restores everything.
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">
              Characters that already exist
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={existing}
              onChange={(_, v: ExistingPolicy | null) => v && setExisting(v)}
              aria-label="Existing characters"
            >
              <ToggleButton value="keep" title="Never touch an existing glyph (default)">
                Keep as is
              </ToggleButton>
              <ToggleButton value="fillBlank" title="Give blank, existing glyphs the template artwork; glyphs with artwork are untouched">
                Fill blanks
              </ToggleButton>
              <ToggleButton value="overwrite" title="Replace the artwork of existing glyphs — explicit overwrite, undoable">
                Overwrite
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">
              New glyphs start …
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={templateMode}
              onChange={(_, v: 'blank' | 'copy' | null) => v && setTemplateMode(v)}
              aria-label="New glyph template"
            >
              <ToggleButton value="blank" title="Empty, editable pixel grid — nothing is claimed to be designed">
                Blank grid
              </ToggleButton>
              <ToggleButton value="copy" title="Copy a template glyph (for large digits: the matching standard digit)">
                Copy template
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {templateMode === 'copy' && (
            <TextField
              select
              size="small"
              label="Template glyph"
              value={templateGlyphId}
              onChange={(e) => setTemplateGlyphId(e.target.value)}
              sx={{ minWidth: 220 }}
              helperText="Automatic picks the matching standard digit for large digits, otherwise a glyph of the same set."
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">Automatic</MenuItem>
              {templateCandidates.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {templateMode === 'copy' && (
            <Box>
              <Typography variant="caption" color="text.secondary" component="div">
                Template scale
              </Typography>
              <ToggleButtonGroup exclusive size="small" value={templateScale} onChange={(_, v: number | null) => v && setTemplateScale(v)} aria-label="Template scale">
                <ToggleButton value={1} title="Straight copy at the same size">
                  ×1
                </ToggleButton>
                <ToggleButton value={2} title="Nearest-neighbour scale ×2 (double-size digits)">
                  ×2 nearest
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
          <FormControlLabel
            sx={{ alignItems: 'center' }}
            control={<Checkbox size="small" checked={adaptAdvance} onChange={(e) => setAdaptAdvance(e.target.checked)} />}
            label="Also copy the advance width when filling/replacing an existing glyph"
            slotProps={{ typography: { variant: 'caption' } }}
          />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
          <Button variant="contained" color="primary" startIcon={<GridOnIcon />} onClick={previewChanges} disabled={!selected.length}>
            Preview changes
          </Button>
          <Button onClick={() => setSelected(incompleteSets)} disabled={!incompleteSets.length}>
            Select the missing characters ({incompleteSets.length} sets)
          </Button>
          <Button onClick={() => runAdd(selected, 'Add selected character sets')} disabled={!selected.length}>
            Add now
          </Button>
        </Stack>

        {previewPlan && (
          <Alert severity="info" role="status">
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Preview: {previewPlan.changes.length} change(s), {previewPlan.skipped.length} kept
              </Typography>
              <Typography variant="caption">
                {previewPlan.additions.length} new glyph(s) · {previewPlan.fills.length} blank glyph(s) filled · {previewPlan.replacements.length}{' '}
                overwritten · {previewPlan.skipped.filter((s) => s.reason === 'present').length} existing character(s) kept exactly as they are
                {previewPlan.skipped.some((s) => s.reason === 'blank') ? ` · ${previewPlan.skipped.filter((s) => s.reason === 'blank').length} blank glyph(s) left alone` : ''}
              </Typography>
              <Box sx={{ overflowX: 'auto', maxHeight: 260 }}>
                <Table size="small" aria-label="Planned changes">
                  <TableHead>
                    <TableRow>
                      <TableCell>Character</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Set</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Grid</TableCell>
                      <TableCell align="right">Advance</TableCell>
                      <TableCell>Template</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewPlan.changes.slice(0, 120).map((c) => (
                      <TableRow key={`${c.codePoint}-${c.mode}`}>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline' }}>
                            <span style={{ fontSize: 16 }}>{charOf(c.codePoint)}</span>
                            <Typography variant="caption" color="text.secondary">
                              {formatCp(c.codePoint)}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell>{CHAR_SET_BY_ID[c.set].label}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={c.mode === 'create' ? 'success' : c.mode === 'fill' ? 'info' : 'warning'}
                            label={c.mode === 'create' ? (c.blank ? 'new (blank)' : 'new (template)') : c.mode === 'fill' ? 'fill blank' : 'overwrite'}
                          />
                        </TableCell>
                        <TableCell>
                          {c.gridWidth}×{c.gridHeight}
                        </TableCell>
                        <TableCell align="right">{c.advanceWidth}</TableCell>
                        <TableCell>{c.templateLabel ? `${c.templateLabel} ×${c.scale}` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              {previewPlan.changes.length > 120 && <Typography variant="caption">Showing the first 120 of {previewPlan.changes.length} changes.</Typography>}
              {previewPlan.skipped.length > 0 && (
                <Typography variant="caption">
                  Kept: {previewPlan.skipped.slice(0, 40).map((s) => `${charOf(s.codePoint)} ${s.glyphName}`).join(', ')}
                  {previewPlan.skipped.length > 40 ? ', …' : ''}
                </Typography>
              )}
              {previewPlan.warnings.map((w, i) => (
                <Typography key={i} variant="caption" color="warning.main">
                  {w}
                </Typography>
              ))}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() =>
                    applyGuarded(
                      previewPlan,
                      'Add character sets',
                      `${previewPlan.changes.length} character(s) applied (${previewPlan.additions.length} new, ${previewPlan.replacements.length} replaced). Existing glyphs were kept unless you asked for a replacement.`,
                    )
                  }
                >
                  Apply {previewPlan.changes.length} change(s)
                </Button>
                <Button onClick={() => setPreviewPlan(null)}>Cancel preview</Button>
                <Button
                  onClick={() => {
                    const added = previewPlan.changes.find((c) => c.glyphId);
                    if (!added?.glyphId) return;
                    applyGuarded(previewPlan, 'Add character sets', 'Added.');
                    selectGlyph(slot, added.glyphId);
                  }}
                >
                  Apply and open the first glyph
                </Button>
              </Stack>
            </Stack>
          </Alert>
        )}
        <Hint>
          Adding a character set never replaces a character that already exists unless you explicitly ask for it: its design, code point, advance
          width and spacing are preserved by default, and any replacement is confirmed first. New characters are created as blank pixel grids (or as
          copies of a template when you ask for one) — nothing is treated as a finished design until you draw it. The whole batch is one undo step.
        </Hint>
      </Section>

      {/* ------------------------------------------------ large digits */}
      <Section title="Double-size alternative digits">
        <Typography variant="body2">
          The alternative digits are ordinary characters that map to their own glyphs, so a text can mix regular and large digits. The default
          mapping is the Private Use Area {formatCp(DEFAULT_LARGE_DIGIT_POINTS[0])}–{formatCp(DEFAULT_LARGE_DIGIT_POINTS[9])} (there is no universal
          keyboard for those code points — use the picker in the Preview panel to insert them).
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }} useFlexGap>
          {inputs.map((value, i) => (
            <TextField
              key={i}
              size="small"
              label={`Digit ${i}`}
              value={value}
              onChange={(e) => {
                const next = [...inputs];
                next[i] = e.target.value;
                setAltInputs(next);
              }}
              sx={{ width: 110 }}
              slotProps={{ htmlInput: { 'aria-label': `Alternative code point for digit ${i}` } }}
            />
          ))}
        </Stack>
        {altError && (
          <Alert severity="error" role="alert">
            {altError}
          </Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
          <Button variant="contained" onClick={applyAltMapping} disabled={!altInputs}>
            Apply mapping
          </Button>
          <Button onClick={() => { setAltInputs(DEFAULT_LARGE_DIGIT_POINTS.map((cp) => formatCp(cp))); setAltError(null); }}>
            Reset to {formatCp(DEFAULT_LARGE_DIGIT_POINTS[0])}
          </Button>
          {altInputs && <Button onClick={() => setAltInputs(null)}>Cancel</Button>}
          <Button
            onClick={() => {
              try {
                const plan = planAddSets(doc, { sets: ['largeDigits'], existing, template: 'blank', altDigitPoints: altPoints });
                if (!plan.changes.length) {
                  toast('info', 'All ten alternative digits already exist.');
                  return;
                }
                applyPlan(plan, 'Add large-digit set', `${plan.changes.length} alternative digit glyph(s) added as blank grids.`);
              } catch (err) {
                toast('error', err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Add the large-digit set
          </Button>
        </Stack>

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Large digit workflow">
            <TableHead>
              <TableRow>
                <TableCell>Digit</TableCell>
                <TableCell>Code point</TableCell>
                <TableCell>Standard digit</TableCell>
                <TableCell>Large digit glyph</TableCell>
                <TableCell align="right">Advance</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: 10 }, (_, i) => {
                const std = glyphFor(0x30 + i);
                const large = glyphFor(altPoints[i]);
                return (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{charOf(0x30 + i)}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{formatCp(altPoints[i])}</TableCell>
                    <TableCell>
                      {std ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <span>{std.name}</span>
                          <Chip size="small" label={glyphHasArtwork(std) ? 'designed' : 'blank'} color={glyphHasArtwork(std) ? 'success' : 'warning'} sx={{ height: 18 }} />
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          not in this font
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {large ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <span>{large.name}</span>
                          <Chip
                            size="small"
                            label={glyphHasArtwork(large) ? `${large.pixel ? `${large.pixel.width}×${large.pixel.height}` : 'outline'}` : 'blank'}
                            color={glyphHasArtwork(large) ? 'success' : 'warning'}
                            sx={{ height: 18 }}
                          />
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          not added yet
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{large?.advanceWidth ?? '—'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title="Copy the standard digit of the same value into this large digit (keeps the code point)">
                        <span>
                          <Button size="small" startIcon={<ContentCopyIcon fontSize="small" />} disabled={!std || !large} onClick={() => copyStandardDigit(i)}>
                            Copy
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Nearest-neighbour scale ×2 of this large digit (never done silently)">
                        <span>
                          <Button size="small" startIcon={<ZoomOutMapIcon fontSize="small" />} disabled={!large} onClick={() => scaleLargeDigit(i, 2)}>
                            ×2
                          </Button>
                        </span>
                      </Tooltip>
                      <Button size="small" disabled={!large} onClick={() => { if (large) { selectGlyph(slot, large.id); closeModal(); } }}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
        <Hint>
          Typical workflow: <strong>Add the standard digits</strong> (if missing) → design or keep them → <strong>Add the large-digit set</strong> →{' '}
          <strong>Copy</strong> a standard digit into its large counterpart → <strong>×2 nearest</strong> if you want it double-size → edit the pixels
          and the metrics of the large digit independently. Both sets are exported in the same TTF/OTF.
        </Hint>
      </Section>

      <Section title="What happens on export">
        <Hint>
          Export writes every glyph of this document — imported, added and drawn — with its real outlines, advance widths and cmap entries, and
          re-opens the produced file to check it: <em>Character coverage</em>, <em>Alternative (large) digits</em> and <em>Added &amp; edited glyph
          outlines</em> in the export report are verified from the file bytes, not from the editor state. Font metadata and licensing fields are
          preserved.
        </Hint>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
          <Button onClick={() => { closeModal(); useStore.getState().openModal({ type: 'export', slot }); }}>Open export…</Button>
          <Button onClick={() => { const g = glyphFor(altPoints[0]); if (g) { selectGlyph(slot, g.id); closeModal(); } }}>
            Go to the first large digit
          </Button>
          <Button
            onClick={() => {
              const missing = report.sets.find((s) => s.def.id === 'georgian');
              const cp = missing?.missingPoints[0] ?? 0x10d0;
              const g = glyphFor(cp);
              if (g) {
                selectGlyph(slot, g.id);
                closeModal();
                toast('info', `${charOf(cp)} ${describeCodePoint(cp)} opened.`);
              } else {
                toast('info', 'Add the Georgian set first — the missing letters are listed in the coverage report above.');
              }
            }}
          >
            Go to the first missing Georgian letter
          </Button>
        </Stack>
      </Section>
    </AppDialog>
  );
}
