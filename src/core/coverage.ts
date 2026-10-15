/**
 * Character coverage report for an imported (or edited) font.
 *
 * Answers, per required character set: how many characters are really there,
 * which ones are missing, and which ones exist but are still blank. A code
 * point counts as **present** only when a glyph with actual artwork claims it —
 * a mapping to `.notdef`, to an empty glyph or to a glyph whose pixel grid is
 * entirely dark is reported separately (blank / missing), never as supported.
 */
import type { FontDoc, GlyphDoc } from './types';
import { allUnicodes, duplicateMappings, glyphForCodePoint } from './unicodeMap';
import {
  CHAR_SETS,
  type CharSetDef,
  type CharSetId,
  type GlyphState,
  glyphHasArtwork,
  glyphState,
  largeDigitPoints,
  pointsForSet,
} from './charSets';
import { charFromCodePoint, describeCodePoint } from './unicodeNames';

export type CharStatus = 'present' | 'blank' | 'missing';

export interface CharCoverageEntry {
  codePoint: number;
  /** present = real artwork, blank = mapped but empty, missing = no mapping (or `.notdef`). */
  status: CharStatus;
  glyphId: string | null;
  glyphName: string | null;
  /** UI state of the owning glyph (only meaningful when a glyph exists). */
  state: GlyphState | 'missing';
  /** Human-readable reason for a non-present status. */
  note?: string;
}

export interface SetCoverage {
  def: CharSetDef;
  /** Code points checked (the configured mapping for the large digits). */
  points: number[];
  total: number;
  present: number;
  blank: number;
  missing: number;
  /** Every code point that is not present, so the UI can list/repair them. */
  missingPoints: number[];
  /** Only the code points with no glyph at all. */
  absentPoints: number[];
  entries: CharCoverageEntry[];
}

export interface CoverageReport {
  sets: SetCoverage[];
  setById: Record<CharSetId, SetCoverage>;
  totals: { total: number; present: number; blank: number; missing: number };
  /** Glyph counts by state across the whole font. */
  glyphStates: Record<GlyphState, number>;
  /** Number of glyphs (excluding `.notdef`) in the font. */
  glyphCount: number;
  warnings: string[];
  /** True when the document has no editable glyphs at all. */
  unusable: boolean;
}

const isNotdef = (g: GlyphDoc | undefined): boolean => g?.name === '.notdef';

/**
 * Coverage of one required character set.
 * `glyphs` is the document's glyph list; `def` may be the large-digit set whose
 * points come from the font's own configuration.
 */
export function coverageOfSet(doc: FontDoc, def: CharSetDef, points = pointsForSet(def.id, doc)): SetCoverage {
  const entries: CharCoverageEntry[] = points.map((cp) => {
    const glyph = glyphForCodePoint(doc.glyphs, cp);
    if (!glyph || isNotdef(glyph)) {
      return {
        codePoint: cp,
        status: 'missing' as CharStatus,
        glyphId: glyph?.id ?? null,
        glyphName: glyph?.name ?? null,
        state: 'missing' as const,
        note: glyph ? `mapped to ${glyph.name || '.notdef'} (no character design)` : undefined,
      };
    }
    // A space is legitimately blank: it is present when it is mapped and has an
    // advance width (nothing to draw). Everything else needs real artwork.
    const isSpace = cp === 0x20 && glyph.advanceWidth > 0;
    const hasArt = glyphHasArtwork(glyph) || isSpace;
    return {
      codePoint: cp,
      status: hasArt ? ('present' as CharStatus) : ('blank' as CharStatus),
      glyphId: glyph.id,
      glyphName: glyph.name,
      state: hasArt ? glyphState(glyph) : 'blank',
      note: hasArt ? undefined : 'glyph exists but has no artwork yet',
    };
  });
  const present = entries.filter((e) => e.status === 'present').length;
  const blank = entries.filter((e) => e.status === 'blank').length;
  return {
    def,
    points,
    total: points.length,
    present,
    blank,
    missing: entries.filter((e) => e.status === 'missing').length,
    missingPoints: entries.filter((e) => e.status !== 'present').map((e) => e.codePoint),
    absentPoints: entries.filter((e) => e.status === 'missing').map((e) => e.codePoint),
    entries,
  };
}

/**
 * The full coverage report of a font.
 *
 * Besides the per-set numbers it collects the caveats a user should see:
 * code points that resolve to `.notdef`, required characters that are mapped to
 * blank glyphs, and code points of the configured large-digit mapping that are
 * owned by an unrelated glyph (`altKeys`).
 */
