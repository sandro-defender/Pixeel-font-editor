/**
 * OS/2 ulUnicodeRange1–4 bit table (OpenType OS/2 specification v1.7): bit n → the
 * Unicode blocks that set it. Generated from fontTools' OS2_UNICODE_RANGES.
 */
export const OS2_UNICODE_RANGES: ReadonlyArray<ReadonlyArray<readonly [name: string, start: number, end: number]>> = [
  [['Basic Latin', 0x0000, 0x007F]], // 0
  [['Latin-1 Supplement', 0x0080, 0x00FF]], // 1
  [['Latin Extended-A', 0x0100, 0x017F]], // 2
  [['Latin Extended-B', 0x0180, 0x024F]], // 3
  [['IPA Extensions', 0x0250, 0x02AF], ['Phonetic Extensions', 0x1D00, 0x1D7F], ['Phonetic Extensions Supplement', 0x1D80, 0x1DBF]], // 4
  [['Spacing Modifier Letters', 0x02B0, 0x02FF], ['Modifier Tone Letters', 0xA700, 0xA71F]], // 5
  [['Combining Diacritical Marks', 0x0300, 0x036F], ['Combining Diacritical Marks Supplement', 0x1DC0, 0x1DFF]], // 6
  [['Greek and Coptic', 0x0370, 0x03FF]], // 7
  [['Coptic', 0x2C80, 0x2CFF]], // 8
  [['Cyrillic', 0x0400, 0x04FF], ['Cyrillic Supplement', 0x0500, 0x052F], ['Cyrillic Extended-A', 0x2DE0, 0x2DFF], ['Cyrillic Extended-B', 0xA640, 0xA69F]], // 9
  [['Armenian', 0x0530, 0x058F]], // 10
  [['Hebrew', 0x0590, 0x05FF]], // 11
  [['Vai', 0xA500, 0xA63F]], // 12
  [['Arabic', 0x0600, 0x06FF], ['Arabic Supplement', 0x0750, 0x077F]], // 13
  [['NKo', 0x07C0, 0x07FF]], // 14
  [['Devanagari', 0x0900, 0x097F]], // 15
  [['Bengali', 0x0980, 0x09FF]], // 16
  [['Gurmukhi', 0x0A00, 0x0A7F]], // 17
  [['Gujarati', 0x0A80, 0x0AFF]], // 18
  [['Oriya', 0x0B00, 0x0B7F]], // 19
  [['Tamil', 0x0B80, 0x0BFF]], // 20
  [['Telugu', 0x0C00, 0x0C7F]], // 21
  [['Kannada', 0x0C80, 0x0CFF]], // 22
  [['Malayalam', 0x0D00, 0x0D7F]], // 23
  [['Thai', 0x0E00, 0x0E7F]], // 24
  [['Lao', 0x0E80, 0x0EFF]], // 25
  [['Georgian', 0x10A0, 0x10FF], ['Georgian Supplement', 0x2D00, 0x2D2F]], // 26
  [['Balinese', 0x1B00, 0x1B7F]], // 27
  [['Hangul Jamo', 0x1100, 0x11FF]], // 28
  [['Latin Extended Additional', 0x1E00, 0x1EFF], ['Latin Extended-C', 0x2C60, 0x2C7F], ['Latin Extended-D', 0xA720, 0xA7FF]], // 29
  [['Greek Extended', 0x1F00, 0x1FFF]], // 30
  [['General Punctuation', 0x2000, 0x206F], ['Supplemental Punctuation', 0x2E00, 0x2E7F]], // 31
  [['Superscripts And Subscripts', 0x2070, 0x209F]], // 32
  [['Currency Symbols', 0x20A0, 0x20CF]], // 33
  [['Combining Diacritical Marks For Symbols', 0x20D0, 0x20FF]], // 34
  [['Letterlike Symbols', 0x2100, 0x214F]], // 35
  [['Number Forms', 0x2150, 0x218F]], // 36
  [['Arrows', 0x2190, 0x21FF], ['Supplemental Arrows-A', 0x27F0, 0x27FF], ['Supplemental Arrows-B', 0x2900, 0x297F], ['Miscellaneous Symbols and Arrows', 0x2B00, 0x2BFF]], // 37
  [['Mathematical Operators', 0x2200, 0x22FF], ['Supplemental Mathematical Operators', 0x2A00, 0x2AFF], ['Miscellaneous Mathematical Symbols-A', 0x27C0, 0x27EF], ['Miscellaneous Mathematical Symbols-B', 0x2980, 0x29FF]], // 38
  [['Miscellaneous Technical', 0x2300, 0x23FF]], // 39
  [['Control Pictures', 0x2400, 0x243F]], // 40
  [['Optical Character Recognition', 0x2440, 0x245F]], // 41
  [['Enclosed Alphanumerics', 0x2460, 0x24FF]], // 42
  [['Box Drawing', 0x2500, 0x257F]], // 43
  [['Block Elements', 0x2580, 0x259F]], // 44
  [['Geometric Shapes', 0x25A0, 0x25FF]], // 45
  [['Miscellaneous Symbols', 0x2600, 0x26FF]], // 46
  [['Dingbats', 0x2700, 0x27BF]], // 47
  [['CJK Symbols And Punctuation', 0x3000, 0x303F]], // 48
  [['Hiragana', 0x3040, 0x309F]], // 49
  [['Katakana', 0x30A0, 0x30FF], ['Katakana Phonetic Extensions', 0x31F0, 0x31FF]], // 50
  [['Bopomofo', 0x3100, 0x312F], ['Bopomofo Extended', 0x31A0, 0x31BF]], // 51
  [['Hangul Compatibility Jamo', 0x3130, 0x318F]], // 52
  [['Phags-pa', 0xA840, 0xA87F]], // 53
  [['Enclosed CJK Letters And Months', 0x3200, 0x32FF]], // 54
  [['CJK Compatibility', 0x3300, 0x33FF]], // 55
  [['Hangul Syllables', 0xAC00, 0xD7AF]], // 56
  [['Non-Plane 0 *', 0xD800, 0xDFFF]], // 57
  [['Phoenician', 0x10900, 0x1091F]], // 58
  [['CJK Unified Ideographs', 0x4E00, 0x9FFF], ['CJK Radicals Supplement', 0x2E80, 0x2EFF], ['Kangxi Radicals', 0x2F00, 0x2FDF], ['Ideographic Description Characters', 0x2FF0, 0x2FFF], ['CJK Unified Ideographs Extension A', 0x3400, 0x4DBF], ['CJK Unified Ideographs Extension B', 0x20000, 0x2A6DF], ['Kanbun', 0x3190, 0x319F]], // 59
  [['Private Use Area (plane 0)', 0xE000, 0xF8FF]], // 60
  [['CJK Strokes', 0x31C0, 0x31EF], ['CJK Compatibility Ideographs', 0xF900, 0xFAFF], ['CJK Compatibility Ideographs Supplement', 0x2F800, 0x2FA1F]], // 61
  [['Alphabetic Presentation Forms', 0xFB00, 0xFB4F]], // 62
  [['Arabic Presentation Forms-A', 0xFB50, 0xFDFF]], // 63
  [['Combining Half Marks', 0xFE20, 0xFE2F]], // 64
  [['Vertical Forms', 0xFE10, 0xFE1F], ['CJK Compatibility Forms', 0xFE30, 0xFE4F]], // 65
  [['Small Form Variants', 0xFE50, 0xFE6F]], // 66
  [['Arabic Presentation Forms-B', 0xFE70, 0xFEFF]], // 67
  [['Halfwidth And Fullwidth Forms', 0xFF00, 0xFFEF]], // 68
  [['Specials', 0xFFF0, 0xFFFF]], // 69
  [['Tibetan', 0x0F00, 0x0FFF]], // 70
  [['Syriac', 0x0700, 0x074F]], // 71
  [['Thaana', 0x0780, 0x07BF]], // 72
  [['Sinhala', 0x0D80, 0x0DFF]], // 73
  [['Myanmar', 0x1000, 0x109F]], // 74
  [['Ethiopic', 0x1200, 0x137F], ['Ethiopic Supplement', 0x1380, 0x139F], ['Ethiopic Extended', 0x2D80, 0x2DDF]], // 75
  [['Cherokee', 0x13A0, 0x13FF]], // 76
  [['Unified Canadian Aboriginal Syllabics', 0x1400, 0x167F]], // 77
  [['Ogham', 0x1680, 0x169F]], // 78
  [['Runic', 0x16A0, 0x16FF]], // 79
  [['Khmer', 0x1780, 0x17FF], ['Khmer Symbols', 0x19E0, 0x19FF]], // 80
  [['Mongolian', 0x1800, 0x18AF]], // 81
  [['Braille Patterns', 0x2800, 0x28FF]], // 82
  [['Yi Syllables', 0xA000, 0xA48F], ['Yi Radicals', 0xA490, 0xA4CF]], // 83
  [['Tagalog', 0x1700, 0x171F], ['Hanunoo', 0x1720, 0x173F], ['Buhid', 0x1740, 0x175F], ['Tagbanwa', 0x1760, 0x177F]], // 84
  [['Old Italic', 0x10300, 0x1032F]], // 85
  [['Gothic', 0x10330, 0x1034F]], // 86
  [['Deseret', 0x10400, 0x1044F]], // 87
  [['Byzantine Musical Symbols', 0x1D000, 0x1D0FF], ['Musical Symbols', 0x1D100, 0x1D1FF], ['Ancient Greek Musical Notation', 0x1D200, 0x1D24F]], // 88
  [['Mathematical Alphanumeric Symbols', 0x1D400, 0x1D7FF]], // 89
  [['Private Use (plane 15)', 0xF0000, 0xFFFFD], ['Private Use (plane 16)', 0x100000, 0x10FFFD]], // 90
  [['Variation Selectors', 0xFE00, 0xFE0F], ['Variation Selectors Supplement', 0xE0100, 0xE01EF]], // 91
  [['Tags', 0xE0000, 0xE007F]], // 92
  [['Limbu', 0x1900, 0x194F]], // 93
  [['Tai Le', 0x1950, 0x197F]], // 94
  [['New Tai Lue', 0x1980, 0x19DF]], // 95
  [['Buginese', 0x1A00, 0x1A1F]], // 96
  [['Glagolitic', 0x2C00, 0x2C5F]], // 97
  [['Tifinagh', 0x2D30, 0x2D7F]], // 98
  [['Yijing Hexagram Symbols', 0x4DC0, 0x4DFF]], // 99
  [['Syloti Nagri', 0xA800, 0xA82F]], // 100
  [['Linear B Syllabary', 0x10000, 0x1007F], ['Linear B Ideograms', 0x10080, 0x100FF], ['Aegean Numbers', 0x10100, 0x1013F]], // 101
  [['Ancient Greek Numbers', 0x10140, 0x1018F]], // 102
  [['Ugaritic', 0x10380, 0x1039F]], // 103
  [['Old Persian', 0x103A0, 0x103DF]], // 104
  [['Shavian', 0x10450, 0x1047F]], // 105
  [['Osmanya', 0x10480, 0x104AF]], // 106
  [['Cypriot Syllabary', 0x10800, 0x1083F]], // 107
  [['Kharoshthi', 0x10A00, 0x10A5F]], // 108
  [['Tai Xuan Jing Symbols', 0x1D300, 0x1D35F]], // 109
  [['Cuneiform', 0x12000, 0x123FF], ['Cuneiform Numbers and Punctuation', 0x12400, 0x1247F]], // 110
  [['Counting Rod Numerals', 0x1D360, 0x1D37F]], // 111
  [['Sundanese', 0x1B80, 0x1BBF]], // 112
  [['Lepcha', 0x1C00, 0x1C4F]], // 113
  [['Ol Chiki', 0x1C50, 0x1C7F]], // 114
  [['Saurashtra', 0xA880, 0xA8DF]], // 115
  [['Kayah Li', 0xA900, 0xA92F]], // 116
  [['Rejang', 0xA930, 0xA95F]], // 117
  [['Cham', 0xAA00, 0xAA5F]], // 118
  [['Ancient Symbols', 0x10190, 0x101CF]], // 119
  [['Phaistos Disc', 0x101D0, 0x101FF]], // 120
  [['Carian', 0x102A0, 0x102DF], ['Lycian', 0x10280, 0x1029F], ['Lydian', 0x10920, 0x1093F]], // 121
  [['Domino Tiles', 0x1F030, 0x1F09F], ['Mahjong Tiles', 0x1F000, 0x1F02F]], // 122
];

