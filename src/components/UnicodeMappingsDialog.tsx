/**
 * Unicode mappings of one glyph: several code points → one glyph. Adding a code
 * that another glyph already owns shows the conflict and offers to reassign it.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, List, ListItem, ListItemText, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { addUnicodeMapping, removeUnicodeMapping, setPrimaryUnicode } from '../state/glyphActions';
import { allUnicodes, formatCp, hasCodePoint, mappingConflicts } from '../core/unicodeMap';
import { charFromCodePoint, describeCodePoint, isValidCodePoint, parseCodePointInput } from '../core/unicodeNames';
import { AppDialog, Hint, Section } from './ui';

export function UnicodeMappingsDialog(props: { slot: Slot; glyphId: string }) {
  const { slot, glyphId } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const closeModal = useStore((s) => s.closeModal);
  const toast = useStore((s) => s.toast);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const [input, setInput] = useState('');

  const glyph = doc?.glyphs.find((g) => g.id === glyphId);
  const raw = input.trim();
  const cp = useMemo(() => (raw === '' ? null : parseCodePointInput(raw)), [raw]);

  if (!doc || !glyph) {
    return (
      <AppDialog title="Unicode mappings" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning">This glyph no longer exists.</Alert>
      </AppDialog>
    );
  }

  const mappings = allUnicodes(glyph);
  const conflict = cp !== null && isValidCodePoint(cp) ? mappingConflicts(doc, glyph.id, [cp])[0] : undefined;
  const already = cp !== null && hasCodePoint(glyph, cp);
  const notdef = glyph.name === '.notdef';
  const problem =
    raw !== '' && cp === null
      ? 'Not a single character or code point (try a character, U+FF21, 0x41 or 65).'
      : already
        ? `${formatCp(cp!)} is already mapped to this glyph.`
        : null;

  const run = (label: string, fn: (d: NonNullable<typeof doc>) => NonNullable<typeof doc>, ok: string) => {
    try {
      if (commit(slot, label, fn)) toast('success', ok);
      return true;
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const add = (reassign: boolean) => {
    if (cp === null || problem || notdef) return;
    if (run('Add Unicode mapping', (d) => addUnicodeMapping(d, glyph.id, cp, { reassign }), `Mapped ${describeCodePoint(cp)}.`)) setInput('');
  };

  return (
    <AppDialog
      title={`Unicode mappings — ${glyph.name}`}
      onClose={closeModal}
      actions={<Button onClick={closeModal}>Done</Button>}
    >
      <Section title={`Mapped code points (${mappings.length})`}>
        {mappings.length === 0 ? (
          <Hint>This glyph has no Unicode mapping yet. Add one below.</Hint>
        ) : (
          <List dense disablePadding aria-label="Mapped code points">
            {mappings.map((c, i) => (
              <ListItem
                key={c}
                disableGutters
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    {i > 0 && (
                      <Tooltip title="Make primary">
                        <IconButton size="small" aria-label={`Make ${formatCp(c)} primary`} onClick={() => run('Set primary Unicode', (d) => setPrimaryUnicode(d, glyph.id, c), `${formatCp(c)} is now the primary mapping.`)}>
                          <StarIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Remove this mapping">
                      <IconButton size="small" aria-label={`Remove ${formatCp(c)}`} onClick={() => run('Remove Unicode mapping', (d) => removeUnicodeMapping(d, glyph.id, c), `Removed ${formatCp(c)}.`)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              >
                <Typography sx={{ width: 36, fontWeight: 700, textAlign: 'center', mr: 1 }} aria-hidden>
                  {charFromCodePoint(c)}
                </Typography>
                <ListItemText primary={formatCp(c)} secondary={describeCodePoint(c)} />
                {i === 0 && <Chip size="small" color="primary" label="primary" sx={{ mr: 6 }} />}
              </ListItem>
            ))}
          </List>
        )}
      </Section>

      <Section title="Add a mapping">
        {notdef ? (
          <Alert severity="info">.notdef must stay unmapped.</Alert>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                size="small"
                fullWidth
                label="Code point"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !conflict && add(false)}
                placeholder="e.g. Ａ or U+FF21"
                error={!!problem}
                helperText={problem ?? 'A character, U+FF21, 0x41 or a decimal number. The same outline is used for every mapped code point.'}
                slotProps={{ htmlInput: { 'aria-label': 'Code point to add' } }}
              />
              <Button variant="contained" onClick={() => add(false)} disabled={cp === null || !!problem || !!conflict} sx={{ mt: 0.25 }}>
                Add mapping
              </Button>
            </Stack>
            {cp !== null && !problem && !conflict && <Hint>{describeCodePoint(cp)} is free.</Hint>}
            {conflict && (
              <Alert
                severity="warning"
                role="alert"
                action={
                  <Button color="inherit" size="small" onClick={() => add(true)}>
                    Reassign here
                  </Button>
                }
              >
                <Box>
                  {formatCp(cp!)} is already mapped to “{conflict.ownerName}”.{' '}
                  <Button size="small" sx={{ p: 0, minWidth: 0, textTransform: 'none' }} onClick={() => selectGlyph(slot, conflict.ownerId)}>
                    Go to that glyph
                  </Button>
                  <br />
                  Reassigning takes it away from “{conflict.ownerName}” (undoable).
                </Box>
              </Alert>
            )}
          </>
        )}
      </Section>
    </AppDialog>
  );
}
