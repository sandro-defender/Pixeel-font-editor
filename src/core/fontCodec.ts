/**
 * TTF import / export built on fonteditor-core.
 *
 * Capability notes (verified against fonteditor-core 2.6.x):
 *  - Reads TTF (glyf) incl. composite glyphs, hinting instructions, GPOS/kern.
 *  - Writes genuine TrueType `glyf` + `loca` with computed table checksums.
 *  - Writer emits: OS/2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post
 *    and optionally cvt/fpgm/prep/gasp (hinting) and GPOS/kern/kerx (kerning).
 *  - Everything else (GSUB, GDEF, COLR, fvar/gvar, ...) cannot be preserved.
 */
import { Font } from 'fonteditor-core';
import type { FontEditor } from 'fonteditor-core';

type FontInstance = FontEditor.Font;
import type {
  CompoundComponent,
  Contour,
  FontDoc,
  FontMeta,
  GlyphDoc,
} from './types';
import { makeId } from './types';
import { EMPTY_META, deriveMetaFields } from './metadata';
import { tracePixelData } from './trace';
import { transformContours, contourBounds } from './contours';
import { b64ToBytes } from './bitmap';
import { checkLedFont, ledLabel } from './ledMatrix';
import { effectiveVertical } from './verticalMetrics';
import { describeCodePoint } from './unicodeNames';
import { allUnicodes, duplicateMappings } from './unicodeMap';
import { analyzeCoverage, coverageSummaryLine, type CoverageReport } from './coverage';
import { pointsForSet } from './charSets';
import { unwrapFont } from './woff';
import { codePointsByGlyph, readCmapFromSfnt } from './cmapRead';
import { finalizeSfnt } from './sfntFinalize';
import { rangeWords, unicodeRangeBits, wordBits } from './os2Ranges';
import { buildKernTable, effectivePairs, kerningFromTtf, kerningOf, kerningToIndexPairs, parseKernTable } from './kerning';

