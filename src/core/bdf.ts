/**
 * BDF (Glyph Bitmap Distribution Format) import as a pixel font.
 *
 * One BDF pixel = one editor pixel. All glyphs share one grid that is just big
 * enough for every glyph (so monospaced 8×16 fonts get an 8×16 grid), the
 * baseline sits on a whole row, and ascent / descent / advances / bearings are
 * the BDF's own numbers times the pixel size in font units.
 */
import { bytesToB64 } from './bitmap';
import { EMPTY_META, deriveMetaFields, makePostScriptName } from './metadata';
import { emptyGlyphDoc } from './fontCodec';
import { DEFAULT_CELL_TARGET, makePixelGlyph } from './fontFactory';
import type { FontDoc, FontMeta, GlyphDoc } from './types';
import { makeId } from './types';
import { suggestGlyphName } from './unicodeNames';
import { MAX_GRID } from './bitmap';

export class BdfError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'BdfError';
  }
}

interface RawGlyph {
  name: string;
  encoding: number; // -1 = unencoded
  dwidth: number | null;
  w: number;
  h: number;
  xoff: number;
  yoff: number;
  /** rows top → bottom, each `w` booleans */
  rows: boolean[][];
  line: number;
}

export interface BdfInfo {
  /** Design cell: the width of a monospaced font's advance, else the bounding-box width. */
  cellWidth: number;
  cellHeight: number;
  /** The shared pixel grid every glyph uses. */
  gridWidth: number;
  gridHeight: number;
  /** Grid rows below the baseline. */
  baselineRow: number;
  ascentRows: number;
  descentRows: number;
  monospaced: boolean;
  glyphCount: number;
  unencoded: number;
  /** Font units per BDF pixel. */
  unitsPerCell: number;
}

export interface BdfImportResult {
  doc: FontDoc;
  warnings: string[];
  info: BdfInfo;
}

const unquote = (s: string): string => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
};

const int = (s: string | undefined, what: string, line: number): number => {
  const n = Number(s);
  if (s === undefined || s === '' || !Number.isInteger(n)) throw new BdfError(`${what} must be a whole number, found “${s ?? ''}”`, line);
  return n;
};

