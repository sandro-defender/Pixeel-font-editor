/** All modal dialogs (MUI). Each one reads the store, validates input, and applies one undoable edit. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import { useStore, type ModalState, type TransferMode } from '../state/store';
import type { FontDoc, FontMeta, LedMatrixSpec, Slot } from '../core/types';
import { createNewFont, computePixelLayout } from '../core/fontFactory';
import { applyLedMatrix, checkMetrics, makeEmptyGlyph, resizeGrid, setGlyphBitmap } from '../state/glyphActions';
import {
  DEFAULT_LED_CELL_UNITS,
  LED_PRESETS,
  asciiToBitmap,
  bitmapToAscii,
  bitmapToColumnHex,
  checkLedFont,
  columnBytesToBitmap,
  defaultLedSpec,
  ledLabel,
  normalizeLedSpec,
} from '../core/ledMatrix';
import { parseCodePointInput, describeCodePoint, isValidCodePoint, charFromCodePoint } from '../core/unicodeNames';
import { validateMeta, deriveMetaFields } from '../core/metadata';
import { applyLicense, buildLicenseTxt, LICENSING_DISCLAIMER, type LicenseMode } from '../core/license';
import { buildOFLLicense, OFL_VERSION_NOTE } from '../core/oflText';
import { exportFont } from '../services/exportService';
import { DEFAULT_EXPORT_OPTIONS, type ExportReport } from '../core/fontCodec';
import { downloadArrayBuffer, downloadBlob } from '../services/persistence';
import { releaseSourcesNotIn } from '../services/fileActions';
import { findConflicts, sourceAfterMove, transferGlyphs, type CollisionStrategy, type MetricsMode } from '../core/transfer';
import { rasterizeContours, defaultRasterizeFrame } from '../core/rasterize';
import { Bitmap, MAX_GRID } from '../core/bitmap';
import { paintBitmap, toRgba } from '../render/bitmapCanvas';
import { AppDialog, Hint, SegmentedControl, Section } from './ui';

/** Numeric field that keeps a number (NaN when empty) and reports it. */
function NumberField(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  helper?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <TextField
      label={props.label}
      type="number"
      value={Number.isNaN(props.value) ? '' : props.value}
      onChange={(e) => props.onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      slotProps={{ htmlInput: { min: props.min, max: props.max, 'aria-label': props.ariaLabel ?? props.label } }}
      helperText={props.helper}
      disabled={props.disabled}
    />
  );
}

/** Dialogs look their target up on every render: the glyph or font may vanish while the dialog is open. */
function useGlyph(slot: Slot, glyphId: string) {
  const doc = useStore((s) => s.fonts[slot]);
  const glyph = doc?.glyphs.find((g) => g.id === glyphId) ?? null;
  return { doc, glyph };
}

function GoneNotice(props: { onClose: () => void; title: string }) {
  return (
    <AppDialog title={props.title} onClose={props.onClose} actions={<Button onClick={props.onClose}>Close</Button>}>
      <Alert severity="warning">This item no longer exists (it may have been deleted or the font replaced).</Alert>
    </AppDialog>
  );
}

/** Colour used for bitmap previews on the given theme. */
function inkFor(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#e8eaf2' : '#1c2030';
}

