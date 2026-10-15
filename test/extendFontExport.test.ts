/**
 * End-to-end: import a font, extend it, export it, and **re-open the exported
 * bytes** to check that the new characters really are in the file.
 *
 * Nothing here trusts the editor state: every assertion about the export goes
 * through `reopenFont()` (a fresh parse of the produced sfnt) or through the
 * validation report, which does the same thing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTtf, importFont, reopenFont, verifyExportedCoverage } from '../src/core/fontCodec';
import { importAnyFont } from '../src/core/importAny';
import { analyzeCoverage } from '../src/core/coverage';
import { planAddSets } from '../src/core/addCharSets';
import { DEFAULT_LARGE_DIGIT_POINTS, GEORGIAN_MKHEDRULI, GEORGIAN_MKHEDRULI_POINTS, glyphHasArtwork } from '../src/core/charSets';
import { allUnicodes } from '../src/core/unicodeMap';
import { unicodeName } from '../src/core/unicodeNames';
import { contourBoundsTight } from '../src/core/contours';
import type { FontDoc } from '../src/core/types';
import { newTestFont, drawGlyph, parseTtf } from './helpers';

function loadFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const EXPORT_OPTIONS = { preserveHinting: true, preserveKerning: true, validate: true };

/** Build a real TTF that contains nothing but English letters and export/import it again. */
async function importedEnglishOnlyFont(): Promise<FontDoc> {
  let doc = newTestFont(8, 8, 'EnglishOnly');
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') {
    doc = drawGlyph(doc, ch.codePointAt(0)!, (bm) => bm.rect(1, 1, 5, 6, 1, true)).doc;
  }
  doc = drawGlyph(doc, 0x2e, (bm) => bm.rect(1, 0, 2, 2, 1, true)).doc; // one punctuation mark
  const { buffer } = buildTtf({ doc, sourceTtf: null, options: { ...EXPORT_OPTIONS, validate: false } });
  const { doc: reimported } = await importFont(buffer, 'EnglishOnly.ttf');
  return reimported;
}

