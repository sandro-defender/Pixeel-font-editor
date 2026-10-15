import { describe, expect, it } from 'vitest';
import { newTestFont, drawGlyph, parseTtf } from './helpers';
import {
  buildMax7219Package,
  defaultMax7219Settings,
  firmwareIdFromSlug,
  guessLicenseName,
  macroFromSlug,
  MAX7219_BPP,
  MAX7219_DEFAULT_GLYPHS,
  MAX7219_PIXEL_SIZE,
  slugify,
  validateMax7219Font,
  validateSlug,
  type Max7219ExportSettings,
} from '../src/services/max7219Export';
import { applyLicense } from '../src/core/license';
import { deriveMetaFields } from '../src/core/metadata';
import type { FontDoc } from '../src/core/types';
import { exportFont } from '../src/services/exportService';
import { DEFAULT_EXPORT_OPTIONS } from '../src/core/fontCodec';

/**
 * Build a font where digits are full 8-pixel tall glyphs using all rows, so
 * tallest digit = 8px. Digits are 5px wide (solid blocks) and "88:88:88"
 * fits in ≤48 px (6 chars × 6 px including colon = 36 px).
 *
 * We draw each digit as a filled block of width 5 that spans
 * all 8 rows; that makes each digit exactly 8px tall with advance 5px (plus
 * 1px spacing makes 6px × 6 = 36px for "88:88:88" — well under 48).
 */
function makeSevenSegFont(): FontDoc {
  // Start with 8x8 font. Adjust baseline so glyphs can fill all 8 rows from
  // top (row 0) to bottom (row 7). The default computePixelLayout sets
  // baselineRow = 2 (rows from bottom), so rows above baseline = 6. We want
  // 7 rows above baseline (so top 7 rows + 1 bottom = 8 total).
  // Easiest: just draw in rows 0..7 and let the measurement rasterize to the
  // font's metrics (which the exported TTF carries).
  let doc = newTestFont(8, 8, 'Max7219Georgian');
  // Update metrics so ascent = 7*cell, descent = -1*cell, lineGap = 0.
  // The newTestFont layout uses unitsPerCell=128 for gridHeight 8.
  // Override metrics to fit 8 rows exactly:
  const cell = doc.metrics.unitsPerEm / 8; // = 128
  doc = {
    ...doc,
    metrics: {
      ...doc.metrics,
      ascent: Math.round(cell * 7), // 896
      descent: -Math.round(cell * 1), // -128
    },
  };

  // For each digit (0-9) draw an 8x5 block of pixels (solid rectangle filling all 8 rows).
  // This gives tallest digit exactly 8, advance width = 5 pixels * cell = 640 fu → 5 px.
  const drawSolid = (cp: number, w = 5) => {
    doc = drawGlyph(doc, cp, (bm) => {
      for (let y = 0; y < bm.height; y++) {
        for (let x = 0; x < w; x++) bm.set(x, y, 1);
      }
    }).doc;
    // Set advance width to w pixels: advance = w * cell fu
    const glyph = doc.glyphs.find((g) => g.unicode === cp)!;
    glyph.advanceWidth = Math.round(w * cell);
    glyph.leftSideBearing = 0;
  };
  for (const d of '0123456789') {
    drawSolid(d.codePointAt(0)!, 5);
  }
  // Colon (:) — two dots, width 2 px; advance 2 px.
  doc = drawGlyph(doc, ':'.codePointAt(0)!, (bm) => {
    // rows 2 and 5 from top
    bm.set(1, 2, 1);
    bm.set(1, 5, 1);
  }).doc;
  {
    const g = doc.glyphs.find((g) => g.unicode === ':'.codePointAt(0)!)!;
    g.advanceWidth = Math.round(2 * cell);
    g.leftSideBearing = 0;
  }
  // Punctuation: ., -, /, %, !, ?, +, space
  const drawPunct = (ch: string, w: number, drawFn: (bm: import('../src/core/bitmap').Bitmap) => void) => {
    doc = drawGlyph(doc, ch.codePointAt(0)!, drawFn).doc;
    const g = doc.glyphs.find((g) => g.unicode === ch.codePointAt(0)!)!;
    g.advanceWidth = Math.round(w * cell);
    g.leftSideBearing = 0;
  };
  drawPunct('.', 2, (bm) => bm.set(1, 7, 1));
  drawPunct('-', 3, (bm) => { for (let x = 0; x < 3; x++) bm.set(x, 4, 1); });
  drawPunct('/', 4, (bm) => {
    for (let i = 0; i < 7; i++) bm.set(i, 6 - i, 1);
  });
  drawPunct('%', 6, (bm) => {
    bm.set(0, 1, 1); bm.set(1, 1, 1);
    bm.set(4, 6, 1); bm.set(5, 6, 1);
    for (let i = 0; i < 6; i++) bm.set(i, i, 1);
  });
  drawPunct('!', 2, (bm) => { for (let y = 0; y < 6; y++) bm.set(0, y, 1); bm.set(0, 7, 1); });
  drawPunct('?', 4, (bm) => {
    bm.set(0, 1, 1); bm.set(1, 0, 1); bm.set(2, 1, 1);
    bm.set(2, 2, 1); bm.set(1, 3, 1); bm.set(1, 5, 1);
  });
  drawPunct('+', 4, (bm) => {
    bm.set(1, 3, 1); bm.set(2, 3, 1); bm.set(1, 4, 1); bm.set(2, 4, 1);
    bm.set(0, 3, 1); bm.set(3, 3, 1); bm.set(1, 2, 1); bm.set(2, 5, 1);
    bm.set(1, 3, 1);
    for (let x = 0; x < 4; x++) bm.set(x, 3, 1);
    for (let y = 1; y < 6; y++) { bm.set(1, y, 0); bm.set(2, y, 0); }
    bm.set(1, 3, 1); bm.set(2, 3, 1); bm.set(1, 4, 1); bm.set(2, 4, 1);
  });

  // Georgian letters (just single-pixel tall bars on each, all within 8 rows)
  const georgian = 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ';
  for (const ch of georgian) {
    const cp = ch.codePointAt(0)!;
    if (doc.glyphs.some((g) => g.unicode === cp)) continue;
    drawPunct(ch, 4, (bm) => {
      // draw a simple 4px-wide glyph that stays within 8 rows
      for (let y = 1; y < 7; y++) { bm.set(0, y, 1); bm.set(3, y, 1); }
      for (let x = 0; x < 4; x++) { bm.set(x, 1, 1); bm.set(x, 4, 1); }
    });
  }

  return doc;
}

