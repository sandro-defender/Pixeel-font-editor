/**
 * ESPHome MAX7219 Matrix Clock font package generator.
 *
 * Produces a ZIP that drops into sandro-defender/Esphome-Max7219-Matrix-Clock
 * following its font-package convention (see module docs at the bottom of the
 * service). The compiled TTF is measured the way ESPHome / FreeType will
 * rasterize it at size 8, bpp=1.
 */
import JSZip from 'jszip';
import { Font } from 'fonteditor-core';
import type { FontDoc } from '../core/types';
import { buildLicenseTxt } from '../core/license';
import { downloadBlob } from './persistence';
import { exportFont } from './exportService';
import { DEFAULT_EXPORT_OPTIONS } from '../core/fontCodec';
import { makePostScriptName } from '../core/metadata';
import { rasterizeCoverage, coverageToBitmap } from '../core/rasterize';
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
  { re: /Creative\s+Commons\s+Attribution(?:-NonCommercial)?(?:-ShareAlike)?\s+(\d+\.\d+)/i, name: byVersion('CC BY') },
  { re: /CC\s+BY-SA\s+(\d+\.\d+)/i, name: byVersion('CC BY-SA') },
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

export interface GlyphMeasurement {
  cp: number;
  present: boolean;
  bitmap: boolean[][] | null;
  advancePx: number;
  heightPx: number;
  baselineOffset: number;
  clippedTop: boolean;
  clippedBottom: boolean;
}

export interface ValidationResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  glyphs: Map<number, GlyphMeasurement>;
  tallestDigitPx: number;
  measuredTestStringWidthPx: number;
}

/**
 * Convert a single point (x,y) in font units to the pixel that contains it at
 * the given scale. Pixel (col, row) covers x ∈ [col, col+1), y ∈ [row, row+1)
 * scaled units, so both coordinates use floor (pixel identity — NOT nearest
 * sample: a point on a cell boundary belongs to the cell above/right of it).
 *
 * `row` is returned measured from the TOP of the ppem-row panel: the panel
 * spans `ascentPx` pixel rows above the baseline and `ppem - ascentPx` below,
 * so the first pixel row above the baseline (pixel row 0 from the bottom) is
 * panel row `ascentPx - 1`.
 */
function ppemPoint(
  x: number,
  y: number,
  scale: number,
  ascPx: number,
): { col: number; row: number } {
  const col = Math.floor(x * scale);
  const row = ascPx - 1 - Math.floor(y * scale);
  return { col, row };
}

/**
 * Rasterize the compiled TTF at size=8, bpp=1 using coverage-based 1-bit
 * rendering that matches FreeType's box filtering at 1bpp. Returns
 * measurements for every character in glyphSet.
 */
