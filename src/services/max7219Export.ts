/**
 * ESPHome MAX7219 Matrix Clock font package generator.
 *
 * Produces a ZIP that drops into sandro-defender/Esphome-Max7219-Matrix-Clock
 * following its font-package convention (see module docs at the bottom of the
 * service). The compiled TTF is measured the way ESPHome / FreeType will
 * rasterize it at size 8, bpp=1, and every glyph is placed the way the clock
 * firmware draws it (text centred on the ink of '0'). Failing checks come with
 * a plain-language diagnosis; `max7219DebugLog.ts` turns all of it into a
 * paste-friendly debug log.
 */
import JSZip from 'jszip';
import { Font } from 'fonteditor-core';
import type { FontDoc } from '../core/types';
import { buildLicenseTxt } from '../core/license';
import { downloadBlob } from './persistence';
import { exportFont } from './exportService';
import { DEFAULT_EXPORT_OPTIONS, listTables, unicodeCmapOf } from '../core/fontCodec';
import { makePostScriptName } from '../core/metadata';
import { rasterizeCoverage, coverageToBitmap } from '../core/rasterize';
import { MAX_GRID } from '../core/bitmap';
import { sha256Hex } from '../core/sha256';

// ---------------------------------------------------------------------------
// Identifier derivation
// ---------------------------------------------------------------------------

export const MAX7219_DEFAULT_GLYPHS = '0123456789:.-/%!?+ აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ';
export const MAX7219_PIXEL_SIZE = 8;
export const MAX7219_BPP = 1;

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Derive a default display label from the font family name. */
export function defaultLabel(familyName: string): string {
  const cleaned = familyName.trim();
  if (!cleaned) return 'MAX7219 Font';
  return /max\s*7219/i.test(cleaned) ? cleaned : `MAX7219 ${cleaned}`;
}

/** Convert arbitrary text to kebab-case slug. */
export function slugify(input: string): string {
  let s = (input || '').trim().toLowerCase();
  try {
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    /* environments without normalization continue without */
  }
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'font';
}

export function toSlugUnderscores(slug: string): string {
  return slug.replace(/-/g, '_');
}

export function firmwareIdFromSlug(slug: string): string {
  return `font_${toSlugUnderscores(slug)}_source`;
}

export function macroFromSlug(slug: string): string {
  return `MAX7219_FONT_${toSlugUnderscores(slug).toUpperCase()}`;
}

export function validateSlug(slug: string): string | null {
  if (!slug) return 'Slug is required.';
  if (!SLUG_RE.test(slug)) {
    return 'Slug must be kebab-case: lowercase letters, digits, single dashes between parts (^[a-z0-9]+(-[a-z0-9]+)*$).';
  }
  return null;
}

// ---------------------------------------------------------------------------
// License helpers
// ---------------------------------------------------------------------------

type LicenseNamePattern = { re: RegExp; name: string | ((m: RegExpMatchArray) => string) };
function namedCC(m: RegExpMatchArray): string { return m[0].replace(/\s+/g, ' ').trim(); }
function byVersion(pre: string): (m: RegExpMatchArray) => string {
  return (m: RegExpMatchArray) => `${pre} ${m[1] ?? ''}`.trim();
}
const LICENSE_PATTERNS: LicenseNamePattern[] = [
  { re: /SIL\s*OPEN\s*FONT\s*LICENSE\s*Version\s*1\.1/i, name: 'SIL OFL 1.1' },
  { re: /SIL\s*OPEN\s*FONT\s*LICENSE/i, name: 'SIL OFL' },
  { re: /OPEN\s*FONT\s*LICENSE/i, name: 'OFL' },
  { re: /MIT\s+License|\bMIT\b/i, name: 'MIT' },
  { re: /Apache\s+License[,\s]+Version\s*2/i, name: 'Apache 2.0' },
  { re: /GNU\s+GENERAL\s+PUBLIC\s+LICENSE\s+Version\s*3/i, name: 'GPL-3.0' },
  { re: /GNU\s+GENERAL\s+PUBLIC\s+LICENSE\s+Version\s*2/i, name: 'GPL-2.0' },
  { re: /GNU\s+LESSER\s+GENERAL\s+PUBLIC\s+LICENSE/i, name: 'LGPL' },
  { re: /BSD\s+[23]-Clause/i, name: 'BSD' },
  { re: /CC0\s+1\.0|Creative\s+Commons\s+Zero/i, name: 'CC0 1.0' },
  { re: /CC\s+BY(?:-NC)?(?:-SA)?\s+\d+\.\d+/i, name: (m: RegExpMatchArray) => m[0].replace(/\s+/g, ' ').trim() },
  { re: /Creative\s+Commons\s+Attribution[\s-]+NonCommercial[\s-]+Share\s*Alike(?:\s+(\d+\.\d+))?/i, name: byVersion('CC BY-NC-SA') },
  { re: /Creative\s+Commons\s+Attribution[\s-]+Share[\s-]*Alike(?:\s+(\d+\.\d+))?/i, name: byVersion('CC BY-SA') },
  { re: /Creative\s+Commons\s+Attribution(?:-NonCommercial)?(?:-ShareAlike)?\s+(\d+\.\d+)/i, name: byVersion('CC BY') },
  { re: /Creative\s+Commons\s+Attribution\b/i, name: 'CC BY' },
  { re: /CC\s+BY-SA(?:\s+(\d+\.\d+))?/i, name: byVersion('CC BY-SA') },
];

