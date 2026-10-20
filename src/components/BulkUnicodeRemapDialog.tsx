/** Remap the Unicode code points of a multi-selection in one undoable step. */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { allUnicodes } from '../core/unicodeMap';
import { charFromCodePoint, describeCodePoint, parseCodePointInput } from '../core/unicodeNames';
import {
  findUnicodeRemapConflicts,
  remapGlyphs,
  unicodeRemapTargets,
  UNICODE_REMAP_PRESETS,
  type UnicodeRemapMode,
  type UnicodeRemapPreset,
} from '../core/unicodeRemap';
import { AppDialog, Hint, Section } from './ui';

const showChar = (cp: number): string => cp === 0x20 ? '␠' : cp < 0x20 || cp === 0x7f ? '·' : charFromCodePoint(cp);
const formatMapping = (cp: number): string => `${showChar(cp)} · U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

type PresetChoice = UnicodeRemapPreset | '';

export function BulkUnicodeRemapDialog(props: {
  slot: Slot;
  glyphIds: string[];
  targetPreset?: UnicodeRemapPreset;
  initialMode?: UnicodeRemapMode;
}) {
  const { slot, glyphIds } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const closeModal = useStore((s) => s.closeModal);
  const toast = useStore((s) => s.toast);
  const askConfirm = useStore((s) => s.askConfirm);
  const setMultiSelect = useStore((s) => s.setMultiSelect);
  const setListCategory = useStore((s) => s.setListCategory);
  const selectGlyph = useStore((s) => s.selectGlyph);

  const [preset, setPreset] = useState<PresetChoice>(props.targetPreset ?? '');
  const [customStart, setCustomStart] = useState('U+E000');
  const [mode, setMode] = useState<UnicodeRemapMode>(props.initialMode ?? 'move');
  const [takeExisting, setTakeExisting] = useState(false);

  // A takeover choice is scoped to one exact mapping preview. Do not carry it
  // over if the target, mode, start code point, or font changes.
  useEffect(() => setTakeExisting(false), [preset, customStart, mode, doc]);

  const selectedGlyphs = useMemo(
    () => (doc ? glyphIds.map((id) => doc.glyphs.find((g) => g.id === id) ?? null) : []),
    [doc, glyphIds],
  );
  const missingCount = selectedGlyphs.filter((g) => !g).length;
  const hasNotdef = selectedGlyphs.some((g) => g?.name === '.notdef');
  const validation = useMemo(() => {
    if (!doc) return { targets: null as number[] | null, error: 'No font is loaded.' };
    if (!preset) return { targets: null as number[] | null, error: 'Choose a destination character set.' };
    if (missingCount) return { targets: null as number[] | null, error: `${missingCount} selected glyph(s) no longer exist.` };
    if (hasNotdef) return { targets: null as number[] | null, error: '.notdef cannot be remapped. Remove it from the selection first.' };
    try {
      const start = preset === 'custom' ? parseCodePointInput(customStart) ?? undefined : undefined;
      const targets = unicodeRemapTargets(preset, glyphIds.length, start);
      return { targets, error: null };
    } catch (err) {
      return { targets: null as number[] | null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [doc, preset, customStart, glyphIds.length, missingCount, hasNotdef]);

  const targetPoints = validation.targets;
  const conflicts = useMemo(
    () => doc && targetPoints ? findUnicodeRemapConflicts(doc, glyphIds, targetPoints, mode) : [],
    [doc, glyphIds, targetPoints, mode],
  );
  const targetLabel = UNICODE_REMAP_PRESETS.find((x) => x.id === preset)?.label ?? 'Unicode range';
  const noChange = !!doc && !!targetPoints && !conflicts.length && targetPoints.every((cp, i) => {
    const glyph = doc.glyphs.find((g) => g.id === glyphIds[i]);
    if (!glyph) return false;
    const existing = allUnicodes(glyph);
    return mode === 'move' ? existing.length === 1 && existing[0] === cp : existing.includes(cp);
  });

  const apply = async () => {
    if (!doc || !targetPoints || validation.error || (conflicts.length > 0 && !takeExisting)) return;
    if (conflicts.length) {
      const details = conflicts
        .slice(0, 12)
        .map((c) => `${formatMapping(c.codePoint)} is currently mapped to “${c.ownerName}” and will be mapped to “${c.targetGlyphName}” instead.`)
        .join('\n');
      const remaining = conflicts.length > 12 ? `\n…and ${conflicts.length - 12} more mapping(s).` : '';
      const ok = await askConfirm({
        title: `Take ${conflicts.length} existing Unicode mapping${conflicts.length === 1 ? '' : 's'}?`,
        message: `${details}${remaining}\n\nThe old glyphs and their artwork will stay in the font; only these code-point assignments will move.`,
        confirmLabel: 'Take mappings',
        danger: true,
      });
      if (!ok) return;
    }

    const changed = commit(slot, `${mode === 'move' ? 'Move' : 'Add'} glyph Unicode mappings`, (current) =>
      remapGlyphs(current, glyphIds, targetPoints, { mode, takeExistingMappings: takeExisting }),
    );
    if (!changed) {
      toast('info', 'Those Unicode mappings are already set.');
      return;
    }

    const category = preset === 'digits' ? 'digits'
      : preset === 'latinUpper' || preset === 'latinLower' ? 'english'
        : preset === 'georgian' ? 'georgian'
          : 'all';
    setListCategory(slot, category);
    setMultiSelect(slot, []);
    selectGlyph(slot, glyphIds[0] ?? null);
    toast('success', `${mode === 'move' ? 'Moved' : 'Added'} ${glyphIds.length} mapping(s) to ${targetLabel}.`);
    closeModal();
  };

  if (!doc) {
    return (
      <AppDialog title="Remap selected glyphs" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning">No font is loaded in Font {slot}.</Alert>
      </AppDialog>
    );
  }

  return (
    <AppDialog
      title={`${mode === 'move' ? 'Move' : 'Map'} ${glyphIds.length} selected glyph${glyphIds.length === 1 ? '' : 's'} to another character set`}
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button onClick={closeModal}>Cancel</Button>
          <Button
            variant="contained"
            onClick={apply}
            disabled={!targetPoints || !!validation.error || (conflicts.length > 0 && !takeExisting) || noChange}
          >
            {mode === 'move' ? 'Move mappings' : 'Add mappings'}
          </Button>
        </>
      }
    >
      <Alert severity="info">
        This changes Unicode assignments only. Glyph artwork, pixel grids, names and metrics stay with the selected glyphs. The rows below show the exact order used.
      </Alert>

      <Section title="Destination">
        <TextField
          select
          fullWidth
          label="Character set"
          value={preset}
          onChange={(e) => setPreset(e.target.value as PresetChoice)}
          helperText={UNICODE_REMAP_PRESETS.find((x) => x.id === preset)?.description ?? 'Choose the Unicode code points for the selected glyphs.'}
        >
          <MenuItem value="" disabled>Choose a destination…</MenuItem>
          {UNICODE_REMAP_PRESETS.map((item) => (
            <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>
          ))}
        </TextField>
        {preset === 'custom' && (
          <TextField
            label="First destination code point"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            helperText="Enter a character, U+10D0, 0x10D0, or a decimal code point. Selected glyphs fill consecutive code points from here."
            slotProps={{ htmlInput: { 'aria-label': 'First destination code point' } }}
          />
        )}
        {validation.error && <Alert severity="warning" role="alert">{validation.error}</Alert>}
      </Section>

      <Section title="What to do with the selected glyphs’ current mappings">
        <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as UnicodeRemapMode)}>
          <FormControlLabel value="move" control={<Radio />} label="Move — replace each selected glyph’s current Unicode mapping(s)." />
          <FormControlLabel value="alias" control={<Radio />} label="Add as an alias — keep existing mappings and add the destination code point." />
        </RadioGroup>
        <Hint>
          Choose <strong>Move</strong> to change a glyph from one section to another. Choose <strong>Add as an alias</strong> when the same drawing should keep its old character too.
        </Hint>
      </Section>

      {conflicts.length > 0 && (
        <Section title={`Code points already in use (${conflicts.length})`}>
          <Alert severity="warning">
            {conflicts.slice(0, 8).map((c) => (
              <div key={`${c.codePoint}:${c.ownerId}:${c.targetGlyphId}`}>
                {formatMapping(c.codePoint)} is assigned to “{c.ownerName}”; destination glyph: “{c.targetGlyphName}”.
              </div>
            ))}
            {conflicts.length > 8 && <div>…and {conflicts.length - 8} more.</div>}
          </Alert>
          <FormControlLabel
            control={<Checkbox checked={takeExisting} onChange={(e) => setTakeExisting(e.target.checked)} />}
            label="Take these code points from their current glyphs (those glyphs stay, but lose only these mappings)."
          />
        </Section>
      )}

      {targetPoints && (
        <Section title={`Mapping preview · ${targetPoints.length} glyph(s)`}>
          <Box sx={{ maxHeight: 360, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader aria-label="Unicode remapping preview">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Selected glyph</TableCell>
                  <TableCell>Current code point(s)</TableCell>
                  <TableCell>Destination</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {glyphIds.map((id, i) => {
                  const glyph = doc.glyphs.find((g) => g.id === id);
                  const current = glyph ? allUnicodes(glyph) : [];
                  return (
                    <TableRow key={id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{glyph?.name ?? 'Missing glyph'}</TableCell>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                        {current.length ? current.map(formatMapping).join(', ') : 'Unmapped'}
                      </TableCell>
                      <TableCell>
                        <Typography component="span" sx={{ fontWeight: 700, mr: 0.75 }}>{showChar(targetPoints[i])}</Typography>
                        <Typography component="span" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                          U+{targetPoints[i].toString(16).toUpperCase().padStart(4, '0')}
                        </Typography>
                        <Typography component="div" variant="caption" color="text.secondary">
                          {describeCodePoint(targetPoints[i])}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </Section>
      )}
    </AppDialog>
  );
}
