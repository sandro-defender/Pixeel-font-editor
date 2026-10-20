import { describe, expect, it } from 'vitest';
import { newTestFont, drawGlyph, parseTtf } from './helpers';
import { createNewFont } from '../src/core/fontFactory';
import { defaultLedSpec } from '../src/core/ledMatrix';
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
import { DEFAULT_EXPORT_OPTIONS, importFont } from '../src/core/fontCodec';
import { detectFontPixelGrid, pixelizeFont } from '../src/core/pixelGrid';
import { normalizeFontDoc } from '../src/core/project';
import { buildMax7219DebugLog, editorDiagnosis } from '../src/services/max7219DebugLog';
import { applyLedMatrix } from '../src/state/glyphActions';
import { Font } from 'fonteditor-core';

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
  // 8x8 grid with the baseline one row up from the bottom: 7 rows above the
  // baseline + 1 below = 8 total. descentRows=1 makes createNewFont set both
  // the pixel template's baselineRow and the vertical metrics (ascent 7 cells,
  // descent -1 cell) to match, so drawings and metrics agree — a glyph that
  // fills all 8 grid rows measures exactly 8 px at size 8 with no clipping.
  let doc = newTestFont(8, 8, 'Max7219Georgian', 1);
  const cell = doc.metrics.unitsPerEm / 8; // = 128

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
    expect(guessLicenseName('Creative Commons Attribution Share Alike')).toBe('CC BY-SA');
    expect(guessLicenseName('')).toBe('');
  });
});

