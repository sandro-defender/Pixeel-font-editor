import { describe, expect, it } from 'vitest';
import { newTestFont, drawGlyph, parseTtf } from './helpers';
import { buildEsphomePackage, esphomePackageName } from '../src/services/esphomeExport';
import { applyLicense } from '../src/core/license';
import { deriveMetaFields } from '../src/core/metadata';
import type { FontDoc } from '../src/core/types';

/** A small font with a couple of real glyphs (space, A, B) so the glyph list is meaningful. */
function fontWithGlyphs(): FontDoc {
  let doc = newTestFont(8, 8, 'EsphomeTest');
  for (const cp of [0x41, 0x42]) {
    doc = drawGlyph(doc, cp, (bm) => {
      bm.set(0, 0, 1);
      bm.set(1, 0, 1);
    }).doc;
  }
  return doc;
}

/** The `glyphs:` line of the generated YAML. */
function glyphLine(yaml: string): string {
  return yaml.split('\n').find((l) => l.trim().startsWith('glyphs:'))!;
}

describe('ESPHome package export', () => {
  it('names the archive after the PostScript name', () => {
    const doc = newTestFont(8, 8, 'My Esphome Font');
    // the PostScript name is derived from family + style, so the file names follow the font
    expect(esphomePackageName(doc)).toBe('MyEsphomeFont-Regular-esphome.zip');
  });

  it('produces a zip containing the ttf, license, yaml snippet, glyph list and readme', async () => {
    const doc = fontWithGlyphs();
    const pkg = await buildEsphomePackage(doc, { fontSize: 16 });

    expect(pkg.fileName).toBe('EsphomeTest-Regular-esphome.zip');
    expect(pkg.ttfFileName).toBe('EsphomeTest-Regular.ttf');
    expect(pkg.yamlFileName).toBe('EsphomeTest-Regular.yaml');
    expect(pkg.blob.size).toBeGreaterThan(0);

    // The embedded TTF is a real, parseable font with the right family.
    expect(parseTtf(pkg.ttf).name.fontFamily).toBe('EsphomeTest');

    // The zip really holds every advertised file.
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(pkg.blob);
    const names = Object.keys(zip.files);
    expect(names).toContain('EsphomeTest-Regular.ttf');
    expect(names).toContain('LICENSE.txt');
    expect(names).toContain('esphome/EsphomeTest-Regular.yaml');
    expect(names).toContain('esphome/glyphs.txt');
    expect(names).toContain('README.md');

    expect(await zip.file('esphome/EsphomeTest-Regular.yaml')!.async('string')).toBe(pkg.yaml);
    expect(await zip.file('esphome/glyphs.txt')!.async('string')).toBe(pkg.glyphs);
    expect(await zip.file('LICENSE.txt')!.async('string')).toBe(pkg.license);
  });

  it('emits a valid ESPHome font block with an id, size and glyph list', async () => {
    const pkg = await buildEsphomePackage(fontWithGlyphs(), { fontSize: 20 });

    expect(pkg.yaml).toMatch(/^font:\n/m);
    expect(pkg.yaml).toMatch(/^\s+- file: "EsphomeTest-Regular\.ttf"$/m);
    expect(pkg.yaml).toMatch(/^\s+id: esphometest_regular$/m);
    expect(pkg.yaml).toMatch(/^\s+size: 20$/m);
    expect(glyphLine(pkg.yaml)).toMatch(/^\s+glyphs: "/);

    // Every mapped glyph that carries artwork, sorted by code point. The
    // unmapped .notdef is never part of the list.
    expect([...pkg.glyphs].map((c) => c.codePointAt(0))).toEqual([0x20, 0x41, 0x42]);
  });

  it('defaults to size 16 and honours an explicit size', async () => {
    const doc = fontWithGlyphs();
    expect(await buildEsphomePackage(doc).then((p) => p.yaml)).toMatch(/^\s+size: 16$/m);
    expect(await buildEsphomePackage(doc, { fontSize: 8 }).then((p) => p.yaml)).toMatch(/^\s+size: 8$/m);
  });

  it('keeps the glyph string YAML-safe when it contains quotes or backslashes', async () => {
    let doc = newTestFont(8, 8, 'Quotey');
    // U+0022 (") and U+005C (\) are both mapped and would break an unescaped YAML string
    for (const cp of [0x22, 0x5c]) {
      doc = drawGlyph(doc, cp, (bm) => bm.set(0, 0, 1)).doc;
    }
    const pkg = await buildEsphomePackage(doc);
    // leading space glyph, then the two tricky characters
    expect([...pkg.glyphs].map((c) => c.codePointAt(0))).toEqual([0x20, 0x22, 0x5c]);
    expect(glyphLine(pkg.yaml)).toContain('\\"');
    expect(glyphLine(pkg.yaml)).toContain('\\\\');
  });

  it('ships the license the font carries and mentions it in the readme', async () => {
    let doc = newTestFont(8, 8, 'Licensed');
    doc = {
      ...doc,
      meta: deriveMetaFields(
        applyLicense({ ...doc.meta, designer: 'Jane Doe' }, {
          mode: 'ofl',
          oflCopyrightHolder: 'Jane Doe',
          oflYear: '2026',
          oflReservedNames: 'Licensed',
        }),
      ),
    };
    const pkg = await buildEsphomePackage(doc);

    expect(pkg.license).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(pkg.license).toContain('Copyright (c) 2026, Jane Doe');
    expect(pkg.readme).toContain('Jane Doe');
    expect(pkg.readme).toContain('LICENSE.txt');
    // quick-start instructions reference the font id and show the include form
    expect(pkg.readme).toContain('id: licensed_regular');
    expect(pkg.readme).toContain('glyphs: !include esphome/glyphs.txt');
    expect(pkg.readme).toContain('it.print(');
  });

  it('falls back to a plain all-rights-reserved note when the font carries no license', async () => {
    const pkg = await buildEsphomePackage(newTestFont(8, 8, 'NoLicense'));
    expect(pkg.license).toContain('NoLicense');
    expect(pkg.license).toContain('All rights reserved');
  });
});