describe('extending an imported font and exporting it', () => {
  it('exports Georgian, digits and large digits that are all really in the file', async () => {
    const englishOnly = await importedEnglishOnlyFont();
    const before = analyzeCoverage(englishOnly);
    expect(before.setById.latinUpper.present).toBe(26);
    expect(before.setById.latinLower.present).toBe(26);
    expect(before.setById.georgian.missing).toBe(33);
    expect(before.setById.digits.missing).toBe(10);

    // Add Georgian (blank, editable), then the digits with a template and finally
    // the large digits as a ×2 nearest-neighbour copy of the standard ones.
    const georgian = planAddSets(englishOnly, { sets: ['georgian'] });
    const digits = planAddSets(georgian.nextDoc, { sets: ['digits'], template: 'copy' });
    const large = planAddSets(digits.nextDoc, { sets: ['largeDigits'], template: 'copy', templateScale: 2 });
    // draw one Georgian letter so the exported file contains a real new outline
    const first = large.nextDoc.glyphs.find((g) => g.unicode === 0x10d0)!;
    const drawn: FontDoc = {
      ...large.nextDoc,
      glyphs: large.nextDoc.glyphs.map((g) =>
        g.id === first.id
          ? { ...g, kind: 'pixel', edited: true, pixel: { ...g.pixel!, cellsB64: drawCells(g.pixel!.width, g.pixel!.height) } }
          : g,
      ),
    };

    const { buffer, report } = buildTtf({ doc: drawn, sourceTtf: null, options: EXPORT_OPTIONS });
    expect(report.validation?.ok).toBe(true);
    const checkNames = report.validation!.checks.map((c) => c.name);
    expect(checkNames).toContain('Character coverage');
    expect(checkNames).toContain('Alternative (large) digits');
    expect(checkNames).toContain('Added & edited glyph outlines');
    expect(report.validation!.checks.every((c) => c.ok)).toBe(true);

    // --- reopen the actual file -------------------------------------------------
    const reopened = reopenFont(buffer);
    const { cmap, ttf } = reopened;
    expect(reopened.glyphCount).toBe(drawn.glyphs.length);
    for (const ch of 'AzaZ09') expect(cmap[ch.codePointAt(0)!]).toBeDefined();
    for (const cp of GEORGIAN_MKHEDRULI_POINTS) {
      expect(cmap[cp], `U+${cp.toString(16)} should be in the cmap`).toBeDefined();
      const glyph = reopened.glyphAt(cp)!;
      expect(glyph).toBeTruthy();
      expect(glyph.advanceWidth).toBeGreaterThan(0);
    }
    // the drawn Georgian letter has a real outline in the file
    const a = reopened.glyphAt(0x10d0)!;
    expect(Array.isArray(a.contours) ? a.contours.length : 0).toBeGreaterThan(0);
    const bounds = contourBoundsTight(
      (a.contours as Array<Array<{ x: number; y: number; onCurve: boolean }>>).map((c) => c.map((p) => ({ x: p.x, y: p.y, onCurve: !!p.onCurve }))),
    );
    expect(bounds).toBeTruthy();
    expect(bounds!.yMax).toBeGreaterThan(0); // sits above the baseline, not clipped away

    // large digits: U+E000–U+E009 → their own glyphs, bigger than the standard ones
    for (const cp of DEFAULT_LARGE_DIGIT_POINTS) expect(cmap[cp]).toBeDefined();
    const stdZero = reopened.glyphAt(0x30)!;
    const largeZero = reopened.glyphAt(0xe000)!;
    expect(cmap[0xe000]).not.toBe(cmap[0x30]);
    expect(largeZero.advanceWidth).toBe(stdZero.advanceWidth * 2);
    const largeBounds = contourBoundsTight(
      (largeZero.contours as Array<Array<{ x: number; y: number; onCurve: boolean }>>).map((c) => c.map((p) => ({ x: p.x, y: p.y, onCurve: !!p.onCurve }))),
    );
    const stdBounds = contourBoundsTight(
      (stdZero.contours as Array<Array<{ x: number; y: number; onCurve: boolean }>>).map((c) => c.map((p) => ({ x: p.x, y: p.y, onCurve: !!p.onCurve }))),
    );
    expect(largeBounds!.yMax - largeBounds!.yMin).toBeGreaterThan(stdBounds!.yMax - stdBounds!.yMin);

    // exported cmap counts measured from the file
    const coverage = verifyExportedCoverage(buffer, drawn);
    const georgianCheck = coverage.find((c) => c.set === 'Georgian Mkhedruli')!;
    expect(georgianCheck.found).toBe(33);
    const largeCheck = coverage.find((c) => c.set === 'Double-size alternative digits')!;
    expect(largeCheck.found).toBe(10);
  });

  it('keeps the original English glyphs, their metrics and the font metadata intact', async () => {
    const doc = await importedEnglishOnlyFont();
    const a = doc.glyphs.find((g) => g.unicode === 0x41)!;
    const e = doc.glyphs.find((g) => g.unicode === 0x65)!;
    const beforeMetrics = { ...doc.metrics };
    const beforeMeta = { ...doc.meta };

    const extended = planAddSets(doc, { sets: ['georgian', 'digits'] }).nextDoc;
    const { buffer } = buildTtf({ doc: extended, sourceTtf: null, options: EXPORT_OPTIONS });
    const reopened = reopenFont(buffer);

    for (const g of [a, e]) {
      const inFile = reopened.glyphAt(g.unicode!)!;
      expect(inFile).toBeTruthy();
      expect(inFile.advanceWidth).toBe(g.advanceWidth);
      expect((inFile.contours as unknown[]).length).toBe(g.contours.length);
      // identical point data for the untouched glyphs
      const flat = (cs: Array<Array<{ x: number; y: number }>>) => cs.flatMap((c) => c.map((p) => `${p.x},${p.y}`)).join(' ');
      expect(flat(inFile.contours as never)).toBe(flat(g.contours as never));
    }
    const head = reopened.ttf.head as { unitsPerEm: number };
    const hhea = reopened.ttf.hhea as { ascent: number; descent: number; lineGap: number };
    expect(head.unitsPerEm).toBe(beforeMetrics.unitsPerEm);
    expect(hhea.ascent).toBe(beforeMetrics.ascent);
    expect(hhea.descent).toBe(beforeMetrics.descent);
    expect(hhea.lineGap).toBe(beforeMetrics.lineGap);
    const names = reopened.ttf.name as Record<string, string>;
    expect(names.fontFamily).toBe(beforeMeta.fontFamily);
    expect(names.fontSubFamily).toBe(beforeMeta.fontSubFamily);
    expect(reopened.ttf.post).toBeTruthy();
    expect(reopened.ttf['OS/2']).toBeTruthy();
  });

  it('keeps imported punctuation, symbols and unrelated glyphs intact (Lato)', async () => {
    const lato = await importAnyFont(loadFixture('Lato-Regular.ttf'), 'Lato-Regular.ttf');
    const doc = lato.doc;
    const slash = doc.glyphs.find((g) => g.unicode === 0x2f)!; // '/'
    const euro = doc.glyphs.find((g) => g.unicode === 0x20ac)!;
    const ccedilla = doc.glyphs.find((g) => g.unicode === 0xe7)!; // unrelated glyph outside the sets
    expect(slash && euro && ccedilla).toBeTruthy();
    const glyphCountBefore = doc.glyphs.length;

    const extended = planAddSets(doc, { sets: ['georgian'], gridRows: 16, existing: 'keep' }).nextDoc;
    expect(extended.glyphs.length).toBe(glyphCountBefore + 33);
    const { buffer, report } = buildTtf({ doc: extended, sourceTtf: lato.sourceTtf, options: EXPORT_OPTIONS });
    expect(report.validation?.ok).toBe(true);

    const reopened = reopenFont(buffer);
    for (const g of [slash, euro, ccedilla]) {
      const inFile = reopened.glyphAt(g.unicode!)!;
      expect(inFile, `U+${g.unicode!.toString(16)} must survive`).toBeTruthy();
      expect(inFile.advanceWidth).toBe(g.advanceWidth);
    }
    // the added Georgian letters are in the file as well
    for (const cp of GEORGIAN_MKHEDRULI_POINTS) expect(reopened.cmap[cp]).toBeDefined();
    // Lato's own tables that we can preserve are still there
    const tables = Object.keys(reopened.ttf);
    expect(tables).toContain('GPOS');
    expect(tables).toContain('glyf');
    expect(reopened.glyphCount).toBe(extended.glyphs.length);
  });

  it('writes the large digits to the configured code points, not to the standard digits', async () => {
    const doc = await importedEnglishOnlyFont();
    const custom = Array.from({ length: 10 }, (_, i) => 0xe100 + i);
    const digits = planAddSets(doc, { sets: ['digits'], template: 'copy' });
    const large = planAddSets(digits.nextDoc, { sets: ['largeDigits'], template: 'copy', templateScale: 2, altDigitPoints: custom });
    expect(large.altDigitPoints).toEqual(custom);
    const { buffer } = buildTtf({ doc: large.nextDoc, sourceTtf: null, options: EXPORT_OPTIONS });
    const reopened = reopenFont(buffer);
    for (let i = 0; i < 10; i++) {
      expect(reopened.cmap[custom[i]]).toBeDefined();
      expect(reopened.cmap[0x30 + i]).toBeDefined();
      expect(reopened.cmap[custom[i]]).not.toBe(reopened.cmap[0x30 + i]);
    }
    // the default PUA code points were not used at all
    for (const cp of DEFAULT_LARGE_DIGIT_POINTS) expect(reopened.cmap[cp]).toBeUndefined();
    // the standard digits still hold the regular design (half the size of the large copies)
    const std = reopened.glyphAt(0x30)!;
    const big = reopened.glyphAt(custom[0])!;
    expect(big.advanceWidth).toBe(std.advanceWidth * 2);
  });

  it('does not touch the standard digits when the large digits are added', async () => {
    const doc = await importedEnglishOnlyFont();
    const digits = planAddSets(doc, { sets: ['digits'], template: 'copy' }).nextDoc;
    const zeroBefore = digits.glyphs.find((g) => g.unicode === 0x30)!;
    const large = planAddSets(digits, { sets: ['largeDigits'], template: 'copy', templateScale: 2 }).nextDoc;
    const zeroAfter = large.glyphs.find((g) => g.unicode === 0x30)!;
    expect(zeroAfter).toBe(zeroBefore);
    expect(zeroAfter.pixel!.cellsB64).toBe(zeroBefore.pixel!.cellsB64);
    const { buffer } = buildTtf({ doc: large, sourceTtf: null, options: EXPORT_OPTIONS });
    const reopened = reopenFont(buffer);
    const stdInFile = reopened.glyphAt(0x30)!;
    expect(stdInFile.advanceWidth).toBe(zeroBefore.advanceWidth);
    expect((stdInFile.contours as unknown[]).length).toBeGreaterThan(0);
  });

  it('exports a font whose Georgian letters are still blank without corrupting the file', async () => {
    const doc = await importedEnglishOnlyFont();
    const extended = planAddSets(doc, { sets: ['georgian'] }).nextDoc;
    expect(extended.glyphs.filter((g) => g.origin === 'added').every((g) => !glyphHasArtwork(g))).toBe(true);
    const { buffer, report } = buildTtf({ doc: extended, sourceTtf: null, options: EXPORT_OPTIONS });
    expect(report.validation?.ok).toBe(true);
    const reopened = reopenFont(buffer);
    // blank glyphs are mapped and present, they simply have no outline yet
    for (const cp of GEORGIAN_MKHEDRULI_POINTS) {
      const g = reopened.glyphAt(cp)!;
      expect(g).toBeTruthy();
      expect((g.contours ?? []).length).toBe(0);
    }
    expect(report.notes.some((n) => /alternative \(double-size\) digits have no glyph/.test(n))).toBe(true);
  });

  it('refuses to export when a code point has two glyphs, with a readable message', async () => {
    const doc = await importedEnglishOnlyFont();
    // two glyphs claim U+10D0 — a cmap can hold only one owner, so this is
    // reported instead of failing deep inside the font writer
    const georgian = planAddSets(doc, { sets: ['georgian'] }).nextDoc;
    const owner = georgian.glyphs.find((g) => g.unicode === 0x10d0)!;
    const impostor = { ...owner, id: 'impostor', name: 'impostor', contours: [], pixel: null, edited: true };
    const broken: FontDoc = { ...georgian, glyphs: [...georgian.glyphs, impostor] };
    expect(() => buildTtf({ doc: broken, sourceTtf: null, options: EXPORT_OPTIONS })).toThrow(/mapped to two glyphs/);
    try {
      buildTtf({ doc: broken, sourceTtf: null, options: EXPORT_OPTIONS });
    } catch (err) {
      expect(String(err)).toMatch(/U\+10D0/);
      expect(String(err)).toMatch(/Unicode mappings/);
    }
    // the coverage report also warns about it — the document is still usable
    const report = analyzeCoverage(broken);
    expect(report.warnings.some((w) => /mapped to more than one glyph/.test(w))).toBe(true);
  });
});