/** The four ulUnicodeRange words (bits 0–31, 32–63, 64–95, 96–127). */
export type UnicodeRanges = readonly number[];

/** Bits of the blocks that the code points fall into, plus bit 57 for any code point beyond the BMP. */
export function unicodeRangeBits(codePoints: Iterable<number>): Set<number> {
  const bits = new Set<number>();
  for (const cp of codePoints) {
    if (cp >= 0x10000 && cp < 0x110000) bits.add(57);
    for (let bit = 0; bit < OS2_UNICODE_RANGES.length; bit++) {
      if (bits.has(bit)) continue;
      if (OS2_UNICODE_RANGES[bit].some(([, start, end]) => cp >= start && cp <= end)) bits.add(bit);
    }
  }
  return bits;
}

/**
 * ulUnicodeRange1–4 for a font: the source's own words (an imported font keeps
 * them) with the bits of every code point in the font added. A new font starts
 * from nothing, so its words describe exactly its own characters.
 */
export function computeUnicodeRanges(codePoints: Iterable<number>, source: UnicodeRanges | null): UnicodeRanges {
  const words = source ? [...source, 0, 0, 0, 0].slice(0, 4) : [0, 0, 0, 0];
  for (const bit of unicodeRangeBits(codePoints)) {
    const word = Math.floor(bit / 32);
    words[word] = (words[word] | (1 << (bit % 32))) >>> 0;
  }
  return words.map((w) => w >>> 0);
}