/** Best-effort short license name from raw license text. */
export function guessLicenseName(licenseText: string): string {
  if (!licenseText || !licenseText.trim()) return '';
  const head = licenseText.slice(0, 2000);
  for (const p of LICENSE_PATTERNS) {
    const m = head.match(p.re);
    if (m) return typeof p.name === 'function' ? p.name(m) : p.name;
  }
  if (/opensource\.org\/licenses\/mit/i.test(head)) return 'MIT';
  if (/openfontlicense\.org/i.test(head)) return 'SIL OFL 1.1';
  if (/creativecommons\.org\/licenses\/by-sa/i.test(head)) return 'CC BY-SA';
  if (/creativecommons\.org\/licenses\/by\//i.test(head)) return 'CC BY';
  return '';
}

// ---------------------------------------------------------------------------
// FreeType-style 8-pixel measurement
// ---------------------------------------------------------------------------

/**
 * One character of the glyph set, rendered the way ESPHome renders it
 * (FreeType at size 8, bpp 1) and placed the way the MAX7219 clock draws it.
 */
export interface GlyphMeasurement {
  cp: number;
  /** Mapped in the compiled font's cmap. */
  present: boolean;
  /**
   * The 8 LED rows exactly as the clock lights them for this glyph (row 0 =
   * top LED row), trimmed to the ink columns. null when the glyph has no ink.
   */
  bitmap: boolean[][] | null;
  /** Pen advance in px (ESPHome `advance`). */
  advancePx: number;
  /** Rows of ink — including rows that fall off the display. */
  heightPx: number;
  /** ESPHome's font ascender in px: rows from the top of its text box down to the baseline. */
  baselineOffset: number;
  /** Ink above the top / below the bottom LED row — those rows are lost on the clock. */
  clippedTop: boolean;
  clippedBottom: boolean;
  /** Index of the glyph in the compiled font (null when the character is unmapped). */
  glyphIndex: number | null;
  /** Advance width in font units, exactly as written to the TTF. */
  advanceFU: number;
  /** Outline bounds in font units, where FreeType places them (null without an outline). */
  bboxFU: { xMin: number; yMin: number; xMax: number; yMax: number } | null;
  /** Width of the ink in px. */
  inkWidthPx: number;
  /** First ink column, counted from the pen position (FreeType `bitmap_left` = ESPHome `offset_x`). */
  inkLeftPx: number;
  /** Rows from the baseline up to the top edge of the ink (FreeType `bitmap_top`). */
  inkTopPx: number;
  /** LED row of the topmost ink row on the clock (0 = top row); < 0 or > 7 when clipped. */
  displayTopRow: number;
  /** Ink rows lost above / below the 8 LED rows. */
  rowsClippedTop: number;
  rowsClippedBottom: number;
  /** Every ink row (top first, trimmed to the ink columns), including rows that fall off the display. */
  inkBitmap: boolean[][] | null;
}

/** Font-wide numbers behind the measurement (all at size 8). */
export interface Max7219FontMetrics {
  unitsPerEm: number;
  /** Vertical metrics FreeType reads: hhea, or OS/2 typo when USE_TYPO_METRICS is set. */
  ascentFU: number;
  descentFU: number;
  lineGapFU: number;
  usesTypoMetrics: boolean;
  /** Font units per px: ESPHome scales the em — not the ink — to 8 px. */
  unitsPerPx: number;
  /** ESPHome's ascender / descender / line height in px (FreeType rounds them outwards). */
  ascenderPx: number;
  descenderPx: number;
  lineHeightPx: number;
  /** Ink of '0', which the clock centres every text on (null when '0' is missing or blank). */
  zeroHeightPx: number | null;
  zeroInkTopPx: number | null;
  /** LED row the top of the '0' ink lands on (null when '0' is missing or blank). */
  zeroDisplayTopRow: number | null;
  /** LED row of the top of ESPHome's text box (the ascender line) on the clock. */
  textBoxTopRow: number;
  /** Common grid of the digit outlines (GCD of their coordinates) in font units; null for vector outlines. */
  latticeFU: number | null;
  /** LED px per lattice cell (1 = every drawn pixel is exactly one LED). */
  pxPerLatticeCell: number | null;
  /** The font carries TrueType bytecode hinting; otherwise FreeType's auto-hinter runs (as for every Pixeel-drawn font). */
  hasHinting: boolean;
}

export interface ValidationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  checks: ValidationCheck[];
  glyphs: Map<number, GlyphMeasurement>;
  tallestDigitPx: number;
  measuredTestStringWidthPx: number;
  metrics: Max7219FontMetrics;
  /** Plain-language causes of failed checks and other suspicious findings. Never changes `ok`. */
  diagnosis: string[];
}

/** The clock's widest time string; its advance width must fit the 48-px display. */
export const MAX7219_TEST_STRING = '88:88:88';
export const MAX7219_MAX_WIDTH_PX = 48;
const PX = MAX7219_PIXEL_SIZE;
const DIGITS = '0123456789';
const EPS = 1e-6;

type Pt = { x: number; y: number; onCurve: boolean };
type Box = { xMin: number; yMin: number; xMax: number; yMax: number };

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** C++ integer division semantics (truncation toward zero), without a -0. */
function cTrunc(x: number): number {
  return Math.trunc(x) + 0;
}

/** A number for humans: integers stay integers, fractions get at most `digits` decimals. */
export function fmtNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A glyph's outline in font units, positioned the way FreeType's TrueType
 * loader positions it: the outline moves so that phantom point pp1 =
 * (glyf-header xMin − hmtx lsb) sits on the pen position.
 */
function placedContours(g: any, glyf: any[]): Pt[][] {
  const shift = Math.round(g.leftSideBearing ?? 0) - Math.round(g.xMin ?? 0);
  const out: Pt[][] = [];
  if (g.compound && Array.isArray(g.glyfs)) {
    for (const comp of g.glyfs) {
      const sub = glyf[comp.glyphIndex ?? 0];
      if (!sub || !Array.isArray(sub.contours)) continue;
      const t = comp.transform ?? { a: 1, b: 0, c: 0, d: 1, e: comp.dX ?? 0, f: comp.dY ?? 0 };
      for (const c of sub.contours) {
        out.push(c.map((p: any) => ({
          x: (t.a ?? 1) * p.x + (t.c ?? 0) * p.y + (t.e ?? 0) + shift,
          y: (t.b ?? 0) * p.x + (t.d ?? 1) * p.y + (t.f ?? 0),
          onCurve: !!p.onCurve,
        })));
      }
    }
  } else if (Array.isArray(g.contours)) {
    for (const c of g.contours) {
      out.push(c.map((p: any) => ({ x: Math.round(p.x) + shift, y: Math.round(p.y), onCurve: !!p.onCurve })));
    }
  }
  return out.filter((c) => c.length > 0);
}

function boundsOf(contours: Pt[][]): Box | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.x > xMax) xMax = p.x;
      if (p.y > yMax) yMax = p.y;
    }
  }
  return Number.isFinite(xMin) ? { xMin, yMin, xMax, yMax } : null;
}

interface Ink {
  /** Ink rows, top first, trimmed to the ink columns. */
  rows: boolean[][];
  /** bitmap_top: rows from the baseline to the top edge of the ink. */
  topPx: number;
  /** bitmap_left: first ink column relative to the pen position. */
  leftPx: number;
  width: number;
  height: number;
}

/**
 * Rasterize one glyph at 1 px = `unitsPerPx` font units with coverage-based
 * 1-bit rendering (a cell lights at majority coverage). Pixel row k covers
 * y ∈ [k, k+1) px above the baseline; column c covers x ∈ [c, c+1) px right
 * of the pen position.
 */
