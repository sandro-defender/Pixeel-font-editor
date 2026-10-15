/**
 * "Add Character Sets" (core/addCharSets.ts):
 *  - adding a whole set only adds what is missing and never overwrites,
 *  - new glyphs are editable blank pixel grids, never claimed as finished,
 *  - templates (copy / nearest-neighbour scale) are explicit operations,
 *  - metric defaults come from the font and the global metrics stay untouched,
 *  - the alternative-digit mapping is configurable, validated and non-destructive.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addMissingSets,
  addSingleCharacter,
  altDigitPointsOf,
  blankGridFor,
  copyArtworkInto,
  defaultAdvanceFor,
  incompleteSetIds,
  planAddSets,
  reconfigureAltDigits,
  scaleGlyphNearest,
  validateAltDigitPoints,
} from '../src/core/addCharSets';
import { importFont } from '../src/core/fontCodec';
import { createNewFont, makePixelGlyph } from '../src/core/fontFactory';
import {
  DEFAULT_LARGE_DIGIT_POINTS,
  GEORGIAN_MKHEDRULI_POINTS,
  PUNCTUATION_POINTS,
  glyphHasArtwork,
  glyphState,
  largeDigitPoints,
} from '../src/core/charSets';
import { allUnicodes } from '../src/core/unicodeMap';
import { analyzeCoverage } from '../src/core/coverage';
import { Bitmap } from '../src/core/bitmap';
import type { FontDoc, GlyphDoc } from '../src/core/types';
import { newTestFont, drawGlyph, cellsOf } from './helpers';

const LETTER = (bm: Bitmap) => bm.rect(1, 1, 5, 6, 1, true);
const DIGIT = (bm: Bitmap) => bm.rect(0, 0, 3, 5, 1, true);

/** A pixel font with A–Z, a–z and 0–9 drawn; no Georgian, no punctuation, no large digits. */
function latinOnly(extra: Array<[number, (bm: Bitmap) => void]> = []): FontDoc {
  let doc = newTestFont(8, 8, 'LatinOnly');
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') doc = drawGlyph(doc, ch.codePointAt(0)!, LETTER).doc;
  for (const ch of '0123456789') doc = drawGlyph(doc, ch.codePointAt(0)!, DIGIT).doc;
  for (const [cp, draw] of extra) doc = drawGlyph(doc, cp, draw).doc;
  return doc;
}

const glyphFor = (doc: FontDoc, cp: number): GlyphDoc | undefined => doc.glyphs.find((g) => allUnicodes(g).includes(cp));