function withOflLicense(doc: FontDoc): FontDoc {
  return {
    ...doc,
    meta: deriveMetaFields(
      applyLicense({ ...doc.meta, designer: 'Test Author' }, {
        mode: 'ofl',
        oflCopyrightHolder: 'Test Author',
        oflYear: '2026',
        oflReservedNames: doc.meta.fontFamily,
      }),
    ),
  };
}

const settingsFor = (doc: FontDoc, override: Partial<Max7219ExportSettings> = {}): Max7219ExportSettings => {
  const base = defaultMax7219Settings(doc);
  return {
    ...base,
    label: 'MAX7219 Georgian',
    slug: 'max7219-georgian',
    ttfFileName: base.ttfFileName,
    licenseName: 'SIL OFL 1.1',
    licenseText: 'This font is licensed under the SIL Open Font License, Version 1.1.',
    ...override,
  };
};

describe('MAX7219 Matrix Clock export — identifier derivation', () => {
  it('slugifies to kebab-case', () => {
    expect(slugify('MAX7219 Georgian')).toBe('max7219-georgian');
    expect(slugify('My Cool Font!')).toBe('my-cool-font');
    expect(slugify('   ')).toBe('font');
    expect(slugify('ABC')).toBe('abc');
  });

  it('rejects invalid slugs', () => {
    expect(validateSlug('max7219-georgian')).toBeNull();
    expect(validateSlug('a')).toBeNull();
    expect(validateSlug('abc-123-xyz')).toBeNull();
    expect(validateSlug('-bad')).not.toBeNull();
    expect(validateSlug('bad-')).not.toBeNull();
    expect(validateSlug('double--dash')).not.toBeNull();
    expect(validateSlug('UPPER')).not.toBeNull();
    expect(validateSlug('under_score')).not.toBeNull();
    expect(validateSlug('')).not.toBeNull();
  });

  it('derives firmware id and build macro from slug', () => {
    expect(firmwareIdFromSlug('max7219-georgian')).toBe('font_max7219_georgian_source');
    expect(macroFromSlug('max7219-georgian')).toBe('MAX7219_FONT_MAX7219_GEORGIAN');
    expect(firmwareIdFromSlug('a')).toBe('font_a_source');
    expect(macroFromSlug('a')).toBe('MAX7219_FONT_A');
  });

  it('guesses well-known license names from text', () => {
    expect(guessLicenseName('SIL OPEN FONT LICENSE Version 1.1\n...')).toBe('SIL OFL 1.1');
    expect(guessLicenseName('Copyright (c) ... MIT License.')).toBe('MIT');
    expect(guessLicenseName('Licensed under CC BY-SA 3.0.')).toBe('CC BY-SA 3.0');
    expect(guessLicenseName('')).toBe('');
  });
});