function rasterizeInk(contours: Pt[][], box: Box, unitsPerPx: number): Ink {
  const c0 = Math.floor(box.xMin / unitsPerPx) - 1;
  const c1 = Math.min(Math.ceil(box.xMax / unitsPerPx) + 1, c0 + MAX_GRID - 1);
  let k0 = Math.floor(box.yMin / unitsPerPx) - 1;
  let k1 = Math.ceil(box.yMax / unitsPerPx) + 1;
  if (k1 - k0 + 1 > MAX_GRID) {
    // an outline far outside the em: keep the rows around the display
    k0 = Math.max(k0, -MAX_GRID / 2);
    k1 = Math.min(k1, k0 + MAX_GRID - 1);
  }
  const gridW = c1 - c0 + 1;
  const gridH = k1 - k0 + 1;
  const cov = rasterizeCoverage(contours, {
    gridWidth: gridW,
    gridHeight: gridH,
    unitsPerCell: unitsPerPx,
    offsetX: c0 * unitsPerPx,
    baselineRow: -k0,
    threshold: 0.5,
  });
  const { bitmap } = coverageToBitmap(cov, gridW, gridH, 0.5);
  let top = -Infinity, bottom = Infinity, left = Infinity, right = -Infinity;
  for (let ry = 0; ry < gridH; ry++) {
    for (let cx = 0; cx < gridW; cx++) {
      if (!bitmap.get(cx, ry)) continue;
      const k = ry + k0;
      if (k > top) top = k;
      if (k < bottom) bottom = k;
      if (cx < left) left = cx;
      if (cx > right) right = cx;
    }
  }
  if (top === -Infinity) return { rows: [], topPx: 0, leftPx: 0, width: 0, height: 0 };
  const rows: boolean[][] = [];
  for (let k = top; k >= bottom; k--) {
    const row: boolean[] = [];
    for (let cx = left; cx <= right; cx++) row.push(!!bitmap.get(cx, k - k0));
    rows.push(row);
  }
  return { rows, topPx: top + 1, leftPx: c0 + left, width: right - left + 1, height: top - bottom + 1 };
}

/**
 * Rasterize the compiled TTF the way ESPHome does (size 8, bpp 1) and place
 * every glyph the way the MAX7219 clock firmware does.
 *
 * - Size metrics follow FreeType's grid fitting: ascender rounded up,
 *   descender rounded down, line height rounded.
 * - ESPHome stores offset_y = ascender − bitmap_top for every glyph.
 * - The clock's SourceFont centres every text on the ink of '0':
 *   box_top = (8 − height('0')) / 2 − offset_y('0') (C++ integer division),
 *   and a glyph's ink starts on LED row box_top + offset_y. The font's
 *   ascender therefore cancels out — only the ink relative to '0' matters.
 *   Pixels outside the 8 rows are dropped.
 */
function measureCompiledTtf(ttfBuffer: ArrayBuffer, glyphSet: string): {
  metrics: Max7219FontMetrics;
  measurements: Map<number, GlyphMeasurement>;
} {
  const f = Font.create(ttfBuffer, { type: 'ttf', hinting: false }) as unknown as { data: any };
  const ttf = f.data;
  const unitsPerEm: number = Math.round(ttf.head?.unitsPerEm ?? 0) || 1000;
  const hhea = ttf.hhea ?? {};
  const os2 = ttf['OS/2'] ?? null;
  const usesTypoMetrics = !!os2 && (Number(os2.fsSelection ?? 0) & 0x80) !== 0;
  let ascentFU = Math.round(hhea.ascent ?? 0);
  let descentFU = Math.round(hhea.descent ?? 0); // negative in TTF convention
  let lineGapFU = Math.round(hhea.lineGap ?? 0);
  // FreeType reads the typo values when USE_TYPO_METRICS is set (and when hhea is all zero)
  if (os2 && (usesTypoMetrics || (ascentFU === 0 && descentFU === 0))) {
    ascentFU = Math.round(os2.sTypoAscender ?? 0);
    descentFU = Math.round(os2.sTypoDescender ?? 0);
    lineGapFU = Math.round(os2.sTypoLineGap ?? 0);
  }
  const unitsPerPx = unitsPerEm / PX;
  const scale = PX / unitsPerEm;
  const ascenderPx = Math.ceil(ascentFU * scale - EPS);
  const descenderPx = Math.floor(descentFU * scale + EPS);
  const lineHeightPx = Math.round((ascentFU - descentFU + lineGapFU) * scale);

  let tables: string[] = [];
  try {
    tables = listTables(ttfBuffer);
  } catch {
    /* unreadable table directory: assume no hinting */
  }
  const hasHinting = tables.includes('fpgm') || tables.includes('prep') || Number(ttf.maxp?.maxSizeOfInstructions ?? 0) > 0;

  // the file's Unicode map, read from the raw cmap subtables: fonteditor's
  // merged map would add the legacy Mac subtable's byte codes as Unicode
  const cmap: Record<number, number> = unicodeCmapOf(ttfBuffer, ttf.cmap);
  const glyf: any[] = ttf.glyf ?? [];
  const inks = new Map<number, Ink>();
  const measurements = new Map<number, GlyphMeasurement>();
  const blank = (cp: number, present: boolean, glyphIndex: number | null, advanceFU: number, bboxFU: Box | null): GlyphMeasurement => ({
    cp,
    present,
    bitmap: null,
    advancePx: Math.max(0, Math.round(advanceFU * scale)),
    heightPx: 0,
    baselineOffset: ascenderPx,
    clippedTop: false,
    clippedBottom: false,
    glyphIndex,
    advanceFU,
    bboxFU,
    inkWidthPx: 0,
    inkLeftPx: 0,
    inkTopPx: 0,
    displayTopRow: 0,
    rowsClippedTop: 0,
    rowsClippedBottom: 0,
    inkBitmap: null,
  });

  for (const ch of glyphSet) {
    const cp = ch.codePointAt(0)!;
    if (measurements.has(cp)) continue;
    const idx = cmap[cp];
    const g = idx != null ? glyf[idx] : undefined;
    if (ch === ' ') {
      // a blank space is expected; a font without one still advances a quarter em
      measurements.set(cp, blank(cp, true, g ? idx : null, g ? Math.round(g.advanceWidth ?? 0) : Math.round(unitsPerEm / 4), null));
      continue;
    }
    if (idx == null || !g) {
      measurements.set(cp, blank(cp, false, null, 0, null));
      continue;
    }
    const advanceFU = Math.round(g.advanceWidth ?? 0);
    const contours = placedContours(g, glyf);
    const box = boundsOf(contours);
    if (!box) {
      measurements.set(cp, blank(cp, true, idx, advanceFU, null));
      continue;
    }
    const ink = rasterizeInk(contours, box, unitsPerPx);
    inks.set(cp, ink);
    measurements.set(cp, {
      ...blank(cp, true, idx, advanceFU, box),
      heightPx: ink.height,
      inkWidthPx: ink.width,
      inkLeftPx: ink.leftPx,
      inkTopPx: ink.topPx,
      inkBitmap: ink.height ? ink.rows.map((r) => [...r]) : null,
    });
  }

  // Clock placement: centre on the ink of '0' (font line height when '0' is missing or blank).
  const zero = measurements.get(0x30);
  const zeroInk = zero && zero.present && zero.heightPx > 0 ? zero : null;
  const inkHeight = zeroInk ? zeroInk.heightPx : lineHeightPx;
  const inkTop = zeroInk ? ascenderPx - zeroInk.inkTopPx : 0;
  const boxTop = cTrunc((PX - inkHeight) / 2) - inkTop;
  for (const m of measurements.values()) {
    const ink = inks.get(m.cp);
    if (!ink || !ink.height) continue;
    const top = boxTop + ascenderPx - m.inkTopPx;
    const bottom = top + m.heightPx - 1;
    m.displayTopRow = top;
    m.rowsClippedTop = Math.max(0, -top);
    m.rowsClippedBottom = Math.max(0, bottom - (PX - 1));
    m.clippedTop = m.rowsClippedTop > 0;
    m.clippedBottom = m.rowsClippedBottom > 0;
    m.bitmap = Array.from({ length: PX }, (_, r) => {
      const i = r - top;
      return i >= 0 && i < ink.height ? [...ink.rows[i]] : Array<boolean>(ink.width).fill(false);
    });
  }

  // The pixel grid the digit outlines are drawn on (GCD of their coordinates).
  let lattice = 0;
  const latticeChars = [...(DIGITS + ':')].filter((c) => cmap[c.codePointAt(0)!] != null);
  for (const ch of latticeChars.length ? latticeChars : [...glyphSet]) {
    const idx = cmap[ch.codePointAt(0)!];
    const g = idx != null ? glyf[idx] : undefined;
    if (!g) continue;
    for (const c of placedContours(g, glyf)) {
      for (const p of c) lattice = gcd(gcd(lattice, p.x), p.y);
    }
  }
  // finer than a quarter LED it is not a pixel grid but ordinary vector outlines
  const latticeFU = lattice > 0 && lattice * scale >= 0.25 - EPS ? lattice : null;

  return {
    metrics: {
      unitsPerEm,
      ascentFU,
      descentFU,
      lineGapFU,
      usesTypoMetrics,
      unitsPerPx,
      ascenderPx,
      descenderPx,
      lineHeightPx,
      zeroHeightPx: zeroInk ? zeroInk.heightPx : null,
      zeroInkTopPx: zeroInk ? zeroInk.inkTopPx : null,
      zeroDisplayTopRow: zeroInk ? zeroInk.displayTopRow : null,
      textBoxTopRow: boxTop,
      latticeFU,
      pxPerLatticeCell: latticeFU ? latticeFU * scale : null,
      hasHinting,
    },
    measurements,
  };
}

