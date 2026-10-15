/**
 * Acceptance criteria 5, 6 and 9: the new data (added glyphs, glyph origin and
 * state, the configurable alternative-digit mapping) survives a project save →
 * load round trip, and older project files that predate these fields still open.
 */
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, deserializeProject, normalizeFontDoc, serializeProject } from '../src/core/project';
import { planAddSets, reconfigureAltDigits, copyArtworkInto, scaleGlyphNearest } from '../src/core/addCharSets';
import { analyzeCoverage } from '../src/core/coverage';
import { DEFAULT_LARGE_DIGIT_POINTS, GEORGIAN_MKHEDRULI_POINTS, glyphHasArtwork, largeDigitPoints } from '../src/core/charSets';
import { allUnicodes } from '../src/core/unicodeMap';
import type { FontDoc, ProjectFile } from '../src/core/types';
import { drawGlyph, newTestFont } from './helpers';

const SETTINGS = { theme: 'dark', slot: 'A' } as never;

function roundTrip(docA: FontDoc | null, docB: FontDoc | null = null) {
  const serialized = serializeProject({ A: docA, B: docB }, 'A', SETTINGS);
  const json = JSON.stringify(serialized);
  const { project } = deserializeProject(json);
  return { json, A: project.fonts.A, B: project.fonts.B };
}

/** A font with a designed English alphabet plus punctuation, extended the full way. */
function extendedFont(): FontDoc {
  let doc = newTestFont(8, 8, 'RoundTrip');
  for (const ch of 'ABCabc012') doc = drawGlyph(doc, ch.codePointAt(0)!, (bm) => bm.rect(1, 1, 5, 6, 1, true)).doc;
  doc = drawGlyph(doc, 0x2e, (bm) => bm.rect(2, 0, 1, 1, 1, true)).doc;
  const georgian = planAddSets(doc, { sets: ['georgian'] }).nextDoc;
  // really draw one of the added letters, so it stops being blank
  const first = georgian.glyphs.find((g) => g.unicode === 0x10d0)!;
  const drawn = drawGlyph(georgian, 0x10d0, (bm) => bm.rect(1, 1, 5, 6, 1, true)).doc;
  expect(drawn.glyphs.find((g) => g.id === first.id)!.edited).toBe(true);
  const digits = planAddSets(drawn, { sets: ['digits'] }).nextDoc;
  const large = planAddSets(digits, { sets: ['largeDigits'], template: 'copy', templateScale: 2 }).nextDoc;
  const moved = reconfigureAltDigits(large, [0xf100, 0xf101, 0xf102, 0xf103, 0xf104, 0xf105, 0xf106, 0xf107, 0xf108, 0xf109]);
  const copied = copyArtworkInto(moved, moved.glyphs.find((g) => g.unicode === 0xf103)!.id, moved.glyphs.find((g) => g.unicode === 0x31)!.id, {
    scale: 2,
    adaptAdvance: true,
  }).doc;
  return copied;
}