export function parseBdf(text: string): { props: Map<string, string>; glyphs: RawGlyph[]; bbox: [number, number, number, number] | null; fontName: string; warnings: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const warnings: string[] = [];
  const props = new Map<string, string>();
  const glyphs: RawGlyph[] = [];
  let bbox: [number, number, number, number] | null = null;
  let fontName = '';
  let declaredChars: number | null = null;
  let sawEnd = false;
  let started = false;
  let inProps = false;
  let cur: (Partial<RawGlyph> & { bitmap?: string[]; bitmapLines?: number[]; inBitmap?: boolean }) | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const sp = trimmed.search(/\s/);
    const key = (sp < 0 ? trimmed : trimmed.slice(0, sp)).toUpperCase();
    const rest = sp < 0 ? '' : trimmed.slice(sp + 1).trim();

    if (!started) {
      if (key !== 'STARTFONT') throw new BdfError('Not a BDF file: the first line must be “STARTFONT <version>”', lineNo);
      started = true;
      continue;
    }

    if (cur?.inBitmap) {
      if (key === 'ENDCHAR') {
        const g = cur as RawGlyph & { bitmap: string[]; bitmapLines: number[] };
        const need = Math.ceil(g.w / 8) * 2;
        if (g.bitmap.length !== g.h) throw new BdfError(`Glyph “${g.name}” has ${g.bitmap.length} bitmap rows but its BBX says ${g.h}`, lineNo);
        g.rows = g.bitmap.map((hex, r) => {
          if (!/^[0-9a-fA-F]*$/.test(hex)) throw new BdfError(`Glyph “${g.name}”: bitmap row ${r + 1} is not hexadecimal (“${hex.slice(0, 12)}”)`, g.bitmapLines[r]);
          if (g.w > 0 && hex.length < need) throw new BdfError(`Glyph “${g.name}”: bitmap row ${r + 1} has ${hex.length} hex digits, ${need} are needed for width ${g.w}`, g.bitmapLines[r]);
          const row: boolean[] = [];
          for (let c = 0; c < g.w; c++) {
            const byte = parseInt(hex.slice((c >> 3) * 2, (c >> 3) * 2 + 2), 16);
            row.push(((byte >> (7 - (c & 7))) & 1) === 1);
          }
          return row;
        });
        glyphs.push(g);
        cur = null;
      } else {
        (cur.bitmap as string[]).push(trimmed.replace(/\s+/g, ''));
        (cur.bitmapLines as number[]).push(lineNo);
      }
      continue;
    }

    if (cur) {
      switch (key) {
        case 'ENCODING': {
          const parts = rest.split(/\s+/);
          const first = int(parts[0], 'ENCODING', lineNo);
          // "ENCODING -1 n" = unencoded glyph (n is a legacy position)
          cur.encoding = first;
          break;
        }
        case 'DWIDTH': cur.dwidth = int(rest.split(/\s+/)[0], 'DWIDTH', lineNo); break;
        case 'BBX': {
          const p = rest.split(/\s+/);
          if (p.length < 4) throw new BdfError(`Glyph “${cur.name}”: BBX needs four numbers (width height x-offset y-offset)`, lineNo);
          cur.w = int(p[0], 'BBX width', lineNo);
          cur.h = int(p[1], 'BBX height', lineNo);
          cur.xoff = int(p[2], 'BBX x offset', lineNo);
          cur.yoff = int(p[3], 'BBX y offset', lineNo);
          if (cur.w < 0 || cur.h < 0 || cur.w > 1024 || cur.h > 1024) throw new BdfError(`Glyph “${cur.name}”: unreasonable BBX size ${cur.w}×${cur.h}`, lineNo);
          break;
        }
        case 'BITMAP':
          if (cur.w === undefined) throw new BdfError(`Glyph “${cur.name}” has a BITMAP but no BBX`, lineNo);
          cur.inBitmap = true;
          cur.bitmap = [];
          cur.bitmapLines = [];
          break;
        case 'ENDCHAR':
          // glyph without BITMAP: treat as empty only if BBX is 0 high
          if (cur.w === undefined) throw new BdfError(`Glyph “${cur.name}” has no BBX/BITMAP`, lineNo);
          glyphs.push({ ...(cur as RawGlyph), rows: [] });
          cur = null;
          break;
        default: break; // SWIDTH, DWIDTH vertical etc. are not needed
      }
      continue;
    }

    switch (key) {
      case 'FONT': fontName = rest; break;
      case 'FONTBOUNDINGBOX': {
        const p = rest.split(/\s+/);
        bbox = [int(p[0], 'FONTBOUNDINGBOX width', lineNo), int(p[1], 'FONTBOUNDINGBOX height', lineNo), int(p[2], 'FONTBOUNDINGBOX x offset', lineNo), int(p[3], 'FONTBOUNDINGBOX y offset', lineNo)];
        break;
      }
      case 'STARTPROPERTIES': inProps = true; break;
      case 'ENDPROPERTIES': inProps = false; break;
      case 'CHARS': declaredChars = Number(rest); break;
      case 'STARTCHAR':
        inProps = false;
        cur = { name: rest || `glyph${glyphs.length}`, encoding: -1, dwidth: null, line: lineNo };
        break;
      case 'ENDFONT': sawEnd = true; break;
      default:
        if (inProps) {
          const k = trimmed.slice(0, sp < 0 ? trimmed.length : sp);
          props.set(k.toUpperCase(), unquote(rest));
        }
    }
    if (sawEnd) break;
  }

  if (!started) throw new BdfError('This file is empty — not a BDF font');
  if (cur) throw new BdfError(`The file ends inside glyph “${cur.name}” — it is truncated`);
  if (!sawEnd) warnings.push('The BDF file has no ENDFONT line; it may be truncated.');
  if (declaredChars !== null && Number.isFinite(declaredChars) && declaredChars !== glyphs.length) {
    warnings.push(`The header says ${declaredChars} glyphs but ${glyphs.length} were found.`);
  }
  if (glyphs.length === 0) throw new BdfError('The BDF file contains no glyphs');
  return { props, glyphs, bbox, fontName, warnings };
}

