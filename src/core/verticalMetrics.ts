/**
 * Vertical metrics: hhea ascent / descent / lineGap plus the OS/2 typo and win
 * values, presets for common proportions, validation and the font's glyph
 * extent (to warn about clipping).
 */
import type { Contour, FontDoc, FontMetrics, GlyphDoc } from './types';
import { contourBounds } from './contours';

/** All eight vertical values with defaults filled in. */
export interface EffectiveVertical {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  typoAscender: number;
  typoDescender: number;
  typoLineGap: number;
  winAscent: number;
  winDescent: number;
  useTypoMetrics: boolean;
}

export function effectiveVertical(m: FontMetrics): EffectiveVertical {
  return {
    unitsPerEm: m.unitsPerEm,
    ascent: m.ascent,
    descent: m.descent,
    lineGap: m.lineGap,
    typoAscender: m.typoAscender ?? m.ascent,
    typoDescender: m.typoDescender ?? m.descent,
    typoLineGap: m.typoLineGap ?? m.lineGap,
    winAscent: m.winAscent ?? Math.max(m.ascent, 0),
    winDescent: m.winDescent ?? Math.max(-m.descent, 0),
    useTypoMetrics: !!m.useTypoMetrics,
  };
}

/** Distance between two lines of text in the default (hhea) layout. */
export const lineHeight = (m: Pick<FontMetrics, 'ascent' | 'descent' | 'lineGap'>): number => m.ascent - m.descent + m.lineGap;

export interface VerticalPreset {
  id: string;
  label: string;
  description: string;
  /** fractions of the em */
  ascent: number;
  descent: number;
  lineGap: number;
}

export const VERTICAL_PRESETS: VerticalPreset[] = [
  { id: 'tight', label: 'Tight 80 / 20', description: 'Ascent 0.80 em, descent 0.20 em, no gap — line height 1.0 em', ascent: 0.8, descent: -0.2, lineGap: 0 },
  { id: 'pixel', label: 'Pixel font 75 / 25', description: 'Ascent 0.75 em, descent 0.25 em — baseline on a whole pixel row of a 4-row-per-descent grid', ascent: 0.75, descent: -0.25, lineGap: 0 },
  { id: 'arial', label: 'Arial-like', description: 'Ascent 0.905, descent 0.212, gap 0.033 em', ascent: 0.905, descent: -0.212, lineGap: 0.033 },
  { id: 'roboto', label: 'Roboto-like', description: 'Ascent 0.927, descent 0.244, no gap', ascent: 0.927, descent: -0.244, lineGap: 0 },
  { id: 'times', label: 'Times-like', description: 'Ascent 0.891, descent 0.216, gap 0.042 em', ascent: 0.891, descent: -0.216, lineGap: 0.042 },
  { id: 'airy', label: 'Airy 1.4 line', description: 'Ascent 0.95, descent 0.25, gap 0.20 em — line height 1.4 em', ascent: 0.95, descent: -0.25, lineGap: 0.2 },
];

/** Apply a preset to the font's em size. typo and win values follow the new hhea values. */
export function applyVerticalPreset(m: FontMetrics, preset: VerticalPreset): FontMetrics {
  const ascent = Math.round(m.unitsPerEm * preset.ascent);
  const descent = Math.round(m.unitsPerEm * preset.descent);
  const lineGap = Math.round(m.unitsPerEm * preset.lineGap);
  return syncOs2ToHhea({ ...m, ascent, descent, lineGap });
}

/** Make the OS/2 typo and win values follow ascent / descent / lineGap. */
export function syncOs2ToHhea(m: FontMetrics): FontMetrics {
  return { ...m, typoAscender: m.ascent, typoDescender: m.descent, typoLineGap: m.lineGap, winAscent: Math.max(m.ascent, 0), winDescent: Math.max(-m.descent, 0) };
}

export interface GlyphExtent {
  yMax: number;
  yMin: number;
}

/** Highest and lowest point of any glyph in the font (null for a font with no outlines). */
export function fontExtent(doc: FontDoc, contoursOf: (g: GlyphDoc) => Contour[]): GlyphExtent | null {
  let yMax = -Infinity;
  let yMin = Infinity;
  for (const g of doc.glyphs) {
    if (g.kind === 'empty') continue;
    const bb = contourBounds(contoursOf(g));
    if (!bb) continue;
    if (bb.yMax > yMax) yMax = bb.yMax;
    if (bb.yMin < yMin) yMin = bb.yMin;
  }
  return yMax === -Infinity ? null : { yMax, yMin };
}

export interface VerticalCheck {
  errors: string[];
  warnings: string[];
}

const I16 = 32767;
const U16 = 65535;