// ---------------------------------------------------------------------------
// New font
// ---------------------------------------------------------------------------
export function NewFontDialog() {
  const closeModal = useStore((s) => s.closeModal);
  const toast = useStore((s) => s.toast);
  const askConfirm = useStore((s) => s.askConfirm);
  const fontsFree = useStore((s) => s.fonts.A === null || s.fonts.B === null);

  const [family, setFamily] = useState('My Pixel Font');
  const [style, setStyle] = useState('Regular');
  const [kind, setKind] = useState<'standard' | 'led'>('standard');
  const [preset, setPreset] = useState<'8' | '16' | '32' | 'custom'>('16');
  const [cw, setCw] = useState(16);
  const [ch, setCh] = useState(16);
  const [ledPreset, setLedPreset] = useState<string>('5x7');
  const [ledCols, setLedCols] = useState(5);
  const [ledRows, setLedRows] = useState(7);
  const [ledSpacing, setLedSpacing] = useState(1);
  const [ledCell, setLedCell] = useState(DEFAULT_LED_CELL_UNITS);
  const [ledBelow, setLedBelow] = useState(0);

  const applyLedPreset = (id: string) => {
    setLedPreset(id);
    const p = LED_PRESETS.find((x) => x.id === id);
    if (p) {
      setLedCols(p.cols);
      setLedRows(p.rows);
      setLedBelow(0);
    }
  };

  let ledError: string | null = null;
  let ledSpec: LedMatrixSpec | null = null;
  try {
    ledSpec = normalizeLedSpec({ rows: ledRows, cols: ledCols, spacing: ledSpacing, cellUnits: ledCell, descentRows: ledBelow });
  } catch (err) {
    ledError = err instanceof Error ? err.message : String(err);
  }

  const gridW = preset === 'custom' ? cw : Number(preset);
  const gridH = preset === 'custom' ? ch : Number(preset);
  const standardError = gridW < 2 || gridH < 2 || gridW > MAX_GRID || gridH > MAX_GRID ? `Grid dimensions must be between 2 and ${MAX_GRID}.` : null;
  const error = kind === 'led' ? ledError : standardError;

  const create = async () => {
    if (error) return;
    const state = useStore.getState();
    const doc: FontDoc =
      kind === 'led' && ledSpec
        ? createNewFont({ familyName: family, styleName: style, gridWidth: ledSpec.cols, gridHeight: ledSpec.rows, led: ledSpec })
        : createNewFont({ familyName: family, styleName: style, gridWidth: gridW, gridHeight: gridH });
    // when both workspaces are full, the target is the active one: confirm before replacing it
    const slot: Slot = state.fonts.A === null ? 'A' : state.fonts.B === null ? 'B' : state.active;
    const existing = state.fonts[slot];
    if (existing) {
      const ok = await askConfirm({
        title: `Replace Font ${slot}?`,
        message: `Font ${slot} (“${existing.meta.fontFamily}”) will be replaced by the new font.${state.dirty[slot] ? ' It has unsaved changes that will be lost.' : ''}`,
        confirmLabel: 'Replace font',
        danger: true,
      });
      if (!ok) return;
    }
    const before = [useStore.getState().fonts.A, useStore.getState().fonts.B];
    useStore.getState().loadFont(slot, doc, null);
    releaseSourcesNotIn(before, [useStore.getState().fonts.A, useStore.getState().fonts.B]);
    useStore.getState().setActive(slot);
    toast(
      'success',
      kind === 'led' && ledSpec
        ? `Created LED matrix font “${family}” (${ledSpec.cols}×${ledSpec.rows}) in Font ${slot}.`
        : `Created “${family}” in Font ${slot}.`,
    );
    closeModal();
  };

  return (
    <AppDialog
      title="Create a new pixel font"
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={create} disabled={!!error}>
            {fontsFree ? 'Create font' : 'Create & replace'}
          </Button>
        </>
      }
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="Family name" value={family} onChange={(e) => setFamily(e.target.value)} />
        <TextField label="Style / subfamily" value={style} onChange={(e) => setStyle(e.target.value)} />
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle2">Font type</Typography>
        <SegmentedControl
          ariaLabel="Font type"
          value={kind}
          options={[
            { value: 'standard', label: 'Standard pixel font', tip: 'Free-form pixel grids (default)' },
            { value: 'led', label: 'LED matrix font (exact pixels)', tip: 'Fixed-height pixel grid with whole-pixel metrics' },
          ]}
          onChange={setKind}
        />
        <Hint>Standard: free-form pixel grids. LED matrix: every glyph is exactly on one fixed pixel grid (for LED panels, displays and bitmap-style text).</Hint>
      </Stack>

      {kind === 'standard' && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">Pixel grid size</Typography>
          <SegmentedControl
            ariaLabel="Grid preset"
            value={preset}
            options={[
              { value: '8', label: '8 × 8' },
              { value: '16', label: '16 × 16' },
              { value: '32', label: '32 × 32' },
              { value: 'custom', label: 'Custom…' },
            ]}
            onChange={setPreset}
          />
          {preset === 'custom' && (
            <Stack direction="row" spacing={2}>
              <NumberField label={`Grid width (2–${MAX_GRID})`} value={cw} onChange={setCw} min={2} max={MAX_GRID} />
              <NumberField label={`Grid height (2–${MAX_GRID})`} value={ch} onChange={setCh} min={2} max={MAX_GRID} />
            </Stack>
          )}
          {standardError ? (
            <Alert severity="error">{standardError}</Alert>
          ) : (
            <Hint>
              Each glyph starts as a grid of this size (resizable per glyph later). The em square becomes {computePixelLayout(gridW, gridH).unitsPerEm} units with the baseline about
              20% from the bottom.
            </Hint>
          )}
        </Stack>
      )}

      {kind === 'led' && (
        <Stack spacing={2}>
          <Typography variant="subtitle2">LED matrix</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Preset" value={ledPreset} onChange={(e) => applyLedPreset(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'LED matrix preset' } }}>
              {LED_PRESETS.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label}
                </MenuItem>
              ))}
              <MenuItem value="custom">Custom…</MenuItem>
            </TextField>
            <NumberField label="Units per LED pixel" value={ledCell} onChange={setLedCell} min={1} helper="Each lit pixel is exactly this many font units square." />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <NumberField
              label="Matrix height (rows)"
              value={ledRows}
              onChange={(n) => {
                setLedPreset('custom');
                setLedRows(n);
              }}
              min={1}
              max={MAX_GRID}
              helper="Every glyph is this tall"
            />
            <NumberField
              label="Default width (columns)"
              value={ledCols}
              onChange={(n) => {
                setLedPreset('custom');
                setLedCols(n);
              }}
              min={1}
              max={MAX_GRID}
              helper="Glyph width; can vary per glyph"
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <NumberField label="Letter spacing (px)" value={ledSpacing} onChange={setLedSpacing} min={0} max={32} helper="Blank pixel columns after each glyph" />
            <NumberField label="Rows below baseline" value={ledBelow} onChange={setLedBelow} min={0} helper="0 = no descenders" />
          </Stack>
          {ledError ? (
            <Alert severity="error">{ledError}</Alert>
          ) : (
            ledSpec && (
              <Hint>
                Em size {ledSpec.rows * ledSpec.cellUnits} units ({ledSpec.rows} × {ledSpec.cellUnits}). Glyph advance = (width + {ledSpec.spacing}) × {ledSpec.cellUnits}.
              </Hint>
            )
          )}
        </Stack>
      )}
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Add glyph
// ---------------------------------------------------------------------------
export function AddGlyphDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const toast = useStore((s) => s.toast);
  const doc = useStore((s) => s.fonts[props.slot]);
  const [input, setInput] = useState('');
  const [name, setName] = useState('');

  if (!doc) return <GoneNotice title="Add a glyph" onClose={closeModal} />;

  const trimmedInput = input.trim();
  const cp = trimmedInput === '' ? null : parseCodePointInput(trimmedInput);
  const inputError =
    trimmedInput !== '' && cp === null
      ? 'Not a single character or code point (try a character, U+10D0, 0x41 or 65).'
      : cp !== null && !isValidCodePoint(cp)
        ? 'Invalid Unicode code point.'
        : cp !== null && doc.glyphs.some((g) => g.unicode === cp)
          ? `${describeCodePoint(cp)} already has a glyph. Select it instead, or unassign it first.`
          : null;
  const trimmedName = name.trim();
  const nameError = trimmedName && doc.glyphs.some((g) => g.name === trimmedName) ? `A glyph named “${trimmedName}” already exists.` : null;
  const error = inputError ?? nameError;

  const add = () => {
    const current = useStore.getState().fonts[props.slot];
    if (!current || error) return;
    const glyph = makeEmptyGlyph(current, cp, trimmedName || undefined);
    if (commit(props.slot, 'Add glyph', (d) => ({ ...d, glyphs: [...d.glyphs, glyph] }))) {
      selectGlyph(props.slot, glyph.id);
      toast('success', cp === null ? 'Added an unmapped glyph.' : `Added glyph for ${describeCodePoint(cp)}.`);
    }
    closeModal();
  };

  return (
    <AppDialog
      title="Add a glyph"
      onClose={closeModal}
      actions={
        <>
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={add} disabled={!!error}>
            Add glyph
          </Button>
        </>
      }
    >
      <TextField
        label="Character or code point"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        autoFocus
        error={!!inputError}
        helperText={inputError ?? (cp !== null ? describeCodePoint(cp) : 'A single character, U+10D0, 0x41 or 65. Leave empty for an unmapped glyph.')}
      />
      <TextField label="Glyph name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="auto" error={!!nameError} helperText={nameError ?? ' '} />
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Metadata + license
// ---------------------------------------------------------------------------
const META_FIELDS: Array<{ key: keyof FontMeta; label: string; area?: boolean; hint?: string }> = [
  { key: 'fontFamily', label: 'Family name *' },
  { key: 'fontSubFamily', label: 'Style / subfamily *' },
  { key: 'fullName', label: 'Full name', hint: 'Auto-derived if empty' },
  { key: 'postScriptName', label: 'PostScript name', hint: 'Auto-generated if empty/invalid' },
  { key: 'version', label: 'Version' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'designer', label: 'Author / designer' },
  { key: 'description', label: 'Description', area: true },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'urlOfFontVendor', label: 'Vendor URL' },
  { key: 'urlOfFontDesigner', label: 'Designer URL' },
];