const VALID_GLYPH_NAME = /^[A-Za-z._][A-Za-z0-9._]{0,62}$/;

function styleFrom(props: Map<string, string>): string {
  const weight = (props.get('WEIGHT_NAME') ?? '').toLowerCase();
  const slant = (props.get('SLANT') ?? '').toUpperCase();
  const bold = /bold|black|heavy/.test(weight);
  const italic = slant === 'I' || slant === 'O';
  return bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
}

/** Parse BDF text and build a pixel-font document. Throws BdfError with a line number on bad input. */
export function importBdfText(text: string, fileName: string): BdfImportResult {
  const { props, glyphs: raw, bbox, fontName, warnings } = parseBdf(text);

  // --- vertical em: FONT_ASCENT + FONT_DESCENT, else PIXEL_SIZE, else the bounding box
  const num = (k: string): number | null => {
    const v = props.get(k);
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  let ascentRows = num('FONT_ASCENT');
  let descentRows = num('FONT_DESCENT');
  if (ascentRows === null || descentRows === null) {
    if (bbox) {
      descentRows = Math.max(0, -bbox[3]);
      ascentRows = Math.max(1, bbox[1] + bbox[3]);
    } else {
      const px = num('PIXEL_SIZE');
      const maxTop = Math.max(...raw.map((g) => g.yoff + g.h));
      const minBottom = Math.min(...raw.map((g) => g.yoff));
      ascentRows = px ? Math.round(px * 0.8) : Math.max(1, maxTop);
      descentRows = px ? px - ascentRows : Math.max(0, -minBottom);
    }
    warnings.push('FONT_ASCENT / FONT_DESCENT are missing; the baseline was derived from the font bounding box.');
  }
  ascentRows = Math.max(1, Math.round(ascentRows));
  descentRows = Math.max(0, Math.round(descentRows));
  const emRows = ascentRows + descentRows;

  // --- shared grid covering the em box and every glyph
  let minX = 0, maxX = 0, minY = -descentRows, maxY = ascentRows;
  const advances = new Set<number>();
  let anyWithoutDwidth = 0;
  for (const g of raw) {
    const adv = g.dwidth ?? (bbox ? bbox[0] : g.w);
    if (g.dwidth === null) anyWithoutDwidth += 1;
    advances.add(adv);
    maxX = Math.max(maxX, adv);
    if (g.h > 0 && g.w > 0) {
      minX = Math.min(minX, g.xoff);
      maxX = Math.max(maxX, g.xoff + g.w);
      minY = Math.min(minY, g.yoff);
      maxY = Math.max(maxY, g.yoff + g.h);
    }
  }
  if (anyWithoutDwidth) warnings.push(`${anyWithoutDwidth} glyph(s) have no DWIDTH; the font's bounding-box width was used as their advance.`);
  const gridWidth = Math.max(1, maxX - minX);
  const gridHeight = Math.max(1, maxY - minY);
  if (gridWidth > MAX_GRID || gridHeight > MAX_GRID) {
    throw new BdfError(`This bitmap font needs a ${gridWidth}×${gridHeight} pixel grid; the editor supports at most ${MAX_GRID}×${MAX_GRID} pixels per glyph.`);
  }
  const monospaced = advances.size === 1;
  const cellWidth = monospaced ? [...advances][0] : (bbox ? bbox[0] : gridWidth);
  const baselineRow = -minY;
  const unitsPerCell = Math.max(1, Math.round(DEFAULT_CELL_TARGET / emRows));

  // --- glyphs
  const used = new Set<string>(['.notdef']);
  const codeSeen = new Set<number>();
  const glyphs: GlyphDoc[] = [];
  let unencoded = 0;
  let dupCodes = 0;
  const layout = { unitsPerCell, baselineRow, defaultAdvance: cellWidth * unitsPerCell };
  for (const r of raw) {
    let cp: number | null = r.encoding >= 0 ? r.encoding : null;
    if (cp !== null && (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) cp = null;
    if (cp === null) unencoded += 1;
    else if (codeSeen.has(cp)) {
      dupCodes += 1;
      cp = null;
    } else codeSeen.add(cp);

    let name = VALID_GLYPH_NAME.test(r.name) ? r.name : suggestGlyphName(cp, glyphs.length) || `glyph${glyphs.length}`;
    if (used.has(name)) {
      let n = 1;
      while (used.has(`${name}.${n}`)) n += 1;
      name = `${name}.${n}`;
    }
    used.add(name);

    const g = makePixelGlyph(cp, gridWidth, gridHeight, layout, false);
    g.name = name;
    const cells = new Uint8Array(gridWidth * gridHeight);
    let inkMinX = Infinity;
    let ink = 0;
    for (let row = 0; row < r.rows.length; row++) {
      const y = r.yoff + (r.h - 1 - row); // cell row above the baseline (may be negative)
      for (let c = 0; c < r.w; c++) {
        if (!r.rows[row][c]) continue;
        const x = r.xoff + c;
        cells[(y - minY) * gridWidth + (x - minX)] = 1; // grid row 0 = bottom
        inkMinX = Math.min(inkMinX, x);
        ink += 1;
      }
    }
    g.pixel = { ...g.pixel!, cellsB64: bytesToB64(cells), offsetX: minX * unitsPerCell };
    g.kind = ink > 0 ? 'pixel' : 'empty';
    g.advanceWidth = (r.dwidth ?? (bbox ? bbox[0] : r.w)) * unitsPerCell;
    g.leftSideBearing = ink > 0 ? inkMinX * unitsPerCell : 0;
    glyphs.push(g);
  }
  if (unencoded) warnings.push(`${unencoded} glyph(s) have no Unicode encoding and were imported unmapped.`);
  if (dupCodes) warnings.push(`${dupCodes} glyph(s) repeat an encoding already used; they were imported unmapped.`);
  const registry = (props.get('CHARSET_REGISTRY') ?? '').toUpperCase();
  if (registry && !/ISO10646|UNICODE/.test(registry) && !(registry === 'ISO8859' && props.get('CHARSET_ENCODING') === '1')) {
    warnings.push(`The font's charset is ${registry}${props.get('CHARSET_ENCODING') ? '-' + props.get('CHARSET_ENCODING') : ''}, not Unicode; encodings were used as Unicode code points and some may be wrong.`);
  }

  // --- document
  const xlfd = fontName.split('-');
  const family = props.get('FAMILY_NAME') || (xlfd.length > 2 ? xlfd[2] : '') || fileName.replace(/\.[^.]*$/, '') || 'Bitmap font';
  const style = styleFrom(props);
  const notdef = emptyGlyphDoc('.notdef', Math.round((cellWidth * unitsPerCell) / 2));
  notdef.srcIndex = 0;
  const meta: FontMeta = deriveMetaFields({
    ...EMPTY_META,
    fontFamily: family,
    fontSubFamily: style,
    version: props.get('FONT_VERSION') ? `Version ${props.get('FONT_VERSION')}` : 'Version 1.000',
    copyright: props.get('COPYRIGHT') ?? '',
    manufacturer: props.get('FOUNDRY') ?? '',
    description: `Imported from the BDF bitmap font “${fileName}” (${cellWidth}×${emRows} pixel cells).`,
  });
  const doc: FontDoc = {
    fontId: makeId('f'),
    meta: { ...meta, postScriptName: makePostScriptName(family, style) },
    metrics: { unitsPerEm: unitsPerCell * emRows, ascent: unitsPerCell * ascentRows, descent: -unitsPerCell * descentRows, lineGap: 0 },
    glyphs: [notdef, ...glyphs],
    source: {
      fileName,
      format: 'bdf',
      tables: [],
      hasHinting: false,
      hasKerning: false,
      hasComposites: false,
      numGlyphs: glyphs.length + 1,
      importedAt: Date.now(),
    },
    sourceRef: null,
  };
  return {
    doc,
    warnings,
    info: {
      cellWidth,
      cellHeight: emRows,
      gridWidth,
      gridHeight,
      baselineRow,
      ascentRows,
      descentRows,
      monospaced,
      glyphCount: glyphs.length,
      unencoded,
      unitsPerCell,
    },
  };
}
