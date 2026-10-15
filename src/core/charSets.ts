/**
 * The character sets Pixeel can check for and add to an existing font.
 *
 * Everything here is pure data + small helpers: the required code points of
 * every set, the default mapping of the alternative (large) digits, and the
 * vocabulary the coverage report / character-set UI uses to describe a glyph
 * ("existing", "newly added", "blank", "modified").
 *
 * Adding characters never goes through this module — see `addCharSets.ts`.
 */
import { Bitmap } from './bitmap';
import type { FontDoc, GlyphDoc } from './types';

export type CharSetId = 'latinUpper' | 'latinLower' | 'georgian' | 'digits' | 'largeDigits' | 'punct';

/**
 * The 33 letters of the modern Georgian Mkhedruli alphabet (U+10D0–U+10F0).
 * U+10F1–U+10F5 hold archaic letters (ჱ ჲ ჳ ჴ ჵ) that are NOT part of the
 * modern alphabet; they are only added by the explicit "all Georgian letters"
 * action, never by the coverage repair.
 */
export const GEORGIAN_MKHEDRULI = 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ';

/** Code points of the 33 modern Mkhedruli letters, in alphabet order. */
export const GEORGIAN_MKHEDRULI_POINTS: number[] = Array.from(GEORGIAN_MKHEDRULI, (ch) => ch.codePointAt(0)!);

/** The Unicode range the modern Mkhedruli alphabet lives in (U+10D0–U+10F5). */
export const GEORGIAN_RANGE = { start: 0x10d0, end: 0x10f5 } as const;

/** Default code points of the alternative (double-size) digits: Private Use Area U+E000–U+E009. */
export const DEFAULT_LARGE_DIGIT_POINTS: number[] = Array.from({ length: 10 }, (_, i) => 0xe000 + i);

/** True when `cp` lies in the Private Use Area (U+E000–U+F8FF). */
export const isPrivateUse = (cp: number): boolean => cp >= 0xe000 && cp <= 0xf8ff;

const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

/**
 * Punctuation and common symbols: every printable ASCII character that is not a
 * letter or a digit, plus the currency/quotation/dash marks commonly used in
 * text samples.
 */
export const PUNCTUATION_POINTS: number[] = [
  ...range(0x20, 0x7e).filter((cp) => !(cp >= 0x41 && cp <= 0x5a) && !(cp >= 0x61 && cp <= 0x7a) && !(cp >= 0x30 && cp <= 0x39)),
  0xa0, 0xa1, 0xa9, 0xab, 0xad, 0xae, 0xb0, 0xb7, 0xbb, 0xbf, 0xd7, 0xf7,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x20ac, 0x20be,
];

export interface CharSetDef {
  id: CharSetId;
  /** Full name shown in the coverage report ("English uppercase"). */
  label: string;
  /** Compact name used by the glyph-browser navigation. */
  navLabel: string;
  /** Range / mapping hint, e.g. "U+0041–U+005A". */
  range: string;
  description: string;
  /** Required code points (the *default* mapping for the configurable large digits). */
  points: number[];
  /** True when the user may change the assigned code points (large digits). */
  configurable: boolean;
  /** Initials for the compact "add" buttons. */
  short: string;
}

export const CHAR_SETS: CharSetDef[] = [
  {
    id: 'latinUpper',
    label: 'English uppercase',
    navLabel: 'English A–Z',
    range: 'U+0041–U+005A',
    description: 'A–Z',
    points: range(0x41, 0x5a),
    configurable: false,
    short: 'A–Z',
  },
  {
    id: 'latinLower',
    label: 'English lowercase',
    navLabel: 'English a–z',
    range: 'U+0061–U+007A',
    description: 'a–z',
    points: range(0x61, 0x7a),
    configurable: false,
    short: 'a–z',
  },
  {
    id: 'georgian',
    label: 'Georgian Mkhedruli',
    navLabel: 'Georgian',
    range: 'U+10D0–U+10F0 (33 letters)',
    description: 'ა–ჰ, the 33 letters of the modern alphabet',
    points: GEORGIAN_MKHEDRULI_POINTS,
    configurable: false,
    short: 'ა–ჰ',
  },
  {
    id: 'digits',
    label: 'Standard digits',
    navLabel: 'Digits',
    range: 'U+0030–U+0039',
    description: '0–9',
    points: range(0x30, 0x39),
    configurable: false,
    short: '0–9',
  },
  {
    id: 'largeDigits',
    label: 'Double-size alternative digits',
    navLabel: 'Large digits',
    range: 'U+E000–U+E009 (default)',
    description: 'A second, independently designed 0–9 in the Private Use Area',
    points: DEFAULT_LARGE_DIGIT_POINTS,
    configurable: true,
    short: '0⁺–9⁺',
  },
  {
    id: 'punct',
    label: 'Punctuation & common symbols',
    navLabel: 'Punctuation',
    range: 'Basic Latin + common marks',
    description: 'space, !"#$… and the usual quotes, dashes and currency signs',
    points: PUNCTUATION_POINTS,
    configurable: false,
    short: '!?.,',
  },
];

export const CHAR_SET_BY_ID: Record<CharSetId, CharSetDef> = Object.fromEntries(
  CHAR_SETS.map((s) => [s.id, s]),
) as Record<CharSetId, CharSetDef>;

export function charSetDef(id: CharSetId): CharSetDef {
  return CHAR_SET_BY_ID[id];
}

/** The sets in the order the UI lists them (all sets = every one of them). */
export const ALL_CHAR_SET_IDS: CharSetId[] = CHAR_SETS.map((s) => s.id);

