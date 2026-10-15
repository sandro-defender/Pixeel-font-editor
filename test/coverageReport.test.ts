/**
 * Character coverage report (see core/coverage.ts):
 *  - importing a font with complete coverage,
 *  - importing fonts that miss Georgian / English case / digits,
 *  - characters that map to .notdef or to a blank glyph are NOT "supported",
 *  - the required mappings themselves (A–Z, a–z, the 33 Mkhedruli letters, 0–9,
 *    U+E000–U+E009) and the graceful handling of malformed files.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeCoverage, coverageOfSet, coverageSummaryLine, isComplete } from '../src/core/coverage';
import { importFont } from '../src/core/fontCodec';
import { importAnyFont } from '../src/core/importAny';
import { createNewFont, makePixelGlyph } from '../src/core/fontFactory';
import {
  CHAR_SETS,
  DEFAULT_LARGE_DIGIT_POINTS,
  GEORGIAN_MKHEDRULI,
  GEORGIAN_MKHEDRULI_POINTS,
  PUNCTUATION_POINTS,
  charSetDef,
  largeDigitPoints,
  pointsForSet,
} from '../src/core/charSets';
import { unicodeName } from '../src/core/unicodeNames';
import { newTestFont, drawGlyph } from './helpers';
import type { FontDoc } from '../src/core/types';

function loadFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A font with the digits and letters actually drawn, no Georgian. */
function latinFont(): FontDoc {
  let doc = newTestFont(8, 8, 'LatinOnly');
  for (const cp of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'abcdefghijklmnopqrstuvwxyz', ...'0123456789']) {
    doc = drawGlyph(doc, cp.codePointAt(0)!, (bm) => bm.rect(1, 1, 5, 5, 1, true)).doc;
  }
  return doc;
}