/** One character of the test string: how many times it occurs and where its advance goes. */
export interface TestStringPart {
  ch: string;
  count: number;
  advancePx: number;
  inkWidthPx: number;
}

/** Advance width of "88:88:88", broken down per distinct character. */
export function measureTestString(glyphs: Map<number, GlyphMeasurement>, text = MAX7219_TEST_STRING): {
  widthPx: number;
  missing: boolean;
  parts: TestStringPart[];
} {
  let widthPx = 0;
  let missing = false;
  const parts: TestStringPart[] = [];
  for (const ch of text) {
    const m = glyphs.get(ch.codePointAt(0)!);
    if (!m || !m.present) {
      missing = true;
      continue;
    }
    widthPx += m.advancePx;
    const part = parts.find((p) => p.ch === ch);
    if (part) part.count += 1;
    else parts.push({ ch, count: 1, advancePx: m.advancePx, inkWidthPx: m.inkWidthPx });
  }
  return { widthPx: missing ? 0 : widthPx, missing, parts };
}

/** "9 px (5 ink + 4 blank)" — where a glyph's advance goes. */
export function describeAdvance(advancePx: number, inkWidthPx: number): string {
  if (inkWidthPx <= 0) return `${advancePx} px (blank)`;
  if (advancePx === inkWidthPx) return `${advancePx} px (all ink)`;
  if (advancePx > inkWidthPx) return `${advancePx} px (${inkWidthPx} ink + ${advancePx - inkWidthPx} blank)`;
  return `${advancePx} px (${inkWidthPx} px of ink overflows it by ${inkWidthPx - advancePx})`;
}

const rowSpan = (a: number, b: number) => (a === b ? `row ${a}` : `rows ${a}–${b}`);

/**
 * Run the MAX7219 validation checks against the compiled TTF buffer.
 */
