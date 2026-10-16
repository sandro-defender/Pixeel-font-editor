/**
 * Human-readable debug log for the MAX7219 Matrix Clock export.
 *
 * Meant to be copied into a bug report or chat: it shows, side by side, what
 * was drawn in the editor (pixel grids, ink, advance widths), what the
 * compiled TTF tells ESPHome (metrics, outline grid) and what the validator
 * measured at 8 px — including the LED bitmaps the clock will show — plus
 * plain-language hints that point at the editor setting behind a failure.
 */
import { Bitmap } from '../core/bitmap';
import { glyphForCodePoint } from '../core/unicodeMap';
import type { FontDoc, GlyphDoc, PixelData } from '../core/types';
import {
  describeAdvance,
  describeChar,
  fmtNum,
  measureTestString,
  MAX7219_BPP,
  MAX7219_MAX_WIDTH_PX,
  MAX7219_PIXEL_SIZE,
  MAX7219_TEST_STRING,
  type GlyphMeasurement,
  type Max7219Package,
  type ValidationResult,
} from './max7219Export';

const PX = MAX7219_PIXEL_SIZE;
const DIGITS = '0123456789';
/** Characters always listed in the glyph table and drawn as bitmaps. */
const CLOCK_CHARS = DIGITS + ':';
const TABLE_CHARS = CLOCK_CHARS + '.-';
const MAX_TABLE_ROWS = 40;
const BAND_WIDTH = 96;

export interface Max7219DebugEnv {
  appVersion?: string;
  /** Short git commit of the running build. */
  commit?: string;
  now?: Date;
}

/** What the editor holds for one character. */
interface EditorGlyph {
  glyph: GlyphDoc;
  /** The pixel grid that export traces (null for vector / composite / empty glyphs). */
  pixel: PixelData | null;
  bitmap: Bitmap | null;
  inkCols: number;
  inkRows: number;
}