describe('MAX7219 YAML and manifest generation', () => {
  it('emits a web font YAML with size 8, bpp 1, build flag and select option', async () => {
    const doc = withOflLicense(makeSevenSegFont());
    const s = settingsFor(doc);
    const pkg = await buildMax7219Package(doc, s);
    expect(pkg.reportContent).toContain('## Checks');
    expect(pkg.reportContent).toContain('## Per-glyph rasterization');
    const JSZip = (await import("jszip")).default;
    const reportZip = await JSZip.loadAsync(pkg.blob);
    expect(await reportZip.file('EXPORT-REPORT.md')!.async('string')).toBe(pkg.reportContent);


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

    const integration = await zip.file('INTEGRATION.md')!.async('string');
    expect(integration).toContain('Use your larger digits for the clock time');
    expect(integration).toContain('ASCII digits `0`–`9`');
    expect(integration).toContain('Use large digits for time…');
    expect(integration).toContain('re-open Font → Export');

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

describe('MAX7219 measurement matches the drawn pixels', () => {
  /**
   * Regression: the validator used to mix bottom-up rasterizer rows with
   * top-down panel rows and round ascent up (ceil), so a glyph that filled
   * all 8 rows of a default 8×8 grid was reported as 6–7 px tall with a
   * bogus "clipped at the top", even though the compiled TTF carries exactly
   * 8 px of ink.
   */
  it('an 8-row glyph on a default 8×8 grid measures exactly 8 px', async () => {
    let doc = newTestFont(8, 8, 'EightByEight');
    const cell = doc.metrics.unitsPerEm / 8;
    for (const d of '0123456789') {
      doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) bm.set(x, y, 1);
      }).doc;
      const g = doc.glyphs.find((g) => g.unicode === d.codePointAt(0)!)!;
      g.advanceWidth = Math.round(5 * cell);
      g.leftSideBearing = 0;
    }
    doc = drawGlyph(doc, ':'.codePointAt(0)!, (bm) => { bm.set(1, 2, 1); bm.set(1, 5, 1); }).doc;
    {
      const g = doc.glyphs.find((g) => g.unicode === ':'.codePointAt(0)!)!;
      g.advanceWidth = Math.round(2 * cell);
      g.leftSideBearing = 0;
    }
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:');
    expect(v.tallestDigitPx).toBe(8);
    for (const d of '0123456789') {
      const m = v.glyphs.get(d.codePointAt(0)!)!;
      expect(m.heightPx).toBe(8);
      expect(m.clippedTop).toBe(false);
      expect(m.clippedBottom).toBe(false);
    }
    expect(v.checks.find((c) => c.name === 'Tallest digit is exactly 8 px')?.ok).toBe(true);
    expect(v.checks.find((c) => c.name === 'No glyph clipped at the top')?.ok).toBe(true);
    expect(v.checks.find((c) => c.name === 'No glyph clipped at the bottom')?.ok).toBe(true);
    expect(v.ok).toBe(true);
  });

  it('maps each drawn row onto the same display row (top stays top)', async () => {
    let doc = newTestFont(8, 8, 'RowFidelity');
    // Bitmap row 0 is the BOTTOM row of the grid, row 7 the top. '0' fills
    // all 8 rows, so the clock (which centres text on the ink of '0') shows
    // the grid's rows 1:1; '1' has a single pixel in the top row, '2' in the
    // bottom row.
    doc = drawGlyph(doc, 0x30, (bm) => { for (let y = 0; y < 8; y++) bm.set(2, y, 1); }).doc;
    doc = drawGlyph(doc, 0x31, (bm) => bm.set(2, 7, 1)).doc;
    doc = drawGlyph(doc, 0x32, (bm) => bm.set(2, 0, 1)).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '012');
    // Measured bitmaps are top-down: row 0 is the top LED row.
    const one = v.glyphs.get(0x31)!;
    expect(one.heightPx).toBe(1);
    expect(one.displayTopRow).toBe(0);
    expect(one.bitmap![0].some(Boolean)).toBe(true);
    expect(one.bitmap!.slice(1).flat().some(Boolean)).toBe(false);
    const two = v.glyphs.get(0x32)!;
    expect(two.heightPx).toBe(1);
    expect(two.displayTopRow).toBe(7);
    expect(two.bitmap![7].some(Boolean)).toBe(true);
    expect(two.bitmap!.slice(0, 7).flat().some(Boolean)).toBe(false);
  });

  it('8×8 LED matrix digits drawn full height measure 8 px', async () => {
    let doc = createNewFont({
      familyName: 'LedEight',
      styleName: 'Regular',
      gridWidth: 8,
      gridHeight: 8,
      led: defaultLedSpec(8, 8),
    });
    doc = drawGlyph(doc, 0x30, (bm) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < bm.width; x++) bm.set(x, y, 1);
    }).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0');
    expect(v.tallestDigitPx).toBe(8);
    const m = v.glyphs.get(0x30)!;
    expect(m.heightPx).toBe(8);
    expect(m.clippedTop).toBe(false);
    expect(m.clippedBottom).toBe(false);
  });

  it('does not flag a drawing that sits lower than the metrics: the clock centres on the ink of 0', async () => {
    // The pixel grid puts the baseline 2 rows above the bottom, but the
    // metrics only reserve 1 row of descent, so the drawing hangs one row
    // below ESPHome's text box. The clock never uses that box: it centres
    // every text on the ink of '0', so all 8 rows still show. (This used to
    // be reported as "clipped at the bottom".)
    let doc = newTestFont(8, 8, 'LowHang');
    const cell = doc.metrics.unitsPerEm / 8;
    doc = {
      ...doc,
      metrics: { ...doc.metrics, ascent: Math.round(cell * 7), descent: -Math.round(cell * 1) },
    };
    doc = drawGlyph(doc, 0x30, (bm) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) bm.set(x, y, 1);
    }).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0');
    const m = v.glyphs.get(0x30)!;
    expect(m.heightPx).toBe(8);
    expect(m.displayTopRow).toBe(0);
    expect(m.clippedBottom).toBe(false);
    expect(m.clippedTop).toBe(false);
    expect(v.checks.find((c) => c.name === 'No glyph clipped at the bottom')?.ok).toBe(true);
    expect(v.checks.find((c) => c.name === 'No glyph clipped at the top')?.ok).toBe(true);
  });

  it('flags ink below the display relative to 0 and still counts it in the height', async () => {
    // '0' is 6 rows tall at the top of the grid, '1' fills all 8 rows. The
    // clock centres on '0' (LED rows 1–6), so '1' starts on row 1 too and
    // its bottom row falls off the display.
    let doc = newTestFont(8, 8, 'LowDigit');
    doc = drawGlyph(doc, 0x30, (bm) => { for (let y = 2; y < 8; y++) for (let x = 0; x < 4; x++) bm.set(x, y, 1); }).doc;
    doc = drawGlyph(doc, 0x31, (bm) => { for (let y = 0; y < 8; y++) bm.set(1, y, 1); }).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '01');
    expect(v.metrics.zeroDisplayTopRow).toBe(1);
    const one = v.glyphs.get(0x31)!;
    expect(one.heightPx).toBe(8);
    expect(one.displayTopRow).toBe(1);
    expect(one.clippedBottom).toBe(true);
    expect(one.rowsClippedBottom).toBe(1);
    expect(one.clippedTop).toBe(false);
    const check = v.checks.find((c) => c.name === 'No glyph clipped at the bottom')!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("'1' (U+0031) (1 row)");
    expect(check.detail).toContain("centres text on the ink of '0', LED rows 1–6");
    // the last LED row shows the 7th ink row; the 8th is cut off
    expect(one.bitmap).toHaveLength(8);
    expect(one.bitmap![0].some(Boolean)).toBe(false);
    expect(one.bitmap![7].some(Boolean)).toBe(true);
    // and the slide animation (clipped to the rows of '0') crops it as well
    expect(v.diagnosis.join('\n')).toMatch(/slide animation: '1' 2 rows below/);
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

/**
 * The most common real-world font: digits 5 px wide drawn on the default
 * 8-column grid of a new 8×8 font, so every glyph still advances the whole
 * grid width.
 */
function wideGridClockFont(): FontDoc {
  const EIGHT = ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '#...#', '.###.'];
  let doc = newTestFont(8, 8, 'WideGrid');
  for (const d of '0123456789') {
    doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => {
      EIGHT.forEach((row, i) => [...row].forEach((c, x) => { if (c === '#') bm.set(x, 7 - i, 1); }));
    }).doc;
  }
  doc = drawGlyph(doc, 0x3a, (bm) => { bm.set(0, 2, 1); bm.set(0, 5, 1); }).doc;
  return withOflLicense(doc);
}

