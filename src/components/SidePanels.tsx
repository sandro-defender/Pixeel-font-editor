/** Right-hand panels: metrics & tools, live preview, A/B comparison. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { Alert, Box, Button, Chip, Paper, Slider, Stack, TextField, Typography } from '@mui/material';
import { useStore } from '../state/store';
import type { FontDoc, GlyphDoc, Slot } from '../core/types';
import { parseCodePointInput, describeCodePoint, SAMPLE_TEXTS } from '../core/unicodeNames';
import { drawGlyph } from '../render/glyphRender';
import { previewFamily, rebuildPreview } from '../services/previewFont';
import { assignUnicode, duplicateGlyph, removeGlyphs, renameGlyph, setAdvance, setLeftSideBearing } from '../state/glyphActions';
import { Hint, Section } from './ui';

/** Whole-number font units; rejects blank and fractional input. */
function parseUnits(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && Math.abs(n) <= 100000 ? n : null;
}

// ---------------------------------------------------------------------------
// Metrics & tools
// ---------------------------------------------------------------------------
export function MetricsPanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const glyphId = useStore((s) => s.ui[slot].glyphId);
  const glyph = doc?.glyphs.find((g) => g.id === glyphId);
  if (!doc || !glyph) return <Typography color="text.secondary">No glyph selected.</Typography>;
  // keyed: switching glyphs (or any change to these values) starts the form from the stored values
  return (
    <GlyphForm
      key={`${glyph.id}|${glyph.unicode}|${glyph.name}|${glyph.advanceWidth}|${glyph.leftSideBearing}`}
      slot={slot}
      glyph={glyph}
      doc={doc}
    />
  );
}

function GlyphForm(props: { slot: Slot; glyph: GlyphDoc; doc: FontDoc }) {
  const { slot, glyph, doc } = props;
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const askConfirm = useStore((s) => s.askConfirm);
  const openModal = useStore((s) => s.openModal);

  const [uniInput, setUniInput] = useState(glyph.unicode !== null ? 'U+' + glyph.unicode.toString(16).toUpperCase().padStart(4, '0') : '');
  const [nameInput, setNameInput] = useState(glyph.name);
  const [advInput, setAdvInput] = useState(String(glyph.advanceWidth));
  const [lsbInput, setLsbInput] = useState(String(glyph.leftSideBearing));

  const applyUnicode = () => {
    const raw = uniInput.trim();
    const cp = raw === '' ? null : parseCodePointInput(raw);
    if (raw !== '' && cp === null) {
      toast('error', `“${raw}” is not a valid character or code point.`);
      return;
    }
    try {
      commit(slot, 'Assign Unicode', (d) => assignUnicode(d, glyph.id, cp));
      toast('success', cp === null ? 'Unicode assignment removed.' : `Assigned ${describeCodePoint(cp)}.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const applyName = () => {
    const name = nameInput.trim();
    if (name === glyph.name) return;
    try {
      commit(slot, 'Rename glyph', (d) => renameGlyph(d, glyph.id, name));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
      setNameInput(glyph.name);
    }
  };

  const applyMetrics = () => {
    const adv = parseUnits(advInput);
    const lsb = parseUnits(lsbInput);
    if (adv === null || lsb === null) {
      toast('error', 'Advance width and left side bearing must be whole numbers of font units.');
      return;
    }
    try {
      if (adv !== glyph.advanceWidth) commit(slot, 'Set advance', (d) => setAdvance(d, glyph.id, adv));
      if (lsb !== glyph.leftSideBearing) {
        commit(slot, 'Set LSB', (d) => setLeftSideBearing(d, glyph.id, lsb));
        toast('info', 'Glyph content was shifted to match the new left side bearing.');
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const deleteGlyph = async () => {
    const ok = await askConfirm({
      title: 'Delete glyph?',
      message: `Delete glyph “${glyph.name}”? You can undo this with Ctrl+Z.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    // the store moves the selection to a neighbouring glyph after the removal
    commit(slot, 'Delete glyph', (d) => removeGlyphs(d, [glyph.id]));
  };

  const other = slot === 'A' ? 'B' : 'A';
  const metricsDirty = parseUnits(advInput) !== glyph.advanceWidth || parseUnits(lsbInput) !== glyph.leftSideBearing;

  return (
    <Stack spacing={1.5}>
      <Section title="Glyph metrics & tools">
        <Stack sx={{ alignItems: 'flex-start' }} direction="row" spacing={1}>
          <TextField
            label="Unicode"
            value={uniInput}
            onChange={(e) => setUniInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyUnicode()}
            placeholder="e.g. U+0041"
            helperText="Character, U+10D0, 0x41 or 65. Empty removes the mapping."
            slotProps={{ htmlInput: { 'aria-label': 'Unicode value' } }}
          />
          <Button onClick={applyUnicode} title="Apply the Unicode assignment (validated for conflicts)" sx={{ mt: 0.5 }}>
            Apply
          </Button>
        </Stack>
        {glyph.unicode !== null && <Hint>{describeCodePoint(glyph.unicode)}</Hint>}
        {glyph.name === '.notdef' && <Hint>.notdef is required and stays unmapped.</Hint>}

        <TextField
          label="Glyph name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={applyName}
          onKeyDown={(e) => e.key === 'Enter' && applyName()}
          slotProps={{ htmlInput: { 'aria-label': 'Glyph name' } }}
        />

        <Stack direction="row" spacing={1}>
          <TextField
            label="Advance width"
            type="number"
            value={advInput}
            onChange={(e) => setAdvInput(e.target.value)}
            helperText="Font units"
            slotProps={{ htmlInput: { 'aria-label': 'Advance width', step: 1 } }}
          />
          <TextField
            label="Left side bearing"
            type="number"
            value={lsbInput}
            onChange={(e) => setLsbInput(e.target.value)}
            helperText="Shifts glyph content"
            slotProps={{ htmlInput: { 'aria-label': 'Left side bearing', step: 1 } }}
          />
        </Stack>
        <Stack sx={{ flexWrap: 'wrap' }} direction="row" spacing={1} useFlexGap>
          <Button variant="contained" color="primary" onClick={applyMetrics} disabled={!metricsDirty} title="Apply advance width and side bearing">
            Apply metrics
          </Button>
          <Button
            title="Duplicate this glyph (the copy is unmapped)"
            onClick={() => {
              commit(slot, 'Duplicate glyph', (d) => duplicateGlyph(d, glyph.id).doc);
              toast('success', 'Glyph duplicated (copy is unmapped).');
            }}
          >
            Duplicate
          </Button>
          {glyph.name !== '.notdef' && (
            <Button color="error" title="Delete this glyph" onClick={deleteGlyph}>
              Delete
            </Button>
          )}
        </Stack>

        {glyph.kind === 'compound' && (
          <Alert severity="warning">
            Composite glyph — it references other glyphs. Flattening (button in the editor toolbar) converts it to editable outlines. It is preserved as a composite on export while unedited.
          </Alert>
        )}
        <Stack sx={{ flexWrap: 'wrap' }} direction="row" spacing={1} useFlexGap>
          {glyph.instructions && <Chip size="small" label="hinting instructions" />}
          {glyph.sourceContours && <Chip size="small" label="source outline kept" />}
          {glyph.srcIndex !== null && <Chip size="small" label={`source #${glyph.srcIndex}`} />}
        </Stack>
        <Stack sx={{ flexWrap: 'wrap' }} direction="row" spacing={1} useFlexGap>
          <Button
            onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: [glyph.id], mode: 'copy' })}
            title="Copy this glyph to the other font"
          >
            Copy to Font {other}…
          </Button>
          <Button
            onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: [glyph.id], mode: 'move' })}
            title="Move this glyph to the other font (removes it here; one undo restores both)"
          >
            Move to Font {other}…
          </Button>
        </Stack>
      </Section>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Live preview (uses the current edited font incl. unsaved changes)