function editorGlyph(doc: FontDoc, cp: number): EditorGlyph | null {
  const glyph = glyphForCodePoint(doc.glyphs, cp);
  if (!glyph) return null;
  const pixel = glyph.kind === 'pixel' && glyph.pixel ? glyph.pixel : null;
  if (!pixel) return { glyph, pixel: null, bitmap: null, inkCols: 0, inkRows: 0 };
  const bitmap = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (!bitmap.get(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const has = Number.isFinite(minX);
  return { glyph, pixel, bitmap, inkCols: has ? maxX - minX + 1 : 0, inkRows: has ? maxY - minY + 1 : 0 };
}

const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const quoted = (ch: string) => (ch === ' ' ? 'SPACE' : `'${ch}'`);

/**
 * Hints that need the editor document: which grid, LED setting or advance
 * width produces the measured numbers, and what to change.
 */
export function editorDiagnosis(doc: FontDoc, v: ValidationResult): string[] {
  const out: string[] = [];
  const led = doc.ledMatrix ?? null;
  const upem = doc.metrics.unitsPerEm;

  // Width: where the advance of '8' and ':' comes from
  const width = measureTestString(v.glyphs);
  if (!width.missing && width.widthPx > MAX7219_MAX_WIDTH_PX) {
    const parts: string[] = [];
    const targets: string[] = [];
    for (const ch of '8:') {
      const e = editorGlyph(doc, ch.codePointAt(0)!);
      if (!e?.pixel) continue;
      const u = e.pixel.unitsPerCell;
      parts.push(
        `${quoted(ch)} is drawn on a ${e.pixel.width}-column grid with ${s(e.inkCols, 'inked column')} and advances ${e.glyph.advanceWidth} units = ${fmtNum(e.glyph.advanceWidth / u, 2)} grid columns`,
      );
      targets.push(`${quoted(ch)} ${(e.inkCols + 1) * u} units`);
    }
    if (parts.length) {
      const fix = led
        ? `In this LED-matrix font every glyph advances its grid width + ${led.spacing} px letter spacing (converted glyphs are at least the matrix default width of ${led.cols} columns). ` +
          `Crop the empty columns of the digits and ':' with "Resize pixel grid…" — the advance follows the new width — or lower "Letter spacing (px)" in "LED matrix…".`
        : `Set the advance width of the digits and ':' to ink + 1 pixel in the glyph's "Advance width" field (or drag the advance line in the pixel editor): ${targets.join(', ')}. ` +
          `Outside LED mode, resizing the pixel grid does not change the advance.`;
      out.push(`${parts.join('; ')}. ${fix}`);
    }
  }

  // Height: grid rows → LED rows
  if (v.tallestDigitPx !== PX) {
    const digits = [...DIGITS]
      .map((d) => editorGlyph(doc, d.codePointAt(0)!))
      .filter((e): e is EditorGlyph => !!e?.pixel && e.inkRows > 0);
    if (digits.length) {
      const tallest = digits.reduce((a, b) => (b.inkRows > a.inkRows ? b : a));
      const px = tallest.pixel!;
      const u = px.unitsPerCell;
      const emRows = upem / u;
      const d = tallest.glyph.unicode !== null ? String.fromCodePoint(tallest.glyph.unicode) : '?';
      let msg =
        `In the editor the tallest digit (${quoted(d)}) is ${s(tallest.inkRows, 'row')} tall on a ${px.width}×${px.height} grid (cell ${u} units); ` +
        `the em is ${upem} units = ${fmtNum(emRows, 2)} grid rows, so it is drawn ${fmtNum((tallest.inkRows * PX) / emRows, 2)} px tall.`;
      if (Math.abs(emRows - PX) > 1e-6) {
        msg += led
          ? ` The LED matrix is ${led.rows} rows tall but a MAX7219 module has 8 rows: set "Matrix height (rows)" to 8 in "LED matrix…".`
          : ` For one LED per drawn pixel the em must be exactly 8 grid rows (unitsPerEm = 8 × ${u} = ${8 * u}): convert the font with "LED matrix…" at 8 rows, ` +
            `or change "Units per em" (and ascent/descent) in "Font info & license → Global metrics".`;
      } else if (tallest.inkRows < PX) {
        msg += ` Draw the digits using all 8 rows of the em.`;
      } else {
        msg += ` Draw the digits at most 8 rows tall.`;
      }
      out.push(msg);
    }
  }

  // Digits on different pixel sizes render at different scales
  const cells = new Set<number>();
  for (const ch of CLOCK_CHARS) {
    const e = editorGlyph(doc, ch.codePointAt(0)!);
    if (e?.pixel) cells.add(e.pixel.unitsPerCell);
  }
  if (cells.size > 1) {
    out.push(`The digits and ':' use different pixel sizes (${[...cells].sort((a, b) => a - b).join(', ')} units per cell), so they render at different scales.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text layout helpers
// ---------------------------------------------------------------------------

/** Pad every column of a table to its widest cell. */
function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 0, [...c].length); });
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c + ' '.repeat(widths[i] - [...c].length))).join('  ').trimEnd());
}

interface Block {
  title: string;
  /** One string per shared row of the band. */
  lines: string[];
}

/** Lay blocks out side by side in bands, with a shared row-label column. */
function bands(labels: string[], blocks: Block[]): string[] {
  const out: string[] = [];
  const labelW = Math.max(0, ...labels.map((l) => l.length));
  let band: Block[] = [];
  let used = labelW;
  const flush = () => {
    if (!band.length) return;
    const widths = band.map((b) => Math.max([...b.title].length, ...b.lines.map((l) => l.length)));
    out.push(' '.repeat(labelW) + '  ' + band.map((b, i) => b.title.padEnd(widths[i])).join('  ').trimEnd());
    labels.forEach((label, r) => {
      out.push(label.padStart(labelW) + '  ' + band.map((b, i) => (b.lines[r] ?? '').padEnd(widths[i])).join('  ').trimEnd());
    });
    out.push('');
    band = [];
    used = labelW;
  };
  for (const b of blocks) {
    const w = Math.max([...b.title].length, ...b.lines.map((l) => l.length)) + 2;
    if (band.length && used + w > BAND_WIDTH) flush();
    band.push(b);
    used += w;
  }
  flush();
  return out;
}

/** The 8 LED rows (plus any rows that fall off) for the given glyphs, as the clock lights them. */
function ledBitmaps(chars: string, v: ValidationResult): string[] {
  const shown = [...chars]
    .map((ch) => ({ ch, m: v.glyphs.get(ch.codePointAt(0)!) }))
    .filter((x): x is { ch: string; m: GlyphMeasurement } => !!x.m && x.m.present);
  if (!shown.length) return ['(none of these characters are in the font)'];
  let r0 = 0, r1 = PX - 1;
  for (const { m } of shown) {
    if (!m.heightPx) continue;
    r0 = Math.min(r0, m.displayTopRow);
    r1 = Math.max(r1, m.displayTopRow + m.heightPx - 1);
  }
  const labels: string[] = [];
  for (let r = r0; r <= r1; r++) labels.push(r < 0 || r >= PX ? `${r}!` : `${r} `);
  const blocks = shown.map(({ ch, m }) => {
    const c0 = Math.min(0, m.inkLeftPx);
    const c1 = Math.max(m.advancePx, m.inkLeftPx + m.inkWidthPx) - 1;
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) {
      let line = '';
      for (let c = c0; c <= c1; c++) {
        const i = r - m.displayTopRow;
        const j = c - m.inkLeftPx;
        const on = !!m.inkBitmap && i >= 0 && i < m.heightPx && j >= 0 && j < m.inkWidthPx && m.inkBitmap[i][j];
        line += on ? '#' : c >= 0 && c < m.advancePx ? '.' : ' ';
      }
      lines.push(line);
    }
    return { title: `${quoted(ch)} ${m.advancePx}px`, lines };
  });
  return bands(labels, blocks);
}

/** The drawn pixel grids of the given glyphs, aligned on their baselines. */
function editorBitmaps(chars: string, doc: FontDoc): string[] {
  const shown = [...chars]
    .map((ch) => ({ ch, e: editorGlyph(doc, ch.codePointAt(0)!) }))
    .filter((x): x is { ch: string; e: EditorGlyph } => !!x.e?.pixel && !!x.e.bitmap);
  if (!shown.length) return ['(no pixel glyphs — the digits are vector or composite glyphs)'];
  let above = 0, below = 0;
  for (const { e } of shown) {
    above = Math.max(above, e.pixel!.height - e.pixel!.baselineRow);
    below = Math.max(below, e.pixel!.baselineRow);
  }
  // k = 0 is the first row above the baseline, k = -1 the first row below it
  const ks: number[] = [];
  for (let k = above - 1; k >= -below; k--) ks.push(k);
  const labels = ks.map((k) => (k >= 0 ? `+${k + 1}` : `${k}`));
  const blocks = shown.map(({ ch, e }) => {
    const px = e.pixel!;
    const lines = ks.map((k) => {
      const y = k + px.baselineRow;
      if (y < 0 || y >= px.height) return ' '.repeat(px.width);
      let line = '';
      for (let x = 0; x < px.width; x++) line += e.bitmap!.get(x, y) ? '#' : '.';
      return line;
    });
    return { title: `${quoted(ch)} ${px.width}×${px.height}`, lines };
  });
  return bands(labels, blocks);
}

function gridLabel(e: EditorGlyph | null): string {
  if (!e) return 'missing';
  if (!e.pixel) return e.glyph.kind === 'compound' ? 'composite' : e.glyph.kind;
  const p = e.pixel;
  return `${p.width}×${p.height} @${p.unitsPerCell} b${p.baselineRow}${p.offsetX ? ` x${p.offsetX}` : ''}`;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * Build the debug log for a validated MAX7219 package. Plain text, about a
 * hundred lines, safe to paste anywhere.
 */
export function buildMax7219DebugLog(doc: FontDoc, pkg: Max7219Package, env: Max7219DebugEnv = {}): string {
  const v = pkg.validation;
  const m = v.metrics;
  const L: string[] = [];
  const failed = v.checks.filter((c) => !c.ok).length;
  const glyphSet = [...pkg.settings.glyphs];

  L.push('===== Pixeel MAX7219 debug log =====');
  L.push(`Pixeel v${env.appVersion ?? '?'}${env.commit ? ` (build ${env.commit})` : ''} · ${(env.now ?? new Date()).toISOString()}`);
  L.push(`Result: ${v.ok ? 'PASS' : `FAIL — ${failed} of ${v.checks.length} checks failed`}`);
  L.push(`Package ${pkg.fileName} · label "${pkg.settings.label}" · size ${pkg.settings.pixelSize} · bpp ${MAX7219_BPP}`);
  L.push(`Glyph set (${glyphSet.length}): ${pkg.settings.glyphs}`);

  L.push('');
  L.push('--- Checks ---');
  for (const c of v.checks) L.push(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);

  const hints = [...v.diagnosis, ...editorDiagnosis(doc, v)];
  if (hints.length) {
    L.push('');
    L.push('--- Diagnosis ---');
    for (const h of hints) L.push(`* ${h}`);
  }

  // Editor
  const dm = doc.metrics;
  const led = doc.ledMatrix ?? null;
  L.push('');
  L.push('--- Editor font ---');
  const origin = !doc.source || doc.source.format === 'created'
    ? 'created in Pixeel'
    : `imported from ${doc.source.fileName} (${doc.source.container ?? doc.source.format}${doc.source.hasHinting ? ', hinted' : ''})`;
  L.push(`"${doc.meta.fontFamily}" ${doc.meta.fontSubFamily} · ${doc.glyphs.length} glyphs · ${origin}`);
  L.push(
    `unitsPerEm ${dm.unitsPerEm} · ascent ${dm.ascent} · descent ${dm.descent} · lineGap ${dm.lineGap}` +
      (dm.useTypoMetrics !== undefined ? ` · useTypoMetrics ${dm.useTypoMetrics ? 'on' : 'off'}` : '') +
      (dm.typoAscender !== undefined ? ` · typo ${dm.typoAscender}/${dm.typoDescender ?? '?'}/${dm.typoLineGap ?? '?'}` : ''),
  );
  L.push(
    led
      ? `LED matrix: ${led.rows} rows · default width ${led.cols} · letter spacing ${led.spacing} · ${led.cellUnits} units per pixel · ${led.descentRows} rows below baseline`
      : 'LED matrix: off',
  );
  const grids = new Map<string, number>();
  const kinds = new Map<string, number>();
  for (const ch of new Set(glyphSet)) {
    if (ch === ' ') continue;
    const e = editorGlyph(doc, ch.codePointAt(0)!);
    if (e?.pixel) {
      const key = `${e.pixel.width}×${e.pixel.height} cell ${e.pixel.unitsPerCell} baseline row ${e.pixel.baselineRow}`;
      grids.set(key, (grids.get(key) ?? 0) + 1);
    } else {
      const key = e ? (e.glyph.kind === 'compound' ? 'composite' : e.glyph.kind) : 'missing';
      kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
  }
  const gridList = [...grids].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (×${n})`);
  const kindList = [...kinds].map(([k, n]) => `${k} ×${n}`);
  L.push(`Glyph-set grids: ${[...gridList, ...kindList].join('; ') || 'none'}`);
  const cellSizes = [...new Set([...grids.keys()].map((k) => Number(/cell (\d+(?:\.\d+)?)/.exec(k)?.[1])))].filter(Number.isFinite);
  for (const u of cellSizes) {
    L.push(`  cell ${u} units → em = ${fmtNum(dm.unitsPerEm / u, 2)} grid rows → 1 drawn pixel = ${fmtNum((u * PX) / dm.unitsPerEm)} LED px at size 8`);
  }

  // Compiled TTF
  L.push('');
  L.push('--- Compiled TTF (what ESPHome reads) ---');
  L.push(`${pkg.ttf.byteLength} bytes · SHA-256 ${pkg.ttfSha256.slice(0, 16)}… · family "${pkg.familyName}"`);
  L.push(
    `unitsPerEm ${m.unitsPerEm} · ${m.usesTypoMetrics ? 'OS/2 typo' : 'hhea'} ascent ${m.ascentFU} / descent ${m.descentFU} / lineGap ${m.lineGapFU} · ` +
      `hinting: ${m.hasHinting ? 'TrueType bytecode' : 'none (FreeType auto-hinter)'}`,
  );
  L.push(`At 8 px: 1 px = ${fmtNum(m.unitsPerPx)} units · ascender ${m.ascenderPx} px · descender ${m.descenderPx} px · line height ${m.lineHeightPx} px`);
  const p = m.pxPerLatticeCell;
  L.push(
    `Outline pixel grid: ${m.latticeFU && p
      ? `${m.latticeFU} units = ${fmtNum(p)} LED px per drawn pixel${Math.abs(p - Math.round(p)) > 1e-6 ? '  <-- not whole LEDs' : ' (exact)'}`
      : 'none (vector outlines)'}`,
  );
  L.push(
    m.zeroDisplayTopRow !== null && m.zeroHeightPx !== null
      ? `Clock placement: '0' ink is ${m.zeroHeightPx} px tall (bitmap_top ${m.zeroInkTopPx}) → centred on LED rows ${m.zeroDisplayTopRow}–${m.zeroDisplayTopRow + m.zeroHeightPx - 1}`
      : `Clock placement: no '0' ink → text box top on LED row ${m.textBoxTopRow}`,
  );

  // Glyph table
  const flagged = (g: GlyphMeasurement) => !g.present || g.heightPx === 0 || g.heightPx > PX || g.clippedTop || g.clippedBottom;
  const listed: string[] = [];
  for (const ch of TABLE_CHARS) if (glyphSet.includes(ch) && !listed.includes(ch)) listed.push(ch);
  for (const ch of glyphSet) {
    if (ch === ' ' || listed.includes(ch)) continue;
    const g = v.glyphs.get(ch.codePointAt(0)!);
    if (g && flagged(g)) listed.push(ch);
  }
  const shownRows = listed.slice(0, MAX_TABLE_ROWS);
  const header = ['char', 'editor grid', 'ink c×r', 'advance units→px', 'TTF ink box (units)', '8px ink w×h', 'left', 'LED rows', 'clipped'];
  const rows = shownRows.map((ch) => {
    const cp = ch.codePointAt(0)!;
    const g = v.glyphs.get(cp);
    const e = editorGlyph(doc, cp);
    if (!g || !g.present) return [describeChar(ch), gridLabel(e), '-', '-', 'not in the TTF', '-', '-', '-', '-'];
    const b = g.bboxFU;
    return [
      describeChar(ch),
      gridLabel(e),
      e?.pixel ? `${e.inkCols}×${e.inkRows}` : '-',
      `${g.advanceFU}→${g.advancePx}`,
      b ? `${b.xMin},${b.yMin}..${b.xMax},${b.yMax}` : 'blank',
      g.heightPx ? `${g.inkWidthPx}×${g.heightPx}` : 'blank',
      g.heightPx ? String(g.inkLeftPx) : '-',
      g.heightPx ? (g.heightPx === 1 ? `${g.displayTopRow}` : `${g.displayTopRow}–${g.displayTopRow + g.heightPx - 1}`) : '-',
      [g.rowsClippedTop ? `top ${g.rowsClippedTop}` : '', g.rowsClippedBottom ? `bottom ${g.rowsClippedBottom}` : ''].filter(Boolean).join(', ') || '-',
    ];
  });
  L.push('');
  L.push('--- Glyphs (editor → compiled TTF → 8 px on the clock) ---');
  L.push(...table([header, ...rows]));
  const others = glyphSet.filter((ch) => ch !== ' ' && !listed.includes(ch)).length;
  if (listed.length > shownRows.length) L.push(`… ${listed.length - shownRows.length} more flagged characters not shown`);
  if (others) L.push(`(${s(others, 'other character')} measured without problems)`);

  // Test string
  const width = measureTestString(v.glyphs);
  L.push('');
  L.push(`--- "${MAX7219_TEST_STRING}" (must be ≤ ${MAX7219_MAX_WIDTH_PX} px) ---`);
  if (width.missing) {
    L.push("Cannot measure — '8' or ':' is missing.");
  } else {
    for (const part of width.parts) {
      L.push(`${quoted(part.ch)} × ${part.count}: ${describeAdvance(part.advancePx, part.inkWidthPx)} each = ${part.advancePx * part.count} px`);
    }
    const tight = width.parts.reduce((sum, part) => sum + part.count * (part.inkWidthPx + 1), 0);
    L.push(`Total ${width.widthPx} px · with every glyph advancing ink + 1 px it would be ${tight} px`);
  }

  // Bitmaps
  L.push('');
  L.push("--- 8 px on the clock (# = LED on, . = blank inside the advance; rows marked ! are off the display) ---");
  L.push(...ledBitmaps(CLOCK_CHARS, v));
  L.push("--- Drawn in the editor (# = pixel; +1 is the first row above the baseline, -1 the first below) ---");
  L.push(...editorBitmaps(CLOCK_CHARS, doc));
  L.push('===== end of MAX7219 debug log =====');
  return L.join('\n');
}
