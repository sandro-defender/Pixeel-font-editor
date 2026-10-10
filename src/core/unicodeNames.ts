/** Character name lookup for the glyph browser (curated common blocks). */

const LATIN_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LATIN_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const PUNCTUATION: Record<number, string> = {
  0x20: 'SPACE', 0x21: 'EXCLAMATION MARK', 0x22: 'QUOTATION MARK', 0x23: 'NUMBER SIGN',
  0x24: 'DOLLAR SIGN', 0x25: 'PERCENT SIGN', 0x26: 'AMPERSAND', 0x27: 'APOSTROPHE',
  0x28: 'LEFT PARENTHESIS', 0x29: 'RIGHT PARENTHESIS', 0x2a: 'ASTERISK', 0x2b: 'PLUS SIGN',
  0x2c: 'COMMA', 0x2d: 'HYPHEN-MINUS', 0x2e: 'FULL STOP', 0x2f: 'SOLIDUS',
  0x3a: 'COLON', 0x3b: 'SEMICOLON', 0x3c: 'LESS-THAN SIGN', 0x3d: 'EQUALS SIGN',
  0x3e: 'GREATER-THAN SIGN', 0x3f: 'QUESTION MARK', 0x40: 'COMMERCIAL AT',
  0x5b: 'LEFT SQUARE BRACKET', 0x5c: 'REVERSE SOLIDUS', 0x5d: 'RIGHT SQUARE BRACKET',
  0x5e: 'CIRCUMFLEX ACCENT', 0x5f: 'LOW LINE', 0x60: 'GRAVE ACCENT',
  0x7b: 'LEFT CURLY BRACKET', 0x7c: 'VERTICAL LINE', 0x7d: 'RIGHT CURLY BRACKET',
  0x7e: 'TILDE', 0xa0: 'NO-BREAK SPACE', 0xa1: 'INVERTED EXCLAMATION MARK',
  0xa9: 'COPYRIGHT SIGN', 0xab: 'LEFT-POINTING DOUBLE ANGLE QUOTATION MARK',
  0xad: 'SOFT HYPHEN', 0xae: 'REGISTERED SIGN', 0xb0: 'DEGREE SIGN',
  0xb7: 'MIDDLE DOT', 0xbb: 'RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK',
  0xbf: 'INVERTED QUESTION MARK', 0xd7: 'MULTIPLICATION SIGN', 0xf7: 'DIVISION SIGN',
  0x2013: 'EN DASH', 0x2014: 'EM DASH', 0x2018: 'LEFT SINGLE QUOTATION MARK',
  0x2019: 'RIGHT SINGLE QUOTATION MARK', 0x201c: 'LEFT DOUBLE QUOTATION MARK',
  0x201d: 'RIGHT DOUBLE QUOTATION MARK', 0x2026: 'HORIZONTAL ELLIPSIS',
  0x20ac: 'EURO SIGN', 0x20be: 'LARI SIGN',
  0x10fb: 'GEORGIAN PARAGRAPH SEPARATOR',
  0x10fc: 'MODIFIER LETTER GEORGIAN NAR',
};

/** Official Georgian letter name stems in Unicode order, Mkhedruli U+10D0–U+10FA. */
const GEORGIAN = [
  'AN', 'BAN', 'GAN', 'DON', 'EN', 'VIN', 'ZEN', 'TAN', 'IN', 'KAN', 'LAS', 'MAN',
  'NAR', 'ON', 'PAR', 'ZHAR', 'RAE', 'SAN', 'TAR', 'UN', 'PHAR', 'KHAR', 'GHAN',
  'QAR', 'SHIN', 'CHIN', 'CAN', 'JIL', 'CIL', 'CHAR', 'XAN', 'JHAN', 'HAE',
  'HE', 'HIE', 'WE', 'HAR', 'HOE', 'FI', 'YN', 'ELIFI', 'TURNED GAN', 'AIN',
];

/** Characters commonly used in sample texts. */
export const SAMPLE_TEXTS: Record<string, string> = {
  Latin: 'The quick brown fox jumps over the lazy dog.',
  Numbers: '0123456789 + - * / = % (,.;:!?)[#&]',
  Georgian: 'ქართული: აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ',
  Punctuation: '!?,.;:"\'-—()[]{}<>/\\|_~`^&*@#%',
  Mixed: 'Pixeel 2026 — ანბანი: აბგდ, xyz!? (0123) "quote"',
};