export function validateMax7219Font(ttfBuffer: ArrayBuffer, glyphSet: string): ValidationResult {
  const { metrics, measurements } = measureCompiledTtf(ttfBuffer, glyphSet);
  const checks: ValidationCheck[] = [];
  let ok = true;
  const push = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, ok: pass, detail });
    if (!pass) ok = false;
  };
  const label = (cp: number) => describeChar(String.fromCodePoint(cp));

  // 1. Every glyph exists and is non-empty (space may be blank)
  const missing: string[] = [];
  const empty: string[] = [];
  for (const ch of new Set(glyphSet)) {
    if (ch === ' ') continue;
    const m = measurements.get(ch.codePointAt(0)!);
    if (!m || !m.present) { missing.push(describeChar(ch)); continue; }
    if (!m.bitmap || m.heightPx === 0) empty.push(describeChar(ch));
  }
  push('All glyphs present in cmap', missing.length === 0,
    missing.length === 0 ? `All ${[...glyphSet].length} requested characters are mapped.` : `Missing: ${missing.join(', ')}`);
  push('No glyph renders as empty/.notdef', empty.length === 0,
    empty.length === 0 ? 'No mapped glyph is empty.' : `Empty: ${empty.join(', ')}`);

  // 2. No glyph taller than 8 px
  const tooTall = [...measurements.values()].filter((m) => m.heightPx > PX);
  push(`No glyph taller than ${PX} px`, tooTall.length === 0,
    tooTall.length === 0 ? 'Every glyph fits within 8 rows.' : `Taller than 8: ${tooTall.map((m) => `${label(m.cp)} (${m.heightPx}px)`).join(', ')}`);

  // 3. Tallest digit is 8 px (or 7 px when the 8-row grid reserves a descender row on a whole-LED lattice)
  let tallestDigit = 0;
  const digitHeights: string[] = [];
  for (const d of DIGITS) {
    const h = measurements.get(d.codePointAt(0)!)?.heightPx ?? 0;
    if (h > tallestDigit) tallestDigit = h;
    digitHeights.push(`${d}=${h}`);
  }
  const wholeLedLattice =
    metrics.pxPerLatticeCell === null ||
    Math.abs(metrics.pxPerLatticeCell - Math.round(metrics.pxPerLatticeCell)) <= EPS;
  const sevenRowWithDescender =
    tallestDigit === PX - 1 &&
    metrics.descenderPx <= -1 &&
    wholeLedLattice;
  const digitHeightOk = tallestDigit === PX || sevenRowWithDescender;
  push('Tallest digit is exactly 8 px', digitHeightOk,
    tallestDigit === PX
      ? `Digits fill all 8 rows (${digitHeights.join(', ')}).`
      : sevenRowWithDescender
        ? `Digits fill all 7 ascent rows above the descender row (${digitHeights.join(', ')}).`
        : `Tallest digit is ${tallestDigit} px (need 8). Heights: ${digitHeights.join(', ')}`);

  // 4. "88:88:88" width
  const width = measureTestString(measurements);
  const widthOk = !width.missing && width.widthPx <= MAX7219_MAX_WIDTH_PX;
  push(`"${MAX7219_TEST_STRING}" advance width ≤ ${MAX7219_MAX_WIDTH_PX} px`, widthOk,
    width.missing
      ? 'Cannot measure — one of : or 8 is missing.'
      : `${width.widthPx} px (need ≤ ${MAX7219_MAX_WIDTH_PX}): ` +
          width.parts.map((p) => `'${p.ch}' ${describeAdvance(p.advancePx, p.inkWidthPx)} ×${p.count}`).join(', ') + '.');

  // 5. Clipping, as the clock places the glyphs
  const where = metrics.zeroDisplayTopRow !== null
    ? `the clock centres text on the ink of '0', LED ${rowSpan(metrics.zeroDisplayTopRow, metrics.zeroDisplayTopRow + (metrics.zeroHeightPx ?? 1) - 1)}`
    : `'0' is missing, so the clock centres the ${metrics.lineHeightPx}-px text box`;
  const clippedTop = [...measurements.values()].filter((m) => m.clippedTop);
  const clippedBot = [...measurements.values()].filter((m) => m.clippedBottom);
  push('No glyph clipped at the top', clippedTop.length === 0,
    clippedTop.length === 0
      ? `No ink above the 8 LED rows (${where}).`
      : `Clipped top: ${clippedTop.map((m) => `${label(m.cp)} (${plural(m.rowsClippedTop, 'row')})`).join(', ')} — ${where}.`);
  push('No glyph clipped at the bottom', clippedBot.length === 0,
    clippedBot.length === 0
      ? `No ink below the 8 LED rows (${where}).`
      : `Clipped bottom: ${clippedBot.map((m) => `${label(m.cp)} (${plural(m.rowsClippedBottom, 'row')})`).join(', ')} — ${where}.`);

  const diagnosis = diagnoseMax7219(metrics, measurements, tallestDigit, width);
  return {
    ok,
    checks,
    glyphs: measurements,
    tallestDigitPx: tallestDigit,
    measuredTestStringWidthPx: width.widthPx,
    metrics,
    diagnosis,
  };
}

/**
 * Explain, in plain words and with the measured numbers, why checks fail and
 * what else looks off. Works on the compiled TTF alone.
 */
