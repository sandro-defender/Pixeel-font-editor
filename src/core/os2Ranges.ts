/**
 * The OS/2 `ulUnicodeRange1-4` bit table of the OpenType specification (v1.7),
 * generated from fontTools' `OS2_UNICODE_RANGES` — the same data its
 * `intersectUnicodeRanges` uses, so Pixeel's exports carry the bits other font
 * tools expect.
 *
 * Each entry is a Unicode block: the bit it sets and the code point range it
 * covers. One bit can cover several blocks (e.g. bit 4, "IPA Extensions",
 * also covers the phonetic extensions).
 */
export interface UnicodeRangeBlock {
  /** 0-125: bit 0 is the lowest bit of ulUnicodeRange1, bit 32 of ulUnicodeRange2, … */
  readonly bit: number;
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/** Blocks sorted by their first code point (binary search in unicodeRangeBits). */
export const OS2_UNICODE_BLOCKS: readonly UnicodeRangeBlock[] = [
  { bit: 0, name: "Basic Latin", start: 0x0000, end: 0x007F },
  { bit: 1, name: "Latin-1 Supplement", start: 0x0080, end: 0x00FF },
  { bit: 2, name: "Latin Extended-A", start: 0x0100, end: 0x017F },
  { bit: 3, name: "Latin Extended-B", start: 0x0180, end: 0x024F },
  { bit: 4, name: "IPA Extensions", start: 0x0250, end: 0x02AF },
  { bit: 5, name: "Spacing Modifier Letters", start: 0x02B0, end: 0x02FF },
  { bit: 6, name: "Combining Diacritical Marks", start: 0x0300, end: 0x036F },
  { bit: 7, name: "Greek and Coptic", start: 0x0370, end: 0x03FF },
  { bit: 9, name: "Cyrillic", start: 0x0400, end: 0x04FF },
  { bit: 9, name: "Cyrillic Supplement", start: 0x0500, end: 0x052F },
  { bit: 10, name: "Armenian", start: 0x0530, end: 0x058F },
  { bit: 11, name: "Hebrew", start: 0x0590, end: 0x05FF },
  { bit: 13, name: "Arabic", start: 0x0600, end: 0x06FF },
  { bit: 71, name: "Syriac", start: 0x0700, end: 0x074F },
  { bit: 13, name: "Arabic Supplement", start: 0x0750, end: 0x077F },
  { bit: 72, name: "Thaana", start: 0x0780, end: 0x07BF },
  { bit: 14, name: "NKo", start: 0x07C0, end: 0x07FF },
  { bit: 15, name: "Devanagari", start: 0x0900, end: 0x097F },
  { bit: 16, name: "Bengali", start: 0x0980, end: 0x09FF },
  { bit: 17, name: "Gurmukhi", start: 0x0A00, end: 0x0A7F },
  { bit: 18, name: "Gujarati", start: 0x0A80, end: 0x0AFF },
  { bit: 19, name: "Oriya", start: 0x0B00, end: 0x0B7F },
  { bit: 20, name: "Tamil", start: 0x0B80, end: 0x0BFF },
  { bit: 21, name: "Telugu", start: 0x0C00, end: 0x0C7F },
  { bit: 22, name: "Kannada", start: 0x0C80, end: 0x0CFF },
  { bit: 23, name: "Malayalam", start: 0x0D00, end: 0x0D7F },
  { bit: 73, name: "Sinhala", start: 0x0D80, end: 0x0DFF },
  { bit: 24, name: "Thai", start: 0x0E00, end: 0x0E7F },
  { bit: 25, name: "Lao", start: 0x0E80, end: 0x0EFF },
  { bit: 70, name: "Tibetan", start: 0x0F00, end: 0x0FFF },
  { bit: 74, name: "Myanmar", start: 0x1000, end: 0x109F },
  { bit: 26, name: "Georgian", start: 0x10A0, end: 0x10FF },
  { bit: 28, name: "Hangul Jamo", start: 0x1100, end: 0x11FF },
  { bit: 75, name: "Ethiopic", start: 0x1200, end: 0x137F },
  { bit: 75, name: "Ethiopic Supplement", start: 0x1380, end: 0x139F },
  { bit: 76, name: "Cherokee", start: 0x13A0, end: 0x13FF },
  { bit: 77, name: "Unified Canadian Aboriginal Syllabics", start: 0x1400, end: 0x167F },
  { bit: 78, name: "Ogham", start: 0x1680, end: 0x169F },
  { bit: 79, name: "Runic", start: 0x16A0, end: 0x16FF },
  { bit: 84, name: "Tagalog", start: 0x1700, end: 0x171F },
  { bit: 84, name: "Hanunoo", start: 0x1720, end: 0x173F },
  { bit: 84, name: "Buhid", start: 0x1740, end: 0x175F },
  { bit: 84, name: "Tagbanwa", start: 0x1760, end: 0x177F },
  { bit: 80, name: "Khmer", start: 0x1780, end: 0x17FF },
  { bit: 81, name: "Mongolian", start: 0x1800, end: 0x18AF },
  { bit: 93, name: "Limbu", start: 0x1900, end: 0x194F },
  { bit: 94, name: "Tai Le", start: 0x1950, end: 0x197F },
  { bit: 95, name: "New Tai Lue", start: 0x1980, end: 0x19DF },
  { bit: 80, name: "Khmer Symbols", start: 0x19E0, end: 0x19FF },
  { bit: 96, name: "Buginese", start: 0x1A00, end: 0x1A1F },
  { bit: 27, name: "Balinese", start: 0x1B00, end: 0x1B7F },
  { bit: 112, name: "Sundanese", start: 0x1B80, end: 0x1BBF },
  { bit: 113, name: "Lepcha", start: 0x1C00, end: 0x1C4F },
  { bit: 114, name: "Ol Chiki", start: 0x1C50, end: 0x1C7F },
  { bit: 4, name: "Phonetic Extensions", start: 0x1D00, end: 0x1D7F },
  { bit: 4, name: "Phonetic Extensions Supplement", start: 0x1D80, end: 0x1DBF },
  { bit: 6, name: "Combining Diacritical Marks Supplement", start: 0x1DC0, end: 0x1DFF },
  { bit: 29, name: "Latin Extended Additional", start: 0x1E00, end: 0x1EFF },
  { bit: 30, name: "Greek Extended", start: 0x1F00, end: 0x1FFF },
  { bit: 31, name: "General Punctuation", start: 0x2000, end: 0x206F },
  { bit: 32, name: "Superscripts And Subscripts", start: 0x2070, end: 0x209F },
  { bit: 33, name: "Currency Symbols", start: 0x20A0, end: 0x20CF },
  { bit: 34, name: "Combining Diacritical Marks For Symbols", start: 0x20D0, end: 0x20FF },
  { bit: 35, name: "Letterlike Symbols", start: 0x2100, end: 0x214F },
  { bit: 36, name: "Number Forms", start: 0x2150, end: 0x218F },
  { bit: 37, name: "Arrows", start: 0x2190, end: 0x21FF },
  { bit: 38, name: "Mathematical Operators", start: 0x2200, end: 0x22FF },
  { bit: 39, name: "Miscellaneous Technical", start: 0x2300, end: 0x23FF },
  { bit: 40, name: "Control Pictures", start: 0x2400, end: 0x243F },
  { bit: 41, name: "Optical Character Recognition", start: 0x2440, end: 0x245F },
  { bit: 42, name: "Enclosed Alphanumerics", start: 0x2460, end: 0x24FF },
  { bit: 43, name: "Box Drawing", start: 0x2500, end: 0x257F },
  { bit: 44, name: "Block Elements", start: 0x2580, end: 0x259F },
  { bit: 45, name: "Geometric Shapes", start: 0x25A0, end: 0x25FF },
  { bit: 46, name: "Miscellaneous Symbols", start: 0x2600, end: 0x26FF },
  { bit: 47, name: "Dingbats", start: 0x2700, end: 0x27BF },
  { bit: 38, name: "Miscellaneous Mathematical Symbols-A", start: 0x27C0, end: 0x27EF },
  { bit: 37, name: "Supplemental Arrows-A", start: 0x27F0, end: 0x27FF },
  { bit: 82, name: "Braille Patterns", start: 0x2800, end: 0x28FF },
  { bit: 37, name: "Supplemental Arrows-B", start: 0x2900, end: 0x297F },
  { bit: 38, name: "Miscellaneous Mathematical Symbols-B", start: 0x2980, end: 0x29FF },
  { bit: 38, name: "Supplemental Mathematical Operators", start: 0x2A00, end: 0x2AFF },
  { bit: 37, name: "Miscellaneous Symbols and Arrows", start: 0x2B00, end: 0x2BFF },
  { bit: 97, name: "Glagolitic", start: 0x2C00, end: 0x2C5F },
  { bit: 29, name: "Latin Extended-C", start: 0x2C60, end: 0x2C7F },
  { bit: 8, name: "Coptic", start: 0x2C80, end: 0x2CFF },
  { bit: 26, name: "Georgian Supplement", start: 0x2D00, end: 0x2D2F },
  { bit: 98, name: "Tifinagh", start: 0x2D30, end: 0x2D7F },
  { bit: 75, name: "Ethiopic Extended", start: 0x2D80, end: 0x2DDF },
  { bit: 9, name: "Cyrillic Extended-A", start: 0x2DE0, end: 0x2DFF },
  { bit: 31, name: "Supplemental Punctuation", start: 0x2E00, end: 0x2E7F },
  { bit: 59, name: "CJK Radicals Supplement", start: 0x2E80, end: 0x2EFF },
  { bit: 59, name: "Kangxi Radicals", start: 0x2F00, end: 0x2FDF },
  { bit: 59, name: "Ideographic Description Characters", start: 0x2FF0, end: 0x2FFF },
  { bit: 48, name: "CJK Symbols And Punctuation", start: 0x3000, end: 0x303F },
  { bit: 49, name: "Hiragana", start: 0x3040, end: 0x309F },
  { bit: 50, name: "Katakana", start: 0x30A0, end: 0x30FF },
  { bit: 51, name: "Bopomofo", start: 0x3100, end: 0x312F },
  { bit: 52, name: "Hangul Compatibility Jamo", start: 0x3130, end: 0x318F },
  { bit: 59, name: "Kanbun", start: 0x3190, end: 0x319F },
  { bit: 51, name: "Bopomofo Extended", start: 0x31A0, end: 0x31BF },
  { bit: 61, name: "CJK Strokes", start: 0x31C0, end: 0x31EF },
  { bit: 50, name: "Katakana Phonetic Extensions", start: 0x31F0, end: 0x31FF },
  { bit: 54, name: "Enclosed CJK Letters And Months", start: 0x3200, end: 0x32FF },
  { bit: 55, name: "CJK Compatibility", start: 0x3300, end: 0x33FF },
  { bit: 59, name: "CJK Unified Ideographs Extension A", start: 0x3400, end: 0x4DBF },
  { bit: 99, name: "Yijing Hexagram Symbols", start: 0x4DC0, end: 0x4DFF },
  { bit: 59, name: "CJK Unified Ideographs", start: 0x4E00, end: 0x9FFF },
  { bit: 83, name: "Yi Syllables", start: 0xA000, end: 0xA48F },
  { bit: 83, name: "Yi Radicals", start: 0xA490, end: 0xA4CF },
  { bit: 12, name: "Vai", start: 0xA500, end: 0xA63F },
  { bit: 9, name: "Cyrillic Extended-B", start: 0xA640, end: 0xA69F },
  { bit: 5, name: "Modifier Tone Letters", start: 0xA700, end: 0xA71F },
  { bit: 29, name: "Latin Extended-D", start: 0xA720, end: 0xA7FF },
  { bit: 100, name: "Syloti Nagri", start: 0xA800, end: 0xA82F },
  { bit: 53, name: "Phags-pa", start: 0xA840, end: 0xA87F },
  { bit: 115, name: "Saurashtra", start: 0xA880, end: 0xA8DF },
  { bit: 116, name: "Kayah Li", start: 0xA900, end: 0xA92F },
  { bit: 117, name: "Rejang", start: 0xA930, end: 0xA95F },
  { bit: 118, name: "Cham", start: 0xAA00, end: 0xAA5F },
  { bit: 56, name: "Hangul Syllables", start: 0xAC00, end: 0xD7AF },
  { bit: 57, name: "Non-Plane 0 *", start: 0xD800, end: 0xDFFF },
  { bit: 60, name: "Private Use Area (plane 0)", start: 0xE000, end: 0xF8FF },
  { bit: 61, name: "CJK Compatibility Ideographs", start: 0xF900, end: 0xFAFF },
  { bit: 62, name: "Alphabetic Presentation Forms", start: 0xFB00, end: 0xFB4F },
  { bit: 63, name: "Arabic Presentation Forms-A", start: 0xFB50, end: 0xFDFF },
  { bit: 91, name: "Variation Selectors", start: 0xFE00, end: 0xFE0F },
  { bit: 65, name: "Vertical Forms", start: 0xFE10, end: 0xFE1F },
  { bit: 64, name: "Combining Half Marks", start: 0xFE20, end: 0xFE2F },
  { bit: 65, name: "CJK Compatibility Forms", start: 0xFE30, end: 0xFE4F },
  { bit: 66, name: "Small Form Variants", start: 0xFE50, end: 0xFE6F },
  { bit: 67, name: "Arabic Presentation Forms-B", start: 0xFE70, end: 0xFEFF },
  { bit: 68, name: "Halfwidth And Fullwidth Forms", start: 0xFF00, end: 0xFFEF },
  { bit: 69, name: "Specials", start: 0xFFF0, end: 0xFFFF },
  { bit: 101, name: "Linear B Syllabary", start: 0x10000, end: 0x1007F },
  { bit: 101, name: "Linear B Ideograms", start: 0x10080, end: 0x100FF },
  { bit: 101, name: "Aegean Numbers", start: 0x10100, end: 0x1013F },
  { bit: 102, name: "Ancient Greek Numbers", start: 0x10140, end: 0x1018F },
  { bit: 119, name: "Ancient Symbols", start: 0x10190, end: 0x101CF },
  { bit: 120, name: "Phaistos Disc", start: 0x101D0, end: 0x101FF },
  { bit: 121, name: "Lycian", start: 0x10280, end: 0x1029F },
  { bit: 121, name: "Carian", start: 0x102A0, end: 0x102DF },
  { bit: 85, name: "Old Italic", start: 0x10300, end: 0x1032F },
  { bit: 86, name: "Gothic", start: 0x10330, end: 0x1034F },
  { bit: 103, name: "Ugaritic", start: 0x10380, end: 0x1039F },
  { bit: 104, name: "Old Persian", start: 0x103A0, end: 0x103DF },
  { bit: 87, name: "Deseret", start: 0x10400, end: 0x1044F },
  { bit: 105, name: "Shavian", start: 0x10450, end: 0x1047F },
  { bit: 106, name: "Osmanya", start: 0x10480, end: 0x104AF },
  { bit: 107, name: "Cypriot Syllabary", start: 0x10800, end: 0x1083F },
  { bit: 58, name: "Phoenician", start: 0x10900, end: 0x1091F },
  { bit: 121, name: "Lydian", start: 0x10920, end: 0x1093F },
  { bit: 108, name: "Kharoshthi", start: 0x10A00, end: 0x10A5F },
  { bit: 110, name: "Cuneiform", start: 0x12000, end: 0x123FF },
  { bit: 110, name: "Cuneiform Numbers and Punctuation", start: 0x12400, end: 0x1247F },
  { bit: 88, name: "Byzantine Musical Symbols", start: 0x1D000, end: 0x1D0FF },
  { bit: 88, name: "Musical Symbols", start: 0x1D100, end: 0x1D1FF },
  { bit: 88, name: "Ancient Greek Musical Notation", start: 0x1D200, end: 0x1D24F },
  { bit: 109, name: "Tai Xuan Jing Symbols", start: 0x1D300, end: 0x1D35F },
  { bit: 111, name: "Counting Rod Numerals", start: 0x1D360, end: 0x1D37F },
  { bit: 89, name: "Mathematical Alphanumeric Symbols", start: 0x1D400, end: 0x1D7FF },
  { bit: 122, name: "Mahjong Tiles", start: 0x1F000, end: 0x1F02F },
  { bit: 122, name: "Domino Tiles", start: 0x1F030, end: 0x1F09F },
  { bit: 59, name: "CJK Unified Ideographs Extension B", start: 0x20000, end: 0x2A6DF },
  { bit: 61, name: "CJK Compatibility Ideographs Supplement", start: 0x2F800, end: 0x2FA1F },
  { bit: 92, name: "Tags", start: 0xE0000, end: 0xE007F },
  { bit: 91, name: "Variation Selectors Supplement", start: 0xE0100, end: 0xE01EF },
  { bit: 90, name: "Private Use (plane 15)", start: 0xF0000, end: 0xFFFFD },
  { bit: 90, name: "Private Use (plane 16)", start: 0x100000, end: 0x10FFFD },
];

/** Highest bit the specification defines (bits above it must stay 0). */
export const OS2_MAX_RANGE_BIT = 122;

/**
 * The ulUnicodeRange bits a set of code points sets, exactly like fontTools'
 * `intersectUnicodeRanges`: a bit is set when at least one code point falls
 * into one of its blocks, plus bit 57 ("Non-Plane 0") as soon as a code point
 * lives beyond the BMP.
 */
export function unicodeRangeBits(codePoints: Iterable<number>): Set<number> {
  const bits = new Set<number>();
  for (const cp of codePoints) {
    if (!Number.isFinite(cp) || cp < 0) continue;
    // binary search: last block whose start is <= cp
    let lo = 0;
    let hi = OS2_UNICODE_BLOCKS.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (OS2_UNICODE_BLOCKS[mid].start <= cp) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // several blocks can share a start; walk back over them
    for (let i = found; i >= 0 && OS2_UNICODE_BLOCKS[i].start === OS2_UNICODE_BLOCKS[found]?.start; i--) {
      if (cp <= OS2_UNICODE_BLOCKS[i].end) bits.add(OS2_UNICODE_BLOCKS[i].bit);
    }
    if (cp >= 0x10000 && cp < 0x110000) bits.add(57); // Non-Plane 0
  }
  return bits;
}

/** Pack range bits into the four OS/2 words. */
export function rangeWords(bits: Iterable<number>): [number, number, number, number] {
  const words: [number, number, number, number] = [0, 0, 0, 0];
  for (const bit of bits) {
    if (bit < 0 || bit > 127) continue;
    const word = bit >> 5;
    words[word] = (words[word] | (1 << (bit % 32))) >>> 0;
  }
  return words;
}

/** Unpack the four OS/2 words into a bit set. */
export function wordBits(words: readonly number[]): Set<number> {
  const bits = new Set<number>();
  words.slice(0, 4).forEach((word, index) => {
    for (let i = 0; i < 32; i++) if ((word >>> i) & 1) bits.add(index * 32 + i);
  });
  return bits;
}