describe('export validation details', () => {
  it('reports the character coverage measured on the re-opened file', async () => {
    const doc = await importedEnglishOnlyFont();
    const extended = planAddSets(doc, { sets: ['georgian', 'digits', 'largeDigits'] }).nextDoc;
    const { buffer } = buildTtf({ doc: extended, sourceTtf: null, options: EXPORT_OPTIONS });
    const coverage = verifyExportedCoverage(buffer, extended);
    const byName = Object.fromEntries(coverage.map((c) => [c.set, c]));
    expect(byName['English uppercase'].found).toBe(26);
    expect(byName['English lowercase'].found).toBe(26);
    expect(byName['Standard digits'].found).toBe(10);
    expect(byName['Georgian Mkhedruli'].found).toBe(33);
    expect(byName['Double-size alternative digits'].found).toBe(10);
    expect(byName['Georgian Mkhedruli'].missing).toEqual([]);
  });

  it('lists the Georgian letters by their official Unicode names after a round trip', async () => {
    const doc = await importedEnglishOnlyFont();
    const extended = planAddSets(doc, { sets: ['georgian'] }).nextDoc;
    const { buffer } = buildTtf({ doc: extended, sourceTtf: null, options: EXPORT_OPTIONS });
    const { doc: reimported } = await importFont(buffer, 'extended.ttf');
    const letters = reimported.glyphs.filter((g) => allUnicodes(g).some((cp) => GEORGIAN_MKHEDRULI_POINTS.includes(cp)));
    expect(letters).toHaveLength(33);
    expect(GEORGIAN_MKHEDRULI_POINTS.every((cp) => unicodeName(cp) !== null)).toBe(true);
    const charList = letters.map((g) => String.fromCodePoint(g.unicode!)).join('');
    expect(charList).toBe(GEORGIAN_MKHEDRULI);
  });
});

/** A lit cell pattern for a w×h grid (used to give one added letter real ink). */
function drawCells(w: number, h: number): string {
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h - 2; y++) for (let x = 1; x < w - 1; x++) cells[y * w + x] = y % 2 === 0 || x % 2 === 0 ? 1 : 0;
  let bin = '';
  for (const c of cells) bin += String.fromCharCode(c);
  return btoa(bin);
}
