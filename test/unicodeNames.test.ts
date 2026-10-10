import { describe, expect, it } from 'vitest';
import { parseCodePointInput, isValidCodePoint, suggestGlyphName, unicodeName } from '../src/core/unicodeNames';

describe('parseCodePointInput', () => {
  it('parses a single character', () => {
    expect(parseCodePointInput('A')).toBe(0x41);
    expect(parseCodePointInput('0')).toBe(0x30); // the character "0", not the number
    expect(parseCodePointInput('😀')).toBe(0x1f600);
  });

  it('parses bare digits as DECIMAL (the documented "65" → U+0041)', () => {
    expect(parseCodePointInput('65')).toBe(0x41);
    expect(parseCodePointInput(' 65 ')).toBe(0x41);
    // not silently re-read as hex (0x65 = 101 = 'e')
    expect(parseCodePointInput('65')).not.toBe(0x65);
  });

  it('parses prefixed hex', () => {
    expect(parseCodePointInput('U+41')).toBe(0x41);
    expect(parseCodePointInput('u+10d0')).toBe(0x10d0);
    expect(parseCodePointInput('0x41')).toBe(0x41);
    expect(parseCodePointInput('\\u0041')).toBe(0x41);
  });

  it('parses bare hex that cannot be decimal (contains a hex letter)', () => {
    expect(parseCodePointInput('10D0')).toBe(0x10d0);
    expect(parseCodePointInput('ff')).toBe(0xff);
  });

  it('rejects invalid input', () => {
    expect(parseCodePointInput('')).toBeNull();
    expect(parseCodePointInput('   ')).toBeNull();
    expect(parseCodePointInput('xyz')).toBeNull();
    expect(parseCodePointInput('U+')).toBeNull();
    expect(parseCodePointInput('0x')).toBeNull();
    expect(parseCodePointInput('1114112')).toBeNull(); // decimal 0x110000 > U+10FFFF
    expect(parseCodePointInput('U+110000')).toBeNull(); // hex beyond U+10FFFF
    expect(parseCodePointInput('55296')).toBeNull(); // decimal surrogate D800
    expect(parseCodePointInput('\uD800')).toBeNull(); // lone surrogate half
  });
});

describe('isValidCodePoint', () => {
  it('accepts scalar values only', () => {
    expect(isValidCodePoint(0)).toBe(true);
    expect(isValidCodePoint(0x10ffff)).toBe(true);
    expect(isValidCodePoint(0x110000)).toBe(false);
    expect(isValidCodePoint(0xd800)).toBe(false);
    expect(isValidCodePoint(0xdfff)).toBe(false);
    expect(isValidCodePoint(-1)).toBe(false);
    expect(isValidCodePoint(1.5)).toBe(false);
  });
});

describe('names', () => {
  it('suggests glyph names and looks up unicode names', () => {
    expect(suggestGlyphName(0x41)).toBe('A');
    expect(suggestGlyphName(0x20)).toBe('space');
    expect(suggestGlyphName(0x10d0)).toBe('uni10D0');
    expect(suggestGlyphName(null, 7)).toBe('glyph7');
    expect(unicodeName(0x41)).toBe('LATIN CAPITAL LETTER A');
    expect(unicodeName(0x10d0)).toBe('GEORGIAN LETTER AN');
    expect(unicodeName(0x2603)).toBeNull();
  });
});