export function MetadataDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const doc = useStore((s) => s.fonts[props.slot]);

  const [meta, setMeta] = useState<FontMeta | null>(() => (doc ? { ...doc.meta } : null));
  const [metrics, setMetrics] = useState(() => (doc ? { ...doc.metrics } : null));
  const [licMode, setLicMode] = useState<LicenseMode>(doc?.meta.licence ? 'imported' : 'custom');
  const [customText, setCustomText] = useState(doc?.meta.licence ?? '');
  const [customUrl, setCustomUrl] = useState(doc?.meta.urlOfLicence ?? '');
  const [oflHolder, setOflHolder] = useState(doc ? doc.meta.designer || doc.meta.fontFamily : '');
  const [oflYear, setOflYear] = useState(String(new Date().getFullYear()));
  const [oflReserved, setOflReserved] = useState(doc?.meta.fontFamily ?? '');

  if (!doc || !meta || !metrics) return <GoneNotice title="Font info" onClose={closeModal} />;

  const licenceChoice = { mode: licMode, customText, customUrl, oflCopyrightHolder: oflHolder, oflYear, oflReservedNames: oflReserved };
  const derived = deriveMetaFields(meta);
  const validation = validateMeta(derived);

  // LED fonts derive their metrics from the matrix; for the rest, reject NaN and out-of-range values
  let metricsError: string | null = null;
  let checkedMetrics: FontDoc['metrics'] | null = null;
  if (doc.ledMatrix) {
    checkedMetrics = doc.metrics;
  } else {
    try {
      checkedMetrics = checkMetrics(metrics);
    } catch (err) {
      metricsError = err instanceof Error ? err.message : String(err);
    }
  }
  const error = validation.errors.length ? validation.errors.join(' ') : metricsError;

  const save = () => {
    if (error || !checkedMetrics) {
      toast('error', error ?? 'Check the metrics.');
      return;
    }
    const licensed = applyLicense(derived, licenceChoice);
    const target = checkedMetrics;
    if (commit(props.slot, 'Edit metadata', (d) => ({ ...d, meta: licensed, metrics: target }))) {
      toast('success', 'Font metadata updated.');
    }
    closeModal();
  };

  const licenseFile = () => {
    downloadBlob(new Blob([buildLicenseTxt(applyLicense(derived, licenceChoice), licenceChoice)], { type: 'text/plain' }), 'LICENSE.txt');
  };

  return (
    <AppDialog
      title={`Font info & license — Font ${props.slot}`}
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button onClick={licenseFile} startIcon={<DownloadIcon />}>
            LICENSE.txt
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={save} disabled={!!error}>
            Save metadata
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        {META_FIELDS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            multiline={!!f.area}
            minRows={f.area ? 3 : undefined}
            value={(meta[f.key] as string) ?? ''}
            onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })}
            helperText={f.hint}
            sx={f.area ? { gridColumn: { sm: '1 / -1' } } : undefined}
          />
        ))}
      </Box>
      {validation.errors.length > 0 && <Alert severity="error">{validation.errors.join(' ')}</Alert>}

      <Section title="Global metrics">
        {doc.ledMatrix && <Hint>LED matrix font: metrics are set by the matrix (rows × units per pixel). Change them in “LED matrix…”.</Hint>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
          <NumberField label="Units per em" value={metrics.unitsPerEm} onChange={(n) => setMetrics({ ...metrics, unitsPerEm: n })} disabled={!!doc.ledMatrix} helper="Edit with care on imported fonts" />
          <NumberField label="Ascent (positive)" value={metrics.ascent} onChange={(n) => setMetrics({ ...metrics, ascent: n })} disabled={!!doc.ledMatrix} />
          <NumberField label="Descent (negative)" value={metrics.descent} onChange={(n) => setMetrics({ ...metrics, descent: n })} disabled={!!doc.ledMatrix} />
          <NumberField label="Line gap" value={metrics.lineGap} onChange={(n) => setMetrics({ ...metrics, lineGap: n })} disabled={!!doc.ledMatrix} />
        </Box>
        {metricsError && <Alert severity="error">{metricsError}</Alert>}
      </Section>

      <Section title="License">
        <SegmentedControl
          ariaLabel="License mode"
          value={licMode}
          options={[
            { value: 'imported', label: 'Keep imported', tip: 'Preserve whatever license the imported font carries (default)' },
            { value: 'custom', label: 'Custom text', tip: 'Write your own license text' },
            { value: 'ofl', label: 'SIL OFL template', tip: 'Generate a SIL Open Font License 1.1 document' },
          ]}
          onChange={setLicMode}
        />
        {licMode === 'imported' && (
          <Hint>
            Current license fields are left exactly as imported: {doc.meta.licence ? `“${doc.meta.licence.slice(0, 120)}${doc.meta.licence.length > 120 ? '…' : ''}”` : '(none found)'}
          </Hint>
        )}
        {licMode === 'custom' && (
          <Stack spacing={2}>
            <TextField label="License text" multiline minRows={4} value={customText} onChange={(e) => setCustomText(e.target.value)} />
            <TextField label="License URL" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
          </Stack>
        )}
        {licMode === 'ofl' && (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Copyright holder" value={oflHolder} onChange={(e) => setOflHolder(e.target.value)} />
              <TextField label="Year" value={oflYear} onChange={(e) => setOflYear(e.target.value)} />
              <TextField label="Reserved font name(s)" value={oflReserved} onChange={(e) => setOflReserved(e.target.value)} helperText="Optional, per OFL clause 3" />
            </Stack>
            <Accordion disableGutters variant="outlined">
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2">{OFL_VERSION_NOTE} — full text</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', m: 0, fontSize: 12, color: 'text.secondary' }}>
                  {buildOFLLicense({ copyrightHolder: oflHolder, year: oflYear, reservedFontNames: oflReserved })}
                </Box>
              </AccordionDetails>
            </Accordion>
          </Stack>
        )}
        <Alert severity="warning">{LICENSING_DISCLAIMER}</Alert>
      </Section>

      {validation.warnings.length > 0 && <Hint>⚠ {validation.warnings.join(' · ')}</Hint>}
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const STANDARD_TABLES = ['glyf', 'loca', 'head', 'hhea', 'hmtx', 'maxp', 'cmap', 'name', 'post', 'OS/2'];
const HINTING_TABLES = ['cvt ', 'cvt', 'fpgm', 'prep', 'gasp'];
const KERNING_TABLES = ['GPOS', 'kern', 'kerx'];

export function ExportDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const setBusy = useStore((s) => s.setBusy);
  const doc = useStore((s) => s.fonts[props.slot]);
  const [preserveHinting, setPreserveHinting] = useState(true);
  const [preserveKerning, setPreserveKerning] = useState(true);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const src = doc?.source ?? null;
  const droppedPreview = useMemo(() => {
    if (!src) return [];
    return src.tables.filter(
      (t) => !STANDARD_TABLES.includes(t) && !(preserveHinting && HINTING_TABLES.includes(t)) && !(preserveKerning && KERNING_TABLES.includes(t)),
    );
  }, [src, preserveHinting, preserveKerning]);

  if (!doc) return <GoneNotice title="Export TTF" onClose={closeModal} />;

  const run = async () => {
    setError(null);
    setReport(null);
    setBuffer(null);
    setRunning(true);
    setBusy('Exporting TTF (building, writing, re-parsing to validate)…');
    try {
      const out = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS, preserveHinting, preserveKerning });
      if (!mounted.current) return;
      setBuffer(out.buffer);
      setReport(out.report);
      if (!out.report.validation?.ok) setError('Validation reported problems — review the checks below before using this file.');
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setRunning(false);
      setBusy(null);
    }
  };

  const psName = doc.meta.postScriptName || 'font';

  return (
    <AppDialog
      title={`Export TTF — Font ${props.slot} (${doc.meta.fontFamily})`}
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button onClick={() => downloadBlob(new Blob([buildLicenseTxt(doc.meta)], { type: 'text/plain' }), 'LICENSE.txt')} disabled={!buffer} title="Also ship a license file with your font">
            LICENSE.txt
          </Button>
          {buffer && (
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadArrayBuffer(buffer, `${psName}.ttf`)}>
              Download {psName}.ttf ({Math.ceil(buffer.byteLength / 1024)} KB)
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Close</Button>
          <Button variant="contained" color="primary" onClick={run} disabled={running}>
            {buffer ? 'Re-export' : 'Export & validate'}
          </Button>
        </>
      }
    >
      {src && src.format !== 'created' && (
        <Section title={`Source: ${src.fileName}`}>
          <Stack sx={{ flexWrap: 'wrap' }} direction="row" spacing={1} useFlexGap>
            <Chip label={`${src.numGlyphs} glyphs`} size="small" />
            {src.hasComposites && <Chip label="composite glyphs — preserved when unedited" size="small" />}
            {src.hasHinting && <Chip label="hinting present" size="small" />}
            {src.hasKerning && <Chip label="kerning/GPOS present" size="small" />}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControlLabel
              control={<Checkbox checked={preserveHinting} onChange={(e) => setPreserveHinting(e.target.checked)} disabled={!src.hasHinting} />}
              label="Preserve hinting (cvt/fpgm/prep/gasp + per-glyph instructions of unedited glyphs)"
            />
            <FormControlLabel
              control={<Checkbox checked={preserveKerning} onChange={(e) => setPreserveKerning(e.target.checked)} disabled={!src.hasKerning} />}
              label="Preserve kerning tables (GPOS/kern/kerx)"
            />
          </Stack>
          {droppedPreview.length > 0 && (
            <Alert severity="warning">
              Tables that <strong>cannot</strong> be preserved and will be dropped: {droppedPreview.map((t) => t.trim()).join(', ')}. This includes e.g. GSUB shaping, variable-font
              data (fvar/gvar), colour layers, and DSIG signatures. The exported file remains a valid standalone TTF; this is a simplified export for those tables.
            </Alert>
          )}
        </Section>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {report && (
        <Section title="Export report">
          <Table size="small" aria-label="Export report">
            <TableBody>
              <TableRow>
                <TableCell component="th" scope="row">File size</TableCell>
                <TableCell>{report.bytes.toLocaleString()} bytes</TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" scope="row">Tables written</TableCell>
                <TableCell>{report.writtenTables.map((t) => t.trim()).join(', ')}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" scope="row">Preserved from source</TableCell>
                <TableCell>{report.preservedTables.length ? report.preservedTables.map((t) => t.trim()).join(', ') : '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" scope="row">Dropped</TableCell>
                <TableCell>{report.droppedTables.length ? report.droppedTables.map((t) => t.trim()).join(', ') : 'none'}</TableCell>
              </TableRow>
              {report.notes.length > 0 && (
                <TableRow>
                  <TableCell component="th" scope="row">Notes</TableCell>
                  <TableCell>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {report.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {report.validation && (
            <>
              <Typography variant="subtitle2">Validation (re-parse of the exported file)</Typography>
              <Table size="small" aria-label="Validation checks">
                <TableBody>
                  {report.validation.checks.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell>
                        {c.ok ? '✅' : '❌'} {c.name}
                      </TableCell>
                      <TableCell>{c.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {report.validation.ok ? (
                <Alert severity="success">The exported file re-parsed cleanly and representative glyphs verified.</Alert>
              ) : (
                <Alert severity="error">Validation failed — inspect the checks above.</Alert>
              )}
            </>
          )}
        </Section>
      )}
      <Hint>Your original uploaded file is never modified or overwritten — export always writes a new file.</Hint>
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Transfer between fonts
// ---------------------------------------------------------------------------
type TransferSummary = {
  doc: FontDoc;
  copied: number;
  skipped: number;
  replaced: number;
  reassigned: number;
  flattenedComposites: number;
  notes: string[];
  copiedSourceIds: string[];
};

export function TransferDialog(props: { from: Slot; glyphIds: string[]; mode?: TransferMode }) {
  const closeModal = useStore((s) => s.closeModal);
  const commitLinked = useStore((s) => s.commitLinked);
  const setMultiSelect = useStore((s) => s.setMultiSelect);
  const toast = useStore((s) => s.toast);
  const srcDoc = useStore((s) => s.fonts[props.from]);
  const to: Slot = props.from === 'A' ? 'B' : 'A';
  const dstDoc = useStore((s) => s.fonts[to]);

  const [mode, setMode] = useState<TransferMode>(props.mode ?? 'copy');
  const [metricsMode, setMetricsMode] = useState<MetricsMode>('preserve');
  const [scaleUpm, setScaleUpm] = useState(true);
  const [collision, setCollision] = useState<CollisionStrategy>('replace');
  const [reassign, setReassign] = useState<Record<string, string>>({});
  const [confirmStep, setConfirmStep] = useState(false);
  const [conflictResolution, setConflictResolution] = useState<Record<string, CollisionStrategy>>({});

  const glyphs = useMemo(() => (srcDoc ? srcDoc.glyphs.filter((g) => props.glyphIds.includes(g.id)) : []), [srcDoc, props.glyphIds]);
  const conflicts = useMemo(() => (srcDoc && dstDoc ? findConflicts(srcDoc, dstDoc, props.glyphIds) : []), [srcDoc, dstDoc, props.glyphIds]);

  if (!srcDoc) return <GoneNotice title="Transfer glyphs" onClose={closeModal} />;
  if (!dstDoc) {
    return (
      <AppDialog title={`Transfer to Font ${to}`} onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning">Font {to} is empty. Create or open a font there first, then transfer again.</Alert>
      </AppDialog>
    );
  }
  if (glyphs.length === 0) return <GoneNotice title="Transfer glyphs" onClose={closeModal} />;

  const toLed = !!dstDoc.ledMatrix;
  const perGlyphStrategy = (id: string): CollisionStrategy => conflictResolution[id] ?? collision;

  // invalid reassignment code points block the transfer instead of being unmapped silently
  const reassignErrors: Record<string, string> = {};
  for (const c of conflicts) {
    const raw = (reassign[c.glyphId] ?? '').trim();
    if (perGlyphStrategy(c.glyphId) === 'reassign' && raw !== '' && parseCodePointInput(raw) === null) {
      reassignErrors[c.glyphId] = 'Not a valid code point.';
    }
  }
  const hasReassignError = Object.keys(reassignErrors).length > 0;

  /** Runs the transfer against the destination doc (called inside the undoable commit). */
  const runTransfer = (dst: FontDoc): TransferSummary => {
    const groups = new Map<CollisionStrategy, string[]>();
    for (const g of glyphs) {
      const hasConflict = conflicts.some((c) => c.glyphId === g.id);
      const strat = hasConflict ? perGlyphStrategy(g.id) : 'skip';
      groups.set(strat, [...(groups.get(strat) ?? []), g.id]);
    }
    const reassignments: Record<string, number | null> = {};
    for (const [id, raw] of Object.entries(reassign)) {
      const t = raw.trim();
      reassignments[id] = t === '' ? null : parseCodePointInput(t);
    }
    let next = dst;
    const total: TransferSummary = { doc: dst, copied: 0, skipped: 0, replaced: 0, reassigned: 0, flattenedComposites: 0, notes: [], copiedSourceIds: [] };
    for (const [strat, ids] of groups) {
      if (!ids.length) continue;
      // transferGlyphs takes one strategy per call, so run once per strategy group
      const res = transferGlyphs(srcDoc, next, ids, { metricsMode, scaleByUpm: scaleUpm, collision: strat, reassignments });
      next = res.doc;
      total.copied += res.copied;
      total.skipped += res.skipped;
      total.replaced += res.replaced;
      total.reassigned += res.reassigned;
      total.flattenedComposites += res.flattenedComposites;
      total.notes.push(...res.notes);
      total.copiedSourceIds.push(...res.copiedSourceIds);
    }
    total.doc = next;
    return total;
  };

  const apply = () => {
    if (hasReassignError) return;
    let summary: TransferSummary | null = null;
    const edits: Array<{ slot: Slot; updater: (d: FontDoc) => FontDoc }> = [
      {
        slot: to,
        updater: (d) => {
          summary = runTransfer(d);
          return summary.doc;
        },
      },
    ];
    if (mode === 'move') {
      // removal uses the ids that were really copied; skipped glyphs stay in the source
      edits.push({ slot: props.from, updater: (d) => sourceAfterMove(d, (summary as TransferSummary | null)?.copiedSourceIds ?? []) });
    }
    const ok = commitLinked(mode === 'move' ? 'Move glyphs' : 'Copy glyphs', edits);
    const res = summary as TransferSummary | null;
    if (!ok || !res) {
      toast('warning', 'Nothing was transferred.');
      closeModal();
      return;
    }
    if (mode === 'move') setMultiSelect(props.from, []);
    const verb = mode === 'move' ? 'moved' : 'copied';
    toast(
      'success',
      `Transfer complete: ${res.copied} ${verb}, ${res.replaced} replaced, ${res.reassigned} reassigned, ${res.skipped} skipped.` +
        (res.flattenedComposites ? ` ${res.flattenedComposites} composite(s) flattened.` : '') +
        ` Undo with Ctrl+Z restores ${mode === 'move' ? `Font ${props.from} and Font ${to}` : `Font ${to}`}.`,
    );
    res.notes.forEach((n) => toast('warning', n));
    closeModal();
  };

  const ratio = (dstDoc.metrics.unitsPerEm / srcDoc.metrics.unitsPerEm).toFixed(3);

  return (
    <AppDialog
      title={`${mode === 'move' ? 'Move' : 'Copy'} ${glyphs.length} glyph(s): Font ${props.from} → Font ${to}`}
      onClose={closeModal}
      maxWidth="md"
      actions={
        !confirmStep ? (
          <>
            <Button onClick={closeModal}>Cancel</Button>
            <Button variant="contained" color="primary" onClick={() => setConfirmStep(true)} disabled={hasReassignError}>
              Review & confirm…
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setConfirmStep(false)}>← Back</Button>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" color="primary" onClick={apply} disabled={hasReassignError}>
              {mode === 'move' ? `Move ${glyphs.length} glyph(s)` : `Copy ${glyphs.length} glyph(s)`} into Font {to}
            </Button>
          </>
        )
      }
    >
      <Hint>
        Source “{srcDoc.meta.fontFamily}” (upm {srcDoc.metrics.unitsPerEm}) → destination “{dstDoc.meta.fontFamily}” (upm {dstDoc.metrics.unitsPerEm}). Glyphs are matched by identity,
        never by glyph index.
      </Hint>

      <Section title="What happens to the glyphs">
        <SegmentedControl
          ariaLabel="Transfer mode"
          value={mode}
          options={[
            { value: 'copy', label: 'Copy', tip: 'Keep the glyphs in both fonts' },
            { value: 'move', label: 'Move', tip: `Copy into Font ${to}, then remove them from Font ${props.from}` },
          ]}
          onChange={(m) => {
            setMode(m);
            setConfirmStep(false);
          }}
        />
        {mode === 'move' && (
          <Hint>
            Moved glyphs are removed from Font {props.from}. “.notdef” always stays. Glyphs skipped because of a collision stay in Font {props.from}. One undo restores both fonts.
          </Hint>
        )}
      </Section>

      <Section title="Options">
        <SegmentedControl
          ariaLabel="Metrics handling"
          value={metricsMode}
          options={[
            { value: 'preserve', label: 'Preserve source metrics', tip: 'Copy advance width (scaled if proportional scaling is on)' },
            { value: 'adapt', label: 'Adapt to destination', tip: 'Recompute advance from the copied outline extents' },
          ]}
          onChange={setMetricsMode}
        />
        <FormControlLabel
          control={<Checkbox checked={scaleUpm} onChange={(e) => setScaleUpm(e.target.checked)} />}
          label={`Proportional scaling by units-per-em (×${ratio})`}
        />
        <Hint>
          Copied glyphs align on the destination baseline; pixel grids keep their cell layout (only their cell size in units is scaled).
          {toLed && (
            <>
              {' '}
              <strong>Font {to} is an LED matrix font:</strong> glyphs are snapped onto its exact pixel grid (vector outlines are rasterized) and metrics become whole pixels.
            </>
          )}
        </Hint>
      </Section>

      {conflicts.length > 0 && (
        <Section
          title={`Unicode collisions (${conflicts.length})`}
          action={
            <SegmentedControl
              ariaLabel="Collision strategy"
              value={collision}
              options={[
                { value: 'replace', label: 'Replace', tip: 'Unmap the existing destination glyph and map the incoming one' },
                { value: 'skip', label: 'Skip', tip: 'Do not copy colliding glyphs' },
                { value: 'reassign', label: 'Reassign', tip: 'Assign a different (or no) code point to the incoming glyph' },
              ]}
              onChange={setCollision}
            />
          }
        >
          {conflicts.map((c) => {
            const strat = perGlyphStrategy(c.glyphId);
            const dstGlyph = dstDoc.glyphs.find((g) => g.id === c.existingId);
            return (
              <Stack sx={{ alignItems: { sm: 'center' } }} key={c.glyphId} direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Typography sx={{ minWidth: 28, fontWeight: 700 }}>{charFromCodePoint(c.unicode)}</Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  U+{c.unicode.toString(16).toUpperCase()} — destination has “{dstGlyph?.name}”
                </Typography>
                <TextField
                  select
                  value={strat}
                  onChange={(e) => setConflictResolution({ ...conflictResolution, [c.glyphId]: e.target.value as CollisionStrategy })}
                  slotProps={{ htmlInput: { 'aria-label': `Strategy for ${c.glyphName}` } }}
                  sx={{ minWidth: 130 }}
                >
                  <MenuItem value="replace">replace</MenuItem>
                  <MenuItem value="skip">skip</MenuItem>
                  <MenuItem value="reassign">reassign</MenuItem>
                </TextField>
                {strat === 'reassign' && (
                  <TextField
                    placeholder="new U+ or empty = unmapped"
                    value={reassign[c.glyphId] ?? ''}
                    onChange={(e) => setReassign({ ...reassign, [c.glyphId]: e.target.value })}
                    slotProps={{ htmlInput: { 'aria-label': `New code point for ${c.glyphName}` } }}
                    error={!!reassignErrors[c.glyphId]}
                    helperText={reassignErrors[c.glyphId] ?? ' '}
                    sx={{ minWidth: 200 }}
                  />
                )}
              </Stack>
            );
          })}
        </Section>
      )}

      <Section title={`Glyphs to ${mode === 'move' ? 'move' : 'copy'}`}>
        <Stack sx={{ flexWrap: 'wrap' }} direction="row" spacing={0.75} useFlexGap>
          {glyphs.slice(0, 40).map((g) => (
            <Chip key={g.id} size="small" label={`${g.unicode !== null ? charFromCodePoint(g.unicode) : '·'} ${g.name}`} title={g.name} />
          ))}
          {glyphs.length > 40 && <Chip size="small" label={`+${glyphs.length - 40} more`} />}
        </Stack>
      </Section>

      {confirmStep && (
        <Alert severity={mode === 'move' ? 'warning' : 'info'}>
          This will {mode === 'move' ? `move glyphs from Font ${props.from} into Font ${to}` : `copy glyphs into Font ${to}`},{' '}
          {metricsMode === 'preserve' ? 'preserve source metrics' : 'adapt metrics to the destination'}
          {scaleUpm ? ', scale proportionally to units-per-em' : ''}, and resolve collisions by “{conflicts.length ? 'per-glyph choices above' : collision}”.{' '}
          {mode === 'move' ? 'Undo (Ctrl+Z) restores both fonts in one step.' : `The operation is a single undo step in Font ${to}.`}
        </Alert>
      )}
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Resize pixel grid
// ---------------------------------------------------------------------------
export function ResizeGridDialog(props: { slot: Slot; glyphId: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const { doc, glyph } = useGlyph(props.slot, props.glyphId);
  const pixel = glyph?.pixel ?? null;
  const led = doc?.ledMatrix ?? null;
  const [w, setW] = useState(pixel?.width ?? 16);
  const [h, setH] = useState(led ? led.rows : (pixel?.height ?? 16));
  const [mode, setMode] = useState<'crop' | 'center' | 'resample'>('crop');

  if (!doc || !glyph || !pixel) return <GoneNotice title="Resize pixel grid" onClose={closeModal} />;

  const sizeError = w < 1 || h < 1 || w > MAX_GRID || h > MAX_GRID ? `Grid size must be 1–${MAX_GRID}.` : null;

  const apply = () => {
    if (sizeError) {
      toast('error', sizeError);
      return;
    }
    if (commit(props.slot, 'Resize grid', (d) => resizeGrid(d, props.glyphId, w, h, mode))) {
      const how = mode === 'crop' ? 'crop/pad bottom-left' : mode === 'center' ? 'crop/pad centred' : 'nearest-neighbour resample';
      toast('success', `Grid resized to ${w}×${h} (${how}).`);
    }
    closeModal();
  };

  return (
    <AppDialog
      title={`Resize pixel grid — ${glyph.name}`}
      onClose={closeModal}
      actions={
        <>
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={apply} disabled={!!sizeError}>
            Apply
          </Button>
        </>
      }
    >
      <Hint>
        Current: {pixel.width}×{pixel.height}. Baseline sits {pixel.baselineRow} rows from the bottom; placement in font units stays anchored so the glyph does not silently shift.
      </Hint>
      {led && (
        <Alert severity="info">
          LED matrix font: the height is fixed at {led.rows} pixels. Only the width changes, and the advance follows it (width + {led.spacing} px spacing).
        </Alert>
      )}
      <Stack direction="row" spacing={2}>
        <NumberField label="New width" value={w} onChange={setW} min={1} max={MAX_GRID} />
        <NumberField label="New height" value={h} onChange={setH} min={1} max={MAX_GRID} disabled={!!led} />
      </Stack>
      {sizeError && <Alert severity="error">{sizeError}</Alert>}
      <Stack spacing={1}>
        <Typography variant="subtitle2">How to fit the existing drawing</Typography>
        <SegmentedControl
          ariaLabel="Resize mode"
          value={mode}
          options={[
            { value: 'crop', label: 'Crop / pad (baseline-anchored)', tip: 'Keep the bottom-left region, pad new space with empty pixels' },
            { value: 'center', label: 'Crop / pad (centred)', tip: 'Crop or pad equally on all sides' },
            { value: 'resample', label: 'Resample (nearest)', tip: 'Scale the bitmap to the new size; can alias but keeps proportions' },
          ]}
          onChange={setMode}
        />
        <Hint>Crop/pad never distorts; resample scales with nearest-neighbour.</Hint>
      </Stack>
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Rasterize vector glyph → pixels
// ---------------------------------------------------------------------------
export function RasterizeDialog(props: { slot: Slot; glyphId: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const theme = useStore((s) => s.theme);
  const { doc, glyph } = useGlyph(props.slot, props.glyphId);
  const contours = glyph?.contours ?? [];
  const [gridH, setGridH] = useState(16);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const frame = useMemo(() => (doc ? defaultRasterizeFrame(contours, doc.metrics, Math.max(4, Math.min(MAX_GRID, gridH))) : null), [contours, doc, gridH]);
  const raster = useMemo(() => (frame ? rasterizeContours(contours, frame) : null), [contours, frame]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !raster) return;
    const bm = Bitmap.fromB64(raster.width, raster.height, raster.cellsB64);
    paintBitmap(canvas, bm, 6, { on: toRgba(inkFor(theme)), off: null });
  }, [raster, theme]);

  if (!doc || !glyph || !raster) return <GoneNotice title="Convert to pixel grid" onClose={closeModal} />;

  const apply = () => {
    const ok = commit(props.slot, 'Rasterize to pixels', (d) => ({
      ...d,
      glyphs: d.glyphs.map((g) =>
        g.id === props.glyphId
          ? {
              ...g,
              pixel: { width: raster.width, height: raster.height, cellsB64: raster.cellsB64, unitsPerCell: raster.unitsPerCell, offsetX: raster.offsetX, baselineRow: raster.baselineRow },
              kind: 'pixel' as const,
              sourceContours: g.contours.length ? g.contours.map((c) => c.map((p) => ({ ...p }))) : g.sourceContours,
              edited: true,
            }
          : g,
      ),
    }));
    if (ok) {
      toast('success', 'Glyph converted to a pixel grid. The original outline is kept — use “Revert to original outline” any time before export replaces it.');
    }
    closeModal();
  };

  return (
    <AppDialog
      title={`Convert to pixel grid — ${glyph.name}`}
      onClose={closeModal}
      actions={
        <>
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={apply}>
            Create editable pixel grid
          </Button>
        </>
      }
    >
      <Alert severity="warning">
        Rasterization <strong>loses vector detail</strong>: curves become cell-sized steps. This only prepares an editable grid — the original outline is kept until you export the edited
        pixel version (explicit), and you can revert at any time.
      </Alert>
      <Stack spacing={1}>
        <Typography variant="subtitle2" id="raster-height-label">
          Grid height — {gridH} rows across ascent→descent
        </Typography>
        <Slider value={gridH} min={4} max={64} onChange={(_, v) => setGridH(v as number)} aria-labelledby="raster-height-label" />
      </Stack>
      <Stack sx={{ alignItems: 'center' }} direction="row" spacing={2}>
        <Box
          component="canvas"
          ref={previewRef}
          aria-label="Rasterization preview"
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxWidth: '100%', imageRendering: 'pixelated', bgcolor: 'background.default' }}
        />
        <Hint>
          {raster.width}×{raster.height} cells · {raster.unitsPerCell.toFixed(1)} units/cell · baseline row {raster.baselineRow}
        </Hint>
      </Stack>
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Pixel code: text art and LED column bytes
// ---------------------------------------------------------------------------
function PixelPreview(props: { bm: Bitmap | null; theme: 'light' | 'dark' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !props.bm) return;
    const bm = props.bm;
    const cell = Math.max(2, Math.floor(160 / Math.max(bm.width, bm.height)));
    paintBitmap(c, bm, cell, { on: toRgba('#fbbf24'), off: toRgba('#111827') });
  }, [props.bm, props.theme]);
  return <Box component="canvas" ref={ref} aria-label="Glyph preview" sx={{ maxWidth: '100%', imageRendering: 'pixelated', border: 1, borderColor: 'divider', borderRadius: 1 }} />;
}

export function PixelCodeDialog(props: { slot: Slot; glyphId: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const theme = useStore((s) => s.theme);
  const { doc, glyph } = useGlyph(props.slot, props.glyphId);
  const pixel = glyph?.pixel ?? null;
  const led = doc?.ledMatrix ?? null;
  const current = useMemo(() => (pixel ? Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64) : null), [pixel]);
  const [format, setFormat] = useState<'ascii' | 'columns'>('ascii');
  const [text, setText] = useState(() => (current ? bitmapToAscii(current) : ''));
  const requiredRows = led ? led.rows : (pixel?.height ?? 0);

  const parsed = useMemo((): { bitmap: Bitmap | null; warnings: string[]; error: string | null } => {
    try {
      if (format === 'ascii') {
        const r = asciiToBitmap(text);
        if (r.rows !== requiredRows) {
          throw new Error(`Got ${r.rows} row(s); this glyph needs exactly ${requiredRows} rows (${led ? 'LED matrix height' : 'grid height'}).`);
        }
        return { bitmap: r.bitmap, warnings: r.warnings, error: null };
      }
      const r = columnBytesToBitmap(text, requiredRows);
      return { bitmap: r.bitmap, warnings: r.warnings, error: null };
    } catch (err) {
      return { bitmap: null, warnings: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [text, format, requiredRows, led]);

  if (!doc || !glyph || !pixel || !current) return <GoneNotice title="Pixel code" onClose={closeModal} />;

  // switching format keeps the drawing: the last valid parse is re-encoded in the new format
  const switchFormat = (f: 'ascii' | 'columns') => {
    const source = parsed.bitmap ?? current;
    setFormat(f);
    setText(f === 'ascii' ? bitmapToAscii(source) : bitmapToColumnHex(source));
  };

  const apply = () => {
    const bm = parsed.bitmap;
    if (!bm) return;
    if (commit(props.slot, 'Pixel code edit', (d) => setGlyphBitmap(d, props.glyphId, bm))) {
      toast('success', `Updated “${glyph.name}” from ${format === 'ascii' ? 'text art' : 'column bytes'} (${bm.width}×${bm.height}).`);
    }
    closeModal();
  };

  const copyText = () => {
    navigator.clipboard?.writeText(text).then(
      () => toast('success', 'Copied to clipboard.'),
      () => toast('error', 'Clipboard is not available here.'),
    );
  };

  const bm = parsed.bitmap;
  return (
    <AppDialog
      title={`Pixel code — ${glyph.name}`}
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button onClick={copyText}>Copy text</Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={apply} disabled={!bm}>
            Apply to glyph
          </Button>
        </>
      }
    >
      <Hint>
        {led
          ? `LED matrix font: height is fixed at ${led.rows} rows. Width can be any value up to ${MAX_GRID} columns.`
          : `Grid height is ${pixel.height} rows. Width can change; height must match.`}{' '}
        Row order is top to bottom, like the grid as displayed.
      </Hint>
      <SegmentedControl
        ariaLabel="Pixel code format"
        value={format}
        options={[
          { value: 'ascii', label: 'Text art (# on, . off)', tip: 'One line per row; # is lit, . is off' },
          { value: 'columns', label: 'LED column bytes', tip: 'One line per column; 8 rows per byte, bit 0 = top pixel' },
        ]}
        onChange={switchFormat}
      />
      <Stack sx={{ alignItems: 'flex-start' }} direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          multiline
          minRows={6}
          maxRows={18}
          value={text}
          onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Pixel code', spellCheck: false, style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } } }}
          sx={{ flex: 1 }}
        />
        <Stack spacing={0.5} sx={{ minWidth: 180 }}>
          <Typography variant="caption" color="text.secondary">
            Preview {bm ? `${bm.width}×${bm.height}` : ''}
          </Typography>
          <PixelPreview bm={bm} theme={theme} />
        </Stack>
      </Stack>
      {parsed.error && <Alert severity="error">{parsed.error}</Alert>}
      {parsed.warnings.map((w) => (
        <Alert key={w} severity="warning">
          {w}
        </Alert>
      ))}
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// LED matrix settings (font level)
// ---------------------------------------------------------------------------
export function LedMatrixDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const askConfirm = useStore((s) => s.askConfirm);
  const doc = useStore((s) => s.fonts[props.slot]);
  const current = doc?.ledMatrix ?? null;
  const template = useMemo(() => doc?.glyphs.find((g) => g.pixel)?.pixel ?? null, [doc]);
  const initial = useMemo<LedMatrixSpec>(() => {
    if (current) return current;
    if (template) {
      return { rows: template.height, cols: template.width, spacing: 1, cellUnits: Math.max(1, Math.round(template.unitsPerCell)), descentRows: template.baselineRow };
    }
    return defaultLedSpec();
  }, [current, template]);
  const [rows, setRows] = useState(initial.rows);
  const [cols, setCols] = useState(initial.cols);
  const [spacing, setSpacing] = useState(initial.spacing);
  const [cell, setCell] = useState(initial.cellUnits);
  const [below, setBelow] = useState(initial.descentRows);

  if (!doc) return <GoneNotice title="LED matrix" onClose={closeModal} />;

  let spec: LedMatrixSpec | null = null;
  let error: string | null = null;
  try {
    spec = normalizeLedSpec({ rows, cols, spacing, cellUnits: cell, descentRows: below });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const check = current ? checkLedFont(doc) : null;
  const vectorCount = doc.glyphs.filter((g) => !g.pixel && (g.kind === 'vector' || g.kind === 'compound' || g.contours.length > 0)).length;

  const apply = async () => {
    if (!spec) return;
    if (vectorCount > 0) {
      const ok = await askConfirm({
        title: 'Rasterize vector glyphs?',
        message: `${vectorCount} vector glyph(s) will be rasterized onto the LED grid so they match exactly. Their outlines are replaced by pixels. Undo (Ctrl+Z) reverts it.`,
        confirmLabel: 'Rasterize and apply',
        danger: true,
      });
      if (!ok) return;
    }
    const target = spec;
    if (commit(props.slot, current ? 'Change LED matrix' : 'Enable LED matrix', (d) => applyLedMatrix(d, target))) {
      toast('success', `LED matrix ${ledLabel(target)} applied to Font ${props.slot}.`);
    }
    closeModal();
  };

  const turnOff = () => {
    if (commit(props.slot, 'Turn off LED matrix', (d) => applyLedMatrix(d, null))) {
      toast('success', 'LED matrix mode turned off. Glyph grids keep their pixels.');
    }
    closeModal();
  };

  return (
    <AppDialog
      title="LED matrix (exact pixels)"
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          {current && (
            <Button color="error" onClick={turnOff}>
              Turn LED mode off
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={apply} disabled={!spec}>
            {current ? 'Apply changes' : 'Enable LED matrix'}
          </Button>
        </>
      }
    >
      <Hint>
        In LED mode every glyph lives on one pixel grid: each lit pixel is exactly <em>units per pixel</em> font units, offsets and side bearings are whole pixels, and every advance is
        (width + spacing) × units per pixel. This makes the TTF render exactly like the LED panel.
      </Hint>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
        <NumberField label="Matrix height (rows)" value={rows} onChange={setRows} min={1} max={MAX_GRID} ariaLabel="LED rows" />
        <NumberField label="Default width (columns)" value={cols} onChange={setCols} min={1} max={MAX_GRID} ariaLabel="LED columns" />
        <NumberField label="Units per LED pixel" value={cell} onChange={setCell} min={1} helper="Integer. Preset sizes use multiples of 100 for crisp shapes." ariaLabel="Units per LED pixel" />
        <NumberField label="Letter spacing (px)" value={spacing} onChange={setSpacing} min={0} max={32} ariaLabel="LED spacing" />
        <NumberField label="Rows below baseline" value={below} onChange={setBelow} min={0} ariaLabel="LED descent rows" />
        <TextField
          select
          label="Apply preset"
          value=""
          onChange={(e) => {
            const p = LED_PRESETS.find((x) => x.id === e.target.value);
            if (p) {
              setRows(p.rows);
              setCols(p.cols);
            }
          }}
          slotProps={{ htmlInput: { 'aria-label': 'Apply LED preset' } }}
        >
          <MenuItem value="">Choose…</MenuItem>
          {LED_PRESETS.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : (
        spec && (
          <Hint>
            Em size {spec.rows * spec.cellUnits} units · ascent {(spec.rows - spec.descentRows) * spec.cellUnits} · descent {spec.descentRows * spec.cellUnits} · space advance{' '}
            {(Math.max(2, Math.round(spec.cols / 2)) + spec.spacing) * spec.cellUnits}.
          </Hint>
        )
      )}
      <Section title="Status">
        <Typography variant="body2">{current ? `Current: ${ledLabel(current)}` : 'Currently a standard pixel font.'}</Typography>
        {check &&
          (check.errors === 0 ? (
            <Alert severity="success">All glyphs are exact on the LED grid.</Alert>
          ) : (
            <Alert severity="warning">
              {check.errors} error(s):
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {check.issues
                  .filter((i) => i.severity === 'error')
                  .slice(0, 5)
                  .map((i, k) => (
                    <li key={k}>{i.message}</li>
                  ))}
              </ul>
            </Alert>
          ))}
        {vectorCount > 0 && <Alert severity="info">{vectorCount} vector glyph(s) will be rasterized to pixels to match the LED grid. Undo (Ctrl+Z) reverts the change.</Alert>}
      </Section>
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
const SHORTCUTS: Array<[string, string]> = [
  ['Arrow keys', 'Move the keyboard cursor one pixel (the cell is outlined on the canvas). With a selection, arrows nudge the selection instead.'],
  ['Shift + arrows', 'Shift the whole glyph bitmap one pixel in that direction (the cursor stays put).'],
  ['Space / Enter', 'Act at the cursor with the current tool (pencil/line/rect paints, eraser clears, fill floods from the cursor).'],
  ['Shift + Space', 'Erase at the cursor, whatever the current tool.'],
  ['T', 'Toggle the pixel under the cursor (on ↔ off).'],
  ['B / P · E · F · L · R', 'Pencil · Eraser · Flood fill · Line · Rectangle'],
  ['M / S', 'Select & move (marquee)'],
  ['Ctrl+A', 'Select the whole grid'],
  ['Ctrl+C / X / V', 'Copy / cut / paste. Paste puts the top-left corner at the cursor.'],
  ['Esc', 'Place a floating selection back onto the grid (or cancel an in-progress stroke or marquee).'],
  ['Delete / Backspace', 'Delete a floating selection, or clear the whole grid when nothing is selected.'],
  ['I · G · + / −', 'Invert · toggle grid lines · zoom'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo (one step per edit; a move across fonts undoes in both fonts)'],
  ['Ctrl+S', 'Save the project file'],
];

export function HelpDialog() {
  const closeModal = useStore((s) => s.closeModal);
  return (
    <AppDialog
      title="Pixeel help & shortcuts"
      onClose={closeModal}
      maxWidth="md"
      actions={
        <Button variant="contained" color="primary" onClick={closeModal}>
          Got it
        </Button>
      }
    >
      <Section title="Keyboard shortcuts">
        <Table size="small" aria-label="Keyboard shortcuts">
          <TableBody>
            {SHORTCUTS.map(([k, v]) => (
              <TableRow key={k}>
                <TableCell sx={{ whiteSpace: 'nowrap', width: 200 }}>
                  <Chip label={k} size="small" variant="outlined" sx={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }} />
                </TableCell>
                <TableCell>{v}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Hint>
          Shortcuts are ignored while you type in a text field or while a dialog is open. <strong>Mouse:</strong> left button paints with the tool; <strong>right-button drag erases</strong>{' '}
          with any paint tool. Hover shows the pixel coordinate in the status line. Rulers number the columns (top) and rows from the top (left).
        </Hint>
      </Section>
      <Section title="LED matrix fonts">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Create one with <em>File → New font → LED matrix</em>, or enable it later from the <em>Font</em> menu (<em>LED matrix…</em>).
          </li>
          <li>Every glyph has the same height (rows). Each pixel is exactly the same number of font units (an integer), so the TTF renders the same pixels as the panel.</li>
          <li>Glyph origins and advances sit on whole-pixel boundaries; advance = (width + spacing) × units per pixel. Export checks report any glyph that breaks these rules.</li>
          <li>Vector glyphs are rasterized (snapped) to the grid.</li>
        </ul>
      </Section>
      <Section title="Transfer between fonts A and B">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            Select glyphs, then <em>Copy</em> or <em>Move</em> to the other font. Move copies first, then removes the glyphs from the source. <code>.notdef</code> is never removed.
          </li>
          <li>Drag glyph cards onto the A or B tab to transfer them quickly.</li>
          <li>Glyphs that collide with an existing code point can be replaced, skipped, or reassigned. A single undo reverts a transfer in both fonts.</li>
        </ul>
      </Section>
      <Section title="How it works">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <strong>Pixel fonts:</strong> you draw on a grid; export traces filled pixels into sharp TrueType outlines (holes become counters). No bitmap strikes are embedded — the TTF
            contains real scalable outlines.
          </li>
          <li>
            <strong>Imported fonts:</strong> original vector outlines are preserved until you edit a glyph. Edited glyphs lose their hinting instructions (reported at export). Composite
            glyphs are preserved while unedited and can be flattened explicitly.
          </li>
          <li>
            <strong>Safety:</strong> your uploaded files are never modified; recovery snapshots are saved to IndexedDB as you work; project files are JSON you control.
          </li>
        </ul>
      </Section>
    </AppDialog>
  );
}

// ---------------------------------------------------------------------------
// Host: renders the dialog for the store's modal state
// ---------------------------------------------------------------------------
export function ModalHost() {
  const modal: ModalState = useStore((s) => s.modal);
  switch (modal.type) {
    case 'newFont':
      return <NewFontDialog />;
    case 'metadata':
      return <MetadataDialog slot={modal.slot} />;
    case 'export':
      return <ExportDialog slot={modal.slot} />;
    case 'transfer':
      return <TransferDialog from={modal.from} glyphIds={modal.glyphIds} mode={modal.mode} />;
    case 'resizeGrid':
      return <ResizeGridDialog slot={modal.slot} glyphId={modal.glyphId} />;
    case 'rasterize':
      return <RasterizeDialog slot={modal.slot} glyphId={modal.glyphId} />;
    case 'addGlyph':
      return <AddGlyphDialog slot={modal.slot} />;
    case 'pixelCode':
      return <PixelCodeDialog slot={modal.slot} glyphId={modal.glyphId} />;
    case 'ledMatrix':
      return <LedMatrixDialog slot={modal.slot} />;
    case 'help':
      return <HelpDialog />;
    default:
      return null;
  }
}
