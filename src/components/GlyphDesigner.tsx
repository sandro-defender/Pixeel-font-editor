/** Local-font glyph helper: sample a character, style it, then place it in the pixel editor. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { Bitmap } from '../core/bitmap';
import {
  bitmapToSvgPath,
  DEFAULT_GLYPH_DESIGN_STYLE,
  rasterizeCharacterTemplate,
  styleGlyphTemplate,
  type GlyphDesignStyle,
} from '../core/glyphDesigner';
import type { GlyphDoc, Slot } from '../core/types';
import {
  charFromCodePoint,
  describeCodePoint,
  GEORGIAN_SCRIPT_RANGES,
  isValidCodePoint,
  parseCodePointInput,
} from '../core/unicodeNames';
import { loadCatalogReferenceFont, loadReferenceFontCatalog, loadUploadedReferenceFont, type ReferenceFontDefinition } from '../services/referenceFonts';
import { setGlyphBitmap } from '../state/glyphActions';
import { useStore } from '../state/store';
import { AppDialog, Hint, Section } from './ui';

interface FontChoice {
  id: string;
  name: string;
  kind: 'system' | 'catalog' | 'upload';
  definition?: ReferenceFontDefinition;
  uploadId?: string;
  bytes?: ArrayBuffer;
}

const SYSTEM_FONT: FontChoice = { id: 'system', name: 'System sans-serif', kind: 'system' };

const asciiPoints = (text: string): number[] => Array.from(text, (ch) => ch.codePointAt(0)!);
const TEMPLATE_SETS = [
  { id: 'latin-upper', label: 'Latin uppercase · A–Z', points: asciiPoints('ABCDEFGHIJKLMNOPQRSTUVWXYZ') },
  { id: 'latin-lower', label: 'Latin lowercase · a–z', points: asciiPoints('abcdefghijklmnopqrstuvwxyz') },
  { id: 'digits', label: 'Numbers · 0–9', points: asciiPoints('0123456789') },
  ...GEORGIAN_SCRIPT_RANGES.map((script) => ({
    id: script.id,
    label: `Georgian · ${script.label}`,
    points: script.points,
  })),
];

function setForCodePoint(codePoint: number | null): string {
  if (codePoint === null) return 'georgian-mkhedruli';
  return TEMPLATE_SETS.find((set) => set.points.includes(codePoint))?.id ?? 'georgian-mkhedruli';
}

function familyFontSpec(family: string): string {
  if (family === 'sans-serif') return '400 48px sans-serif';
  return `400 48px "${family.replace(/[\\"]/g, '\\$&')}"`;
}

function DesignSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2">{props.label}</Typography>
        <Chip size="small" label={`${props.value}${props.suffix}`} />
      </Stack>
      <Slider
        aria-label={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        valueLabelDisplay="auto"
        onChange={(_, value) => props.onChange(Array.isArray(value) ? value[0] : value)}
      />
    </Box>
  );
}

function previewPath(bitmap: Bitmap): string {
  return bitmapToSvgPath(bitmap);
}

export function GlyphDesignerDialog(props: { slot: Slot; glyphId: string }) {
  const doc = useStore((s) => s.fonts[props.slot]);
  const glyph = doc?.glyphs.find((g) => g.id === props.glyphId) ?? null;
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const theme = useStore((s) => s.theme);

  const [templateInput, setTemplateInput] = useState(() => (glyph?.unicode !== null && glyph?.unicode !== undefined ? charFromCodePoint(glyph.unicode) : 'A'));
  const [templateSetId, setTemplateSetId] = useState(() => setForCodePoint(glyph?.unicode ?? null));
  const [style, setStyle] = useState<GlyphDesignStyle>({ ...DEFAULT_GLYPH_DESIGN_STYLE });
  const [fontChoices, setFontChoices] = useState<FontChoice[]>([SYSTEM_FONT]);
  const [fontChoiceId, setFontChoiceId] = useState('system');
  const [fontFamily, setFontFamily] = useState('sans-serif');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [fontLoading, setFontLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [baseTemplate, setBaseTemplate] = useState<Bitmap | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pixel = glyph?.pixel ?? null;
  const templateCodePoint = parseCodePointInput(templateInput);
  const templateCharacter = templateCodePoint !== null && isValidCodePoint(templateCodePoint) ? charFromCodePoint(templateCodePoint) : '';
  const currentTemplateSet = TEMPLATE_SETS.find((set) => set.id === templateSetId) ?? TEMPLATE_SETS[0];
  const selectedFont = fontChoices.find((choice) => choice.id === fontChoiceId) ?? SYSTEM_FONT;

  useEffect(() => {
    let current = true;
    setCatalogLoading(true);
    void loadReferenceFontCatalog()
      .then((catalog) => {
        if (!current) return;
        const choices: FontChoice[] = [
          SYSTEM_FONT,
          ...catalog.map((definition) => ({
            id: `catalog:${definition.id}`,
            name: definition.name,
            kind: 'catalog' as const,
            definition,
          })),
        ];
        setFontChoices((existing) => [...choices, ...existing.filter((choice) => choice.kind === 'upload')]);
        setFontChoiceId((selected) => (selected === 'system' && catalog.length ? `catalog:${catalog[0].id}` : selected));
        setCatalogError(catalog.length ? null : 'No catalog fonts yet. Add TTF/OTF files to public/fonts and run npm run fonts:catalog (the next build indexes them automatically), or load a file below.');
      })
      .catch((error) => {
        if (!current) return;
        setCatalogError(`The reference-font catalog could not be read. You can still use System sans-serif or load a font file. ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (current) setCatalogLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    setFontError(null);
    if (selectedFont.kind === 'system') {
      setFontFamily('sans-serif');
      setFontLoading(false);
      return () => {
        current = false;
      };
    }

    setFontLoading(true);
    const load = selectedFont.kind === 'catalog' && selectedFont.definition
      ? loadCatalogReferenceFont(selectedFont.definition)
      : selectedFont.kind === 'upload' && selectedFont.bytes && selectedFont.uploadId
        ? loadUploadedReferenceFont(selectedFont.uploadId, selectedFont.bytes)
        : Promise.reject(new Error('The selected reference font is not available.'));
    void load
      .then((family) => {
        if (current) setFontFamily(family);
      })
      .catch((error) => {
        if (current) setFontError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (current) setFontLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selectedFont]);

  useEffect(() => {
    let current = true;
    if (!pixel || !templateCharacter || fontLoading || !!fontError) {
      setBaseTemplate(null);
      setTemplateError(templateCharacter ? null : 'Choose one character (or enter a Unicode code point).');
      setTemplateLoading(false);
      return () => {
        current = false;
      };
    }

    setTemplateLoading(true);
    setTemplateError(null);
    setBaseTemplate(null);
    void (async () => {
      try {
        if (typeof document !== 'undefined' && document.fonts?.load) {
          await document.fonts.load(familyFontSpec(fontFamily), templateCharacter);
        }
        const bitmap = rasterizeCharacterTemplate(
          templateCharacter,
          fontFamily,
          pixel.width,
          pixel.height,
          pixel.baselineRow,
        );
        if (current) setBaseTemplate(bitmap);
      } catch (error) {
        if (current) setTemplateError(error instanceof Error ? error.message : String(error));
      } finally {
        if (current) setTemplateLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [fontFamily, fontLoading, fontError, pixel?.width, pixel?.height, pixel?.baselineRow, templateCharacter]);

  const preview = useMemo(
    () => (baseTemplate && pixel ? styleGlyphTemplate(baseTemplate, pixel.baselineRow, style) : null),
    [baseTemplate, pixel?.baselineRow, style],
  );
  const path = useMemo(() => (preview ? previewPath(preview) : ''), [preview]);
  const characterError = templateInput.trim() !== '' && templateCodePoint === null;

  const chooseTemplate = (codePoint: number) => {
    setTemplateInput(charFromCodePoint(codePoint));
  };

  const updateStyle = (key: keyof GlyphDesignStyle, value: number) => {
    setStyle((current) => ({ ...current, [key]: value }));
  };

  const loadUploadedFont = async (file: File) => {
    if (!/\.(ttf|otf)$/i.test(file.name)) {
      setFontError('Choose a .ttf or .otf font file.');
      return;
    }
    setFontLoading(true);
    setFontError(null);
    try {
      const bytes = await file.arrayBuffer();
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const choice: FontChoice = {
        id: `upload:${uploadId}`,
        name: `${file.name} · this session`,
        kind: 'upload',
        uploadId,
        bytes,
      };
      setFontChoices((choices) => [...choices.filter((item) => item.kind !== 'upload'), choice]);
      setFontChoiceId(choice.id);
    } catch (error) {
      setFontError(`Could not read that font file: ${error instanceof Error ? error.message : String(error)}`);
      setFontLoading(false);
    }
  };

  const applyDesign = () => {
    if (!doc || !glyph || !preview) return;
    const changed = commit(props.slot, 'Apply glyph design', (current) => setGlyphBitmap(current, glyph.id, preview));
    if (changed) {
      toast('success', `Placed ${templateCharacter} from ${selectedFont.name} into “${glyph.name}”. Undo is available.`);
      closeModal();
    }
  };

  if (!doc || !glyph) {
    return (
      <AppDialog title="Glyph designer" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="warning">This glyph no longer exists (it may have been deleted or the font replaced).</Alert>
      </AppDialog>
    );
  }
  if (!pixel) {
    return (
      <AppDialog title="Glyph designer" onClose={closeModal} actions={<Button onClick={closeModal}>Close</Button>}>
        <Alert severity="info">Create or convert this glyph to a pixel grid first, then open the designer from the pixel toolbar.</Alert>
      </AppDialog>
    );
  }

  return (
    <AppDialog
      title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><AutoFixHighIcon color="primary" /><span>Glyph designer</span></Stack>}
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button onClick={closeModal}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AutoFixHighIcon />}
            onClick={applyDesign}
            disabled={!preview || templateLoading || fontLoading || !!fontError}
          >
            Place in pixel window
          </Button>
        </>
      }
    >
      <Hint>
        Use a character from a reference font as your starting shape. The preview is local and editable; nothing is sent to an AI service or uploaded.
      </Hint>

      <Section title="1 · Choose a reference font and character">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            select
            label="Reference font"
            value={fontChoiceId}
            onChange={(event) => setFontChoiceId(event.target.value)}
            sx={{ flex: 1 }}
            disabled={catalogLoading && fontChoices.length === 1}
          >
            {fontChoices.map((choice) => (
              <MenuItem key={choice.id} value={choice.id}>{choice.name}</MenuItem>
            ))}
          </TextField>
          <Button startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()} sx={{ minHeight: 40, whiteSpace: 'nowrap' }}>
            Add font file…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            hidden
            aria-label="Add reference font file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void loadUploadedFont(file);
            }}
          />
        </Stack>
        {catalogError && <Alert severity="info">{catalogError}</Alert>}
        {fontError && <Alert severity="error">{fontError}</Alert>}
        <TextField
          label="Template character or code point"
          value={templateInput}
          onChange={(event) => setTemplateInput(event.target.value)}
          error={characterError}
          helperText={characterError ? 'Enter one character, U+10D0, 0x41 or 65.' : templateCodePoint !== null ? describeCodePoint(templateCodePoint) : 'Choose a letter or number below, or type/paste one (including Georgian).'}
          slotProps={{ htmlInput: { 'aria-label': 'Template character or code point' } }}
        />
        <TextField
          select
          label="Browse template set"
          value={templateSetId}
          onChange={(event) => setTemplateSetId(event.target.value)}
        >
          {TEMPLATE_SETS.map((set) => <MenuItem key={set.id} value={set.id}>{set.label}</MenuItem>)}
        </TextField>
        <Box aria-label="Character templates" role="group" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 0.5, maxHeight: 132, overflowY: 'auto', p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {currentTemplateSet.points.map((codePoint) => {
            const character = charFromCodePoint(codePoint);
            const selected = templateCodePoint === codePoint;
            return (
              <ButtonBase
                key={codePoint}
                aria-label={`Use ${character} template, ${describeCodePoint(codePoint)}`}
                aria-pressed={selected}
                onClick={() => chooseTemplate(codePoint)}
                sx={{
                  minHeight: 34,
                  borderRadius: 1,
                  border: 1,
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? 'action.selected' : 'background.paper',
                  fontSize: 20,
                  fontFamily: fontFamily === 'sans-serif' ? 'sans-serif' : `"${fontFamily}"`,
                  '&:hover': { borderColor: 'secondary.main', bgcolor: 'action.hover' },
                }}
              >
                {character}
              </ButtonBase>
            );
          })}
        </Box>
        <Hint>
          Georgian sets include all assigned letters in Mkhedruli, Mtavruli, Asomtavruli and Nuskhuri, including historic letters. If a character is missing in the chosen font, switch fonts and check the preview.
        </Hint>
      </Section>

      <Section title="2 · Shape it">
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {[
            { label: 'Regular', values: DEFAULT_GLYPH_DESIGN_STYLE },
            { label: 'Bold', values: { ...DEFAULT_GLYPH_DESIGN_STYLE, weight: 1 } },
            { label: 'Condensed', values: { ...DEFAULT_GLYPH_DESIGN_STYLE, width: 75 } },
            { label: 'Italic', values: { ...DEFAULT_GLYPH_DESIGN_STYLE, slant: 12 } },
            { label: 'Tall', values: { ...DEFAULT_GLYPH_DESIGN_STYLE, height: 120 } },
          ].map((preset) => (
            <Button key={preset.label} onClick={() => setStyle({ ...preset.values })} aria-label={`Apply ${preset.label} style preset`}>
              {preset.label}
            </Button>
          ))}
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3, rowGap: 1.5 }}>
          <DesignSlider label="Width" value={style.width} min={50} max={150} step={5} suffix="%" onChange={(value) => updateStyle('width', value)} />
          <DesignSlider label="Height" value={style.height} min={65} max={140} step={5} suffix="%" onChange={(value) => updateStyle('height', value)} />
          <DesignSlider label="Stroke weight" value={style.weight} min={0} max={3} step={1} suffix=" px" onChange={(value) => updateStyle('weight', value)} />
          <DesignSlider label="Slant" value={style.slant} min={-20} max={20} step={1} suffix="°" onChange={(value) => updateStyle('slant', value)} />
          <DesignSlider label="Raise / lower" value={style.verticalShift} min={-Math.min(4, pixel.height - 1)} max={Math.min(4, pixel.height - 1)} step={1} suffix=" px" onChange={(value) => updateStyle('verticalShift', value)} />
        </Box>
      </Section>

      <Section title="3 · Preview and place">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <Paper sx={{ p: 1, bgcolor: 'background.default', display: 'grid', placeItems: 'center', width: { xs: 190, sm: 220 }, height: { xs: 190, sm: 220 }, flexShrink: 0 }}>
            {preview ? (
              <Box
                component="svg"
                role="img"
                aria-label="Generated pixel glyph preview"
                viewBox={`0 0 ${preview.width} ${preview.height}`}
                sx={{ width: '100%', height: '100%', color: 'text.primary', shapeRendering: 'crispEdges' }}
              >
                <rect width={preview.width} height={preview.height} fill={theme === 'dark' ? '#1d2029' : '#ffffff'} />
                <path d={path} fill={theme === 'dark' ? '#e8eaf2' : '#1c2030'} />
              </Box>
            ) : (
              <Typography color="text.secondary" align="center" variant="body2">
                {fontLoading || templateLoading || catalogLoading ? 'Preparing preview…' : 'Your design preview appears here.'}
              </Typography>
            )}
          </Paper>
          <Stack spacing={1} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {glyph.unicode !== null ? `Place into ${charFromCodePoint(glyph.unicode)} · ${glyph.name}` : `Place into ${glyph.name}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Source: {templateCharacter || '—'} · {selectedFont.name} · grid {pixel.width}×{pixel.height}
            </Typography>
            {preview && <Chip color="primary" label={`${preview.count()} lit pixels · ${preview.width}×${preview.height}`} sx={{ alignSelf: 'flex-start' }} />}
            {templateError && <Alert severity="warning">{templateError}</Alert>}
            <Hint>Applying creates one undoable edit. The selected glyph keeps its Unicode assignment and grid metrics, and you can continue drawing on the pixel canvas immediately.</Hint>
          </Stack>
        </Stack>
      </Section>
    </AppDialog>
  );
}