describe('adding missing character sets', () => {
  it('adds exactly the missing Georgian letters as editable blank pixel grids', () => {
    const doc = latinOnly();
    const before = analyzeCoverage(doc);
    expect(before.setById.georgian.missing).toBe(33);

    const plan = planAddSets(doc, { sets: ['georgian'] });
    expect(plan.additions).toHaveLength(33);
    expect(plan.skipped).toHaveLength(0);
    const after = analyzeCoverage(plan.nextDoc);
    // present only counts artwork: the new letters are blank on purpose …
    expect(after.setById.georgian.present).toBe(0);
    expect(after.setById.georgian.blank).toBe(33);
    expect(after.setById.georgian.missing).toBe(0);

    // … but they exist, are mapped, and are editable in the matrix editor
    for (const cp of GEORGIAN_MKHEDRULI_POINTS) {
      const g = glyphFor(plan.nextDoc, cp)!;
      expect(g).toBeTruthy();
      expect(g.pixel).toBeTruthy();
      expect(g.pixel!.width).toBeGreaterThan(0);
      expect(g.pixel!.height).toBe(8);
      expect(Bitmap.fromB64(g.pixel!.width, g.pixel!.height, g.pixel!.cellsB64).count()).toBe(0);
      expect(glyphHasArtwork(g)).toBe(false);
      expect(g.origin).toBe('added');
      expect(g.edited).toBe(false);
      expect(glyphState(g)).toBe('blank');
    }
    // the new glyphs sit on the font's own grid and baseline
    const template = doc.glyphs.find((g) => g.pixel && g.name !== '.notdef')!.pixel!;
    const newLetter = glyphFor(plan.nextDoc, 0x10d0)!;
    expect(newLetter.pixel!.unitsPerCell).toBe(template.unitsPerCell);
    expect(newLetter.pixel!.baselineRow).toBe(template.baselineRow);
  });

  it('never replaces an existing glyph and preserves its design, mapping, advance and spacing', () => {
    const doc = latinOnly();
    const a = glyphFor(doc, 0x41)!;
    const plan = planAddSets(doc, { sets: ['latinUpper', 'latinLower', 'digits'] });
    expect(plan.changes).toHaveLength(0);
    expect(plan.additions).toHaveLength(0);
    expect(plan.skipped).toHaveLength(62);
    expect(plan.skipped.every((s) => s.reason === 'present')).toBe(true);
    expect(plan.nextDoc).toBe(doc); // nothing at all changed

    const after = plan.nextDoc.glyphs.find((g) => g.id === a.id)!;
    expect(after.pixel!.cellsB64).toBe(a.pixel!.cellsB64);
    expect(after.advanceWidth).toBe(a.advanceWidth);
    expect(after.leftSideBearing).toBe(a.leftSideBearing);
    expect(after.unicode).toBe(0x41);
    expect(after.edited).toBe(a.edited); // untouched, whatever the source state was
  });

  it('adds several sets in one undoable batch and leaves the existing glyphs byte-identical', () => {
    const doc = latinOnly();
    const { doc: next, plan } = addMissingSets(doc, { sets: ['georgian', 'punct'] });
    // every required punctuation mark except the space is missing in this font;
    // the space already exists (a mapped space with an advance is complete)
    expect(plan.additions.length).toBe(33 + PUNCTUATION_POINTS.length - 1);
    expect(plan.skipped.map((s) => s.codePoint)).toEqual([0x20]);
    // the original glyphs are the very same objects, not copies
    for (const original of doc.glyphs) {
      expect(next.glyphs.find((g) => g.id === original.id)).toBe(original);
    }
    expect(analyzeCoverage(next).setById.punct.missing).toBe(0);
    expect(next.glyphs.length).toBe(doc.glyphs.length + plan.additions.length);
    // running it again adds nothing (idempotent)
    const again = planAddSets(next, { sets: ['georgian', 'punct'] });
    expect(again.additions).toHaveLength(0);
    expect(again.nextDoc).toBe(next);
  });

  it('keeps blank glyphs alone by default and only fills/replaces them when asked', () => {
    const base = newTestFont(8, 8, 'Blanks');
    const blank = makePixelGlyph(0x41, 8, 8, { unitsPerCell: 128, baselineRow: 2, defaultAdvance: 900 }, true);
    blank.name = 'A';
    blank.edited = false;
    const doc: FontDoc = { ...base, glyphs: [...base.glyphs, blank] };

    const keep = planAddSets(doc, { sets: ['latinUpper'] });
    expect(keep.skipped.find((s) => s.codePoint === 0x41)!.reason).toBe('blank');
    expect(keep.nextDoc.glyphs.find((g) => g.id === blank.id)!.pixel!.cellsB64).toBe(blank.pixel!.cellsB64);

    const fill = planAddSets(doc, { sets: ['latinUpper'], existing: 'fillBlank', template: 'copy' });
    const filled = fill.fills.find((c) => c.codePoint === 0x41);
    expect(filled).toBeTruthy();
    const filledGlyph = fill.nextDoc.glyphs.find((g) => g.id === blank.id)!;
    expect(filledGlyph.advanceWidth).toBe(blank.advanceWidth); // existing advance preserved
    expect(filledGlyph.edited).toBe(true);

    const overwrite = planAddSets(doc, { sets: ['latinUpper'], existing: 'overwrite' });
    expect(overwrite.replacements.some((c) => c.codePoint === 0x41)).toBe(true);
  });

  it('never overwrites a designed glyph unless overwrite AND a template are chosen', () => {
    const doc = latinOnly();
    const a = glyphFor(doc, 0x41)!;

    // overwrite without a template cannot invent artwork → the design is kept
    const bare = planAddSets(doc, { sets: ['latinUpper'], existing: 'overwrite' });
    expect(bare.changes.some((c) => c.codePoint === 0x41)).toBe(false);
    expect(bare.skipped.some((s) => s.codePoint === 0x41 && s.reason === 'present')).toBe(true);
    expect(bare.nextDoc.glyphs.find((g) => g.id === a.id)!.pixel!.cellsB64).toBe(a.pixel!.cellsB64);
    expect(bare.warnings.some((w) => /Overwrite.*keep their artwork/.test(w))).toBe(true); // with "“Overwrite” needs a template ..." in front

    // …and still not with a template while the policy is the default
    const keep = planAddSets(doc, { sets: ['latinUpper'], template: 'copy' });
    expect(keep.nextDoc.glyphs.find((g) => g.id === a.id)).toBe(a);
    expect(keep.replacements.some((c) => c.codePoint === 0x41)).toBe(false);

    // a template that is only picked automatically (here: the first designed
    // letter of the set) must not wipe the other designs either
    const auto = planAddSets(doc, { sets: ['latinUpper'], existing: 'overwrite', template: 'copy' });
    expect(auto.changes.some((c) => c.codePoint === 0x41)).toBe(false);
    expect(auto.nextDoc.glyphs.find((g) => g.id === a.id)).toBe(a);

    // an explicit template + overwrite does replace the artwork — and says so
    const source = glyphFor(doc, 0x42)!;
    const plan = planAddSets(doc, { sets: ['latinUpper'], existing: 'overwrite', template: 'copy', templateGlyphId: source.id });
    const change = plan.replacements.find((c) => c.codePoint === 0x41)!;
    expect(change).toBeTruthy();
    expect(change.replacedArtwork).toBe(true);
    expect(change.templateGlyphId).toBe(source.id);
    const replaced = plan.nextDoc.glyphs.find((g) => g.id === a.id)!;
    expect(replaced.pixel!.cellsB64).toBe(source.pixel!.cellsB64);
    expect(replaced.advanceWidth).toBe(a.advanceWidth); // advance stays unless asked for
    expect(replaced.id).toBe(a.id); // same glyph, same mapping — only the artwork changed
    expect(replaced.edited).toBe(true);
    // the chosen template applies to the whole set: the other letters were
    // replaced with it as well (that is what an explicit overwrite means), while
    // .notdef, the unmapped glyphs and the glyphs outside the set are untouched
    const keptC = plan.nextDoc.glyphs.find((g) => g.id === glyphFor(doc, 0x43)!.id)!;
    expect(keptC.pixel!.cellsB64).toBe(source.pixel!.cellsB64);
    expect(keptC.id).toBe(glyphFor(doc, 0x43)!.id);
    expect(plan.nextDoc.glyphs.find((g) => g.name === '.notdef')).toBe(doc.glyphs.find((g) => g.name === '.notdef'));
    expect(plan.changes.filter((c) => c.replacedArtwork)).toHaveLength(26);
    // and a created glyph is never a "replaced artwork" case
    expect(plan.additions.every((c) => !c.replacedArtwork)).toBe(true);
  });

  it('gives new characters metric defaults from the font and never touches the global metrics', () => {
    const doc = latinOnly();
    const letterMedian = defaultAdvanceFor(doc, 'latinUpper');
    const plan = planAddSets(doc, { sets: ['georgian', 'digits', 'largeDigits'] });
    const georgian = plan.additions.filter((a) => a.set === 'georgian');
    expect(georgian.every((a) => a.advanceWidth === letterMedian)).toBe(true);
    const digits = plan.additions.filter((a) => a.set === 'digits');
    expect(digits).toHaveLength(0); // digits already exist
    // large digits start blank: their advance follows the missing standard digit → letter fallback
    const large = plan.additions.filter((a) => a.set === 'largeDigits');
    expect(large).toHaveLength(10);
    expect(large.every((a) => a.advanceWidth > 0)).toBe(true);

    expect(plan.nextDoc.metrics).toEqual(doc.metrics);
    for (const add of plan.additions) {
      const g = plan.nextDoc.glyphs.find((x) => x.id === add.glyphId)!;
      expect(g.leftSideBearing).toBe(0);
      expect(g.pixel!.offsetX).toBe(0);
    }
  });

  it('creates vector-font glyphs on a grid derived from the font metrics', async () => {
    const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
    const { doc } = await importFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'Lato.ttf');
    expect(doc.glyphs.some((g) => g.pixel)).toBe(false);
    const plan = planAddSets(doc, { sets: ['georgian'], gridRows: 16 });
    expect(plan.additions).toHaveLength(33);
    const grid = blankGridFor(doc, 16);
    expect(grid.height).toBe(16);
    expect(grid.unitsPerCell).toBeCloseTo((doc.metrics.ascent - doc.metrics.descent) / 16, 1);
    for (const add of plan.additions) {
      expect(add.gridHeight).toBe(16);
      expect(add.gridWidth).toBeGreaterThanOrEqual(1);
      expect(add.advanceWidth).toBeGreaterThan(0);
    }
    // ascent/descent/upm of the imported font survive
    expect(plan.nextDoc.metrics).toEqual(doc.metrics);
    expect(plan.nextDoc.meta).toEqual(doc.meta);
  });

  it('is idempotent for the same options and reports what it skipped', () => {
    const doc = latinOnly();
    const first = planAddSets(doc, { sets: ['georgian'] }).nextDoc;
    const second = planAddSets(first, { sets: ['georgian'] });
    expect(second.additions).toHaveLength(0);
    expect(second.skipped).toHaveLength(33);
    expect(second.skipped.every((s) => s.reason === 'blank')).toBe(true);
    expect(incompleteSetIds(first)).toContain('georgian'); // still blank → still incomplete
    expect(incompleteSetIds(first)).not.toContain('latinUpper');
  });

  it('adds a single character on demand (the "Missing glyphs" grid)', () => {
    const doc = latinOnly();
    const { doc: next, plan } = addSingleCharacter(doc, 0x10d0);
    expect(plan).toBeTruthy();
    expect(plan!.changes).toHaveLength(1);
    expect(next.glyphs.length).toBe(doc.glyphs.length + 1);
    expect(glyphFor(next, 0x10d0)).toBeTruthy();
    expect(glyphFor(next, 0x10d1)).toBeUndefined();
    // asking again changes nothing: the character exists (blank) and the default
    // policy never overwrites — the UI opens the existing glyph instead
    const again = addSingleCharacter(next, 0x10d0);
    expect(again.plan).toBeNull();
    expect(again.doc).toBe(next);
    // an explicit overwrite policy does fill it
    const filled = addSingleCharacter(next, 0x10d0, { existing: 'overwrite' });
    expect(filled.plan).toBeTruthy();
    expect(filled.plan!.changes).toHaveLength(1);
    // a character that is fully drawn is left alone
    const drawn = drawGlyph(next, 0x10d1, LETTER).doc;
    const noop = addSingleCharacter(drawn, 0x10d1);
    expect(noop.plan).toBeNull();
    expect(noop.doc).toBe(drawn);
  });
});