describe('MAX7219 YAML and manifest generation', () => {
  it('emits a web font YAML with size 8, bpp 1, build flag and select option', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc);
    const pkg = await buildMax7219Package(doc, s);

    expect(pkg.yamlContent).toContain('type: web');
    expect(pkg.yamlContent).toContain('url: ${fonts_base_url}/max7219-georgian/');
    expect(pkg.yamlContent).toContain('size: 8');
    expect(pkg.yamlContent).toContain('bpp: 1');
    expect(pkg.yamlContent).toContain('-DMAX7219_FONT_MAX7219_GEORGIAN');
    expect(pkg.yamlContent).toContain('id: font_max7219_georgian_source');
    expect(pkg.yamlContent).toContain("'MAX7219 Georgian'");
    // UTF-8 Georgian glyphs preserved in glyph list
    expect(pkg.yamlContent).toContain('აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ');
    // No local file: path, no glyphs.txt include
    expect(pkg.yamlContent).not.toContain('glyphs: !include');
    expect(pkg.yamlContent).not.toMatch(/file:\s*"[^$]/);
  });

  it('produces a manifest with all required fields and real TTF SHA-256', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc);
    const pkg = await buildMax7219Package(doc, s);

    expect(pkg.manifest.slug).toBe('max7219-georgian');
    expect(pkg.manifest.label).toBe('MAX7219 Georgian');
    expect(pkg.manifest.firmwareId).toBe('font_max7219_georgian_source');
    expect(pkg.manifest.macro).toBe('MAX7219_FONT_MAX7219_GEORGIAN');
    expect(pkg.manifest.file).toBe('fonts/max7219-georgian/' + s.ttfFileName);
    expect(pkg.manifest.size).toBe(MAX7219_PIXEL_SIZE);
    expect(pkg.manifest.bpp).toBe(MAX7219_BPP);
    expect(pkg.manifest.glyphs).toBe(s.glyphs);
    expect(pkg.manifest.license).toBe('SIL OFL 1.1');
    expect(pkg.manifest.licenseFile).toBe('fonts/max7219-georgian/LICENSE.txt');
    expect(typeof pkg.manifest.ttfSha256).toBe('string');
    expect((pkg.manifest.ttfSha256 as string)).toHaveLength(64);
    expect(pkg.manifest.measuredTestString).toBe('88:88:88');
    expect(typeof pkg.manifest.measuredTestStringWidthPx).toBe('number');
    expect(typeof pkg.manifest.tallestDigitPx).toBe('number');
  });
});

