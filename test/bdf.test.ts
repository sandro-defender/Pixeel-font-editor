/** BDF import as a pixel font — Spleen 8×16 (real font) plus hand-made edge cases. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BdfError, importBdfText } from '../src/core/bdf';
import { importAnyFont } from '../src/core/importAny';
import { buildTtf, importFont } from '../src/core/fontCodec';
import { b64ToBytes } from '../src/core/bitmap';
import { parseTtf } from './helpers';

const SPLEEN = readFileSync(resolve(__dirname, 'fixtures/spleen-8x16.bdf'), 'utf8');

const cellsOf = (g: { pixel: { cellsB64: string } | null }) => b64ToBytes(g.pixel!.cellsB64);
const inkOf = (g: { pixel: { cellsB64: string } | null }) => cellsOf(g).reduce((n, v) => n + v, 0);
const popcount = (n: number) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };

/** Independent oracle: the hex rows of one glyph straight from the file text. */
function hexRows(text: string, enc: number): { rows: string[]; bbx: number[] } {
  const m = new RegExp(`ENCODING ${enc}\\n[\\s\\S]*?BBX ([^\\n]+)\\nBITMAP\\n([\\s\\S]*?)ENDCHAR`).exec(text)!;
  return { rows: m[2].trim().split('\n'), bbx: m[1].split(' ').map(Number) };
}

describe('Spleen 8x16 (real BDF)', () => {
  const res = importBdfText(SPLEEN, 'spleen-8x16.bdf');
  const { doc, info } = res;

  it('detects the cell size and baseline', () => {
    expect(info).toMatchObject({ cellWidth: 8, cellHeight: 16, gridWidth: 8, gridHeight: 16, baselineRow: 4, ascentRows: 12, descentRows: 4, monospaced: true, glyphCount: 1001, unencoded: 0 });
    expect(res.warnings).toEqual([]);
  });

  it('preserves metrics in font units (one BDF pixel = unitsPerCell)', () => {
    const u = info.unitsPerCell;
    expect(u).toBe(64);
    expect(doc.metrics).toEqual({ unitsPerEm: 1024, ascent: 12 * u, descent: -4 * u, lineGap: 0 });
    expect(doc.glyphs[0].name).toBe('.notdef');
    expect(doc.glyphs.length).toBe(1002);
    const A = doc.glyphs.find((g) => g.unicode === 0x41)!;
    expect(A.advanceWidth).toBe(8 * u);
    expect(A.pixel).toMatchObject({ width: 8, height: 16, unitsPerCell: u, baselineRow: 4, offsetX: 0 });
    expect(doc.source).toMatchObject({ format: 'bdf', fileName: 'spleen-8x16.bdf' });
    expect(doc.meta.fontFamily).toBe('Spleen');
    expect(doc.meta.copyright).toMatch(/Cambus/);
    expect(doc.sourceRef).toBeNull();
  });

  it('places every pixel exactly (glyph A against the file text)', () => {
    const A = doc.glyphs.find((g) => g.unicode === 0x41)!;
    const { rows, bbx } = hexRows(SPLEEN, 0x41);
    const [w, h, xoff, yoff] = bbx;
    const cells = cellsOf(A);
    const expected = new Uint8Array(8 * 16);
    rows.forEach((hex, r) => {
      const byte = parseInt(hex.slice(0, 2), 16);
      for (let c = 0; c < w; c++) if ((byte >> (7 - c)) & 1) expected[(yoff + (h - 1 - r) + 4) * 8 + xoff + c] = 1;
    });
    expect([...cells]).toEqual([...expected]);
    expect(A.kind).toBe('pixel');
  });

  it('keeps every pixel of every glyph (total ink matches the file)', () => {
    let fileInk = 0;
    for (const m of SPLEEN.matchAll(/BITMAP\n([\s\S]*?)ENDCHAR/g)) for (const row of m[1].trim().split('\n')) if (row) fileInk += popcount(parseInt(row, 16));
    const docInk = doc.glyphs.reduce((n, g) => n + (g.pixel ? inkOf(g) : 0), 0);
    expect(docInk).toBe(fileInk);
    expect(fileInk).toBeGreaterThan(10000);
  });

  it('maps encodings to Unicode and leaves blank glyphs empty', () => {
    const space = doc.glyphs.find((g) => g.unicode === 0x20)!;
    expect(space.kind).toBe('empty');
    expect(space.advanceWidth).toBe(512);
    expect(doc.glyphs.find((g) => g.unicode === 0x3b1)).toBeTruthy(); // Greek alpha
    expect(new Set(doc.glyphs.map((g) => g.name)).size).toBe(doc.glyphs.length);
    expect(new Set(doc.glyphs.filter((g) => g.unicode !== null).map((g) => g.unicode)).size).toBe(1001);
  });

  it('goes through the shared importer as a source-less pixel font', async () => {
    const buf = readFileSync(resolve(__dirname, 'fixtures/spleen-8x16.bdf'));
    const any = await importAnyFont(new Uint8Array(buf), 'spleen-8x16.bdf');
    expect(any.kind).toBe('bdf');
    expect(any.sourceTtf).toBeNull();
    expect(any.bdf?.cellWidth).toBe(8);
  });

  it('exports a valid .ttf with the same metrics, and it round-trips', async () => {
    const { buffer, report } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: false, preserveKerning: false, validate: true } });
    expect(report.validation?.ok).toBe(true);
    const out = parseTtf(buffer);
    expect(out.head.unitsPerEm).toBe(1024);
    expect(out.hhea.ascent).toBe(768);
    expect(out.hhea.descent).toBe(-256);
    expect(out.glyf.length).toBe(1002);
    const back = await importFont(buffer, 'spleen.ttf');
    const A = back.doc.glyphs.find((g) => g.unicode === 0x41)!;
    expect(A.advanceWidth).toBe(512);
    expect(back.doc.metrics.ascent).toBe(768);
  });
});