export const DIGIT_GLYPH_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Suggested glyph name for an alternative digit, e.g. `zero.large`. */
export function largeDigitName(index: number): string {
  return `${DIGIT_GLYPH_NAMES[index] ?? `digit${index}`}.large`;
}

/**
 * The configured alternative-digit code points of a font. Fonts saved before
 * this feature existed (and brand-new fonts) fall back to the default PUA
 * mapping, so nothing has to be migrated on disk.
 */
export function largeDigitPoints(doc: Pick<FontDoc, 'altDigits'>): number[] {
  const configured = doc.altDigits?.codepoints;
  if (!configured || configured.length !== 10) return [...DEFAULT_LARGE_DIGIT_POINTS];
  return configured.map((cp) => Math.round(cp));
}

/** The reason a proposed alternative-digit mapping cannot be used (null = fine). */
export type AltMappingIssue =
  | { code: 'length' }
  | { code: 'invalid'; codePoint: number }
  | { code: 'control'; codePoint: number }
  | { code: 'standardDigit'; codePoint: number }
  | { code: 'duplicate'; codePoint: number };

/**
 * Structural rules of an alternative-digit mapping, shared by the project
 * loader (a broken mapping falls back to the default) and the mapping editor
 * (which turns the issue into a message). Whether a code point is *already
 * taken by a glyph* is checked separately — that depends on the document.
 */
export function altMappingIssue(points: unknown): AltMappingIssue | null {
  if (!Array.isArray(points) || points.length !== 10) return { code: 'length' };
  const rounded: number[] = [];
  for (const raw of points) {
    const cp = Math.round(Number(raw));
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return { code: 'invalid', codePoint: cp };
    if (cp < 0x20) return { code: 'control', codePoint: cp };
    if (cp >= 0x30 && cp <= 0x39) return { code: 'standardDigit', codePoint: cp };
    rounded.push(cp);
  }
  const seen = new Set<number>();
  for (const cp of rounded) {
    if (seen.has(cp)) return { code: 'duplicate', codePoint: cp };
    seen.add(cp);
  }
  return null;
}

/** True when the font carries an explicit alternative-digit mapping. */
export const hasCustomLargeDigitMapping = (doc: Pick<FontDoc, 'altDigits'>): boolean => !!doc.altDigits?.codepoints;

/** The code points a set requires for this font (large digits use the configured mapping). */
export function pointsForSet(id: CharSetId, doc: Pick<FontDoc, 'altDigits'>): number[] {
  return id === 'largeDigits' ? largeDigitPoints(doc) : [...CHAR_SET_BY_ID[id].points];
}

// ---------------------------------------------------------------------------
// Glyph state: is a glyph really a finished character?
// ---------------------------------------------------------------------------

/**
 * True when the glyph carries artwork of its own (contours, components or lit
 * pixels). A mapped code point whose glyph is blank is **not** a finished
 * character: fonts legitimately map code points to empty glyphs, and treating
 * those as "supported" would hide a font that still needs the design work.
 */
export function glyphHasArtwork(g: Pick<GlyphDoc, 'kind' | 'contours' | 'compound' | 'pixel'>): boolean {
  if (g.compound && g.compound.length > 0) return true;
  if (g.contours.length > 0) return true;
  if (g.pixel) {
    try {
      return Bitmap.fromB64(g.pixel.width, g.pixel.height, g.pixel.cellsB64).count() > 0;
    } catch {
      return false;
    }
  }
  return false;
}

export type GlyphState = 'existing' | 'added' | 'blank' | 'modified';

/** How the character grid labels this glyph. */
export function glyphState(g: GlyphDoc): GlyphState {
  if (!glyphHasArtwork(g)) return 'blank';
  if (g.origin === 'added' && !g.edited) return 'added';
  if (g.edited) return 'modified';
  return 'existing';
}

export const GLYPH_STATE_LABEL: Record<GlyphState, string> = {
  existing: 'from the font',
  added: 'newly added',
  blank: 'blank — still needs drawing',
  modified: 'modified',
};

// ---------------------------------------------------------------------------
// Which set does a code point belong to?
// ---------------------------------------------------------------------------

export type GlyphCategory = 'all' | 'english' | 'georgian' | 'digits' | 'largeDigits' | 'punct' | 'other' | 'missing';

/**
 * The set a code point belongs to, or null when it is none of the required
 * sets (accented letters, Cyrillic, historic Georgian, …). Kept deliberately
 * separate from the coverage report so the glyph browser can group *existing*
 * glyphs the same way it groups missing characters.
 */
export function setOfCodePoint(cp: number, altPoints: number[] = DEFAULT_LARGE_DIGIT_POINTS): CharSetId | null {
  if (cp >= 0x41 && cp <= 0x5a) return 'latinUpper';
  if (cp >= 0x61 && cp <= 0x7a) return 'latinLower';
  if (GEORGIAN_MKHEDRULI_POINTS.includes(cp)) return 'georgian';
  if (cp >= 0x30 && cp <= 0x39) return 'digits';
  if (altPoints.includes(cp)) return 'largeDigits';
  if (PUNCTUATION_POINTS.includes(cp)) return 'punct';
  return null;
}

/** Navigation group of a code point (English merges upper and lower case). */
export function navigationGroupOf(cp: number, altPoints: number[] = DEFAULT_LARGE_DIGIT_POINTS): Exclude<GlyphCategory, 'all' | 'missing'> {
  const set = setOfCodePoint(cp, altPoints);
  if (set === 'latinUpper' || set === 'latinLower') return 'english';
  return set ?? 'other';
}