export function unicodeName(codePoint: number): string | null {
  if (codePoint >= 0x41 && codePoint <= 0x5a) return `LATIN CAPITAL LETTER ${LATIN_UPPER[codePoint - 0x41]}`;
  if (codePoint >= 0x61 && codePoint <= 0x7a) return `LATIN SMALL LETTER ${LATIN_LOWER[codePoint - 0x61]}`;
  if (codePoint >= 0x30 && codePoint <= 0x39) return `DIGIT ${DIGITS[codePoint - 0x30]}`;

  // Georgian is encoded in four letter blocks. Keep the official Unicode
  // character names so search works equally for Mkhedruli and historic scripts.
  if (codePoint >= 0x10d0 && codePoint <= 0x10fa) return `GEORGIAN LETTER ${GEORGIAN[codePoint - 0x10d0]}`;
  if (codePoint >= 0x10fd && codePoint <= 0x10ff) {
    return ['GEORGIAN LETTER AEN', 'GEORGIAN LETTER HARD SIGN', 'GEORGIAN LETTER LABIAL SIGN'][codePoint - 0x10fd];
  }
  if (codePoint >= 0x10a0 && codePoint <= 0x10c5) return `GEORGIAN CAPITAL LETTER ${GEORGIAN[codePoint - 0x10a0]}`;
  if (codePoint === 0x10c7) return 'GEORGIAN CAPITAL LETTER YN';
  if (codePoint === 0x10cd) return 'GEORGIAN CAPITAL LETTER AEN';
  if (codePoint >= 0x1c90 && codePoint <= 0x1cba) return `GEORGIAN MTAVRULI CAPITAL LETTER ${GEORGIAN[codePoint - 0x1c90]}`;
  if (codePoint >= 0x1cbd && codePoint <= 0x1cbf) {
    return ['GEORGIAN MTAVRULI CAPITAL LETTER AEN', 'GEORGIAN MTAVRULI CAPITAL LETTER HARD SIGN', 'GEORGIAN MTAVRULI CAPITAL LETTER LABIAL SIGN'][codePoint - 0x1cbd];
  }
  if (codePoint >= 0x2d00 && codePoint <= 0x2d25) return `GEORGIAN SMALL LETTER ${GEORGIAN[codePoint - 0x2d00]}`;
  if (codePoint === 0x2d27) return 'GEORGIAN SMALL LETTER YN';
  if (codePoint === 0x2d2d) return 'GEORGIAN SMALL LETTER AEN';
  return PUNCTUATION[codePoint] ?? null;
}

export function describeCodePoint(codePoint: number): string {
  const name = unicodeName(codePoint);
  const hex = 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');
  return name ? `${hex} ${name}` : hex;
}

/** Parse user input like "A", "0x10D0", "U+41", "65" into a code point. */
export function parseCodePointInput(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (s.length === 1 || (s.length === 2 && s.codePointAt(0)! > 0xffff)) {
    const cp = s.codePointAt(0);
    return cp === undefined || !isValidCodePoint(cp) ? null : cp;
  }
  // Bare digits are decimal ("65" → U+0041), as documented in the dialogs.
  // (Checking hex first made this branch unreachable and parsed "65" as 0x65.)
  if (/^\d+$/.test(s)) {
    const v = parseInt(s, 10);
    return isValidCodePoint(v) ? v : null;
  }
  // Hex needs a prefix (U+…, 0x…, \u…) or at least one hex letter (bare "10D0").
  const m = s.match(/^(?:u\+|0x|\\u)?([0-9a-f]{1,6})$/i);
  if (m) {
    const v = parseInt(m[1], 16);
    return isValidCodePoint(v) ? v : null;
  }
  return null;
}

export function isValidCodePoint(cp: number): boolean {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return false;
  // Surrogates are not valid scalar values
  return !(cp >= 0xd800 && cp <= 0xdfff);
}

export function charFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '\uFFFD';
  }
}

export interface UnicodeRangeDef {
  id: string;
  label: string;
  points: number[];
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** Assigned Georgian letter code points in the four historic/modern scripts. */
export const GEORGIAN_SCRIPT_RANGES: UnicodeRangeDef[] = [
  { id: 'georgian-mkhedruli', label: 'Mkhedruli', points: [...range(0x10d0, 0x10fa), 0x10fd, 0x10fe, 0x10ff] },
  { id: 'georgian-mtavruli', label: 'Mtavruli', points: [...range(0x1c90, 0x1cba), 0x1cbd, 0x1cbe, 0x1cbf] },
  { id: 'georgian-asomtavruli', label: 'Asomtavruli', points: [...range(0x10a0, 0x10c5), 0x10c7, 0x10cd] },
  { id: 'georgian-nuskhuri', label: 'Nuskhuri', points: [...range(0x2d00, 0x2d25), 0x2d27, 0x2d2d] },
];

/** Every assigned Georgian letter (172 code points; excludes punctuation/modifiers). */
export const GEORGIAN_LETTER_POINTS = GEORGIAN_SCRIPT_RANGES.flatMap((script) => script.points);

export const QUICK_RANGES: UnicodeRangeDef[] = [
  { id: 'latin-upper', label: 'Latin A–Z', points: range(0x41, 0x5a) },
  { id: 'latin-lower', label: 'Latin a–z', points: range(0x61, 0x7a) },
  { id: 'digits', label: 'Digits 0–9', points: range(0x30, 0x39) },
  { id: 'punct', label: 'Basic punctuation', points: [0x20, 0x21, 0x22, 0x27, 0x28, 0x29, 0x2c, 0x2d, 0x2e, 0x3a, 0x3b, 0x3f, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026] },
  { id: 'georgian', label: 'Georgian Mkhedruli (33 modern letters)', points: range(0x10d0, 0x10f0) },
];

/** Suggested glyph name for a code point (Adobe-style). */
export function suggestGlyphName(cp: number | null, fallbackIndex?: number): string {
  if (cp === null) return fallbackIndex !== undefined ? `glyph${fallbackIndex}` : 'glyph';
  if (cp === 0x20) return 'space';
  const named: Record<number, string> = { 0xa0: 'nbspace', 0x2013: 'endash', 0x2014: 'emdash', 0x20ac: 'Euro', 0x20be: 'lari' };
  if (named[cp]) return named[cp];
  if (cp >= 0x41 && cp <= 0x5a) return LATIN_UPPER[cp - 0x41];
  if (cp >= 0x61 && cp <= 0x7a) return LATIN_LOWER[cp - 0x61];
  if (cp >= 0x30 && cp <= 0x39) return `zero one two three four five six seven eight nine`.split(' ')[cp - 0x30];
  return 'uni' + cp.toString(16).toUpperCase().padStart(4, '0');
}