describe('templates, copying and scaling', () => {
  it('copies the standard digit into the large digit and scales it nearest-neighbour', () => {
    const doc = latinOnly();
    const withSet = planAddSets(doc, { sets: ['largeDigits'] }).nextDoc;
    const largeZero = glyphFor(withSet, 0xe000)!;
    const zero = glyphFor(withSet, 0x30)!;
    expect(glyphHasArtwork(largeZero)).toBe(false);

    const copied = copyArtworkInto(withSet, largeZero.id, zero.id, { scale: 1 });
    const c = copied.doc.glyphs.find((g) => g.id === largeZero.id)!;
    expect(glyphHasArtwork(c)).toBe(true);
    expect(c.pixel!.width).toBe(zero.pixel!.width);
    expect(c.pixel!.height).toBe(zero.pixel!.height);
    expect(c.pixel!.cellsB64).toBe(zero.pixel!.cellsB64);
    expect(c.unicode).toBe(0xe000); // the code point never moves
    expect(c.advanceWidth).toBe(zero.advanceWidth);

    const doubled = copyArtworkInto(withSet, largeZero.id, zero.id, { scale: 2 });
    const d = doubled.doc.glyphs.find((g) => g.id === largeZero.id)!;
    expect(d.pixel!.width).toBe(zero.pixel!.width * 2);
    expect(d.pixel!.height).toBe(zero.pixel!.height * 2);
    expect(d.advanceWidth).toBe(zero.advanceWidth * 2);
    // ink is scaled 2× and stays solid (nearest neighbour: no blur, real pixels)
    const bm = Bitmap.fromB64(d.pixel!.width, d.pixel!.height, d.pixel!.cellsB64);
    const src = cellsOf(zero);
    expect(bm.count()).toBe(src.count() * 4);
    expect(bm.bounds()!.w).toBe(src.bounds()!.w * 2);
    // the standard digit itself is untouched by the copy
    expect(copied.doc.glyphs.find((g) => g.id === zero.id)).toBe(zero);
  });

  it('scales a glyph with an explicit factor and keeps the source intact', () => {
    const doc = latinOnly();
    const zero = glyphFor(doc, 0x30)!;
    const { doc: next, width, height } = scaleGlyphNearest(doc, zero.id, 2);
    const scaled = next.glyphs.find((g) => g.id === zero.id)!;
    expect(width).toBe(zero.pixel!.width * 2);
    expect(height).toBe(zero.pixel!.height * 2);
    expect(scaled.advanceWidth).toBe(zero.advanceWidth * 2);
    expect(scaled.edited).toBe(true);
    // the document object was replaced, the original glyph data was not mutated
    expect(zero.pixel!.width).toBe(8);
    expect(glyphFor(next, 0x31)!.pixel!.width).toBe(zero.pixel!.width); // other digits untouched
  });

  it('refuses to copy from an empty glyph instead of inventing artwork', () => {
    const doc = latinOnly();
    const withBoth = planAddSets(doc, { sets: ['georgian', 'largeDigits'] }).nextDoc;
    const largeZero = glyphFor(withBoth, 0xe000)!;
    const blankGeo = glyphFor(withBoth, 0x10d0)!;
    expect(glyphHasArtwork(blankGeo)).toBe(false);
    expect(() => copyArtworkInto(withBoth, largeZero.id, blankGeo.id)).toThrow(/no artwork/i);
  });

  it('rasterizes a vector template onto the new pixel grid', async () => {
    const buf = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.ttf'));
    const { doc } = await importFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'Lato.ttf');
    const a = glyphFor(doc, 0x41)!;
    expect(a.contours.length).toBeGreaterThan(0);
    // Georgian has no designed glyph yet → the font's first drawn glyph is the template
    const geo = planAddSets(doc, { sets: ['georgian'], template: 'copy' });
    const copy = geo.additions[0];
    // no Georgian glyph has artwork yet → the first designed glyph of the font is copied
    expect(copy.templateGlyphId).toBeTruthy();
    expect(copy.templateLabel).toBeTruthy();
    expect(geo.warnings.some((w) => /used as the template/.test(w))).toBe(true);
    // an explicitly chosen template glyph is honoured instead
    const z = glyphFor(doc, 0x7a)!;
    const explicit = planAddSets(doc, { sets: ['georgian'], template: 'copy', templateGlyphId: z.id });
    expect(explicit.additions[0].templateGlyphId).toBe(z.id);
    const glyph = geo.nextDoc.glyphs.find((g) => g.id === copy.glyphId)!;
    expect(glyph.pixel).toBeTruthy();
    expect(glyphHasArtwork(glyph)).toBe(true);
    expect(glyph.kind).toBe('pixel');
    // the outline of the imported font was NOT converted — only the new glyph is a bitmap
    expect(geo.nextDoc.glyphs.find((g) => g.id === a.id)!.contours.length).toBe(a.contours.length);
    expect(geo.nextDoc.glyphs.find((g) => g.id === a.id)!.pixel).toBeNull();
  });
});