describe('MAX7219 diagnosis', () => {
  it('breaks the "88:88:88" width down into ink and blank advance and says how to fit', async () => {
    const doc = wideGridClockFont();
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:');
    expect(v.measuredTestStringWidthPx).toBe(64);
    const check = v.checks.find((c) => c.name === '"88:88:88" advance width ≤ 48 px')!;
    expect(check.ok).toBe(false);
    expect(check.detail).toBe("64 px (need ≤ 48): '8' 8 px (5 ink + 3 blank) ×6, ':' 8 px (1 ink + 7 blank) ×2.");
    const why = v.diagnosis.find((d) => d.startsWith('"88:88:88" is 64 px wide'))!;
    expect(why).toContain("'8' advances 8 px for 5 px of ink");
    expect(why).toContain('would be 40 px');
    expect(why).toContain("make ':' advance 2 px and every digit at most 7 px");
    // the editor hint names the setting and the target values
    const hint = editorDiagnosis(doc, v).join('\n');
    expect(hint).toContain("'8' is drawn on a 8-column grid with 5 inked columns and advances 1024 units = 8 grid columns");
    expect(hint).toContain("'8' 768 units, ':' 256 units");
    // the other checks are unaffected: the digits really are 8 px tall
    expect(v.tallestDigitPx).toBe(8);
    expect(v.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['"88:88:88" advance width ≤ 48 px']);
  });

  it('points LED-matrix fonts at Resize pixel grid and letter spacing', async () => {
    // digits drawn on 8-column grids, then turned into an 8×8 LED font:
    // every glyph advances its grid width + 1 px of letter spacing = 9 px
    let doc = newTestFont(8, 8, 'LedWide');
    for (const d of '0123456789') {
      doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) bm.set(x, y, 1); }).doc;
    }
    doc = drawGlyph(doc, 0x3a, (bm) => { bm.set(0, 2, 1); bm.set(0, 5, 1); }).doc;
    doc = applyLedMatrix(doc, { ...defaultLedSpec(8, 8), descentRows: 2 });
    expect(doc.glyphs.find((g) => g.unicode === 0x38)!.pixel!.width).toBe(8);
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:');
    expect(v.measuredTestStringWidthPx).toBe(72);
    const hint = editorDiagnosis(doc, v).join('\n');
    expect(hint).toContain('every glyph advances its grid width + 1 px letter spacing');
    expect(hint).toContain('Resize pixel grid…');
    expect(hint).toContain('Letter spacing (px)');
  });

  it('places outlines where FreeType does (glyf xMin − lsb on the pen), not shifted by the lsb', async () => {
    // A font written by a normal font tool: the glyf header carries the real
    // bounding box and hmtx lsb = xMin. FreeType draws the outline at its own
    // x (ink starts 2 px right of the pen); adding the lsb again would put it
    // at 4 px.
    let doc = newTestFont(8, 8, 'Origin');
    doc = drawGlyph(doc, 0x30, (bm) => { for (let y = 0; y < 8; y++) for (let x = 2; x < 6; x++) bm.set(x, y, 1); }).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const font = Font.create(buffer, { type: 'ttf' });
    const data = (font as unknown as { data: any }).data;
    const g = data.glyf[data.cmap[0x30]];
    const pts = g.contours.flat() as { x: number; y: number }[];
    const xMin = Math.min(...pts.map((p) => p.x));
    Object.assign(g, {
      xMin,
      xMax: Math.max(...pts.map((p) => p.x)),
      yMin: Math.min(...pts.map((p) => p.y)),
      yMax: Math.max(...pts.map((p) => p.y)),
      leftSideBearing: xMin,
    });
    expect(xMin).toBe(256);
    const v = validateMax7219Font(font.write({ type: 'ttf' }) as ArrayBuffer, '0');
    const m = v.glyphs.get(0x30)!;
    expect(m.inkLeftPx).toBe(2); // FreeType bitmap_left, verified with FreeType 2.13
    expect(m.inkWidthPx).toBe(4);
  });

  it('warns when drawn pixels are not whole LEDs (5×7 grid: 1 pixel = 8/7 LED)', async () => {
    let doc = newTestFont(5, 7, 'FiveBySeven');
    for (const d of '0123456789') {
      doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) if (y === 0 || y === 6 || x === 0 || x === 3) bm.set(x, y, 1); }).doc;
    }
    doc = drawGlyph(doc, 0x3a, (bm) => { bm.set(0, 1, 1); bm.set(0, 4, 1); }).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:');
    expect(v.metrics.latticeFU).toBe(146);
    expect(v.metrics.pxPerLatticeCell).toBeCloseTo(8 / 7, 3);
    const warn = v.diagnosis.find((d) => d.startsWith("Drawn pixels don't land on whole LEDs"))!;
    expect(warn).toContain('1 drawn pixel = 1.143 LED px');
    expect(warn).toContain('the em is 7 drawn pixels tall, not 8');
    expect(warn).toContain('unitsPerEm = 8 × 146 = 1168');
  });

  it('stays quiet about the scale when every drawn pixel is exactly one LED', async () => {
    const doc = wideGridClockFont();
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789:');
    expect(v.metrics.latticeFU).toBe(128);
    expect(v.metrics.pxPerLatticeCell).toBe(1);
    expect(v.diagnosis.some((d) => d.includes("don't land on whole LEDs"))).toBe(false);
  });

  it('rounds the ascender up like FreeType (6.22 px → 7)', async () => {
    const doc = newTestFont(8, 9, 'NineRows'); // 7 rows of 114 units above the baseline, em 1026
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, ' ');
    expect(v.metrics.ascentFU).toBe(798);
    expect(v.metrics.ascenderPx).toBe(7);
    expect(v.metrics.descenderPx).toBe(-2);
  });

  it('reports a mapped but blank glyph as empty, not as missing from the cmap', async () => {
    let doc = newTestFont(8, 8, 'BlankColon');
    doc = drawGlyph(doc, 0x30, (bm) => { for (let y = 0; y < 8; y++) bm.set(1, y, 1); }).doc;
    doc = drawGlyph(doc, 0x3a, () => {}).doc;
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0:');
    expect(v.glyphs.get(0x3a)!.present).toBe(true);
    expect(v.checks.find((c) => c.name === 'All glyphs present in cmap')?.ok).toBe(true);
    const empty = v.checks.find((c) => c.name === 'No glyph renders as empty/.notdef')!;
    expect(empty.ok).toBe(false);
    expect(empty.detail).toContain("':' (U+003A)");
  });

  it('explains digits that render taller than drawn because their edges sit between LED rows', async () => {
    // 16 grid rows on the em → 1 drawn pixel = ½ LED; 3 rows below the
    // baseline put the bottom edge at −1.5 px, so 16 drawn rows (8 px) light 9 LED rows.
    let doc = newTestFont(8, 16, 'HalfPixel', 3);
    for (const d of '0123456789') {
      doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 6; x++) bm.set(x, y, 1); }).doc;
    }
    const { buffer } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    const v = validateMax7219Font(buffer, '0123456789');
    expect(v.tallestDigitPx).toBe(9);
    const why = v.diagnosis.find((d) => d.startsWith('The tallest digit renders 9 px'))!;
    expect(why).toContain("'0' spans 1024 font units = 16 drawn pixels = 8 px");
    expect(why).toContain('Its edges fall between LED rows (it spans y = -1.5 … 6.5 px around the baseline)');
    expect(v.diagnosis.join('\n')).toContain("'0' itself is 9 px tall");
  });

  it('adds a Diagnosis section to EXPORT-REPORT.md when something is off', async () => {
    const doc = wideGridClockFont();
    const pkg = await buildMax7219Package(doc, settingsFor(doc, { glyphs: '0123456789:' }));
    expect(pkg.validation.ok).toBe(false);
    expect(pkg.reportContent).toContain('## Diagnosis');
    expect(pkg.reportContent).toContain('"88:88:88" is 64 px wide');
    expect(pkg.reportContent).toContain('| Char | Advance (px) | Ink width (px) | Height (px) | LED rows | Clipped top | Clipped bottom |');
    expect(pkg.reportContent).toContain("| '8' (U+0038) | 8 | 5 | 8 | 0–7 | no | no |");
  });
});