function diagnoseMax7219(
  metrics: Max7219FontMetrics,
  glyphs: Map<number, GlyphMeasurement>,
  tallestDigit: number,
  width: ReturnType<typeof measureTestString>,
): string[] {
  const out: string[] = [];
  const { unitsPerEm: upem, unitsPerPx, latticeFU: L, pxPerLatticeCell: p } = metrics;
  const digit = (d: string) => glyphs.get(d.codePointAt(0)!);

  // Drawn pixels vs LEDs
  if (L && p && Math.abs(p - Math.round(p)) > EPS) {
    out.push(
      `Drawn pixels don't land on whole LEDs: the outlines use a ${L}-unit pixel grid and ESPHome scales the ${upem}-unit em to 8 px, ` +
        `so 1 drawn pixel = ${fmtNum(p)} LED px (the em is ${fmtNum(upem / L, 2)} drawn pixels tall, not 8). ` +
        `FreeType's hinting then snaps every edge to the LED grid: rows and columns get doubled or merged, thin details (such as the dots of ':') can appear or vanish, ` +
        `and ESPHome's result can differ from the sizes measured here by a pixel or more. ` +
        `For pixel-exact output the em must be exactly 8 drawn pixels: unitsPerEm = 8 × ${L} = ${8 * L}.`,
    );
  } else if (!L && [...DIGITS].some((d) => (digit(d)?.heightPx ?? 0) > 0)) {
    out.push(
      `The digit outlines are not on a pixel grid (vector glyphs), so FreeType's hinting picks the final LEDs and the sizes measured here can be off by about 1 px. ` +
        `Convert the font to pixels for an exact check.`,
    );
  }

  // Width
  if (!width.missing && width.widthPx > MAX7219_MAX_WIDTH_PX) {
    const eight = width.parts.find((x) => x.ch === '8')!;
    const colon = width.parts.find((x) => x.ch === ':')!;
    const tight = 6 * (eight.inkWidthPx + 1) + 2 * (colon.inkWidthPx + 1);
    const maxDigit = Math.floor((MAX7219_MAX_WIDTH_PX - 2 * colon.advancePx) / 6);
    const maxDigitTightColon = Math.floor((MAX7219_MAX_WIDTH_PX - 2 * (colon.inkWidthPx + 1)) / 6);
    let fix: string;
    if (maxDigit >= eight.inkWidthPx + 1) fix = `make every digit advance at most ${maxDigit} px (with ':' at ${colon.advancePx} px)`;
    else if (maxDigitTightColon >= eight.inkWidthPx + 1) fix = `make ':' advance ${colon.inkWidthPx + 1} px and every digit at most ${maxDigitTightColon} px`;
    else fix = `draw narrower digits: even with ':' at ${colon.inkWidthPx + 1} px, 6 digits may advance only ${maxDigitTightColon} px each (ink + 1 px spacing), but '8' alone has ${eight.inkWidthPx} px of ink`;
    out.push(
      `"${MAX7219_TEST_STRING}" is ${width.widthPx} px wide because ESPHome always moves the pen by the full advance width — blank grid columns and letter spacing included: ` +
        `'8' advances ${eight.advancePx} px for ${eight.inkWidthPx} px of ink, ':' advances ${colon.advancePx} px for ${colon.inkWidthPx} px of ink. ` +
        `With every glyph advancing its ink + 1 px the string would be ${tight} px. To fit ${MAX7219_MAX_WIDTH_PX} px, ${fix}. ` +
        `(On the clock a text wider than the display starts at column 0 and its right end is cut off.)`,
    );
  }
  const eightAdv = digit('8')?.advancePx ?? 0;
  const wider = [...DIGITS].filter((d) => d !== '8' && (digit(d)?.advancePx ?? 0) > eightAdv);
  if (eightAdv > 0 && wider.length) {
    out.push(
      `${wider.map((d) => `'${d}' (${digit(d)!.advancePx} px)`).join(', ')} advance${wider.length === 1 ? 's' : ''} more than '8' (${eightAdv} px), ` +
        `so times such as "${wider[0].repeat(2)}:${wider[0].repeat(2)}:${wider[0].repeat(2)}" are wider than the measured "${MAX7219_TEST_STRING}". Give all digits the same advance.`,
    );
  }

  // Digit height
  const wholeLedLattice = p === null || Math.abs(p - Math.round(p)) <= EPS;
  const sevenRowWithDescender = tallestDigit === PX - 1 && metrics.descenderPx <= -1 && wholeLedLattice;
  if (tallestDigit > 0 && tallestDigit !== PX && !sevenRowWithDescender) {
    const tallest = [...DIGITS].map(digit).filter((m): m is GlyphMeasurement => !!m && m.heightPx === tallestDigit)[0];
    const d = String.fromCodePoint(tallest.cp);
    const inkFU = tallest.bboxFU ? tallest.bboxFU.yMax - tallest.bboxFU.yMin : 0;
    const asDrawn = L ? ` = ${fmtNum(inkFU / L, 2)} drawn pixels` : '';
    const target = `${fmtNum(PX * unitsPerPx)} font units${L && p ? ` (${fmtNum(PX / p, 2)} drawn pixels)` : ''}`;
    const exactPx = inkFU / unitsPerPx;
    const bottomPx = tallest.bboxFU ? tallest.bboxFU.yMin / unitsPerPx : 0;
    const topPx = tallest.bboxFU ? tallest.bboxFU.yMax / unitsPerPx : 0;
    const offGrid = (x: number) => Math.abs(x - Math.round(x)) > EPS;
    // ink that would fit (or fill) the display but whose edges cut through LED rows
    const misaligned = (offGrid(bottomPx) || offGrid(topPx)) && Math.abs(exactPx - tallestDigit) >= 0.5 - EPS;
    let advice: string;
    if (misaligned) {
      advice =
        `Its edges fall between LED rows (it spans y = ${fmtNum(bottomPx, 2)} … ${fmtNum(topPx, 2)} px around the baseline), ` +
        `so every row it covers by at least half lights up and it renders ${tallestDigit} px instead of ${fmtNum(exactPx, 2)}. ` +
        `Put the baseline and the ink on whole LED rows.`;
    } else {
      advice = tallestDigit < PX ? `To fill the display the digits must span ${target}.` : `To fit, the digits may span at most ${target}.`;
    }
    out.push(
      `The tallest digit renders ${tallestDigit} px tall; the clock project expects exactly 8. ` +
        `ESPHome scales the em (unitsPerEm ${upem}) — not the ink — to 8 px, so 1 px = ${fmtNum(unitsPerPx)} font units: ` +
        `'${d}' spans ${inkFU} font units${asDrawn} = ${fmtNum(exactPx, 2)} px. ` +
        advice +
        (tallestDigit === PX - 1
          ? ` (The clock's tests accept 7-px digits only for the fonts on their exception list — MD MAX72XX System, MD Parola 7-seg and MG Minecraft Georgian.)`
          : ''),
    );
  }

  // Clipping explanation
  const clipped = [...glyphs.values()].filter((m) => m.clippedTop || m.clippedBottom);
  if (clipped.length && metrics.zeroDisplayTopRow !== null && metrics.zeroHeightPx !== null) {
    const z0 = metrics.zeroDisplayTopRow;
    const z1 = z0 + metrics.zeroHeightPx - 1;
    const lead = z0 < 0 || z1 > PX - 1
      ? `'0' itself is ${metrics.zeroHeightPx} px tall — more than the 8 LED rows — so even centred on it (LED ${rowSpan(z0, z1)}) the clock cuts rows off.`
      : `The clock centres every text on the ink of '0' (LED ${rowSpan(z0, z1)}), so a glyph may reach at most ${plural(z0, 'row')} above and ${plural(PX - 1 - z1, 'row')} below '0'.`;
    out.push(
      `${lead} ` +
        `Cut off: ${clipped.map((m) => `${describeChar(String.fromCodePoint(m.cp))} ${[m.rowsClippedTop ? `${m.rowsClippedTop} above` : '', m.rowsClippedBottom ? `${m.rowsClippedBottom} below` : ''].filter(Boolean).join(' and ')}`).join(', ')}.`,
    );
  }

  // Digits leaving the box of '0' get cropped while they slide (the clock clips each changing digit to it)
  if (metrics.zeroDisplayTopRow !== null && metrics.zeroHeightPx !== null) {
    const z0 = metrics.zeroDisplayTopRow;
    const z1 = z0 + metrics.zeroHeightPx - 1;
    const crop: string[] = [];
    for (const d of DIGITS) {
      const m = digit(d);
      if (!m || !m.heightPx) continue;
      const parts: string[] = [];
      const above = z0 - m.displayTopRow;
      const below = m.displayTopRow + m.heightPx - 1 - z1;
      const left = -m.inkLeftPx;
      const right = m.inkLeftPx + m.inkWidthPx - m.advancePx;
      if (above > 0) parts.push(`${above} row${above === 1 ? '' : 's'} above`);
      if (below > 0) parts.push(`${below} row${below === 1 ? '' : 's'} below`);
      if (left > 0) parts.push(`${left} px left of its advance`);
      if (right > 0) parts.push(`${right} px past its advance`);
      if (parts.length) crop.push(`'${d}' ${parts.join(', ')}`);
    }
    if (crop.length) {
      out.push(
        `While a digit changes, the clock crops it to the rows of '0' (LED ${rowSpan(z0, z1)}) and to its own advance width, so these digits lose ink during the slide animation: ${crop.join('; ')}.`,
      );
    }
  } else {
    out.push(`'0' is missing or blank, so the clock centres the text on the font's ${metrics.lineHeightPx}-px line height instead of on the digit ink.`);
  }
  return out;
}

export function describeChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  if (ch === ' ') return `SPACE (${hex})`;
  if (cp >= 0x20 && cp <= 0x7e) return `'${ch}' (${hex})`;
  return `${ch} (${hex})`;
}

// ---------------------------------------------------------------------------
// File builders
// ---------------------------------------------------------------------------

export interface Max7219ExportSettings {
  label: string;
  slug: string;
  ttfFileName: string;
  pixelSize: number;
  glyphs: string;
  licenseName: string;
  licenseText: string;
}

export interface Max7219Package {
  settings: Max7219ExportSettings;
  ttf: ArrayBuffer;
  ttfSha256: string;
  familyName: string;
  firmwareId: string;
  macro: string;
  assetPath: string;
  validation: ValidationResult;
  blob: Blob;
  fileName: string;
  reportContent: string;
  yamlContent: string;
  manifest: Record<string, unknown>;
}

function yamlSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function buildPackagesYaml(s: Max7219ExportSettings, firmwareId: string, macro: string): string {
  const urlPath = `\${fonts_base_url}/${s.slug}/${s.ttfFileName}`;
  return (
    `font:\n` +
    `  - id: ${firmwareId}\n` +
    `    file:\n` +
    `      type: web\n` +
    `      url: ${urlPath}\n` +
    `    size: ${s.pixelSize}\n` +
    `    bpp: ${MAX7219_BPP}\n` +
    `    glyphs:\n` +
    `      - ${yamlSingleQuote(s.glyphs)}\n` +
    `\n` +
    `esphome:\n` +
    `  build_flags:\n` +
    `    - -D${macro}\n` +
    `\n` +
    `select:\n` +
    `  - id: !extend clock_font\n` +
    `    options:\n` +
    `      - ${yamlSingleQuote(s.label)}\n`
  );
}

function buildManifest(s: Max7219ExportSettings, firmwareId: string, macro: string, assetPath: string, familyName: string, sha: string, v: ValidationResult): string {
  const manifest = {
    slug: s.slug,
    label: s.label,
    familyName,
    firmwareId,
    macro,
    file: assetPath,
    size: s.pixelSize,
    bpp: MAX7219_BPP,
    glyphs: s.glyphs,
    license: s.licenseName,
    licenseFile: `fonts/${s.slug}/LICENSE.txt`,
    ttfSha256: sha,
    measuredTestString: '88:88:88',
    measuredTestStringWidthPx: v.measuredTestStringWidthPx,
    tallestDigitPx: v.tallestDigitPx,
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

function buildExportReport(s: Max7219ExportSettings, v: ValidationResult, sha: string, familyName: string): string {
  const lines: string[] = [];
  const status = v.ok ? 'PASS' : 'FAIL';
  lines.push(`# MAX7219 Matrix Clock export report — ${s.slug}`);
  lines.push('');
  lines.push(`**Status:** ${status}`);
  lines.push('');
  lines.push(`- Label: ${s.label}`);
  lines.push(`- Family: ${familyName}`);
  lines.push(`- Slug: ${s.slug}`);
  lines.push(`- Pixel size: ${s.pixelSize}, bpp: ${MAX7219_BPP}`);
  lines.push(`- TTF: fonts/${s.slug}/${s.ttfFileName}`);
  lines.push(`- TTF SHA-256: ${sha}`);
  lines.push(`- License: ${s.licenseName}`);
  lines.push('');
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  lines.push('## Measurements');
  lines.push('');
  lines.push(
    v.tallestDigitPx === MAX7219_PIXEL_SIZE - 1 && v.checks.find((c) => c.name.includes('Tallest digit'))?.ok
      ? `- Tallest digit 0-9: **${v.tallestDigitPx} px** (7 ascent rows + 1 descender row)`
      : `- Tallest digit 0-9: **${v.tallestDigitPx} px** (must be 8 px)`,
  );
  lines.push(`- "${MAX7219_TEST_STRING}" advance width: **${v.measuredTestStringWidthPx} px** (must be ≤ ${MAX7219_MAX_WIDTH_PX} px)`);
  lines.push(`- Scale: the ${v.metrics.unitsPerEm}-unit em is drawn 8 px tall, so 1 px = ${fmtNum(v.metrics.unitsPerPx)} font units` +
    (v.metrics.latticeFU && v.metrics.pxPerLatticeCell
      ? `; the outlines sit on a ${v.metrics.latticeFU}-unit pixel grid (1 drawn pixel = ${fmtNum(v.metrics.pxPerLatticeCell)} LED px)`
      : ''));
  lines.push('- Measured the way ESPHome renders the font (FreeType, size 8, bpp 1); glyphs are placed the way the clock draws them (text centred on the ink of \'0\').');
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Check | Result | Detail |');
  lines.push('| --- | --- | --- |');
  for (const c of v.checks) {
    lines.push(`| ${c.name} | ${c.ok ? '✅ PASS' : '❌ FAIL'} | ${cell(c.detail)} |`);
  }
  lines.push('');
  if (v.diagnosis.length) {
    lines.push('## Diagnosis');
    lines.push('');
    for (const d of v.diagnosis) lines.push(`- ${d}`);
    lines.push('');
  }
  lines.push('## Per-glyph rasterization');
  lines.push('');
  lines.push('| Char | Advance (px) | Ink width (px) | Height (px) | LED rows | Clipped top | Clipped bottom |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [cp, m] of v.glyphs) {
    const ch = String.fromCodePoint(cp);
    const rows = m.heightPx ? (m.heightPx === 1 ? `${m.displayTopRow}` : `${m.displayTopRow}–${m.displayTopRow + m.heightPx - 1}`) : '–';
    lines.push(`| ${cell(describeChar(ch))} | ${m.advancePx} | ${m.inkWidthPx} | ${m.heightPx} | ${rows} | ${m.clippedTop ? `YES (${m.rowsClippedTop})` : 'no'} | ${m.clippedBottom ? `YES (${m.rowsClippedBottom})` : 'no'} |`);
  }
  lines.push('');
  if (!v.ok) {
    lines.push('> **⚠ One or more mandatory checks failed.** Do not submit this font to the MAX7219 Matrix Clock project until the failing checks are resolved. This export does not stretch, resample, or otherwise modify the font to make it pass.');
    lines.push('');
  }
  return lines.join('\n');
}

function buildIntegrationMd(slug: string): string {
  return (
    `# Integrating ${slug} into Esphome-Max7219-Matrix-Clock\n` +
    `\n` +
    `Follow these steps after extracting the ZIP at the repository root:\n` +
    `\n` +
    `1. **Extract the ZIP at the root of Esphome-Max7219-Matrix-Clock.**\n` +
    `   The extracted layout adds \`fonts/${slug}/\`, \`packages/fonts/${slug}.yaml\`,\n` +
    `   \`font-manifest.json\`, \`EXPORT-REPORT.md\`, \`INTEGRATION.md\` and an \`integration/\` folder.\n` +
    `\n` +
    `2. **Apply the three snippets from \`integration/\`** to the target repo:\n` +
    `   - Add the entry from \`integration/configurator-fontMetadata.json\` under the \`fontMetadata\` key in \`packages/configurator.json\`.\n` +
    `   - Add the guarded C++ block from \`integration/display-snippet.txt\` inside the SourceFont selection block in \`packages/display.yaml\`, following the existing SourceFont pattern.\n` +
    `   - Add the mapping line from \`integration/test-mapping.txt\` to \`FONT_OPTION_BY_ID\` in \`tests/test_config.py\`.\n` +
    `   - Add the Markdown row from \`integration/fonts-readme-row.md\` to the font table in \`fonts/README.md\`.\n` +
    `\n` +
    `3. **Regenerate generated files** by running, from the repository root:\n` +
    `\n` +
    `   \`\`\`\n` +
    `   python scripts/generate_firmware_contract.py\n` +
    `   python web-configurator/scripts/generate_glyphs.py\n` +
    `   python scripts/check_code.py\n` +
    `   \`\`\`\n` +
    `\n` +
    `4. **Firmware compilation / flashing** remains a separate ESPHome step (compile and flash your node through the ESPHome dashboard or CLI as usual). Repository maintainers handle the version bump and \`CHANGELOG.md\` entry.\n`
  );
}

function buildConfiguratorMetadataJson(slug: string, label: string, licenseName: string): string {
  const entry = {
    [slug]: {
      label,
      license: licenseName,
      source: `fonts/${slug}/LICENSE.txt`,
    },
  };
  return JSON.stringify(entry, null, 2) + '\n';
}

function buildDisplaySnippet(macro: string, slugUnderscores: string, firmwareId: string, label: string): string {
  return `#ifdef ${macro}\nmax7219_clock::SourceFont ${slugUnderscores}_font(${firmwareId}, &it);\nif (font_option == ${JSON.stringify(label)}) selected = &${slugUnderscores}_font;\n#endif\n`;
}

function buildTestMapping(firmwareId: string, label: string): string {
  return `"${firmwareId}": ${JSON.stringify(label)},\n`;
}

function buildReadmeRow(label: string, ttfFileName: string, slug: string, licenseName: string): string {
  return `| ${label} | [${ttfFileName}](${slug}/${ttfFileName}) | ${licenseName}; see [${slug}/LICENSE.txt](${slug}/LICENSE.txt) |\n`;
}

/**
 * Build the full MAX7219 export ZIP without downloading.
 *
 * Throws if a license name, license text, slug, or filename is missing, since
 * those are required for a ready-to-submit export.
 */
export async function buildMax7219Package(doc: FontDoc, settings: Max7219ExportSettings): Promise<Max7219Package> {
  if (!settings.licenseName || !settings.licenseName.trim()) {
    throw new Error('License name is required before exporting for the MAX7219 Matrix Clock.');
  }
  if (!settings.licenseText || !settings.licenseText.trim()) {
    throw new Error('License text is required before exporting for the MAX7219 Matrix Clock.');
  }
  const slugErr = validateSlug(settings.slug);
  if (slugErr) throw new Error(slugErr);
  if (settings.pixelSize !== MAX7219_PIXEL_SIZE) {
    throw new Error(`Pixel size must be locked to ${MAX7219_PIXEL_SIZE} for MAX7219 export.`);
  }
  if (!settings.ttfFileName || !settings.ttfFileName.trim()) {
    throw new Error('Compiled font filename is required.');
  }
  if (!settings.label || !settings.label.trim()) {
    throw new Error('Display label is required.');
  }

  const { buffer: ttfBuf } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
  const sha = await sha256Hex(ttfBuf);

  let familyName = doc.meta.fontFamily;
  try {
    const parsed = Font.create(ttfBuf, { type: 'ttf' }) as unknown as { data: any };
    familyName = (parsed.data?.name?.fontFamily as string) || familyName;
  } catch {
    /* fall back to editor family */
  }

  const validation = validateMax7219Font(ttfBuf, settings.glyphs);

  const firmwareId = firmwareIdFromSlug(settings.slug);
  const macro = macroFromSlug(settings.slug);
  const assetPath = `fonts/${settings.slug}/${settings.ttfFileName}`;
  const slugUnderscores = toSlugUnderscores(settings.slug);

  const yamlContent = buildPackagesYaml(settings, firmwareId, macro);
  const manifestContent = buildManifest(settings, firmwareId, macro, assetPath, familyName, sha, validation);
  const reportContent = buildExportReport(settings, validation, sha, familyName);
  const integrationContent = buildIntegrationMd(settings.slug);
  const confMeta = buildConfiguratorMetadataJson(settings.slug, settings.label, settings.licenseName);
  const displaySnippet = buildDisplaySnippet(macro, slugUnderscores, firmwareId, settings.label);
  const testMapping = buildTestMapping(firmwareId, settings.label);
  const readmeRow = buildReadmeRow(settings.label, settings.ttfFileName, settings.slug, settings.licenseName);

  const zip = new JSZip();
  zip.file(assetPath, ttfBuf);
  zip.file(`fonts/${settings.slug}/LICENSE.txt`, settings.licenseText);
  zip.file(`packages/fonts/${settings.slug}.yaml`, yamlContent);
  zip.file('font-manifest.json', manifestContent);
  zip.file('EXPORT-REPORT.md', reportContent);
  zip.file('INTEGRATION.md', integrationContent);
  const iDir = zip.folder('integration');
  if (iDir) {
    iDir.file('configurator-fontMetadata.json', confMeta);
    iDir.file('display-snippet.txt', displaySnippet);
    iDir.file('test-mapping.txt', testMapping);
    iDir.file('fonts-readme-row.md', readmeRow);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const fileName = `${settings.slug}-esphome-max7219.zip`;

  const manifest = JSON.parse(manifestContent) as Record<string, unknown>;

  return {
    settings,
    ttf: ttfBuf,
    ttfSha256: sha,
    familyName,
    firmwareId,
    macro,
    assetPath,
    validation,
    blob,
    fileName,
    reportContent,
    yamlContent,
    manifest,
  };
}

/** Build the package and trigger a browser download. */
export async function exportMax7219Package(doc: FontDoc, settings: Max7219ExportSettings): Promise<{ bytes: number; fileName: string; ok: boolean }> {
  const pkg = await buildMax7219Package(doc, settings);
  downloadBlob(pkg.blob, pkg.fileName);
  return { bytes: pkg.blob.size, fileName: pkg.fileName, ok: pkg.validation.ok };
}

/** Build default settings for the dialog from a FontDoc. */
export function defaultMax7219Settings(doc: FontDoc): Max7219ExportSettings {
  const family = doc.meta.fontFamily.trim() || 'Font';
  const psName = doc.meta.postScriptName && doc.meta.postScriptName.trim()
    ? doc.meta.postScriptName
    : makePostScriptName(family, doc.meta.fontSubFamily);
  const licenseText = buildLicenseTxt(doc.meta).trim();
  const licenseNameGuess = guessLicenseName(doc.meta.licence);
  return {
    label: defaultLabel(family),
    slug: slugify(family),
    ttfFileName: `${psName}.ttf`,
    pixelSize: MAX7219_PIXEL_SIZE,
    glyphs: MAX7219_DEFAULT_GLYPHS,
    licenseName: licenseNameGuess,
    licenseText,
  };
}