const mini = (body: string, props = 'FONT_ASCENT 6\nFONT_DESCENT 2\n') =>
  `STARTFONT 2.1\nFONT -x-Mini-medium-r-normal--8-80-75-75-P-50-ISO10646-1\nSIZE 8 75 75\nFONTBOUNDINGBOX 6 8 -1 -2\nSTARTPROPERTIES 3\n${props}FAMILY_NAME "Mini"\nENDPROPERTIES\nCHARS 9\n${body}ENDFONT\n`;
const glyph = (name: string, enc: string, dw: number, bbx: string, rows: string[]) =>
  `STARTCHAR ${name}\nENCODING ${enc}\nSWIDTH 500 0\nDWIDTH ${dw} 0\nBBX ${bbx}\nBITMAP\n${rows.join('\n')}\nENDCHAR\n`;

describe('hand-made BDF edge cases', () => {
  it('proportional font: advances, bearings and a glyph that overhangs the em box', () => {
    const text = mini(
      glyph('i', '105', 3, '1 6 1 0', ['80', '80', '80', '80', '00', '80']) +
        glyph('W', '87', 7, '7 6 0 0', ['82', '82', '92', '92', 'AA', '44']) +
        glyph('Aacute', '193', 6, '5 9 0 0', ['10', '20', '00', '70', '88', '88', 'F8', '88', '88']) + // top at row 9 > ascent 6
        glyph('tail', '106', 4, '3 3 -1 -2', ['E0', '20', '20']), // hangs left of the origin and below the em box
    );
    const { doc, info } = importBdfText(text, 'mini.bdf');
    expect(info.monospaced).toBe(false);
    expect(info.gridHeight).toBe(11); // 9 above the baseline + 2 below
    expect(info.baselineRow).toBe(2);
    expect(info.gridWidth).toBe(8); // -1 .. 7
    expect(info.cellHeight).toBe(8);
    const u = info.unitsPerCell;
    expect(u).toBe(128);
    expect(doc.metrics).toEqual({ unitsPerEm: 1024, ascent: 6 * u, descent: -2 * u, lineGap: 0 });
    const g = (cp: number) => doc.glyphs.find((x) => x.unicode === cp)!;
    expect(g(105).advanceWidth).toBe(3 * u);
    expect(g(105).leftSideBearing).toBe(1 * u);
    expect(g(87).advanceWidth).toBe(7 * u);
    expect(g(106).leftSideBearing).toBe(-1 * u);
    expect(g(106).pixel!.offsetX).toBe(-1 * u);
    // the pixel at the very top of Aacute row 0 (x=3) lands on the top grid row
    const grid = cellsOf(g(193));
    expect(grid[(8 + 2) * 8 + 3 + 1]).toBe(1);
    expect(inkOf(g(193))).toBe(popcount(0x10) + popcount(0x20) + popcount(0x70) + 3 * popcount(0x88) + popcount(0xf8) + popcount(0x88));
  });

  it('falls back to the bounding box when FONT_ASCENT/DESCENT are missing', () => {
    const { doc, info, warnings } = importBdfText(mini(glyph('i', '105', 3, '1 6 1 0', ['80', '80', '80', '80', '80', '80']), ''), 'mini.bdf');
    expect(info.ascentRows).toBe(6);
    expect(info.descentRows).toBe(2);
    expect(doc.metrics.ascent).toBe(6 * info.unitsPerCell);
    expect(warnings.join(' ')).toMatch(/FONT_ASCENT/);
  });

  it('keeps unencoded glyphs unmapped and reports duplicate encodings and odd charsets', () => {
    const text = mini(
      glyph('one', '65', 4, '1 1 0 0', ['80']) +
        glyph('two', '65', 4, '1 1 0 0', ['80']) +
        glyph('loose', '-1', 4, '1 1 0 0', ['80']) +
        glyph('bad name!', '66', 4, '1 1 0 0', ['80']),
      'FONT_ASCENT 6\nFONT_DESCENT 2\nCHARSET_REGISTRY "KOI8"\nCHARSET_ENCODING "R"\n',
    );
    const { doc, warnings, info } = importBdfText(text, 'mini.bdf');
    expect(doc.glyphs.filter((g) => g.unicode === 65).length).toBe(1);
    expect(doc.glyphs.filter((g) => g.unicode === null && g.name !== '.notdef').length).toBe(2);
    expect(info.unencoded).toBe(1);
    expect(warnings.join('\n')).toMatch(/no Unicode encoding/);
    expect(warnings.join('\n')).toMatch(/repeat an encoding/);
    expect(warnings.join('\n')).toMatch(/KOI8/);
    const names = doc.glyphs.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('bad name!');
  });

  it('reads Windows line endings, tabs and lowercase hex; picks the style from WEIGHT/SLANT', () => {
    const text = mini(glyph('i', '105', 3, '2 2 0 0', ['c0', '40']), 'FONT_ASCENT 6\nFONT_DESCENT 2\nWEIGHT_NAME "Bold"\nSLANT "I"\n').replace(/\n/g, '\r\n').replace('BBX', 'BBX\t');
    const { doc } = importBdfText(text, 'mini.bdf');
    expect(doc.meta.fontSubFamily).toBe('Bold Italic');
    const g = doc.glyphs.find((x) => x.unicode === 105)!;
    expect(inkOf(g)).toBe(3);
  });
});