describe('MAX7219 ZIP layout', () => {
  it('contains exactly the documented paths with forward slashes', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc);
    const pkg = await buildMax7219Package(doc, s);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(pkg.blob);
    const allNames = Object.keys(zip.files);
    const names = allNames.filter((n) => !n.endsWith('/')).sort(); // drop folder entries
    const expected = [
      `fonts/${s.slug}/${s.ttfFileName}`,
      `fonts/${s.slug}/LICENSE.txt`,
      `packages/fonts/${s.slug}.yaml`,
      'font-manifest.json',
      'EXPORT-REPORT.md',
      'INTEGRATION.md',
      'integration/configurator-fontMetadata.json',
      'integration/display-snippet.txt',
      'integration/test-mapping.txt',
      'integration/fonts-readme-row.md',
    ].sort();
    expect(names).toEqual(expected);
    // No generic local yaml/file path should exist
    for (const n of names) {
      expect(n).not.toContain('packages/local_fonts');
      expect(n).not.toMatch(/glyphs\.txt$/);
    }
  });

  it('names the archive <slug>-esphome-max7219.zip', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc);
    const pkg = await buildMax7219Package(doc, s);
    expect(pkg.fileName).toBe('max7219-georgian-esphome-max7219.zip');
  });

  it('contains correctly-pathed integration snippets', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc);
    const pkg = await buildMax7219Package(doc, s);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(pkg.blob);

    const meta = JSON.parse(await zip.file('integration/configurator-fontMetadata.json')!.async('string'));
    expect(meta['max7219-georgian'].label).toBe('MAX7219 Georgian');
    expect(meta['max7219-georgian'].license).toBe('SIL OFL 1.1');
    expect(meta['max7219-georgian'].source).toBe('fonts/max7219-georgian/LICENSE.txt');

    const display = await zip.file('integration/display-snippet.txt')!.async('string');
    expect(display).toContain('#ifdef MAX7219_FONT_MAX7219_GEORGIAN');
    expect(display).toContain('max7219_clock::SourceFont max7219_georgian_font(font_max7219_georgian_source, &it);');
    expect(display).toContain('font_option == "MAX7219 Georgian"');
    expect(display).toContain('#endif');

    const testMap = await zip.file('integration/test-mapping.txt')!.async('string');
    expect(testMap).toContain('"font_max7219_georgian_source": "MAX7219 Georgian",');

    const row = await zip.file('integration/fonts-readme-row.md')!.async('string');
    expect(row).toContain('| MAX7219 Georgian |');
    expect(row).toContain(`[${s.ttfFileName}](max7219-georgian/${s.ttfFileName})`);
    expect(row).toContain('SIL OFL 1.1');

    const pkgYaml = await zip.file(`packages/fonts/${s.slug}.yaml`)!.async('string');
    expect(pkgYaml).toBe(pkg.yamlContent);

    const license = await zip.file(`fonts/${s.slug}/LICENSE.txt`)!.async('string');
    expect(license).toBe(s.licenseText);
  });
});

