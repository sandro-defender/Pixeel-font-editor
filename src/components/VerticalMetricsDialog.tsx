/**
 * Vertical metrics editor: hhea ascent / descent / line gap and the OS/2 typo
 * and win values, with presets, validation and a line-box preview.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useStore } from '../state/store';
import type { FontDoc, FontMetrics, Slot } from '../core/types';
import { setVerticalMetrics } from '../state/glyphActions';
import { resolveGlyphContours } from '../core/fontCodec';
import {
  VERTICAL_PRESETS,
  applyVerticalPreset,
  effectiveVertical,
  fontExtent,
  lineHeight,
  syncOs2ToHhea,
  validateVerticalMetrics,
} from '../core/verticalMetrics';
import { layoutKerned } from '../core/kerning';
import { drawGlyph } from '../render/glyphRender';
import { AppDialog, Hint, Section } from './ui';

type Key = 'ascent' | 'descent' | 'lineGap' | 'typoAscender' | 'typoDescender' | 'typoLineGap' | 'winAscent' | 'winDescent';
type Draft = Record<Key, string> & { useTypoMetrics: boolean };

const KEYS: Key[] = ['ascent', 'descent', 'lineGap', 'typoAscender', 'typoDescender', 'typoLineGap', 'winAscent', 'winDescent'];

function toDraft(m: FontMetrics): Draft {
  const e = effectiveVertical(m);
  const d = { useTypoMetrics: e.useTypoMetrics } as Draft;
  for (const k of KEYS) d[k] = String(e[k]);
  return d;
}

/** Parse the text fields; unparsable fields become NaN so validation reports them. */
function fromDraft(base: FontMetrics, d: Draft): FontMetrics {
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  return {
    unitsPerEm: base.unitsPerEm,
    ascent: num(d.ascent),
    descent: num(d.descent),
    lineGap: num(d.lineGap),
    typoAscender: num(d.typoAscender),
    typoDescender: num(d.typoDescender),
    typoLineGap: num(d.typoLineGap),
    winAscent: num(d.winAscent),
    winDescent: num(d.winDescent),
    useTypoMetrics: d.useTypoMetrics,
  };
}

const COLORS = { hhea: '#1e88e5', typo: '#43a047', win: '#fb8c00' };