export function analyzeCoverage(doc: FontDoc): CoverageReport {
  const warnings: string[] = [];
  const points = largeDigitPoints(doc);
  const sets = CHAR_SETS.map((def) => coverageOfSet(doc, def, pointsForSet(def.id, doc)));
  const setById = Object.fromEntries(sets.map((s) => [s.def.id, s])) as Record<CharSetId, SetCoverage>;

  const glyphStates: Record<GlyphState, number> = { existing: 0, added: 0, blank: 0, modified: 0 };
  for (const g of doc.glyphs) glyphStates[glyphState(g)] += 1;

  // --- .notdef mappings: a code point that "exists" but renders nothing
  const notdefPoints: number[] = [];
  for (const g of doc.glyphs) {
    if (g.name !== '.notdef') continue;
    for (const cp of allUnicodes(g)) notdefPoints.push(cp);
  }
  if (notdefPoints.length) {
    warnings.push(
      `${notdefPoints.length} code point(s) are mapped to .notdef (${notdefPoints
        .slice(0, 6)
        .map((cp) => describeCodePoint(cp))
        .join(', ')}${notdefPoints.length > 6 ? ', …' : ''}) and count as missing.`,
    );
  }

  const blankRequired = sets.flatMap((s) => s.entries.filter((e) => e.status === 'blank').map((e) => e.codePoint));
  if (blankRequired.length) {
    warnings.push(
      `${blankRequired.length} required character(s) exist only as blank glyphs (${blankRequired
        .slice(0, 8)
        .map((cp) => `${charFromCodePoint(cp)} ${describeCodePoint(cp)}`)
        .join(', ')}${blankRequired.length > 8 ? ', …' : ''}). Draw them before exporting.`,
    );
  }

  // --- large-digit mapping sanity: those code points must not belong to unrelated glyphs
  const large = setById.largeDigits;
  const largeDigitLike = (g: GlyphDoc | undefined): boolean => !!g && (g.name.endsWith('.large') || g.origin === 'added');
  const foreign = large.entries.filter((e) => e.status !== 'missing' && !largeDigitLike(doc.glyphs.find((x) => x.id === e.glyphId)));
  if (foreign.length) {
    warnings.push(
      `${foreign.length} alternative-digit code point(s) are already used by other glyphs: ${foreign
        .map((e) => `“${e.glyphName ?? '?'}” at ${describeCodePoint(e.codePoint)}`)
        .join(', ')}. Pixeel will not overwrite them — either design the large digits elsewhere or change the alternative-digit mapping.`,
    );
  }

  const duplicates = duplicateMappings(doc);
  if (duplicates.length) {
    warnings.push(
      `${duplicates.length} code point(s) are mapped to more than one glyph (${duplicates
        .slice(0, 6)
        .map((d) => `${describeCodePoint(d.codePoint)}: ${d.owners.map((o) => o.name).join(' + ')}`)
        .join('; ')}${duplicates.length > 6 ? '; …' : ''}). Exporting needs one owner per code point — fix it in the glyph's Unicode mappings.`,
    );
  }

  if (doc.glyphs.length <= 1) {
    warnings.push('This font has no editable glyphs — nothing could be read from it. Character sets cannot be added.');
  } else if (doc.source && doc.source.numGlyphs !== doc.glyphs.length) {
    warnings.push(
      `The source file contained ${doc.source.numGlyphs} glyph(s); ${doc.glyphs.length} are editable here. Glyphs without an outline or pixel grid were dropped by the parser.`,
    );
  }

  const totals = sets.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      present: acc.present + s.present,
      blank: acc.blank + s.blank,
      missing: acc.missing + s.missing,
    }),
    { total: 0, present: 0, blank: 0, missing: 0 },
  );

  return {
    sets,
    setById,
    totals,
    glyphStates,
    glyphCount: doc.glyphs.length,
    warnings,
    unusable: doc.glyphs.length <= 1,
  };
}

/** One-line summary of the coverage, e.g. "English 52/52 · Georgian 0/33 · …". */
export function coverageSummaryLine(report: CoverageReport, sep = ' · '): string {
  const english = { total: 0, present: 0 };
  for (const id of ['latinUpper', 'latinLower'] as CharSetId[]) {
    english.total += report.setById[id].total;
    english.present += report.setById[id].present;
  }
  return [
    `English ${english.present}/${english.total}`,
    `Georgian ${report.setById.georgian.present}/${report.setById.georgian.total}`,
    `Digits ${report.setById.digits.present}/${report.setById.digits.total}`,
    `Large digits ${report.setById.largeDigits.present}/${report.setById.largeDigits.total}`,
    `Punctuation ${report.setById.punct.present}/${report.setById.punct.total}`,
  ].join(sep);
}

/** True when every required character of every set is present with artwork. */
export function isComplete(report: CoverageReport): boolean {
  return report.sets.every((s) => s.present === s.total);
}

/** Short label for a code point's set, used in the missing-character lists. */
export function setLabelOfPoint(cp: number, report: CoverageReport): string {
  for (const s of report.sets) if (s.points.includes(cp)) return s.def.label;
  return 'Other';
}