describe('project round trip', () => {
  it('keeps added characters, their origin/state and the alternative-digit mapping', () => {
    const doc = extendedFont();
    const { A } = roundTrip(doc);
    expect(A).toBeTruthy();
    expect(A!.glyphs).toHaveLength(doc.glyphs.length);

    // every glyph survives field by field: the JSON copy holds exactly what the
    // normaliser produces (which only adds the "imported" provenance tag)
    expect(A!.glyphs).toEqual(normalizeFontDoc(doc).glyphs);

    // the alternative-digit mapping is a real document field, not just a UI state
    expect(A!.altDigits).toEqual({ codepoints: [0xf100, 0xf101, 0xf102, 0xf103, 0xf104, 0xf105, 0xf106, 0xf107, 0xf108, 0xf109] });
    expect(largeDigitPoints(A!)).toEqual(A!.altDigits!.codepoints);

    // the added Georgian letters are still marked as added, one of them drawn
    const added = A!.glyphs.filter((g) => g.origin === 'added');
    expect(added).toHaveLength(50); // 33 Georgian + the 7 missing digits + 10 large digits
    const drawn = A!.glyphs.find((g) => g.unicode === 0x10d0)!;
    expect(drawn.origin).toBe('added');
    expect(drawn.edited).toBe(true);
    expect(glyphHasArtwork(drawn)).toBe(true);

    // coverage computed after the round trip matches the original
    const before = analyzeCoverage(doc);
    const after = analyzeCoverage(A!);
    expect(after.setById.georgian.present).toBe(before.setById.georgian.present);
    expect(after.totals).toEqual(before.totals);
    expect(after.setById.largeDigits.points).toEqual(before.setById.largeDigits.points);

    // a project that never touched the large digits falls back to the default mapping
    expect(largeDigitPoints(roundTrip(newTestFont(8, 8, 'Plain')).A!)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
  });

  it('keeps the designed artwork byte-identical through save and load', () => {
    const doc = extendedFont();
    const { A } = roundTrip(doc);
    const expected = normalizeFontDoc(doc);
    for (const g of expected.glyphs) {
      const same = A!.glyphs.find((x) => x.id === g.id)!;
      expect(same.pixel?.cellsB64).toBe(g.pixel?.cellsB64);
      expect(same.contours).toEqual(g.contours);
      expect(allUnicodes(same)).toEqual(allUnicodes(g));
      expect(same.advanceWidth).toBe(g.advanceWidth);
      expect(same.leftSideBearing).toBe(g.leftSideBearing);
      expect(same.srcIndex).toBe(g.srcIndex);
      expect(same.origin ?? null).toBe(g.origin ?? null);
    }
    // and the ordering of the glyph list is stable (glyph ids/indexes stay valid)
    expect(A!.glyphs.map((g) => g.id)).toEqual(doc.glyphs.map((g) => g.id));
  });

  it('stores no derived coverage data — the report is recomputed from the glyphs', () => {
    const doc = extendedFont();
    const { json } = roundTrip(doc);
    expect(json).not.toMatch(/coverage|missing|present/i);
    expect(deserializeProject(json).project.fonts.A!.glyphs.length).toBe(doc.glyphs.length);
  });

  it('opens an older project file that has neither origin/edited nor altDigits', () => {
    const doc = newTestFont(8, 8, 'Legacy');
    // emulate the pre-feature format: no origin, no altDigits, no edited flag
    const legacy: ProjectFile = {
      format: PROJECT_FORMAT,
      version: 1,
      savedAt: 1,
      active: 'A',
      settings: SETTINGS,
      fonts: {
        A: {
          ...doc,
          altDigits: undefined as never,
          glyphs: doc.glyphs.map((g) => {
            const { origin: _origin, edited: _edited, ...rest } = g as typeof g & { origin?: unknown; edited?: unknown };
            return rest as typeof g;
          }),
        },
        B: null,
      },
    };
    const { A } = deserializeProject(JSON.stringify({ project: legacy, sources: {} })).project.fonts;
    expect(A).toBeTruthy();
    expect(A!.glyphs).toHaveLength(doc.glyphs.length);
    // glyphs that came from a file keep their source index → marked imported; the
    // others simply have no origin, which the editor reads as "not added"
    for (const g of A!.glyphs) {
      if (g.srcIndex !== null && g.srcIndex !== undefined) expect(g.origin).toBe('imported');
      expect(g.unicode).toBe(doc.glyphs.find((x) => x.id === g.id)!.unicode);
      expect(g.advanceWidth).toBe(doc.glyphs.find((x) => x.id === g.id)!.advanceWidth);
    }
    // and the new features still work on it
    const extended = planAddSets(A!, { sets: ['georgian'] }).nextDoc;
    expect(extended.glyphs.filter((g) => GEORGIAN_MKHEDRULI_POINTS.includes(g.unicode ?? -1))).toHaveLength(33);
    expect(largeDigitPoints(A!)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
  });

  it('drops a broken alternative-digit mapping instead of failing to open', () => {
    const doc = newTestFont(8, 8, 'Broken');
    const cases: Array<Partial<{ codepoints: unknown }> | null> = [
      { codepoints: [1, 2, 3] }, // wrong length
      { codepoints: [0xe000, 0xe000, 0xe002, 0xe003, 0xe004, 0xe005, 0xe006, 0xe007, 0xe008, 0xe009] }, // duplicate
      null,
    ];
    for (const altDigits of cases) {
      const normalized = normalizeFontDoc({ ...doc, altDigits: altDigits as never });
      expect(largeDigitPoints(normalized)).toEqual(DEFAULT_LARGE_DIGIT_POINTS);
    }
    // a good mapping is kept as-is
    const kept = normalizeFontDoc({ ...doc, altDigits: { codepoints: DEFAULT_LARGE_DIGIT_POINTS.map((cp) => cp + 0x1000) } });
    expect(largeDigitPoints(kept)).toEqual(DEFAULT_LARGE_DIGIT_POINTS.map((cp) => cp + 0x1000));
  });

  it('keeps glyphs the user drew in the second workspace slot', () => {
    const a = planAddSets(newTestFont(8, 8, 'A'), { sets: ['digits'] }).nextDoc;
    let b = newTestFont(8, 8, 'B');
    b = drawGlyph(b, 0x41, (bm) => bm.rect(0, 0, 3, 3, 1, true)).doc;
    b = planAddSets(b, { sets: ['largeDigits'], template: 'copy' }).nextDoc;
    b = scaleGlyphNearest(b, b.glyphs.find((g) => g.unicode === 0xe000)!.id, 2, { adaptAdvance: true }).doc;
    const { A, B } = roundTrip(a, b);
    expect(A!.glyphs.length).toBe(a.glyphs.length);
    expect(B!.glyphs.length).toBe(b.glyphs.length);
    expect(B!.glyphs.find((g) => g.unicode === 0x41)!.pixel!.cellsB64).toBe(b.glyphs.find((g) => g.unicode === 0x41)!.pixel!.cellsB64);
    expect(largeDigitPoints(B!)).toEqual(largeDigitPoints(b));
  });

  it('refuses a project from a newer build instead of silently dropping data', () => {
    const doc = extendedFont();
    const serialized = serializeProject({ A: doc, B: null }, 'A', SETTINGS);
    const newer = { ...serialized, project: { ...serialized.project, version: 99 } };
    expect(() => deserializeProject(JSON.stringify(newer))).toThrow(/newer Pixeel/);
    // unknown extra fields in a known version are preserved
    const extra = { ...serialized, project: { ...serialized.project, futureField: { hello: 'world' } } };
    const loaded = deserializeProject(JSON.stringify(extra)).project as ProjectFile & { futureField?: unknown };
    expect(loaded.futureField).toEqual({ hello: 'world' });
  });

  it('survives JSON export/import of a project twice (idempotent)', () => {
    const doc = extendedFont();
    const first = roundTrip(doc);
    const second = roundTrip(first.A!);
    expect(second.A!.glyphs).toEqual(first.A!.glyphs);
    expect(second.A!.altDigits).toEqual(first.A!.altDigits);
    expect(analyzeCoverage(second.A!).totals).toEqual(analyzeCoverage(first.A!).totals);
  });
});