describe('character set definitions', () => {
  it('uses the standard Unicode mappings for every ordinary text character', () => {
    expect(charSetDef('latinUpper').points[0]).toBe(0x41);
    expect(charSetDef('latinUpper').points).toHaveLength(26);
    expect(charSetDef('latinUpper').points[25]).toBe(0x5a);
    expect(charSetDef('latinLower').points[0]).toBe(0x61);
    expect(charSetDef('latinLower').points).toHaveLength(26);
    expect(charSetDef('latinLower').points[25]).toBe(0x7a);
    expect(charSetDef('digits').points).toEqual([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(DEFAULT_LARGE_DIGIT_POINTS).toEqual([0xe000, 0xe001, 0xe002, 0xe003, 0xe004, 0xe005, 0xe006, 0xe007, 0xe008, 0xe009]);
  });

  it('lists exactly the 33 modern Mkhedruli letters, U+10D0–U+10F0', () => {
    expect(GEORGIAN_MKHEDRULI).toHaveLength(33);
    expect(GEORGIAN_MKHEDRULI_POINTS[0]).toBe(0x10d0);
    expect(GEORGIAN_MKHEDRULI_POINTS[32]).toBe(0x10f0);
    expect(GEORGIAN_MKHEDRULI_POINTS).toEqual(Array.from({ length: 33 }, (_, i) => 0x10d0 + i));
    // every letter is an assigned Georgian letter with an official name
    for (const cp of GEORGIAN_MKHEDRULI_POINTS) expect(unicodeName(cp)).toMatch(/GEORGIAN (LETTER|.*LETTER)/);
    // the archaic letters inside the U+10D0–U+10F5 range are NOT part of the required set
    for (const cp of [0x10f1, 0x10f2, 0x10f3, 0x10f4, 0x10f5]) expect(GEORGIAN_MKHEDRULI_POINTS).not.toContain(cp);
  });

  it('covers the basic punctuation and common symbols of ordinary text', () => {
    const punct = new Set(PUNCTUATION_POINTS);
    for (const ch of ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~') expect(punct.has(ch.codePointAt(0)!)).toBe(true);
    for (const cp of [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x20ac]) expect(punct.has(cp)).toBe(true);
    // letters and digits belong to their own sets
    for (const cp of [0x41, 0x61, 0x30]) expect(punct.has(cp)).toBe(false);
  });

  it('never lists unused code points inside a range (no glyphs for U+10F1–U+10F5)', () => {
    const georgian = charSetDef('georgian');
    expect(georgian.points).toHaveLength(33);
    expect(Math.min(...georgian.points)).toBe(0x10d0);
    expect(Math.max(...georgian.points)).toBe(0x10f0);
    expect(new Set(CHAR_SETS.flatMap((s) => s.points)).size).toBe(CHAR_SETS.reduce((n, s) => n + s.points.length, 0));
  });
});

describe('importing fonts and inspecting their coverage', () => {
  it('reports a complete-coverage font as complete', () => {
    let doc = latinFont();
    // add the rest of the required sets: Georgian, punctuation and the large digits
    const points = [...GEORGIAN_MKHEDRULI_POINTS, ...PUNCTUATION_POINTS, ...DEFAULT_LARGE_DIGIT_POINTS];
    for (const cp of points) doc = drawGlyph(doc, cp, (bm) => bm.set(0, 0, 1)).doc;
    const report = analyzeCoverage(doc);
    expect(report.totals.missing).toBe(0);
    expect(report.totals.blank).toBe(0);
    expect(isComplete(report)).toBe(true);
    expect(coverageSummaryLine(report)).toContain('Georgian 33/33');
    expect(coverageSummaryLine(report)).toContain('Large digits 10/10');
  });

  it('detects an imported font that has no Georgian characters (Lato)', async () => {
    const { doc, coverage, warnings } = await importFont(loadFixture('Lato-Regular.ttf'), 'Lato-Regular.ttf');
    expect(doc.meta.fontFamily).toBe('Lato');
    expect(coverage.setById.georgian.present).toBe(0);
    expect(coverage.setById.georgian.missing).toBe(33);
    expect(coverage.setById.georgian.missingPoints).toEqual(GEORGIAN_MKHEDRULI_POINTS);
    // Lato is a complete Latin font: English upper, lower and digits are all there
    expect(coverage.setById.latinUpper.present).toBe(26);
    expect(coverage.setById.latinLower.present).toBe(26);
    expect(coverage.setById.digits.present).toBe(10);
    expect(coverage.setById.largeDigits.present).toBe(0);
    expect(coverage.setById.punct.present).toBeGreaterThan(30);
    expect(coverage.unusable).toBe(false);
    // the import itself reports the coverage situation to the caller
    const any = await importAnyFont(loadFixture('Lato-Regular.ttf'), 'Lato-Regular.ttf');
    expect(any.warnings.some((w) => /Character coverage:.*Georgian 0\/33/.test(w))).toBe(true);
    expect(warnings.every((w) => typeof w === 'string')).toBe(true);
  });

  it('detects a font that is missing English uppercase or lowercase letters', () => {
    let onlyUpper = newTestFont(8, 8, 'UpperOnly');
    for (const ch of 'ABC') onlyUpper = drawGlyph(onlyUpper, ch.codePointAt(0)!, (bm) => bm.set(2, 2, 1)).doc;
    const upper = analyzeCoverage(onlyUpper);
    expect(upper.setById.latinUpper.present).toBe(3);
    expect(upper.setById.latinUpper.missing).toBe(23);
    expect(upper.setById.latinLower.present).toBe(0);
    expect(upper.setById.latinLower.missingPoints).toContain(0x61);
    expect(upper.setById.latinLower.missingPoints).toContain(0x7a);

    let onlyLower = newTestFont(8, 8, 'LowerOnly');
    onlyLower = drawGlyph(onlyLower, 0x61, (bm) => bm.set(1, 1, 1)).doc;
    const lower = analyzeCoverage(onlyLower);
    expect(lower.setById.latinLower.present).toBe(1);
    expect(lower.setById.latinUpper.missing).toBe(26);
  });

  it('detects a font without standard digits and without large digits', () => {
    let doc = newTestFont(8, 8, 'NoDigits');
    doc = drawGlyph(doc, 0x41, (bm) => bm.set(1, 1, 1)).doc;
    const report = analyzeCoverage(doc);
    expect(report.setById.digits.present).toBe(0);
    expect(report.setById.digits.missing).toBe(10);
    expect(report.setById.digits.missingPoints).toEqual([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(report.setById.largeDigits.missingPoints).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
  });

  it('counts a mapped-but-empty glyph as blank, never as supported', () => {
    const base = newTestFont(8, 8, 'BlankMapped');
    const blank = makePixelGlyph(0x41, 8, 8, { unitsPerCell: base.glyphs[1].pixel!.unitsPerCell, baselineRow: 2, defaultAdvance: 512 }, true);
    blank.name = 'A';
    const doc: FontDoc = { ...base, glyphs: [...base.glyphs, blank] };
    const report = analyzeCoverage(doc);
    expect(report.setById.latinUpper.present).toBe(0);
    expect(report.setById.latinUpper.blank).toBe(1);
    expect(report.setById.latinUpper.missing).toBe(25);
    expect(report.setById.latinUpper.entries.find((e) => e.codePoint === 0x41)!.status).toBe('blank');
    expect(report.warnings.some((w) => /blank/i.test(w))).toBe(true);
  });

  it('counts a code point mapped to .notdef as missing', () => {
    const base = newTestFont(8, 8, 'NotdefMap');
    const doc: FontDoc = {
      ...base,
      glyphs: base.glyphs.map((g, i) => (i === 0 ? { ...g, unicode: 0x41, extraUnicodes: [0x10d0] } : g)),
    };
    const report = analyzeCoverage(doc);
    const a = report.setById.latinUpper.entries.find((e) => e.codePoint === 0x41)!;
    expect(a.status).toBe('missing');
    expect(a.note).toMatch(/notdef/);
    expect(report.setById.latinUpper.present).toBe(0);
    const geo = report.setById.georgian.entries.find((e) => e.codePoint === 0x10d0)!;
    expect(geo.status).toBe('missing');
    expect(report.warnings.some((w) => /\.notdef/.test(w))).toBe(true);
  });

  it('reports the large digits from the font mapping, not the hard-coded default', () => {
    const base = newTestFont(8, 8, 'CustomMapping');
    const doc: FontDoc = { ...base, altDigits: { codepoints: Array.from({ length: 10 }, (_, i) => 0xe100 + i) } };
    expect(largeDigitPoints(doc)).toEqual(Array.from({ length: 10 }, (_, i) => 0xe100 + i));
    expect(pointsForSet('largeDigits', doc)).toEqual(Array.from({ length: 10 }, (_, i) => 0xe100 + i));
    const report = analyzeCoverage(doc);
    expect(report.setById.largeDigits.points[0]).toBe(0xe100);
    expect(coverageOfSet(doc, charSetDef('largeDigits')).missingPoints[0]).toBe(0xe100);
  });
});

describe('malformed and unsupported font files', () => {
  it('fails with a readable message instead of corrupting the workspace', async () => {
    const garbage = new Uint8Array(512).fill(7);
    await expect(importFont(garbage.buffer, 'broken.ttf')).rejects.toThrow(/TrueType|sfnt|font/i);
    await expect(importAnyFont(garbage.buffer, 'broken.ttf')).rejects.toThrow();
    await expect(importAnyFont(new Uint8Array(4).buffer, 'tiny.ttf')).rejects.toThrow();
  });

  it('reads a WOFF container (decompressed in the browser) and rejects a truncated one with a message', async () => {
    const woff = await importFont(loadFixture('Lato-Regular.woff'), 'Lato-Regular.woff');
    expect(woff.doc.meta.fontFamily).toBe('Lato');
    expect(woff.warnings.some((w) => /WOFF/.test(w))).toBe(true);

    const full = loadFixture('Lato-Regular.woff');
    const half = full.slice(0, Math.floor(full.byteLength / 3));
    await expect(importFont(half, 'truncated.woff')).rejects.toThrow(/font|WOFF|parse|offset/i);
  });

  it('flags a document with no editable glyphs as unusable', () => {
    const doc = newTestFont(8, 8, 'EmptyDoc');
    const empty: FontDoc = { ...doc, glyphs: doc.glyphs.slice(0, 1) };
    const report = analyzeCoverage(empty);
    expect(report.unusable).toBe(true);
    expect(report.warnings.some((w) => /no editable glyphs/i.test(w))).toBe(true);
  });
});