/** Two lines of sample text inside their line boxes, with every metric drawn as a labelled line. */
function MetricsPreview(props: { doc: FontDoc; metrics: FontMetrics }) {
  const { doc, metrics } = props;
  const theme = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);
  const sample = useMemo(() => {
    const has = (ch: string) => doc.glyphs.some((g) => g.unicode === ch.codePointAt(0) && g.kind !== 'empty');
    const preferred = Array.from('HxgÅp').filter(has).join('');
    if (preferred) return preferred;
    return doc.glyphs
      .filter((g) => g.unicode !== null && g.kind !== 'empty')
      .slice(0, 4)
      .map((g) => String.fromCodePoint(g.unicode!))
      .join('');
  }, [doc]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cssW = canvas.clientWidth || 560;
    const cssH = 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const e = effectiveVertical(metrics);
    if (![e.ascent, e.descent, e.lineGap, e.typoAscender, e.typoDescender, e.typoLineGap, e.winAscent, e.winDescent].every(Number.isFinite)) {
      ctx.fillStyle = theme.palette.text.secondary;
      ctx.font = '13px system-ui';
      ctx.fillText('Enter whole numbers to see the preview.', 12, 30);
      return;
    }
    const pitch = Math.max(lineHeight(metrics), 1);
    const topUnits = Math.max(e.ascent, e.winAscent, e.typoAscender, 1);
    const botUnits = Math.max(-e.descent, e.winDescent, -e.typoDescender, 1);
    // baseline 1 sits topUnits below the top; baseline 2 one line pitch lower
    const total = topUnits + pitch + botUnits;
    const scale = (cssH - 16) / total;
    const left = 64;
    const right = cssW - 150;
    const y1 = 8 + topUnits * scale;
    const y2 = y1 + pitch * scale;
    const emPx = metrics.unitsPerEm * scale;

    // line boxes (hhea): ascent → descent, the gap between lines is hatched
    [y1, y2].forEach((base) => {
      ctx.fillStyle = alpha(COLORS.hhea, 0.1);
      ctx.fillRect(left, base - e.ascent * scale, right - left, (e.ascent - e.descent) * scale);
    });
    if (e.lineGap > 0) {
      ctx.fillStyle = alpha(theme.palette.text.primary, 0.06);
      ctx.fillRect(left, y1 - e.descent * scale, right - left, e.lineGap * scale);
    }

    // sample text
    const laid = layoutKerned(doc, sample, doc.kerning ?? []);
    const textW = Math.max(1, laid.width * scale);
    const fit = Math.min(1, (right - left - 24) / textW);
    [y1, y2].forEach((base) => {
      laid.glyphs.forEach((item) => {
        drawGlyph(ctx, item.glyph, doc.metrics, emPx * fit, left + 12 + item.x * scale * fit, base, { color: theme.palette.text.primary });
      });
    });

    // metric lines
    const line = (y: number, color: string, dash: number[], text: string, x0 = left, x1 = right) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '10px system-ui';
      ctx.fillText(text, x1 + 6, y + 3);
    };
    line(y1, theme.palette.text.primary, [], 'baseline');
    line(y1 - e.ascent * scale, COLORS.hhea, [], `ascent ${e.ascent}`);
    line(y1 - e.descent * scale, COLORS.hhea, [], `descent ${e.descent}`);
    line(y1 - e.typoAscender * scale, COLORS.typo, [6, 4], `typoAsc ${e.typoAscender}`);
    line(y1 - e.typoDescender * scale, COLORS.typo, [6, 4], `typoDesc ${e.typoDescender}`);
    line(y1 - e.winAscent * scale, COLORS.win, [2, 3], `winAsc ${e.winAscent}`);
    line(y1 + e.winDescent * scale, COLORS.win, [2, 3], `winDesc ${-e.winDescent}`);
    // line pitch marker
    ctx.strokeStyle = theme.palette.text.secondary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left - 14, y1);
    ctx.lineTo(left - 14, y2);
    ctx.moveTo(left - 18, y1);
    ctx.lineTo(left - 10, y1);
    ctx.moveTo(left - 18, y2);
    ctx.lineTo(left - 10, y2);
    ctx.stroke();
    ctx.save();
    ctx.translate(left - 22, (y1 + y2) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = theme.palette.text.secondary;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`line height ${pitch}`, 0, 0);
    ctx.restore();
  }, [doc, metrics, sample, theme]);

  return <canvas ref={ref} role="img" aria-label="Vertical metrics preview" style={{ width: '100%', height: 280, display: 'block' }} />;
}