describe('BDF errors', () => {
  const fail = (text: string, re: RegExp) => expect(() => importBdfText(text, 'x.bdf')).toThrow(re);

  it('rejects things that are not BDF', () => {
    fail('hello', /STARTFONT/);
    fail('', /empty|not a BDF/);
  });

  it('names the glyph and line for broken bitmaps', () => {
    fail(mini(glyph('A', '65', 4, '4 3 0 0', ['F0', 'F0'])), /Glyph “A” has 2 bitmap rows but its BBX says 3/);
    fail(mini(glyph('A', '65', 4, '4 2 0 0', ['F0', 'ZZ'])), /not hexadecimal.*\(line \d+\)/);
    fail(mini(glyph('A', '65', 4, '12 1 0 0', ['F0'])), /needed for width 12/);
    fail(mini('STARTCHAR A\nENCODING 65\nBITMAP\nF0\nENDCHAR\n'), /no BBX/);
    fail(mini('STARTCHAR A\nENCODING x\nENDCHAR\n'), /ENCODING must be a whole number/);
    expect(() => importBdfText(mini(glyph('A', '65', 4, '4 2 0 0', ['F0', 'ZZ'])), 'x.bdf')).toThrowError(BdfError);
  });

  it('detects truncation and empty fonts', () => {
    fail(mini('STARTCHAR A\nENCODING 65\nBBX 4 2 0 0\nBITMAP\nF0\n'), /truncated/);
    fail(mini(''), /no glyphs/);
    const noEnd = mini(glyph('A', '65', 4, '1 1 0 0', ['80'])).replace('ENDFONT\n', '');
    expect(importBdfText(noEnd, 'x.bdf').warnings.join(' ')).toMatch(/ENDFONT/);
  });

  it('refuses grids bigger than the editor supports', () => {
    fail(mini(glyph('A', '65', 200, '1 1 0 0', ['80'])), /at most 128/);
  });
});