function measureCompiledTtf(ttfBuffer: ArrayBuffer, glyphSet: string): {
  unitsPerEm: number;
  ascentFU: number;
  descentFU: number;
  cmap: Record<string, number>;
  measurements: Map<number, GlyphMeasurement>;
} {
  const f = Font.create(ttfBuffer, { type: 'ttf', hinting: false }) as unknown as { data: any };
  const ttf = f.data;
  const unitsPerEm: number = Math.round(ttf.head.unitsPerEm);
  const ascentFU: number = Math.round(ttf.hhea.ascent);
  const descentFU: number = Math.round(ttf.hhea.descent); // negative in TTF convention
  const ppem = MAX7219_PIXEL_SIZE;
  const scale = ppem / unitsPerEm;
  const gridRows = ppem;
  // FreeType rounds the scaled ascender to the nearest integer pixel
  // (FT_PIX_ROUND): the baseline boundary sits at panel row ascPx from the
  // top, so panel row r covers scaled y ∈ [ascPx - 1 - r, ascPx - r].
  const ascPx = Math.floor(ascentFU * scale + 0.5);
  const measurements = new Map<number, GlyphMeasurement>();
  const cmap: Record<string, number> = ttf.cmap ?? {};
  const glyf: any[] = ttf.glyf ?? [];

  for (const ch of glyphSet) {
    const cp = ch.codePointAt(0)!;
    if (ch === ' ') {
      const idx = cmap[cp];
      const g = idx != null ? glyf[idx] : null;
      const advanceFU = g ? Math.round(g.advanceWidth ?? 0) : Math.round(unitsPerEm / 4);
      measurements.set(cp, {
        cp,
        present: true,
        bitmap: null,
        advancePx: Math.round(advanceFU * scale),
        heightPx: 0,
        baselineOffset: ascPx,
        clippedTop: false,
        clippedBottom: false,
      });
      continue;
    }
    const idx = cmap[cp];
    if (idx == null) {
      measurements.set(cp, { cp, present: false, bitmap: null, advancePx: 0, heightPx: 0, baselineOffset: ascPx, clippedTop: false, clippedBottom: false });
      continue;
    }
    const g = glyf[idx];
    if (!g) {
      measurements.set(cp, { cp, present: false, bitmap: null, advancePx: 0, heightPx: 0, baselineOffset: ascPx, clippedTop: false, clippedBottom: false });
      continue;
    }

    // Compose contours from components if needed; shift by lsbFU so glyph x
    // coordinates are absolute in font units.
    let contours: Array<Array<{ x: number; y: number; onCurve: boolean }>> = [];
    const lsbFU = Math.round(g.leftSideBearing ?? 0);
    if (g.compound && Array.isArray(g.glyfs)) {
      for (const comp of g.glyfs) {
        const sub = glyf[comp.glyphIndex ?? 0];
        if (!sub || !Array.isArray(sub.contours)) continue;
        const t = comp.transform ?? { a: 1, b: 0, c: 0, d: 1, e: comp.dX ?? 0, f: comp.dY ?? 0 };
        for (const c of sub.contours) {
          contours.push(c.map((p: any) => ({
            x: t.a * p.x + t.c * p.y + (t.e ?? 0) + lsbFU,
            y: t.b * p.x + t.d * p.y + (t.f ?? 0),
            onCurve: !!p.onCurve,
          })));
        }
      }
    } else if (Array.isArray(g.contours)) {
      contours = g.contours.map((c: any) => c.map((p: any) => ({
        x: Math.round(p.x) + lsbFU,
        y: Math.round(p.y),
        onCurve: !!p.onCurve,
      })));
    }

    const advFU = Math.round(g.advanceWidth ?? 0);
    const advancePx = Math.max(0, Math.round(advFU * scale));

    if (!contours.length) {
      measurements.set(cp, { cp, present: false, bitmap: null, advancePx, heightPx: 0, baselineOffset: ascPx, clippedTop: false, clippedBottom: false });
      continue;
    }

    // Compute a bbox in font units, then expand out to a pixel grid large
    // enough to hold any ink we might draw (including ink beyond the 8 rows).
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const c of contours) {
      for (const p of c) {
        if (p.x < xMin) xMin = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.x > xMax) xMax = p.x;
        if (p.y > yMax) yMax = p.y;
      }
    }
    // Convert bbox corners to pixel space and allocate a grid from one pixel
    // left of the leftmost column to one pixel right of the rightmost; extend
    // vertically enough to detect clipping above and below the panel.
    const unitsPerCell = unitsPerEm / ppem;
    const topLeft = ppemPoint(xMin - unitsPerCell, yMax + unitsPerCell, scale, ascPx);
    const botRight = ppemPoint(xMax + unitsPerCell, yMin - unitsPerCell, scale, ascPx);
    const col0 = Math.min(0, topLeft.col);
    const col1 = Math.max(gridRows, botRight.col);
    const row0 = Math.min(0, topLeft.row);
    const row1 = Math.max(gridRows - 1, botRight.row);
    const gridW = col1 - col0 + 1;
    const gridH = row1 - row0 + 1;

    // The rasterizer places y=0 at baselineRow rows from the bottom of its
    // grid. In panel coordinates the baseline is at ascPx-1 from the top,
    // which is (gridRows - ascPx) rows from the bottom. When we allocate the
    // big grid that extends above/below, the baseline row within it is
    // (ascPx - 1) - row0 from the top = (gridH - 1) - ((ascPx - 1) - row0)
    // from the bottom.
    const baselineRowFromTop = ascPx - 1 - row0;
    const baselineRowFromBottom = gridH - 1 - baselineRowFromTop;

    // offsetX is the font-unit X of column 0 of the big grid.
    const offsetX = col0 * unitsPerCell;

    const cov = rasterizeCoverage(contours, {
      gridWidth: gridW,
      gridHeight: gridH,
      unitsPerCell,
      offsetX,
      baselineRow: baselineRowFromBottom,
      threshold: 0.5,
    });
    const { bitmap } = coverageToBitmap(cov, gridW, gridH, 0.5);

    // Extract the 8-row panel, track clipping. rasterizeCoverage numbers its
    // rows bottom-up (row 0 = bottom of the big grid), while panel rows are
    // top-down: big-grid row ry sits at panel row row0 + (gridH - 1 - ry).
    const panel: boolean[][] = Array.from({ length: gridRows }, () => Array(gridW).fill(false));
    let clippedTop = false, clippedBottom = false;
    let topInk = Infinity, bottomInk = -Infinity;
    for (let ry = 0; ry < gridH; ry++) {
      const panelRow = row0 + (gridH - 1 - ry);
      for (let cx = 0; cx < gridW; cx++) {
        if (!bitmap.get(cx, ry)) continue;
        if (panelRow < 0) clippedTop = true;
        else if (panelRow >= gridRows) clippedBottom = true;
        // Ink outside the panel still counts toward the glyph's real pixel
        // height — otherwise a glyph clipped to 8 rows could never be flagged
        // as "taller than 8 px".
        if (panelRow < topInk) topInk = panelRow;
        if (panelRow > bottomInk) bottomInk = panelRow;
        if (panelRow >= 0 && panelRow < gridRows) panel[panelRow][cx] = true;
      }
    }
    let leftCol = gridW, rightCol = -1;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridW; c++) {
        if (panel[r][c]) {
          if (c < leftCol) leftCol = c;
          if (c > rightCol) rightCol = c;
        }
      }
    }
    let trimmed: boolean[][] = [];
    if (rightCol >= leftCol) {
      trimmed = Array.from({ length: gridRows }, (_, r) => {
        const row: boolean[] = [];
        for (let c = leftCol; c <= rightCol; c++) row.push(panel[r][c]);
        return row;
      });
    }
    const inkH = bottomInk >= topInk ? bottomInk - topInk + 1 : 0;
    measurements.set(cp, {
      cp,
      present: true,
      bitmap: trimmed.length ? trimmed : null,
      advancePx,
      heightPx: inkH,
      baselineOffset: ascPx,
      clippedTop,
      clippedBottom,
    });
  }

  return { unitsPerEm, ascentFU, descentFU, cmap, measurements };
}