describe('MAX7219 debug log', () => {
  it('is a compact, paste-friendly text with checks, causes, numbers and LED bitmaps', async () => {
    const doc = wideGridClockFont();
    const pkg = await buildMax7219Package(doc, settingsFor(doc, { glyphs: '0123456789:.-' }));
    const log = buildMax7219DebugLog(doc, pkg, { appVersion: '1.2.3', commit: 'abc1234', now: new Date('2026-10-15T10:00:00Z') });
    const lines = log.split('\n');
    expect(lines[0]).toBe('===== Pixeel MAX7219 debug log =====');
    expect(log).toContain('Pixeel v1.2.3 (build abc1234) · 2026-10-15T10:00:00.000Z');
    // '.' and '-' are requested but not drawn: the cmap check fails too
    expect(log).toContain('Result: FAIL — 2 of 7 checks failed');
    expect(log).toContain("[FAIL] All glyphs present in cmap: Missing: '.' (U+002E), '-' (U+002D)");
    expect(log).toContain("[FAIL] \"88:88:88\" advance width ≤ 48 px: 64 px (need ≤ 48): '8' 8 px (5 ink + 3 blank) ×6");
    expect(log).toContain('--- Diagnosis ---');
    expect(log).toContain("* '8' is drawn on a 8-column grid with 5 inked columns");
    // editor and compiled-font facts
    expect(log).toContain('created in Pixeel');
    expect(log).toContain('LED matrix: off');
    expect(log).toContain('Glyph-set grids: 8×8 cell 128 baseline row 2 (×11)');
    expect(log).toContain('cell 128 units → em = 8 grid rows → 1 drawn pixel = 1 LED px at size 8');
    expect(log).toContain('hinting: none (FreeType auto-hinter)');
    expect(log).toContain('Outline pixel grid: 128 units = 1 LED px per drawn pixel (exact)');
    expect(log).toContain("Clock placement: '0' ink is 8 px tall (bitmap_top 6) → centred on LED rows 0–7");
    // per-glyph table, test-string breakdown and missing characters
    expect(log).toMatch(/'8' \(U\+0038\)\s+8×8 @128 b2\s+5×8\s+1024→8\s+0,-256\.\.640,768\s+5×8\s+0\s+0–7\s+-/);
    expect(log).toMatch(/'\.' \(U\+002E\)\s+missing\s+-\s+-\s+not in the TTF/);
    expect(log).toContain("'8' × 6: 8 px (5 ink + 3 blank) each = 48 px");
    expect(log).toContain('Total 64 px · with every glyph advancing ink + 1 px it would be 40 px');
    // LED rows as the clock shows them, and the drawing they come from
    expect(log).toContain('--- 8 px on the clock');
    expect(log).toMatch(/^0 {3}\.###\.\.\.\. {2}/m);
    expect(log).toMatch(/^\+6 {2}\.###\.\.\.\. {2}/m);
    expect(log).toMatch(/^-2 {2}\.###\.\.\.\. {2}/m);
    expect(lines[lines.length - 1]).toBe('===== end of MAX7219 debug log =====');
    // no raw JSON dumps; short enough to paste
    expect(log).not.toMatch(/[{}]/);
    expect(lines.length).toBeLessThan(150);
  });

  it('lists failing glyphs outside the clock characters and summarises the rest', async () => {
    let doc = newTestFont(8, 8, 'Letters');
    for (const d of '0123456789') doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => { for (let y = 0; y < 8; y++) bm.set(1, y, 1); }).doc;
    doc = drawGlyph(doc, 0x3a, (bm) => { bm.set(0, 2, 1); bm.set(0, 5, 1); }).doc;
    doc = drawGlyph(doc, 0x41, (bm) => { for (let y = 0; y < 8; y++) bm.set(1, y, 1); }).doc; // 'A' fine
    doc = withOflLicense(doc);
    const pkg = await buildMax7219Package(doc, settingsFor(doc, { glyphs: '0123456789:AB' }));
    const log = buildMax7219DebugLog(doc, pkg);
    expect(log).toMatch(/'B' \(U\+0042\)\s+missing/);
    expect(log).not.toMatch(/'A' \(U\+0041\)\s+8×8/);
    expect(log).toContain('(1 other character measured without problems)');
  });

  it('normalizes PixelForge power-of-2 unitsPerEm (32 vs 8×3=24) and passes 7-row digits with 1-row descender (max7219 Georgian)', async () => {
    // Build a PixelForge-style 5×8 font with 3-unit cells (ascent=21, descent=-3)
    // and power-of-2 padded head.unitsPerEm=32, 7-row digits (y=0..21) and
    // 1-row descender on Georgian 'ჯ' (y=-3..18).
    let doc = createNewFont({
      familyName: 'max7219 Georgian',
      styleName: 'Regular',
      gridWidth: 5,
      gridHeight: 8,
      descentRows: 1,
      led: { rows: 8, cols: 5, spacing: 1, cellUnits: 3, descentRows: 1 },
    });
    doc = {
      ...doc,
      meta: deriveMetaFields({ ...doc.meta, licence: 'Creative Commons Attribution Share Alike' }),
    };
    for (const ch of MAX7219_DEFAULT_GLYPHS) {
      if (ch === ' ') continue;
      const cp = ch.codePointAt(0)!;
      doc = drawGlyph(doc, cp, (bm) => {
        if (ch >= '0' && ch <= '9') {
          // 5×7 digit on rows 1..7 above the baseline (y = 0..21)
          for (let y = 1; y < 8; y++) for (let x = 0; x < 5; x++) bm.set(x, y, 1);
        } else if (ch === ':') {
          bm.set(0, 2, 1);
          bm.set(0, 5, 1);
        } else if (ch === 'ჯ') {
          // Uses the 1-row descender (row 0, y = -3..0) up to row 6 (y = 0..18)
          for (let y = 0; y <= 6; y++) bm.set(1, y, 1);
        } else {
          for (let y = 1; y <= 5; y++) bm.set(1, y, 1);
        }
      }).doc;
      const g = doc.glyphs.find((x) => x.unicode === cp)!;
      if (ch === ':') g.advanceWidth = 6; // 2 cells
    }
    const { buffer: cleanBuf } = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS });
    // Simulate PixelForge writing head.unitsPerEm = 32 while ascent=21, descent=-3
    const pfFont = Font.create(cleanBuf, { type: 'ttf' });
    (pfFont as unknown as { data: any }).data.head.unitsPerEm = 32;
    const pfBuf = pfFont.write({ type: 'ttf' }) as ArrayBuffer;

    // 1. importFont normalizes unitsPerEm from 32 to 24 (8 × 3)
    const { doc: imported } = await importFont(pfBuf, 'max7219.ttf');
    expect(imported.metrics.unitsPerEm).toBe(24);
    expect(imported.metrics.ascent).toBe(21);
    expect(imported.metrics.descent).toBe(-3);

    // 2. pixelizeFont also normalizes unitsPerEm even if the doc still had 32
    const det = detectFontPixelGrid({ ...imported, metrics: { ...imported.metrics, unitsPerEm: 32 } });
    expect(det.found).toBe(true);
    const { doc: pixelized } = pixelizeFont(
      { ...imported, metrics: { ...imported.metrics, unitsPerEm: 32 } },
      { grid: det.grid! },
    );
    expect(pixelized.metrics.unitsPerEm).toBe(24);

    // 3. normalizeFontDoc repairs a saved session that had unitsPerEm=32
    const repaired = normalizeFontDoc({ ...pixelized, metrics: { ...pixelized.metrics, unitsPerEm: 32 } });
    expect(repaired.metrics.unitsPerEm).toBe(24);

    // 4. MAX7219 export passes all 7 checks with zero diagnosis warnings
    const settings = defaultMax7219Settings(pixelized);
    expect(settings.licenseName).toBe('CC BY-SA');
    const pkg = await buildMax7219Package(pixelized, settings);
    expect(pkg.validation.ok).toBe(true);
    expect(pkg.validation.tallestDigitPx).toBe(7);
    expect(pkg.validation.metrics.pxPerLatticeCell).toBe(1);
    expect(pkg.validation.diagnosis).toEqual([]);
    expect(editorDiagnosis(pixelized, pkg.validation)).toEqual([]);
    expect(pkg.reportContent).toContain('**Status:** PASS');
  });
});