export function VerticalMetricsDialog(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const commit = useStore((s) => s.commit);
  const closeModal = useStore((s) => s.closeModal);
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<Draft | null>(() => (doc ? toDraft(doc.metrics) : null));
  const [presetId, setPresetId] = useState('');
  const extent = useMemo(() => (doc ? fontExtent(doc, (g) => resolveGlyphContours(g, doc.glyphs)) : null), [doc]);

  if (!doc || !draft) {
    return (
      <AppDialog title="Vertical metrics" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning">This font no longer exists.</Alert>
      </AppDialog>
    );
  }

  const led = !!doc.ledMatrix;
  const parsed = fromDraft(doc.metrics, draft);
  // LED fonts get ascent / descent / gap from the matrix
  const effective: FontMetrics = led ? { ...parsed, ascent: doc.metrics.ascent, descent: doc.metrics.descent, lineGap: doc.metrics.lineGap } : parsed;
  const check = validateVerticalMetrics(effective, extent);
  const original = effectiveVertical(doc.metrics);
  const parsedEff = effectiveVertical(effective);
  const changed = KEYS.some((k) => parsedEff[k] !== original[k]) || parsedEff.useTypoMetrics !== original.useTypoMetrics;

  const set = (k: Key, v: string) => setDraft({ ...draft, [k]: v });

  const choosePreset = (id: string) => {
    setPresetId(id);
    const preset = VERTICAL_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setDraft(toDraft(applyVerticalPreset(doc.metrics, preset)));
  };

  const syncToHhea = () => {
    const synced = syncOs2ToHhea(effective);
    if (![synced.ascent, synced.descent, synced.lineGap].every(Number.isFinite)) return;
    setDraft(toDraft({ ...synced, useTypoMetrics: draft.useTypoMetrics }));
    setPresetId('');
  };

  const apply = () => {
    if (check.errors.length) return;
    if (commit(slot, 'Edit vertical metrics', (d) => setVerticalMetrics(d, effective))) toast('success', 'Vertical metrics updated.');
    closeModal();
  };

  const field = (k: Key, label: string, disabled = false, helper?: string) => (
    <TextField
      key={k}
      size="small"
      type="number"
      label={label}
      value={draft[k]}
      disabled={disabled}
      onChange={(e) => set(k, e.target.value)}
      helperText={helper}
      slotProps={{ htmlInput: { 'aria-label': label, step: 1 } }}
    />
  );

  return (
    <AppDialog
      title={`Vertical metrics — Font ${slot}`}
      maxWidth="md"
      onClose={closeModal}
      actions={
        <>
          <Button onClick={() => setDraft(toDraft(doc.metrics))} disabled={!changed}>
            Reset
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" onClick={apply} disabled={check.errors.length > 0 || !changed}>
            Apply
          </Button>
        </>
      }
    >
      <Section
        title="Preview"
        action={
          <Stack direction="row" spacing={0.75}>
            <Chip size="small" variant="outlined" sx={{ color: COLORS.hhea, borderColor: COLORS.hhea }} label="hhea" />
            <Chip size="small" variant="outlined" sx={{ color: COLORS.typo, borderColor: COLORS.typo }} label="typo" />
            <Chip size="small" variant="outlined" sx={{ color: COLORS.win, borderColor: COLORS.win }} label="win" />
          </Stack>
        }
      >
        <Paper variant="outlined" sx={{ p: 0.5, bgcolor: 'background.default' }}>
          <MetricsPreview doc={doc} metrics={effective} />
        </Paper>
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          Line height {Number.isFinite(lineHeight(effective)) ? lineHeight(effective) : '—'} units ({Number.isFinite(lineHeight(effective)) ? (lineHeight(effective) / doc.metrics.unitsPerEm).toFixed(3) : '—'} em) · units per em {doc.metrics.unitsPerEm}
          {extent ? ` · glyphs span ${Math.round(extent.yMin)} … ${Math.round(extent.yMax)}` : ''}
        </Typography>
      </Section>

      {led && <Alert severity="info">LED matrix font: ascent, descent and line gap come from the matrix (“LED matrix…”). The OS/2 typo and win values below can still be edited.</Alert>}

      <Section title="Presets">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
          <TextField size="small" select label="Preset" value={presetId} onChange={(e) => choosePreset(e.target.value)} disabled={led} sx={{ minWidth: 240 }} slotProps={{ htmlInput: { 'aria-label': 'Vertical metrics preset' } }}>
            {VERTICAL_PRESETS.map((p) => (
              <MenuItem key={p.id} value={p.id} title={p.description}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
          <Button onClick={syncToHhea} title="Copy ascent / descent / line gap into the OS/2 typo values and the win values">
            Sync typo &amp; win to hhea
          </Button>
        </Stack>
        <Hint>{VERTICAL_PRESETS.find((p) => p.id === presetId)?.description ?? 'A preset sets ascent, descent and line gap as fractions of the em and syncs typo and win to them.'}</Hint>
      </Section>

      <Section title="hhea (macOS, Linux, browsers)">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          {field('ascent', 'Ascent', led, 'positive, above the baseline')}
          {field('descent', 'Descent', led, 'negative, below the baseline')}
          {field('lineGap', 'Line gap', led, 'extra space between lines')}
        </Box>
      </Section>

      <Section title="OS/2 typographic (typo)">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          {field('typoAscender', 'Typo ascender')}
          {field('typoDescender', 'Typo descender', false, 'zero or negative')}
          {field('typoLineGap', 'Typo line gap')}
        </Box>
        <FormControlLabel
          control={<Checkbox size="small" checked={draft.useTypoMetrics} onChange={(e) => setDraft({ ...draft, useTypoMetrics: e.target.checked })} />}
          label="Use typo metrics (OS/2 fsSelection bit 7)"
          slotProps={{ typography: { variant: 'body2' } }}
        />
      </Section>

      <Section title="OS/2 Windows (clipping limits)">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
          {field('winAscent', 'Win ascent', false, 'positive, usWinAscent')}
          {field('winDescent', 'Win descent', false, 'positive distance below the baseline, usWinDescent')}
        </Box>
      </Section>

      {check.errors.length > 0 && (
        <Alert severity="error" role="alert">
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {check.errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </Box>
        </Alert>
      )}
      {check.errors.length === 0 && check.warnings.length > 0 && (
        <Alert severity="warning" aria-label="Metric warnings">
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {check.warnings.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </Box>
        </Alert>
      )}
    </AppDialog>
  );
}
