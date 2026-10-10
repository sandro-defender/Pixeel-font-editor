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
    throw new Error('WOFF/WOFF2 files are not supported. Please convert to .ttf first (e.g. with fonttools or an online converter).');
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

export interface ImportResult {
  doc: FontDoc;
  sourceTtf: TtfLike;
  warnings: string[];
}

const NAME_KEYS: Array<keyof FontMeta> = [
  'fontFamily', 'fontSubFamily', 'fullName', 'postScriptName', 'uniqueSubFamily',
  'version', 'copyright', 'designer', 'manufacturer', 'description',
  'urlOfFontVendor', 'urlOfFontDesigner', 'licence', 'urlOfLicence',
];

/** Import a .ttf (or CFF-based .otf) from raw bytes. */
export async function importFont(input: ArrayBuffer | Uint8Array, fileName: string): Promise<ImportResult> {
  const buffer = toStandaloneBuffer(input);
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
  const multiUnicode: string[] = [];

  // First pass: create docs so compound references can be resolved by index.
  for (let i = 0; i < srcGlyf.length; i++) {
    const g = srcGlyf[i];
    const unicodes: number[] = Array.isArray(g.unicode) ? g.unicode : g.unicode != null ? [g.unicode] : [];
    const unicode = unicodes.length ? unicodes[0] : null;
    if (unicodes.length > 1) {
      multiUnicode.push(`Glyph ${i} maps to ${unicodes.length} code points; only U+${unicode!.toString(16).toUpperCase()} is kept in the editor.`);
    }
    const contours: Contour[] = Array.isArray(g.contours)
      ? g.contours.map((c: Array<Record<string, number>>) =>
          c.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), onCurve: !!p.onCurve })),
        )
      : [];
    glyphs.push({
      id: makeId('g'),
      name: g.name || `.glyph${i}`,
      unicode,
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
  const doc: FontDoc = {
    fontId: makeId('f'),
    meta: deriveMetaFields(meta),
    metrics: {
      unitsPerEm: Math.round(Number(head.unitsPerEm ?? 1000)),
      ascent: Math.round(Number(hhea.ascent ?? 800)),
      descent: Math.round(Number(hhea.descent ?? -200)),
      lineGap: Math.round(Number(hhea.lineGap ?? 0)),
    },
    glyphs,
    source: {
      fileName,
      format,
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
  if (multiUnicode.length) warnings.push(multiUnicode.slice(0, 5).join(' '));
  return { doc, sourceTtf: ttf, warnings };
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

/** Build the TTF binary plus a report describing what was preserved/dropped. */
export function buildTtf(input: ExportInput): { buffer: ArrayBuffer; report: ExportReport } {
  const { doc, options } = input;
  const notes: string[] = [];

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
    if (g.unicode !== null) rec.unicode = [g.unicode];

    if (g.kind === 'compound' && g.compound && g.compound.every((c) => c.glyphId && idToIndex.has(c.glyphId))) {
      // preserve as composite
      rec.compound = true;
      rec.glyfs = g.compound.map((c) => ({
        glyphIndex: idToIndex.get(c.glyphId!),
        transform: { ...c.transform, e: Math.round(c.transform.e), f: Math.round(c.transform.f) },
        useMyMetrics: c.useMyMetrics ? 1 : 0,
        overlapCompound: c.overlapCompound ? 1 : 0,
      }));
    } else {
      if (g.kind === 'compound' && g.compound) {
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
    Object.assign(os2, {
      sTypoAscender: doc.metrics.ascent,
      sTypoDescender: doc.metrics.descent,
      sTypoLineGap: doc.metrics.lineGap,
      usWinAscent: Math.max(doc.metrics.ascent, 0),
      usWinDescent: Math.max(-doc.metrics.descent, 0),
    });
  }

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
    kerning: options.preserveKerning,
    writeZeroContoursGlyfData: false,
  };
  const font = Font.create().set(base as never);
  const raw = font.write({ type: 'ttf', ...writerOptions }) as unknown as ArrayBuffer | Uint8Array;
  // fonteditor-core returns a Node Buffer in Node environments — normalize to a
  // standalone ArrayBuffer (handles pooled buffers with a byteOffset).
  const buffer = toStandaloneBuffer(raw);

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

  if (options.validate) {
    report.validation = validateExport(buffer, doc, kerningRewritten ? effectivePairs(kerningOf(doc)).length : undefined);
  }
  return { buffer, report };
}

/** Re-parse an exported font and verify representative properties. */
export function validateExport(buffer: ArrayBuffer, doc: FontDoc, expectedKernPairs?: number): ValidationResult {
  const checks: ValidationCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  try {
    const font = Font.create(buffer, { type: 'ttf', kerning: expectedKernPairs !== undefined }) as unknown as FontInstance;
    const ttf = font.data as unknown as TtfLike;
    push('Parse', true, `Re-parsed exported file (${buffer.byteLength} bytes).`);
    push('Glyph count', ttf.glyf.length === doc.glyphs.length, `expected ${doc.glyphs.length}, got ${ttf.glyf.length}`);
    push('unitsPerEm', (ttf.head as any).unitsPerEm === doc.metrics.unitsPerEm, `expected ${doc.metrics.unitsPerEm}, got ${(ttf.head as any).unitsPerEm}`);

    const cmap = (ttf.cmap ?? {}) as Record<string, number>;
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