/** Check a set of metrics. `extent` (optional) enables clipping warnings. */
export function validateVerticalMetrics(m: FontMetrics, extent?: GlyphExtent | null): VerticalCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const e = effectiveVertical(m);
  const nums: Array<[string, number]> = [
    ['Units per em', e.unitsPerEm],
    ['Ascent', e.ascent],
    ['Descent', e.descent],
    ['Line gap', e.lineGap],
    ['Typo ascender', e.typoAscender],
    ['Typo descender', e.typoDescender],
    ['Typo line gap', e.typoLineGap],
    ['Win ascent', e.winAscent],
    ['Win descent', e.winDescent],
  ];
  const bad = nums.filter(([, v]) => !Number.isFinite(v));
  if (bad.length) {
    errors.push(`${bad.map(([n]) => n).join(', ')} must be ${bad.length === 1 ? 'a number' : 'numbers'}.`);
    return { errors, warnings };
  }
  const fractional = nums.filter(([, v]) => !Number.isInteger(v));
  if (fractional.length) errors.push(`${fractional.map(([n]) => n).join(', ')} must be whole numbers of font units.`);
  if (e.unitsPerEm < 16 || e.unitsPerEm > 16384) errors.push('Units per em must be 16–16384.');
  if (e.ascent <= 0) errors.push('Ascent must be positive (above the baseline).');
  if (e.descent > 0) errors.push('Descent must be negative (below the baseline), or zero for a font without descenders.');
  if (e.lineGap < 0) errors.push('Line gap cannot be negative.');
  if (e.typoAscender <= 0) errors.push('Typo ascender must be positive.');
  if (e.typoDescender > 0) errors.push('Typo descender must be zero or negative.');
  if (e.typoLineGap < 0) errors.push('Typo line gap cannot be negative.');
  if (e.winAscent < 0 || e.winAscent > U16) errors.push(`Win ascent must be 0–${U16}.`);
  if (e.winDescent < 0 || e.winDescent > U16) errors.push(`Win descent must be 0–${U16} (a positive distance below the baseline).`);
  for (const [name, v] of nums.slice(1, 7)) {
    if (Math.abs(v) > I16) errors.push(`${name} must be within ±${I16}.`);
  }
  if (errors.length) return { errors, warnings };

  if (e.descent === 0) warnings.push('Descent is 0: nothing is reserved below the baseline, so descenders would touch the next line.');
  const height = lineHeight(m);
  if (height < e.unitsPerEm * 0.8) warnings.push(`Line height (${height}) is less than 0.8 em — lines of text may overlap.`);
  if (height > e.unitsPerEm * 2.2) warnings.push(`Line height (${height}) is more than 2.2 em — lines will look very far apart.`);
  const typoHeight = e.typoAscender - e.typoDescender + e.typoLineGap;
  if (Math.abs(typoHeight - height) > e.unitsPerEm * 0.05) {
    warnings.push(`hhea line height (${height}) and typo line height (${typoHeight}) differ: macOS and Linux use hhea, Windows uses the typo values when “Use typo metrics” is on — text may be spaced differently per platform.`);
  }
  if (e.winAscent + e.winDescent < e.ascent - e.descent) warnings.push('Win ascent + descent is smaller than hhea ascent − descent: text may be clipped on Windows.');
  if (extent) {
    if (extent.yMax > e.winAscent) warnings.push(`Win ascent (${e.winAscent}) is below the tallest glyph (${Math.round(extent.yMax)}): the tops of glyphs may be clipped on Windows.`);
    if (-extent.yMin > e.winDescent) warnings.push(`Win descent (${e.winDescent}) is less than the deepest glyph (${Math.round(-extent.yMin)}): descenders may be clipped on Windows.`);
    if (extent.yMax > e.ascent) warnings.push(`The tallest glyph (${Math.round(extent.yMax)}) rises above the ascent (${e.ascent}).`);
    if (extent.yMin < e.descent) warnings.push(`The deepest glyph (${Math.round(extent.yMin)}) sinks below the descent (${e.descent}).`);
  }
  return { errors, warnings };
}

/** Rounded copy of `m`; throws the first validation error. */
export function checkVerticalMetrics(m: FontMetrics): FontMetrics {
  const rounded: FontMetrics = { ...m };
  for (const key of ['unitsPerEm', 'ascent', 'descent', 'lineGap', 'typoAscender', 'typoDescender', 'typoLineGap', 'winAscent', 'winDescent'] as const) {
    const v = rounded[key];
    if (v !== undefined && Number.isFinite(v)) rounded[key] = Math.round(v);
  }
  const { errors } = validateVerticalMetrics(rounded);
  if (errors.length) throw new Error(errors[0]);
  return rounded;
}