/**
 * Run the MAX7219 validation checks against the compiled TTF buffer.
 */
export function validateMax7219Font(ttfBuffer: ArrayBuffer, glyphSet: string): ValidationResult {
  const { measurements } = measureCompiledTtf(ttfBuffer, glyphSet);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  let ok = true;

  // 1. Every glyph exists and is non-empty (space may be blank)
  const missing: string[] = [];
  const empty: string[] = [];
  for (const ch of glyphSet) {
    if (ch === ' ') continue;
    const m = measurements.get(ch.codePointAt(0)!);
    if (!m || !m.present) { missing.push(describeChar(ch)); continue; }
    if (!m.bitmap || m.heightPx === 0) empty.push(describeChar(ch));
  }
  push('All glyphs present in cmap', missing.length === 0,
    missing.length === 0 ? `All ${glyphSet.length} requested characters are mapped.` : `Missing: ${missing.join(', ')}`);
  if (missing.length) ok = false;
  push('No glyph renders as empty/.notdef', empty.length === 0,
    empty.length === 0 ? 'No mapped glyph is empty.' : `Empty: ${empty.join(', ')}`);
  if (empty.length) ok = false;

  // 2. No glyph taller than 8 px
  const tooTall: string[] = [];
  for (const [cp, m] of measurements) {
    if (m.heightPx > MAX7219_PIXEL_SIZE) tooTall.push(`${describeChar(String.fromCodePoint(cp))} (${m.heightPx}px)`);
  }
  push(`No glyph taller than ${MAX7219_PIXEL_SIZE} px`, tooTall.length === 0,
    tooTall.length === 0 ? 'Every glyph fits within 8 rows.' : `Taller than 8: ${tooTall.join(', ')}`);
  if (tooTall.length) ok = false;

  // 3. Tallest digit exactly 8 px
  let tallestDigit = 0;
  const digitHeights: string[] = [];
  for (const d of '0123456789') {
    const m = measurements.get(d.codePointAt(0)!);
    const h = m?.heightPx ?? 0;
    if (h > tallestDigit) tallestDigit = h;
    digitHeights.push(`${d}=${h}`);
  }
  push('Tallest digit is exactly 8 px', tallestDigit === MAX7219_PIXEL_SIZE,
    tallestDigit === MAX7219_PIXEL_SIZE
      ? `Digits fill all 8 rows (${digitHeights.join(', ')}).`
      : `Tallest digit is ${tallestDigit} px (need 8). Heights: ${digitHeights.join(', ')}`);
  if (tallestDigit !== MAX7219_PIXEL_SIZE) ok = false;

  // 4. "88:88:88" width
  const testStr = '88:88:88';
  let widthPx = 0;
  let wdMissing = false;
  for (const ch of testStr) {
    const m = measurements.get(ch.codePointAt(0)!);
    if (!m || !m.present) { wdMissing = true; break; }
    widthPx += m.advancePx;
  }
  push('"88:88:88" advance width ≤ 48 px', !wdMissing && widthPx <= 48,
    wdMissing ? 'Cannot measure — one of : or 8 is missing.' : `${widthPx} px (need ≤ 48).`);
  if (wdMissing || widthPx > 48) ok = false;

  // 5. Clipping
  const clippedTop: string[] = [];
  const clippedBot: string[] = [];
  for (const [cp, m] of measurements) {
    if (m.clippedTop) clippedTop.push(describeChar(String.fromCodePoint(cp)));
    if (m.clippedBottom) clippedBot.push(describeChar(String.fromCodePoint(cp)));
  }
  push('No glyph clipped at the top', clippedTop.length === 0,
    clippedTop.length === 0 ? 'No ink above the 8-row grid.' : `Clipped top: ${clippedTop.join(', ')}`);
  if (clippedTop.length) ok = false;
  push('No glyph clipped at the bottom', clippedBot.length === 0,
    clippedBot.length === 0 ? 'No ink below the 8-row grid.' : `Clipped bottom: ${clippedBot.join(', ')}`);
  if (clippedBot.length) ok = false;

  return { ok, checks, glyphs: measurements, tallestDigitPx: tallestDigit, measuredTestStringWidthPx: widthPx };
}

function describeChar(ch: string): string {
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
  lines.push('## Measurements');
  lines.push('');
  lines.push(`- Tallest digit 0-9: **${v.tallestDigitPx} px** (must be 8 px)`);
  lines.push(`- "88:88:88" advance width: **${v.measuredTestStringWidthPx} px** (must be ≤ 48 px)`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Check | Result | Detail |');
  lines.push('| --- | --- | --- |');
  for (const c of v.checks) {
    lines.push(`| ${c.name} | ${c.ok ? '✅ PASS' : '❌ FAIL'} | ${c.detail.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Per-glyph rasterization');
  lines.push('');
  lines.push('| Char | Advance (px) | Height (px) | Clipped top | Clipped bottom |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [cp, m] of v.glyphs) {
    const ch = String.fromCodePoint(cp);
    lines.push(`| ${describeChar(ch)} | ${m.advancePx} | ${m.heightPx} | ${m.clippedTop ? 'YES' : 'no'} | ${m.clippedBottom ? 'YES' : 'no'} |`);
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