describe('alternative (large) digit mapping', () => {
  it('defaults to the Private Use Area U+E000–U+E009 and stays separate from the standard digits', () => {
    const doc = latinOnly();
    expect(largeDigitPoints(doc)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
    const { doc: next } = addMissingSets(doc, { sets: ['largeDigits'] });
    expect(altDigitPointsOf(next)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
    for (let i = 0; i < 10; i++) {
      const large = glyphFor(next, 0xe000 + i)!;
      const standard = glyphFor(next, 0x30 + i)!;
      expect(large.id).not.toBe(standard.id);
      expect(large.unicode).toBe(0xe000 + i);
    }
    // the standard digits keep their own mappings and artwork
    expect(glyphFor(next, 0x30)!.pixel!.cellsB64).toBe(glyphFor(doc, 0x30)!.pixel!.cellsB64);
  });

  it('rejects duplicates, invalid code points, standard digits and taken code points', () => {
    const doc = latinOnly();
    const base = [...DEFAULT_LARGE_DIGIT_POINTS];
    expect(validateAltDigitPoints(doc, base).ok).toBe(true);
    expect(validateAltDigitPoints(doc, base.slice(0, 9)).ok).toBe(false);
    expect(validateAltDigitPoints(doc, [...base.slice(0, 9), base[0]]).ok).toBe(false);
    expect(validateAltDigitPoints(doc, [...base.slice(0, 9), 0x30]).ok).toBe(false);
    expect(validateAltDigitPoints(doc, [...base.slice(0, 9), 0xd800]).ok).toBe(false);
    expect(validateAltDigitPoints(doc, [...base.slice(0, 9), -5]).ok).toBe(false);
    expect(validateAltDigitPoints(doc, [...base.slice(0, 9), 0x41]).ok).toBe(false); // owned by 'A'
    expect(validateAltDigitPoints(doc, [...base.slice(0, 9), 0x01]).ok).toBe(false); // control character
    const dup = validateAltDigitPoints(doc, [...base.slice(0, 9), base[0]]);
    expect(dup.error).toMatch(/two alternative digits/);
    const taken = validateAltDigitPoints(doc, [...base.slice(0, 9), 0x41]);
    expect(taken.error).toMatch(/already used/);
  });

  it('moves the mapping without destroying the glyph designs', () => {
    const doc = latinOnly();
    const withLarge = planAddSets(doc, { sets: ['largeDigits'], template: 'copy', templateScale: 2 }).nextDoc;
    const designed = glyphFor(withLarge, 0xe003)!;
    expect(glyphHasArtwork(designed)).toBe(true);
    const cellsBefore = designed.pixel!.cellsB64;
    const advanceBefore = designed.advanceWidth;

    const moved = reconfigureAltDigits(withLarge, Array.from({ length: 10 }, (_, i) => 0xe100 + i));
    expect(largeDigitPoints(moved)).toEqual(Array.from({ length: 10 }, (_, i) => 0xe100 + i));
    const after = moved.glyphs.find((g) => g.id === designed.id)!;
    expect(after.pixel!.cellsB64).toBe(cellsBefore);
    expect(after.advanceWidth).toBe(advanceBefore);
    expect(allUnicodes(after)).toEqual([0xe103]);
    expect(glyphFor(moved, 0xe003)).toBeUndefined();
    // the standard digits are still where they were
    expect(glyphFor(moved, 0x33)).toBeTruthy();
  });

  it('moves the mapping as part of adding the set and validates it first', () => {
    const doc = latinOnly();
    const custom = Array.from({ length: 10 }, (_, i) => 0xf000 + i);
    const plan = planAddSets(doc, { sets: ['largeDigits'], altDigitPoints: custom });
    expect(plan.altDigitPoints).toEqual(custom);
    expect(plan.nextDoc.altDigits).toEqual({ codepoints: custom });
    expect(glyphFor(plan.nextDoc, 0xf009)).toBeTruthy();
    expect(() => planAddSets(doc, { sets: ['largeDigits'], altDigitPoints: [...custom.slice(0, 9), 0x30] })).toThrow(/standard digit/);
  });

  it('does not let a second glyph claim a large-digit code point', () => {
    const doc = latinOnly();
    const withLarge = planAddSets(doc, { sets: ['largeDigits'] }).nextDoc;
    // a glyph that already owns U+E000 blocks the mapping change to U+E000
    const other: FontDoc = { ...withLarge, glyphs: withLarge.glyphs.map((g) => (g.unicode === 0x41 ? { ...g, unicode: 0xe200 } : g)) };
    const check = validateAltDigitPoints(other, [...DEFAULT_LARGE_DIGIT_POINTS.slice(1), 0xe200]);
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/already used/);
  });

  it('records the mapping on the document so it survives a project round trip', () => {
    const doc = latinOnly();
    const custom = Array.from({ length: 10 }, (_, i) => 0xe200 + i);
    const plan = planAddSets(doc, { sets: ['largeDigits'], altDigitPoints: custom });
    const round = JSON.parse(JSON.stringify(plan.nextDoc)) as FontDoc;
    expect(largeDigitPoints(round)).toEqual(custom);
    expect(round.glyphs.filter((g) => g.origin === 'added')).toHaveLength(10);
  });
});

describe('a font with only English letters', () => {
  it('gets Georgian, digits and a separate large-digit set without losing the English glyphs', () => {
    let doc = newTestFont(8, 8, 'EnglishOnly');
    const english: number[] = [];
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') {
      const cp = ch.codePointAt(0)!;
      english.push(cp);
      doc = drawGlyph(doc, cp, LETTER).doc;
    }
    const snapshots = new Map(english.map((cp) => [cp, glyphFor(doc, cp)!]));

    // 1. add the missing Georgian letters as blank grids (nothing is claimed to be drawn)
    // 2. add the missing digits with a template copy, then the large digits at ×2
    const georgianPlan = planAddSets(doc, { sets: ['georgian'] });
    expect(georgianPlan.additions).toHaveLength(33);
    const digitsPlan = planAddSets(georgianPlan.nextDoc, { sets: ['digits'], template: 'copy', templateScale: 1 });
    expect(digitsPlan.additions).toHaveLength(10);
    expect(digitsPlan.additions.every((a) => !a.blank)).toBe(true);
    const largePlan = planAddSets(digitsPlan.nextDoc, { sets: ['largeDigits'], template: 'copy', templateScale: 2 });
    expect(largePlan.additions).toHaveLength(10);
    expect(largePlan.additions.every((a) => !a.blank)).toBe(true);
    const large = largePlan.nextDoc;

    for (const [cp, before] of snapshots) {
      const after = glyphFor(large, cp)!;
      expect(after.pixel!.cellsB64).toBe(before.pixel!.cellsB64);
      expect(after.advanceWidth).toBe(before.advanceWidth);
      expect(after.name).toBe(before.name);
    }
    expect(glyphFor(large, 0x10d0)).toBeTruthy();
    expect(glyphFor(large, 0x30)).toBeTruthy();
    const largeZero = glyphFor(large, 0xe000)!;
    expect(glyphHasArtwork(largeZero)).toBe(true);
    expect(largeZero.pixel!.width).toBe(glyphFor(large, 0x30)!.pixel!.width * 2);
    expect(largeZero.advanceWidth).toBe(glyphFor(large, 0x30)!.advanceWidth * 2);
    // the Georgian letters of step 1 are still there and still blank
    expect(glyphHasArtwork(glyphFor(large, 0x10d0)!)).toBe(false);
    expect(glyphFor(large, 0x10d0)!.unicode).toBe(0x10d0);
  });
});

describe('pixel fonts created in Pixeel', () => {
  it('adds the missing sets to a from-scratch font as well', () => {
    const doc = createNewFont({ familyName: 'Scratch', styleName: 'Regular', gridWidth: 8, gridHeight: 8 });
    const plan = planAddSets(doc, { sets: ['latinUpper', 'digits'] });
    expect(plan.additions).toHaveLength(36);
    expect(analyzeCoverage(plan.nextDoc).setById.digits.blank).toBe(10);
    expect(plan.nextDoc.glyphs.filter((g) => g.pixel).length).toBeGreaterThan(36);
  });
});