// ---------------------------------------------------------------------------
export function PreviewPanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const [text, setText] = useState<string>(SAMPLE_TEXTS.Mixed);
  const [size, setSize] = useState(42);
  const [spacing, setSpacing] = useState(0);
  // start from the family already registered for this slot, so switching tabs does not flash
  const [family, setFamily] = useState<string | null>(() => previewFamily(slot));
  const [status, setStatus] = useState<'idle' | 'building' | 'error'>('idle');
  const requestRef = useRef(0);

  // rebuild after each change to the font (debounced); only the newest request may update the panel
  useEffect(() => {
    if (!doc) return;
    const request = ++requestRef.current;
    setStatus('building');
    const timer = setTimeout(() => {
      rebuildPreview(slot, doc).then((f) => {
        if (request !== requestRef.current) return;
        setFamily(f);
        setStatus(f ? 'idle' : 'error');
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [doc, slot]);

  if (!doc) return <Typography color="text.secondary">Load a font to preview it.</Typography>;

  return (
    <Stack spacing={1.5}>
      <Section
        title="Live preview"
        action={
          status === 'building' ? (
            <Typography variant="caption" color="text.secondary">rebuilding font…</Typography>
          ) : status === 'error' ? (
            <Typography variant="caption" color="error">preview build failed</Typography>
          ) : null
        }
      >
        <TextField
          label="Sample text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          multiline
          minRows={2}
          slotProps={{ htmlInput: { 'aria-label': 'Preview text' } }}
        />
        <Stack sx={{ flexWrap: 'wrap' }} direction="row" spacing={0.75} useFlexGap>
          {Object.entries(SAMPLE_TEXTS).map(([k, v]) => (
            <Chip
              key={k}
              size="small"
              clickable
              label={`+ ${k}`}
              title={v}
              onClick={() => setText((t) => (t.includes(v) ? t : `${t}\n${v}`))}
            />
          ))}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">Font size — {size}px</Typography>
            <Slider size="small" min={10} max={160} value={size} onChange={(_, v) => setSize(v as number)} aria-label="Preview font size" />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">Letter spacing — {spacing / 100}em</Typography>
            <Slider size="small" min={-5} max={40} value={spacing} onChange={(_, v) => setSpacing(v as number)} aria-label="Preview letter spacing" />
          </Box>
        </Stack>
        <Paper
          variant="outlined"
          aria-label="Font preview"
          sx={{
            p: 2,
            minHeight: 120,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: family ? `"${family}"` : 'serif',
            fontSize: size,
            letterSpacing: `${spacing / 100}em`,
            lineHeight: 1.25,
            opacity: family ? 1 : 0.4,
          }}
        >
          {text || 'Type something…'}
        </Paper>
        <Hint>Preview reflects unsaved edits. It is rebuilt after each change.</Hint>
      </Section>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// A/B comparison
// ---------------------------------------------------------------------------
export function ComparePanel() {
  const docA = useStore((s) => s.fonts.A);
  const docB = useStore((s) => s.fonts.B);
  const openModal = useStore((s) => s.openModal);
  const theme = useTheme();
  const [char, setChar] = useState<string>('A');
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);

  const cp = useMemo(() => char.codePointAt(0) ?? null, [char]);
  const glyphA = useMemo(() => (docA && cp !== null ? docA.glyphs.find((g) => g.unicode === cp) : undefined), [docA, cp]);
  const glyphB = useMemo(() => (docB && cp !== null ? docB.glyphs.find((g) => g.unicode === cp) : undefined), [docB, cp]);

  useEffect(() => {
    const color = theme.palette.text.primary;
    const dim = theme.palette.text.secondary;
    const render = (canvas: HTMLCanvasElement | null, doc: FontDoc | null, glyph: GlyphDoc | undefined) => {
      if (!canvas || !doc) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = 150 * dpr;
      canvas.height = 150 * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, 150, 150);
      if (!glyph) {
        ctx.fillStyle = dim;
        ctx.font = '12px system-ui';
        ctx.fillText('no glyph', 48, 80);
        return;
      }
      drawGlyph(ctx, glyph, doc.metrics, 110, 20, 118, { color, guides: true });
    };
    render(canvasA.current, docA, glyphA);
    render(canvasB.current, docB, glyphB);
  }, [docA, docB, glyphA, glyphB, cp, theme]);

  if (!docA || !docB) {
    return <Typography color="text.secondary">Load fonts into both Font A and Font B to compare them side by side.</Typography>;
  }

  return (
    <Stack spacing={1.5}>
      <Section title="Font A / Font B comparison">
        <TextField
          label="Character to compare"
          value={char}
          onChange={(e) => setChar(Array.from(e.target.value).pop() ?? 'A')}
          helperText="Any single character, e.g. ა, 7, ?"
          slotProps={{ htmlInput: { 'aria-label': 'Comparison character' } }}
          sx={{ '& input': { fontSize: 18 } }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <CompareCell
            title={`Font A — ${docA.meta.fontFamily}`}
            canvas={canvasA}
            caption={glyphA ? `${glyphA.name} · adv ${glyphA.advanceWidth}` : 'missing'}
            action={glyphA ? { label: 'A → B', tip: 'Copy this glyph into Font B', onClick: () => openModal({ type: 'transfer', from: 'A', glyphIds: [glyphA.id], mode: 'copy' }) } : null}
          />
          <CompareCell
            title={`Font B — ${docB.meta.fontFamily}`}
            canvas={canvasB}
            caption={glyphB ? `${glyphB.name} · adv ${glyphB.advanceWidth}` : 'missing'}
            action={glyphB ? { label: 'B → A', tip: 'Copy this glyph into Font A', onClick: () => openModal({ type: 'transfer', from: 'B', glyphIds: [glyphB.id], mode: 'copy' }) } : null}
          />
        </Stack>
        <Hint>Aligns both glyphs on their baselines. Transfers are confirmed per batch and undoable; Move also removes the glyph from its source font.</Hint>
      </Section>
    </Stack>
  );
}

function CompareCell(props: {
  title: string;
  canvas: React.RefObject<HTMLCanvasElement | null>;
  caption: string;
  action: { label: string; tip: string; onClick: () => void } | null;
}) {
  return (
    <Paper sx={{ p: 1.5, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" noWrap sx={{ maxWidth: '100%' }} title={props.title}>
        {props.title}
      </Typography>
      <canvas ref={props.canvas} style={{ width: 150, height: 150 }} aria-label={props.title} />
      <Typography variant="caption" color="text.secondary">
        {props.caption}
      </Typography>
      {props.action && (
        <Button size="small" title={props.action.tip} onClick={props.action.onClick}>
          {props.action.label}
        </Button>
      )}
    </Paper>
  );
}