export interface TtfLike {
  head: Record<string, unknown> & { unitsPerEm: number };
  hhea: Record<string, unknown>;
  name: Record<string, string>;
  glyf: Array<Record<string, any>>;
  cmap?: Record<string, number>;
  maxp?: Record<string, unknown>;
  'OS/2'?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Normalize a write result to a standalone ArrayBuffer. */
export function toStandaloneBuffer(raw: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw;
  const bytes = raw as Uint8Array;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Read the sfnt table directory without a full parse. */
export function listTables(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error('File is too small to be a font.');
  const sfnt = view.getUint32(0);
  const tags = [
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
  ].map((b) => String.fromCharCode(b)).join('');
  if (tags === 'wOFF' || tags === 'wOF2') {
    throw new Error('This is a WOFF/WOFF2 container; unwrap it first with unwrapFont().');
  }
  if (sfnt !== 0x00010000 && tags !== 'true' && tags !== 'OTTO') {
    throw new Error('Not a TrueType/OpenType font (bad sfnt version).');
  }
  const numTables = view.getUint16(4);
  const tables: string[] = [];
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    if (off + 16 > buffer.byteLength) break;
    let tag = '';
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(view.getUint8(off + j));
    tables.push(tag);
  }
  return tables;
}

/**
 * The sfnt table directory must list every tag exactly once, sorted ascending
 * by tag (OpenType spec; OTS — the sanitizer Chrome and Firefox run on every
 * web font — reports "Table directory is not correctly ordered" otherwise, and
 * a duplicate entry means the same bytes are stored twice).
 */
export function checkTableDirectory(buffer: ArrayBuffer): { ok: boolean; detail: string; tags: string[] } {
  let tags: string[];
  try {
    tags = listTables(buffer);
  } catch (err) {
    return { ok: false, tags: [], detail: `Table directory could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
  const counts = new Map<string, number>();
  for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const problems: string[] = [];
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([t, n]) => `${t.trim()} ×${n}`);
  if (duplicates.length) problems.push(`written more than once: ${duplicates.join(', ')}`);
  const sorted = [...tags].sort();
  if (tags.some((t, i) => t !== sorted[i])) problems.push('tags are not in ascending order');
  const list = tags.map((t) => t.trim()).join(', ');
  return {
    ok: problems.length === 0,
    tags,
    detail: problems.length ? `${problems.join('; ')} (${list}).` : `${tags.length} table(s), each once and in ascending order: ${list}.`,
  };
}

export interface ImportResult {
  doc: FontDoc;
  sourceTtf: TtfLike;
  warnings: string[];
  /** Character coverage of the imported file (see core/coverage.ts). */
  coverage: CoverageReport;
}

const NAME_KEYS: Array<keyof FontMeta> = [
  'fontFamily', 'fontSubFamily', 'fullName', 'postScriptName', 'uniqueSubFamily',
  'version', 'copyright', 'designer', 'manufacturer', 'description',
  'urlOfFontVendor', 'urlOfFontDesigner', 'licence', 'urlOfLicence',
];

/** Import a .ttf (or CFF-based .otf) from raw bytes. */
export async function importFont(input: ArrayBuffer | Uint8Array, fileName: string): Promise<ImportResult> {
  // WOFF / WOFF2 are decompressed here (client-side) to the original sfnt bytes
  const { buffer, container } = await unwrapFont(toStandaloneBuffer(input));
  const tables = listTables(buffer);
  const hasGlyf = tables.includes('glyf');
  const hasCff = tables.includes('CFF ') || tables.includes('CFF2');
  if (!hasGlyf && !hasCff) {
    throw new Error('This font contains no outline table (glyf/CFF) and cannot be edited.');
  }
  const format: 'ttf' | 'otf' = hasGlyf ? 'ttf' : 'otf';
  const warnings: string[] = [];

  let font: FontInstance;
  try {
    font = Font.create(buffer, { type: format, hinting: true, kerning: true }) as unknown as FontInstance;
  } catch (err) {
    throw new Error(`Failed to parse font: ${err instanceof Error ? err.message : String(err)}`);
  }
  const ttf = font.data as unknown as TtfLike;
  if (format === 'otf') {
    warnings.push('Imported an OpenType font with CFF outlines. Curves were converted to quadratic TrueType segments; hinting could not be preserved from CFF.');
  }

  const srcGlyf = (ttf.glyf ?? []) as Array<Record<string, any>>;
  const glyphs: GlyphDoc[] = [];
  let extraCount = 0;

  // Code points come from the Unicode cmap subtables, read from the raw bytes
  // (see core/cmapRead.ts): fonteditor-core merges the legacy Macintosh
  // subtable into its map as if its byte codes were Unicode, which invents
  // mappings such as “≤” answering to U+00B2.
  const cmapRead = readCmapFromSfnt(buffer);
  const cmapByGlyph = cmapRead ? codePointsByGlyph(cmapRead.map) : null;
  if (cmapRead?.source === 'macRoman') {
    warnings.push('This font has no Unicode character table; its legacy Macintosh (Mac Roman) table was converted to Unicode.');
  }
  if (cmapRead?.source === 'symbol') {
    warnings.push('This font only has a Windows Symbol character table; its code points are kept as they are (usually U+F020…U+F0FF).');
  }
  if (cmapRead?.variationSequences) {
    warnings.push(`${cmapRead.variationSequences} Unicode variation sequence(s) cannot be edited or exported and were ignored.`);
  }

  // First pass: create docs so compound references can be resolved by index.
  for (let i = 0; i < srcGlyf.length; i++) {
    const g = srcGlyf[i];
    const parsed: number[] = Array.isArray(g.unicode) ? g.unicode : g.unicode != null ? [g.unicode] : [];
    const unicodes: number[] = cmapByGlyph ? (cmapByGlyph.get(i) ?? []) : parsed;
    // keep the parsed source consistent with what the file really maps: it is
    // kept for export (boxes, kerning) and must not carry the Mac Roman codes
    if (cmapByGlyph) g.unicode = unicodes.length ? [...unicodes] : undefined;
    const unicode = unicodes.length ? unicodes[0] : null;
    const extraUnicodes = [...new Set(unicodes.slice(1))].filter((cp) => cp !== unicode);
    if (extraUnicodes.length) extraCount += extraUnicodes.length;
    const contours: Contour[] = Array.isArray(g.contours)
      ? g.contours.map((c: Array<Record<string, number>>) =>
          c.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), onCurve: !!p.onCurve })),
        )
      : [];
    glyphs.push({
      id: makeId('g'),
      name: g.name || `.glyph${i}`,
      unicode,
      ...(extraUnicodes.length ? { extraUnicodes } : {}),
      advanceWidth: Math.round(g.advanceWidth ?? 0),
      leftSideBearing: Math.round(g.leftSideBearing ?? (contourBounds([contours[0] ?? []])?.xMin ?? 0)),
      kind: g.compound ? 'compound' : contours.length ? 'vector' : 'empty',
      contours,
      pixel: null,
      compound: null,
      instructions: Array.isArray(g.instructions) && g.instructions.length ? [...g.instructions] : null,
      sourceContours: contours.length ? contours.map((c) => c.map((p) => ({ ...p }))) : null,
      edited: false,
      srcIndex: i,
      origin: 'imported',
    });
  }

  // Second pass: resolve compound component references.
  for (let i = 0; i < srcGlyf.length; i++) {
    const g = srcGlyf[i];
    if (!g.compound || !Array.isArray(g.glyfs)) continue;
    const comps: CompoundComponent[] = g.glyfs.map((c: Record<string, any>) => {
      const idx = c.glyphIndex ?? 0;
      const t = c.transform ?? { a: 1, b: 0, c: 0, d: 1, e: c.dX ?? 0, f: c.dY ?? 0 };
      return {
        srcGlyphIndex: idx,
        glyphId: glyphs[idx] ? glyphs[idx].id : null,
        transform: { a: t.a ?? 1, b: t.b ?? 0, c: t.c ?? 0, d: t.d ?? 1, e: t.e ?? 0, f: t.f ?? 0 },
        useMyMetrics: !!c.useMyMetrics,
        overlapCompound: !!c.overlapCompound,
      };
    });
    glyphs[i].compound = comps;
    // Flatten for preview/outline editing reference:
    glyphs[i].contours = flattenComponents(glyphs, comps, new Set([i]));
    glyphs[i].sourceContours = glyphs[i].contours.map((c) => c.map((p) => ({ ...p })));
  }

  if (glyphs.length === 0) {
    glyphs.push(emptyGlyphDoc('.notdef', 500));
  }
  if (glyphs[0].name !== '.notdef') glyphs[0].name = glyphs[0].name || '.notdef';

  const meta: FontMeta = { ...EMPTY_META };
  const names = (ttf.name ?? {}) as Record<string, string>;
  for (const k of NAME_KEYS) {
    if (typeof names[k] === 'string' && names[k].trim()) meta[k] = names[k];
  }

  const head = ttf.head ?? ({} as any);
  const hhea = ttf.hhea ?? ({} as any);
  const os2 = (ttf['OS/2'] ?? null) as Record<string, unknown> | null;
  const os2Num = (k: string): number | undefined => (os2 && Number.isFinite(Number(os2[k])) && os2[k] !== undefined ? Math.round(Number(os2[k])) : undefined);
  const doc: FontDoc = {
    fontId: makeId('f'),
    meta: deriveMetaFields(meta),
    metrics: {
      unitsPerEm: Math.round(Number(head.unitsPerEm ?? 1000)),
      ascent: Math.round(Number(hhea.ascent ?? 800)),
      descent: Math.round(Number(hhea.descent ?? -200)),
      lineGap: Math.round(Number(hhea.lineGap ?? 0)),
      ...(os2
        ? {
            typoAscender: os2Num('sTypoAscender'),
            typoDescender: os2Num('sTypoDescender'),
            typoLineGap: os2Num('sTypoLineGap'),
            winAscent: os2Num('usWinAscent'),
            winDescent: os2Num('usWinDescent'),
            useTypoMetrics: (Number(os2.fsSelection ?? 0) & 0x80) !== 0,
          }
        : {}),
    },
    glyphs,
    source: {
      fileName,
      format,
      ...(container !== 'sfnt' ? { container } : {}),
      tables,
      hasHinting: !!(ttf.cvt || ttf.fpgm || ttf.prep) || glyphs.some((g) => g.instructions),
      hasKerning: !!(ttf.kern || ttf.GPOS || ttf.kerx),
      hasComposites: glyphs.some((g) => g.kind === 'compound'),
      numGlyphs: glyphs.length,
      importedAt: Date.now(),
    },
    sourceRef: null, // assigned by the store when registering sourceTtf
  };

  const kern = kerningFromTtf(ttf as { kern?: ArrayLike<number>; GPOS?: ArrayLike<number> }, glyphs);
  if (kern) {
    doc.kerning = kern.pairs;
    warnings.push(...kern.warnings);
  }

  const dropTargets = tables.filter((t) => !CORE_WRITABLE.has(t) && !HINTING_TABLES.has(t) && !KERNING_TABLES.has(t) && !ALWAYS_IGNORED.has(t));
  if (dropTargets.length) {
    warnings.push(`Tables that cannot be preserved on export: ${dropTargets.join(', ')}. See the export report for details.`);
  }
  if (container !== 'sfnt') {
    warnings.push(`Opened from ${container === 'woff' ? 'WOFF' : 'WOFF2'}: it was decompressed in your browser (nothing was uploaded). Export writes a plain .ttf.`);
  }
  if (extraCount) warnings.push(`${extraCount} additional code point mapping(s) shared with another code point of the same glyph were imported (see the glyph's Unicode mappings).`);

  // Character coverage of the file that was just read (see core/coverage.ts).
  // The caller turns this into the user-facing message; importFont only reports
  // that nothing editable could be read at all.
  const coverage = analyzeCoverage(doc);
  if (coverage.unusable) {
    warnings.push('No editable glyphs could be read from this font — character sets cannot be added to it.');
  }

  return { doc, sourceTtf: ttf, warnings, coverage };
}

export const CORE_WRITABLE = new Set(['glyf', 'loca', 'head', 'hhea', 'hmtx', 'maxp', 'cmap', 'name', 'post', 'OS/2']);
export const HINTING_TABLES = new Set(['cvt ', 'cvt', 'fpgm', 'prep', 'gasp']);
export const KERNING_TABLES = new Set(['GPOS', 'kern', 'kerx']);
const ALWAYS_IGNORED = new Set(['DSIG', 'LTSH', 'VDMX', 'hdmx', 'vhea', 'vmtx', 'FFTM']);

export function classifyDroppedTables(tables: string[], preserveHinting: boolean, preserveKerning: boolean): string[] {
  return tables.filter((t) => {
    if (CORE_WRITABLE.has(t)) return false;
    if (HINTING_TABLES.has(t)) return !preserveHinting;
    if (KERNING_TABLES.has(t)) return !preserveKerning;
    if (ALWAYS_IGNORED.has(t)) return true;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Compound flattening
// ---------------------------------------------------------------------------

export function flattenComponents(all: GlyphDoc[], comps: CompoundComponent[], visiting: Set<number> = new Set()): Contour[] {
  const out: Contour[] = [];
  for (const comp of comps) {
    const target = comp.glyphId ? all.find((g) => g.id === comp.glyphId) : comp.srcGlyphIndex < all.length ? all[comp.srcGlyphIndex] : undefined;
    if (!target) continue;
    let contours: Contour[];
    if (target.kind === 'pixel' && target.pixel) {
      contours = tracePixelData(target.pixel);
    } else if (target.kind === 'compound' && target.compound) {
      const idx = target.srcIndex ?? all.indexOf(target);
      if (visiting.has(idx)) continue; // cycle guard
      const v = new Set(visiting);
      v.add(idx);
      contours = flattenComponents(all, target.compound, v);
    } else {
      contours = target.contours;
    }
    out.push(...transformContours(contours, comp.transform));
  }
  return out;
}

/** Replace a compound glyph with simple editable outlines (explicit user action). */
export function flattenedGlyph(glyph: GlyphDoc, all: GlyphDoc[]): GlyphDoc {
  if (glyph.kind !== 'compound' || !glyph.compound) return glyph;
  const contours = flattenComponents(all, glyph.compound);
  return {
    ...glyph,
    kind: contours.length ? 'vector' : 'empty',
    contours,
    compound: null,
    sourceContours: contours.map((c) => c.map((p) => ({ ...p }))),
    edited: true,
    instructions: null,
  };
}

export function emptyGlyphDoc(name: string, advance = 500): GlyphDoc {
  return {
    id: makeId('g'),
    name,
    unicode: null,
    advanceWidth: advance,
    leftSideBearing: 0,
    kind: 'empty',
    contours: [],
    pixel: null,
    compound: null,
    instructions: null,
    sourceContours: null,
    edited: false,
    srcIndex: null,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportOptions {
  preserveHinting: boolean;
  preserveKerning: boolean;
  validate: boolean;
}

export interface ValidationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  checks: ValidationCheck[];
}

export interface ExportReport {
  bytes: number;
  writtenTables: string[];
  preservedTables: string[];
  droppedTables: string[];
  notes: string[];
  validation: ValidationResult | null;
}

export interface ExportInput {
  doc: FontDoc;
  sourceTtf: TtfLike | null;
  options: ExportOptions;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  preserveHinting: true,
  preserveKerning: true,
  validate: true,
};

function emptyTtfObject(): TtfLike {
  return (Font.create() as unknown as FontInstance).data as unknown as TtfLike;
}

/**
 * The source font's glyph-indexed tables (kern, GPOS) are only valid while every
 * glyph still sits at its original index: nothing deleted or inserted before the
 * end of the list.
 */
export function glyphOrderPreserved(doc: FontDoc): boolean {
  const original = doc.source?.numGlyphs ?? 0;
  return doc.glyphs.every((g, i) => (g.srcIndex === null ? i >= original : g.srcIndex === i));
}

/** Resolve the export contours for a glyph. */
export function resolveGlyphContours(glyph: GlyphDoc, all: GlyphDoc[]): Contour[] {
  if (glyph.kind === 'pixel' && glyph.pixel) return tracePixelData(glyph.pixel);
  if (glyph.kind === 'compound' && glyph.compound) return flattenComponents(all, glyph.compound);
  return glyph.contours;
}

/** Integer bounding box of a glyph outline, in font units (the glyf header fields). */
export interface GlyfBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** A component's 2×2 matrix is stored as F2Dot14 — the precision it really has in the file. */
const toF2Dot14 = (v: number): number => Math.round(v * 16384) / 16384;

/**
 * Outline bounds of glyf records (the writer's input, or a re-parsed font):
 * simple glyphs from all their points, on- and off-curve — the TrueType
 * definition — and composites from their components' points through the stored
 * transform (offsets as written, 2×2 part at F2Dot14 precision), rounded once
 * at the end like fontTools does. null for a glyph without an outline.
 */
export function glyfRecordBounds(records: ReadonlyArray<Record<string, any> | null | undefined>): Array<GlyfBox | null> {
  const memo = new Map<number, number[]>(); // flattened points: x0, y0, x1, y1, …
  const flatten = (i: number, stack: Set<number>): number[] => {
    const known = memo.get(i);
    if (known) return known;
    const rec = records[i];
    const out: number[] = [];
    if (rec?.compound && Array.isArray(rec.glyfs)) {
      if (stack.has(i)) return out; // component cycle: contributes nothing
      stack.add(i);
      for (const comp of rec.glyfs) {
        const t = comp?.transform ?? {};
        const a = toF2Dot14(t.a ?? 1), b = toF2Dot14(t.b ?? 0), c = toF2Dot14(t.c ?? 0), d = toF2Dot14(t.d ?? 1);
        const e = Number(t.e ?? 0), f = Number(t.f ?? 0);
        const pts = typeof comp?.glyphIndex === 'number' ? flatten(comp.glyphIndex, stack) : [];
        for (let k = 0; k < pts.length; k += 2) out.push(a * pts[k] + c * pts[k + 1] + e, b * pts[k] + d * pts[k + 1] + f);
      }
      stack.delete(i);
    } else if (rec && Array.isArray(rec.contours)) {
      for (const contour of rec.contours) for (const p of contour) out.push(Number(p.x), Number(p.y));
    }
    memo.set(i, out);
    return out;
  };
  return records.map((_, i) => {
    const pts = flatten(i, new Set());
    if (!pts.length) return null;
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k], y = pts[k + 1];
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    return { xMin: Math.round(xMin), yMin: Math.round(yMin), xMax: Math.round(xMax), yMax: Math.round(yMax) };
  });
}

/** The glyf header box a parsed record carries, or null when it has none. */
function storedBox(rec: Record<string, any> | null | undefined): GlyfBox | null {
  if (!rec) return null;
  const v = [rec.xMin, rec.yMin, rec.xMax, rec.yMax];
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { xMin: v[0], yMin: v[1], xMax: v[2], yMax: v[3] };
}

/** Within a font unit on every side: font compilers round scaled composites differently. */
function boxesAgree(a: GlyfBox, b: GlyfBox): boolean {
  return Math.abs(a.xMin - b.xMin) <= 1 && Math.abs(a.yMin - b.yMin) <= 1 && Math.abs(a.xMax - b.xMax) <= 1 && Math.abs(a.yMax - b.yMax) <= 1;
}

/** hhea's horizontal extents, over the glyphs that have an outline (the OpenType definition). */
export interface HorizontalExtents {
  minLeftSideBearing: number;
  minRightSideBearing: number;
  xMaxExtent: number;
}

/**
 * Give every glyph record its glyf-header bounding box and hmtx left side
 * bearing. FreeType — Linux, Android, ESPHome, Pillow… — puts a glyph's
 * outline at x − (header xMin − lsb), and OTS, the sanitizer Chrome and Firefox
 * run on every web font, rejects a font whose head bbox is inverted; both have
 * to describe the outline that is really written:
 * - a glyph Pixeel draws (pixel glyphs) or the user created or changed gets the
 *   box of its written points and lsb = xMin, so it renders exactly where the
 *   editor shows it;
 * - an untouched imported glyph whose source header matches its outline keeps
 *   the source's box and lsb, so FreeType renders it exactly like the original
 *   font — including fonts whose lsb deliberately differs from xMin, and
 *   hinting that measures from the phantom points;
 * - an untouched glyph whose source header did not match (e.g. an old export
 *   with a 0,0,0,0 box) gets its real box and lsb = xMin;
 * - a glyph without an outline gets no box (it has no glyf entry and must not
 *   stretch the font box) and lsb 0, unless it is an untouched import.
 */
function applyGlyfBounds(records: Array<Record<string, any>>, glyphs: GlyphDoc[], sourceTtf: TtfLike | null): { inked: number; extents: HorizontalExtents } {
  const boxes = glyfRecordBounds(records);
  const srcGlyf = (sourceTtf?.glyf ?? []) as Array<Record<string, any>>;
  let inked = 0;
  let minLeft = Infinity, minRight = Infinity, maxExtent = -Infinity;
  records.forEach((rec, i) => {
    const g = glyphs[i];
    const untouched = !!g && !g.edited && g.origin !== 'added' && typeof g.srcIndex === 'number' && g.kind !== 'pixel';
    const box = boxes[i];
    if (!box) {
      if (!untouched) rec.leftSideBearing = 0;
      return;
    }
    const source = untouched ? storedBox(srcGlyf[g.srcIndex!]) : null;
    if (source && boxesAgree(source, box)) {
      Object.assign(rec, source); // and the source's lsb, already on the record
    } else {
      Object.assign(rec, box);
      rec.leftSideBearing = box.xMin;
    }
    inked += 1;
    const extent = rec.leftSideBearing + (rec.xMax - rec.xMin);
    minLeft = Math.min(minLeft, rec.leftSideBearing);
    minRight = Math.min(minRight, rec.advanceWidth - extent);
    maxExtent = Math.max(maxExtent, extent);
  });
  return {
    inked,
    extents: inked
      ? { minLeftSideBearing: minLeft, minRightSideBearing: minRight, xMaxExtent: maxExtent }
      : { minLeftSideBearing: 0, minRightSideBearing: 0, xMaxExtent: 0 },
  };
}

/** Every code point a document maps, primary and extra. */
export function documentCodePoints(doc: FontDoc): Set<number> {
  const out = new Set<number>();
  for (const g of doc.glyphs) for (const cp of allUnicodes(g)) out.add(cp);
  return out;
}

/** Code points a parsed source font maps (its glyf records carry the lists). */
function sourceCodePoints(sourceTtf: TtfLike | null): Set<number> {
  const out = new Set<number>();
  for (const rec of (sourceTtf?.glyf ?? []) as Array<Record<string, any>>) {
    const u = rec?.unicode;
    if (Array.isArray(u)) for (const cp of u) out.add(Number(cp));
    else if (typeof u === 'number') out.add(u);
  }
  return out;
}

/**
 * The OS/2 ulUnicodeRange1-4 words an export should carry.
 *
 * A font created in Pixeel gets the blocks of its own characters, computed
 * like fontTools' `intersectUnicodeRanges`. An imported font keeps the words
 * its designer chose and only gains bits for blocks whose characters were
 * added in Pixeel — a font may deliberately claim (or not claim) a block it
 * only partly covers, and an export must not quietly change that.
 */
export function exportUnicodeRanges(doc: FontDoc, sourceTtf: TtfLike | null): [number, number, number, number] {
  const docPoints = documentCodePoints(doc);
  const os2 = (sourceTtf?.['OS/2'] ?? null) as Record<string, unknown> | null;
  if (!os2) return rangeWords(unicodeRangeBits(docPoints));
  const sourceWords = [1, 2, 3, 4].map((i) => Number(os2[`ulUnicodeRange${i}`] ?? 0) >>> 0);
  const sourcePoints = sourceCodePoints(sourceTtf);
  const added = [...docPoints].filter((cp) => !sourcePoints.has(cp));
  return rangeWords(new Set([...wordBits(sourceWords), ...unicodeRangeBits(added)]));
}

/** Build the TTF binary plus a report describing what was preserved/dropped. */
export function buildTtf(input: ExportInput): { buffer: ArrayBuffer; report: ExportReport } {
  const { doc, options } = input;
  const notes: string[] = [];

  // A cmap holds exactly one glyph per code point: refuse to write a document
  // that has two owners instead of failing deep inside the writer.
  const duplicates = duplicateMappings(doc);
  if (duplicates.length) {
    const first = duplicates[0];
    throw new Error(
      `${describeCodePoint(first.codePoint)} is mapped to two glyphs (${first.owners
        .map((o) => `“${o.name}”`)
        .join(' and ')})${duplicates.length > 1 ? `, and ${duplicates.length - 1} more code point(s) are duplicated` : ''}. ` +
        'Every code point needs exactly one glyph — remove the extra mapping in the “Unicode mappings…” dialog, then export again.',
    );
  }

  // Start from the original parsed font when available so that GPOS/kern/
  // hinting/name extras survive; otherwise use the blank template.
  const base: TtfLike = input.sourceTtf ? structuredClone(input.sourceTtf) : emptyTtfObject();

  const idToIndex = new Map<string, number>();
  doc.glyphs.forEach((g, i) => idToIndex.set(g.id, i));

  let droppedInstructions = 0;
  const newGlyf: Array<Record<string, any>> = doc.glyphs.map((g) => {
    const rec: Record<string, any> = {
      name: g.name || 'glyph',
      advanceWidth: Math.round(g.advanceWidth),
      leftSideBearing: Math.round(g.leftSideBearing),
    };
    if (g.unicode !== null) rec.unicode = allUnicodes(g);

    if (g.kind === 'compound' && g.compound && g.compound.length > 0 && g.compound.every((c) => c.glyphId && idToIndex.has(c.glyphId))) {
      // preserve as composite
      rec.compound = true;
      rec.glyfs = g.compound.map((c) => ({
        glyphIndex: idToIndex.get(c.glyphId!),
        transform: { ...c.transform, e: Math.round(c.transform.e), f: Math.round(c.transform.f) },
        useMyMetrics: c.useMyMetrics ? 1 : 0,
        overlapCompound: c.overlapCompound ? 1 : 0,
      }));
    } else {
      if (g.kind === 'compound' && g.compound && g.compound.length > 0) {
        notes.push(`Composite glyph "${g.name}" was flattened to simple outlines (a component glyph is missing).`);
      }
      rec.contours = resolveGlyphContours(g, doc.glyphs).map((c) => c.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), onCurve: p.onCurve })));
      if (g.instructions && g.instructions.length && !g.edited && options.preserveHinting) {
        rec.instructions = [...g.instructions];
      } else if (g.instructions && g.instructions.length && g.edited) {
        droppedInstructions += 1;
      }
    }
    return rec;
  });

  if (droppedInstructions > 0) {
    notes.push(`TrueType instructions were dropped for ${droppedInstructions} edited glyph(s) — they no longer match the new point layout.`);
  }

  // Real glyf boxes and side bearings; the writer derives the head box from them.
  const bounds = applyGlyfBounds(newGlyf, doc.glyphs, input.sourceTtf);
  if (!options.preserveHinting && doc.source?.hasHinting) {
    notes.push('Hinting tables (cvt/fpgm/prep/gasp) and glyph instructions were not preserved (option off).');
  }
  if (!options.preserveKerning && doc.source?.hasKerning) {
    notes.push('Kerning tables (kern/GPOS/kerx) were not preserved (option off).');
  }

  // --- kerning
  // Unedited kerning passes through as the source font's own tables (valid while
  // glyph indices are unchanged). Edited kerning — or a changed glyph order —
  // is rewritten as a classic `kern` table from the editor's pair list.
  let kerningRewritten = false;
  let replacedGpos = false;
  if (!options.preserveKerning) {
    for (const t of ['GPOS', 'kern', 'kerx']) delete (base as Record<string, unknown>)[t];
  } else if (doc.kerning !== undefined) {
    if (doc.kerningEdited || !glyphOrderPreserved(doc)) {
      kerningRewritten = true;
      const b = base as Record<string, unknown>;
      const gpos = b.GPOS as ArrayLike<number> | undefined;
      replacedGpos = !!gpos && gpos.length > 0;
      delete b.GPOS;
      delete b.kern;
      delete b.kerx;
      const table = buildKernTable(kerningToIndexPairs(doc));
      if (table.length) b.kern = table;
      const n = effectivePairs(kerningOf(doc)).length;
      notes.push(
        `Kerning was written as a classic kern table (${n} pair${n === 1 ? '' : 's'})` +
          (replacedGpos ? '; the original GPOS table was replaced, so any other GPOS features (mark or ligature positioning) were not kept.' : '.'),
      );
    }
  } else if (doc.source?.hasKerning && !glyphOrderPreserved(doc)) {
    notes.push('Glyphs were removed or inserted, so the original kerning tables (which refer to glyph numbers) may no longer match.');
  }

  base.glyf = newGlyf;
  base.head = { ...(base.head as object), unitsPerEm: doc.metrics.unitsPerEm, indexToLocFormat: 0 } as any;
  base.hhea = { ...(base.hhea as object), ascent: doc.metrics.ascent, descent: doc.metrics.descent, lineGap: doc.metrics.lineGap } as any;
  const os2 = base['OS/2'];
  if (os2) {
    // typo / win values: the editor's own when set (imported fonts keep theirs), else they follow hhea
    const v = effectiveVertical(doc.metrics);
    Object.assign(os2, {
      sTypoAscender: v.typoAscender,
      sTypoDescender: v.typoDescender,
      sTypoLineGap: v.typoLineGap,
      usWinAscent: v.winAscent,
      usWinDescent: v.winDescent,
    });
    if (doc.metrics.useTypoMetrics !== undefined) {
      const sel = Number(os2.fsSelection ?? 0);
      os2.fsSelection = doc.metrics.useTypoMetrics ? sel | 0x80 : sel & ~0x80;
    }
  }

  // --- OS/2 ulUnicodeRange1-4
  // fonteditor-core's OS/2 writer sets ulUnicodeRange2 to 268435456 (only the
  // "Private Use Area" bit) in every font it writes, throwing away the real
  // coverage bits, and its `support` hook cannot override OS/2. The correct
  // words are computed here and written by the finalize pass.
  const unicodeRanges = exportUnicodeRanges(doc, input.sourceTtf);

  // Name table: overlay editable fields; unknown/imported extra records survive.
  const names: Record<string, string> = { ...((base.name as Record<string, string>) ?? {}) };
  const m = doc.meta;
  const map: Array<[keyof FontMeta, string]> = [
    ['fontFamily', 'fontFamily'], ['fontSubFamily', 'fontSubFamily'], ['fullName', 'fullName'],
    ['postScriptName', 'postScriptName'], ['uniqueSubFamily', 'uniqueSubFamily'], ['version', 'version'],
    ['copyright', 'copyright'], ['designer', 'designer'], ['manufacturer', 'manufacturer'],
    ['description', 'description'], ['urlOfFontVendor', 'urlOfFontVendor'], ['urlOfFontDesigner', 'urlOfFontDesigner'],
    ['licence', 'licence'], ['urlOfLicence', 'urlOfLicence'],
  ];
  for (const [src, dst] of map) {
    const v = (m[src] ?? '').trim();
    if (v) names[dst] = v;
  }
  base.name = names as any;

  const writerOptions = {
    hinting: options.preserveHinting,
    // fonteditor-core's writer builds its table list from two overlapping sets:
    // `hinting` copies cvt/fpgm/prep/gasp *and* GPOS/kern/kerx, `kerning` copies
    // GPOS/kern/kerx again (ttfwriter.js prepareDump). Asking for both wrote
    // every kerning table twice — a duplicate tag in the sfnt directory, which
    // breaks its ascending order (OTS: "Table directory is not correctly
    // ordered") and doubled the data (+210 KB on Lato). The `kerning` flag is
    // therefore only needed when `hinting` is off; kerning is still dropped by
    // deleting GPOS/kern/kerx from `base` above when preserveKerning is false.
    kerning: options.preserveKerning && !options.preserveHinting,
    writeZeroContoursGlyfData: false,
    // fonteditor-core derives the head box from the glyf boxes, but its hhea
    // extents assume lsb = xMin and count empty glyphs; with no outline at all
    // it would leave the head box inverted (16384…-16384), which OTS rejects.
    support: {
      hhea: bounds.extents,
      ...(bounds.inked ? {} : { head: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 } }),
    },
  };
  const font = Font.create().set(base as never);
  const raw = font.write({ type: 'ttf', ...writerOptions }) as unknown as ArrayBuffer | Uint8Array;
  // fonteditor-core returns a Node Buffer in Node environments — normalize to a
  // standalone ArrayBuffer (handles pooled buffers with a byteOffset).
  // The finalize pass then corrects the fields the writer gets wrong (glyph
  // names in post, Mac Roman codes in cmap) and recomputes the checksums.
  const buffer = finalizeSfnt(toStandaloneBuffer(raw), {
    glyphNames: doc.glyphs.map((g, i) => g.name || `glyph${i}`),
    unicodeRanges,
  });

  const srcTables = doc.source?.tables ?? [];
  const preserved = srcTables.filter((t) =>
    CORE_WRITABLE.has(t) ||
    (HINTING_TABLES.has(t) && options.preserveHinting) ||
    (KERNING_TABLES.has(t) && options.preserveKerning && !kerningRewritten),
  );
  // a rewritten kerning replaces the source's GPOS / kerx tables (a `kern` table is written in their place)
  const dropped = classifyDroppedTables(srcTables, options.preserveHinting, options.preserveKerning).concat(
    kerningRewritten ? srcTables.filter((t) => KERNING_TABLES.has(t) && t !== 'kern') : [],
  );

  const report: ExportReport = {
    bytes: buffer.byteLength,
    // report what is actually inside the produced file, not what we asked the
    // writer for (e.g. no hinting tables are written for a font without them)
    writtenTables: listTables(buffer),
    preservedTables: preserved,
    droppedTables: dropped,
    notes,
    validation: null,
  };

  // A configured but not-yet-created alternative digit set is worth a note: the
  // mapping is only meaningful once the glyphs exist.
  const largeMissing = pointsForSet('largeDigits', doc).filter((cp) => {
    const owner = doc.glyphs.find((g) => g.unicode === cp || g.extraUnicodes?.includes(cp));
    return !owner || owner.name === '.notdef';
  });
  if (largeMissing.length) {
    notes.push(
      `${largeMissing.length} of the 10 alternative (double-size) digits have no glyph yet in this font (${largeMissing
        .map((cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'))
        .join(', ')}). They are exported as soon as you add them.`,
    );
  }

  if (options.validate) {
    report.validation = validateExport(buffer, doc, kerningRewritten ? effectivePairs(kerningOf(doc)).length : undefined);
  }
  return { buffer, report };
}

/**
 * Re-open an exported font exactly like an importer would: the sfnt is parsed
 * again from the bytes and its character map, glyph count and per-glyph data
 * are returned. This is the "verify the actual file" primitive — export
 * validation and the tests both use it instead of trusting the editor state.
 */
export interface ReopenedFont {
  ttf: TtfLike;
  cmap: Record<number, number>;
  glyphCount: number;
  /** Parsed glyph record for a code point (null when it is not mapped). */
  glyphAt(codePoint: number): Record<string, any> | null;
}

/**
 * The Unicode character map of an sfnt file, read from its raw cmap subtables
 * (see core/cmapRead.ts). fonteditor-core's own `ttf.cmap` merges the legacy
 * Macintosh subtable in as if its byte codes were Unicode, which would make a
 * check believe a character is in the file when only its Mac Roman code is.
 * Falls back to the parsed map for a font this reader finds nothing in.
 */
export function unicodeCmapOf(buffer: ArrayBuffer | Uint8Array, parsed?: Record<string, number> | Record<number, number>): Record<number, number> {
  const read = readCmapFromSfnt(buffer);
  if (read && read.map.size) {
    const out: Record<number, number> = {};
    for (const [cp, gid] of read.map) out[cp] = gid;
    return out;
  }
  return (parsed ?? {}) as Record<number, number>;
}

export function reopenFont(buffer: ArrayBuffer): ReopenedFont {
  const font = Font.create(buffer, { type: 'ttf', hinting: true, kerning: true }) as unknown as FontInstance;
  const ttf = font.data as unknown as TtfLike;
  const cmap = unicodeCmapOf(buffer, ttf.cmap as Record<string, number> | undefined);
  const glyphAt = (cp: number): Record<string, any> | null => {
    const idx = cmap[cp];
    if (idx === undefined || idx === null) return null;
    return (ttf.glyf as Array<Record<string, any>>)[idx] ?? null;
  };
  return { ttf, cmap, glyphCount: (ttf.glyf ?? []).length, glyphAt };
}

/** Per-set result of re-opening an exported font. */
export interface ExportedCoverageCheck {
  set: string;
  expected: number;
  found: number;
  missing: number[];
  detail: string;
}

/**
 * Verify the character coverage of an exported font by re-parsing the file and
 * looking every required code point up in its cmap — independent of the editor
 * state, so a glyph that was never written shows up here.
 */
export function verifyExportedCoverage(buffer: ArrayBuffer, doc: FontDoc): ExportedCoverageCheck[] {
  const { cmap } = reopenFont(buffer);
  const report = analyzeCoverage(doc);
  return report.sets.map((s) => {
    const missing: number[] = [];
    let found = 0;
    for (const cp of s.points) {
      if (cmap[cp] === undefined) {
        missing.push(cp);
        continue;
      }
      found += 1;
    }
    return {
      set: s.def.label,
      expected: s.points.length,
      found,
      missing,
      detail: `${found}/${s.points.length} ${s.def.label} code point(s) present in the exported cmap${
        missing.length ? `, missing ${missing.slice(0, 8).map((cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')).join(' ')}` : ''
      }.`,
    };
  });
}

/** Re-parse an exported font and verify representative properties. */
export function validateExport(buffer: ArrayBuffer, doc: FontDoc, expectedKernPairs?: number): ValidationResult {
  const checks: ValidationCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const dir = checkTableDirectory(buffer);
  push('Table directory', dir.ok, dir.detail);
  try {
    const font = Font.create(buffer, { type: 'ttf', kerning: expectedKernPairs !== undefined }) as unknown as FontInstance;
    const ttf = font.data as unknown as TtfLike;
    push('Parse', true, `Re-parsed exported file (${buffer.byteLength} bytes).`);
    push('Glyph count', ttf.glyf.length === doc.glyphs.length, `expected ${doc.glyphs.length}, got ${ttf.glyf.length}`);
    push('unitsPerEm', (ttf.head as any).unitsPerEm === doc.metrics.unitsPerEm, `expected ${doc.metrics.unitsPerEm}, got ${(ttf.head as any).unitsPerEm}`);

    const cmap = unicodeCmapOf(buffer, ttf.cmap as Record<string, number> | undefined);
    const mapped = doc.glyphs.filter((g) => g.unicode !== null);
    const sample = mapped.slice(0, 200);
    let bad = 0;
    for (const g of sample) {
      const idx = cmap[g.unicode!];
      if (idx === undefined) { bad += 1; continue; }
      const rg = ttf.glyf[idx];
      if (!rg || Math.round(rg.advanceWidth ?? -1) !== Math.round(g.advanceWidth)) bad += 1;
    }
    push('cmap + metrics sample', bad === 0, `${sample.length - bad}/${sample.length} mapped glyphs verified (unicode → glyph index, advance width).`);

    // --- glyphs the editor created or changed: the exported file must really carry them
    const touched = doc.glyphs.filter((g) => g.unicode !== null && (g.origin === 'added' || g.edited));
    if (touched.length) {
      const problems: string[] = [];
      let verified = 0;
      for (const g of touched) {
        const idx = cmap[g.unicode!];
        const rg = idx === undefined ? null : ttf.glyf[idx];
        if (!rg) {
          problems.push(`“${g.name}” (U+${g.unicode!.toString(16).toUpperCase()}) is missing from the exported cmap`);
          continue;
        }
        if (Math.round(rg.advanceWidth ?? -1) !== Math.round(g.advanceWidth)) {
          problems.push(`“${g.name}” advance ${rg.advanceWidth} ≠ ${g.advanceWidth}`);
          continue;
        }
        if (g.kind === 'compound' && g.compound?.length && !rg.compound) {
          problems.push(`“${g.name}” lost its composite structure`);
          continue;
        }
        if (!rg.compound) {
          const expected = resolveGlyphContours(g, doc.glyphs).length;
          const got = Array.isArray(rg.contours) ? rg.contours.length : 0;
          if (got !== expected) {
            problems.push(`“${g.name}” has ${got} of ${expected} outline(s) in the file`);
            continue;
          }
        }
        verified += 1;
      }
      push(
        'Added & edited glyph outlines',
        problems.length === 0,
        problems.length
          ? `${verified}/${touched.length} verified. ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''}`
          : `All ${touched.length} glyph(s) added or edited in Pixeel are in the file with their outlines and advance widths.`,
      );
    }

    // --- glyph boxes: FreeType places every glyph by its glyf box and lsb, and
    //     browsers (OTS) reject a font whose head box does not hold together.
    {
      const parsed = ttf.glyf as Array<Record<string, any>>;
      const real = glyfRecordBounds(parsed);
      const problems: string[] = [];
      let inked = 0;
      let union: GlyfBox | null = null;
      parsed.forEach((rg, i) => {
        const box = real[i];
        if (!box) return;
        inked += 1;
        const label = `“${doc.glyphs[i]?.name ?? rg.name ?? i}”`;
        const stored = storedBox(rg);
        if (!stored || !boxesAgree(stored, box)) {
          const fmt = (b: GlyfBox) => `${b.xMin},${b.yMin}…${b.xMax},${b.yMax}`;
          problems.push(`${label} box ${stored ? fmt(stored) : 'missing'} ≠ outline ${fmt(box)}`);
          return;
        }
        union = union
          ? { xMin: Math.min(union.xMin, stored.xMin), yMin: Math.min(union.yMin, stored.yMin), xMax: Math.max(union.xMax, stored.xMax), yMax: Math.max(union.yMax, stored.yMax) }
          : stored;
        const g = doc.glyphs[i];
        const drawnHere = !!g && (g.edited || g.origin === 'added' || g.kind === 'pixel' || typeof g.srcIndex !== 'number');
        const lsb = Math.round(Number(rg.leftSideBearing ?? NaN));
        if (drawnHere && lsb !== stored.xMin) problems.push(`${label} lsb ${lsb} ≠ xMin ${stored.xMin} (FreeType would draw it ${lsb - stored.xMin} units off)`);
      });
      const h = ttf.head as unknown as Record<string, number>;
      const headBox: GlyfBox = { xMin: h.xMin, yMin: h.yMin, xMax: h.xMax, yMax: h.yMax };
      const expectedHead: GlyfBox = union ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
      const headOk = (['xMin', 'yMin', 'xMax', 'yMax'] as const).every((k) => headBox[k] === expectedHead[k]);
      if (!headOk) {
        problems.push(`font box (head) ${headBox.xMin},${headBox.yMin}…${headBox.xMax},${headBox.yMax} ≠ ${expectedHead.xMin},${expectedHead.yMin}…${expectedHead.xMax},${expectedHead.yMax}`);
      }
      push(
        'Glyph boxes & side bearings',
        problems.length === 0,
        problems.length
          ? `${problems.length} problem(s): ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '; …' : ''}`
          : `${inked} outlined glyph(s) carry their real bounding box; font box ${headBox.xMin},${headBox.yMin}…${headBox.xMax},${headBox.yMax}. ` +
              'Glyphs drawn or edited in Pixeel start at their outline (lsb = xMin), so FreeType-based renderers such as ESPHome draw them where the editor shows them.',
      );
    }

    // --- per-set coverage measured on the re-opened file, not on the editor state.
    //     Characters the font never had are reported, not treated as errors; a
    //     character that exists in the editor but not in the file is an error.
    const docCoverage = analyzeCoverage(doc);
    const coverage = verifyExportedCoverage(buffer, doc);
    const docIndex = new Map<string, number>();
    doc.glyphs.forEach((g, i) => docIndex.set(g.id, i));
    const dropped: number[] = [];
    for (const set of docCoverage.sets) {
      for (const entry of set.entries) {
        if (entry.status === 'missing') continue;
        const mapped = cmap[entry.codePoint];
        // the code point must be in the file *and* point at the glyph that owns
        // it in the editor (a duplicate mapping can only point at one of them)
        if (mapped === undefined || mapped !== docIndex.get(entry.glyphId!)) dropped.push(entry.codePoint);
      }
    }
    push(
      'Character coverage',
      dropped.length === 0,
      `${coverage.map((c) => `${c.set} ${c.found}/${c.expected}`).join(' · ')}${
        dropped.length
          ? ` — ${dropped.length} character(s) of the editor are missing from the file: ${dropped
              .slice(0, 8)
              .map((cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'))
              .join(' ')}`
          : ''
      }.`,
    );

    // --- every code point of a glyph must survive (multi mappings included) and
    //     every alternative digit that exists must be mapped
    const altOwned = docCoverage.setById.largeDigits.entries
      .filter((e) => e.status !== 'missing')
      .map((e) => e.codePoint);
    const altOk = altOwned.every((cp) => cmap[cp] !== undefined);
    push(
      'Alternative (large) digits',
      altOk,
      altOwned.length
        ? `${altOwned.length}/10 large digit(s) mapped in the file (${altOwned
            .map((cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'))
            .join(', ')}).`
        : 'No alternative digit glyphs in this font yet (they are optional).',
    );
    // every extra code point must point at the same glyph as its primary
    const multi = doc.glyphs.map((g, i) => ({ g, i })).filter(({ g }) => (g.extraUnicodes?.length ?? 0) > 0);
    if (multi.length) {
      const pairs = multi.flatMap(({ g, i }) => allUnicodes(g).map((cp) => ({ cp, i })));
      const wrong = pairs.filter(({ cp, i }) => cmap[cp] !== i).length;
      push('Multiple code points per glyph', wrong === 0, `${pairs.length - wrong}/${pairs.length} cmap entries of multi-mapped glyphs point at the right glyph.`);
    }
    if (expectedKernPairs !== undefined) {
      const kern = ttf.kern as ArrayLike<number> | undefined;
      const got = kern && kern.length ? parseKernTable(kern).pairs.length : 0;
      push('Kerning pairs', got === expectedKernPairs, `${got} of ${expectedKernPairs} kerning pair(s) found in the exported kern table.`);
    }
    const family = (ttf.name as any)?.fontFamily;
    push('Name table', family === doc.meta.fontFamily, `family "${family}" vs "${doc.meta.fontFamily}"`);
    const notdef = ttf.glyf[0];
    push('.notdef present', !!notdef, notdef ? 'first glyph exists' : 'missing .notdef');
    if (doc.ledMatrix) {
      const led = checkLedFont(doc, 3);
      const firstErrors = led.issues.filter((i) => i.severity === 'error').slice(0, 3);
      push(
        'LED matrix (exact pixels)',
        led.ok,
        led.ok
          ? `${ledLabel(doc.ledMatrix)} grid, ${doc.metrics.unitsPerEm / doc.ledMatrix.rows} units per pixel: every glyph is on the grid (${led.warnings} warning(s)).`
          : `${led.errors} glyph/metric error(s). ${firstErrors.map((i) => `${i.glyph}: ${i.message}`).join(' ')}`,
      );
    }
  } catch (err) {
    push('Parse', false, `Exported font failed to re-parse: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** Human-readable file size. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Ensure a glyph's pixel cells decode (guards against corrupt projects). */
export function pixelCellsLength(g: GlyphDoc): number | null {
  if (!g.pixel) return null;
  try {
    return b64ToBytes(g.pixel.cellsB64).length;
  } catch {
    return null;
  }
}