describe('MAX7219 validation against compiled TTF', () => {
  it('passes for a compliant 8-digit font', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:.');
    expect(v.ok).toBe(true);
    expect(v.tallestDigitPx).toBe(8);
    expect(v.measuredTestStringWidthPx).toBeLessThanOrEqual(48);
  });

  it('fails when a requested glyph is missing from cmap', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    // Include Georgian letter ა (U+10D0) — but our font only draws a subset (if present), so add an unrelated char we don't have.
    const missingGlyphs = '0123456789:A'; // capital 'A' is not drawn in our font
    const v = validateMax7219Font(buffer, missingGlyphs);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name === 'All glyphs present in cmap')?.ok).toBe(false);
  });

  it('fails tallest-digit check when no digit reaches 8 px', async () => {
    // Make a font whose digits only cover rows 2..7 (6px tall)
    let doc = newTestFont(8, 8, 'Short');
    const cell = doc.metrics.unitsPerEm / 8;
    doc = { ...doc, metrics: { ...doc.metrics, ascent: Math.round(cell * 7), descent: -Math.round(cell * 1) } };
    for (const d of '0123456789') {
      doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => {
        for (let y = 2; y < 8; y++) for (let x = 0; x < 4; x++) bm.set(x, y, 1);
      }).doc;
      const g = doc.glyphs.find((g) => g.unicode === d.codePointAt(0)!)!;
      g.advanceWidth = Math.round(4 * cell);
      g.leftSideBearing = 0;
    }
    doc = withOflLicense(doc);
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:.');
    expect(v.checks.find((c) => c.name === 'Tallest digit is exactly 8 px')?.ok).toBe(false);
    expect(v.tallestDigitPx).toBeLessThan(8);
  });

  it('fails width check when "88:88:88" exceeds 48 px', async () => {
    // Make digits 9px wide (but still 8px tall) so 8*9 = 72 plus colons → > 48
    let doc = newTestFont(8, 8, 'Wide');
    const cell = doc.metrics.unitsPerEm / 8;
    doc = { ...doc, metrics: { ...doc.metrics, ascent: Math.round(cell * 7), descent: -Math.round(cell * 1) } };
    for (const d of '0123456789') {
      doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bm.set(x, y, 1);
      }).doc;
      const g = doc.glyphs.find((g) => g.unicode === d.codePointAt(0)!)!;
      g.advanceWidth = Math.round(9 * cell); // 9px per digit
      g.leftSideBearing = 0;
    }
    doc = drawGlyph(doc, ':'.codePointAt(0)!, (bm) => { bm.set(4, 2, 1); bm.set(4, 5, 1); }).doc;
    {
      const g = doc.glyphs.find((g) => g.unicode === ':'.codePointAt(0)!)!;
      g.advanceWidth = Math.round(5 * cell);
      g.leftSideBearing = 0;
    }
    doc = withOflLicense(doc);
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:');
    expect(v.checks.find((c) => c.name === '"88:88:88" advance width ≤ 48 px')?.ok).toBe(false);
    expect(v.measuredTestStringWidthPx).toBeGreaterThan(48);
  });
});

describe('MAX7219 license enforcement', () => {
  it('blocks export when license name is missing', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = { ...defaultMax7219Settings(doc), licenseName: '', label: 'X', slug: 'x', ttfFileName: 'X.ttf' };
    await expect(buildMax7219Package(doc, s)).rejects.toThrow(/License name is required/);
  });

  it('blocks export when license text is missing', async () => {
    const doc = makeSevenSegFont(); // no license applied
    const s = { ...defaultMax7219Settings(doc), licenseName: 'SIL OFL 1.1', licenseText: '', label: 'X', slug: 'x', ttfFileName: 'X.ttf' };
    await expect(buildMax7219Package(doc, s)).rejects.toThrow(/License text is required/);
  });

  it('blocks export with invalid slug', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc, { slug: 'Not-Kebab!' });
    await expect(buildMax7219Package(doc, s)).rejects.toThrow(/kebab-case/);
  });
});

describe('existing export formats still work', () => {
  it('produces a parseable TTF with the standard export', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const parsed = parseTtf(buffer);
    expect(parsed.name.fontFamily).toBe('Max7219Georgian');
  });

  it('produces the classic ESPHome package (local file: path, glyphs.txt)', async () => {
    const { buildEsphomePackage } = await import('../src/services/esphomeExport');
    const doc = withOflLicense(makeSevenSegFont());
    const pkg = await buildEsphomePackage(doc, { fontSize: 16 });
    expect(pkg.yaml).toMatch(/file:\s*"/); // local file
    expect(pkg.blob.size).toBeGreaterThan(0);
  });
});

describe('default settings', () => {
  it('defaults glyph set, pixel size and label', () => {
    const doc = newTestFont(8, 8, 'Georgian');
    const d = defaultMax7219Settings(doc);
    expect(d.pixelSize).toBe(MAX7219_PIXEL_SIZE);
    expect(d.glyphs).toBe(MAX7219_DEFAULT_GLYPHS);
    expect(d.label).toBe('MAX7219 Georgian');
    expect(d.slug).toBe('georgian');
    expect(d.ttfFileName.endsWith('.ttf')).toBe(true);
  });
});
