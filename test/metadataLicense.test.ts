import { describe, expect, it } from 'vitest';
import { newTestFont, parseTtf } from './helpers';
import { buildTtf } from '../src/core/fontCodec';
import { deriveMetaFields, isValidPostScriptName, makePostScriptName, validateMeta } from '../src/core/metadata';
import { applyLicense, buildLicenseTxt } from '../src/core/license';
import { buildOFLLicense, OFL_BODY } from '../src/core/oflText';

describe('metadata & PostScript names', () => {
  it('generates valid PostScript names', () => {
    expect(makePostScriptName('My Font', 'Bold Italic')).toBe('MyFont-BoldItalic');
    expect(makePostScriptName('  Çool/Font [x] ', 'Regular')).not.toMatch(/[ /[\]]/);
    expect(isValidPostScriptName(makePostScriptName('Ärger 100% (test)', 'Light'))).toBe(true);
    expect(isValidPostScriptName('Has Space')).toBe(false);
    expect(isValidPostScriptName('x'.repeat(64))).toBe(false);
  });

  it('derives full name / unique id and validates required fields', () => {
    const meta = deriveMetaFields({
      ...(newTestFont().meta),
      fontFamily: 'Georgia Sans',
      fontSubFamily: 'Regular',
      fullName: '',
      uniqueSubFamily: '',
      postScriptName: '',
    });
    expect(meta.fullName).toBe('Georgia Sans Regular');
    expect(meta.postScriptName).toBe('GeorgiaSans-Regular');
    expect(meta.uniqueSubFamily).toContain('Georgia Sans');
    const bad = validateMeta({ ...meta, fontFamily: '   ' });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(validateMeta(meta).errors).toHaveLength(0);
  });

  it('round-trips all metadata fields through export', async () => {
    let doc = newTestFont(8, 8, 'MetaFont');
    doc = {
      ...doc,
      meta: deriveMetaFields({
        ...doc.meta,
        fontFamily: 'MetaFont',
        fontSubFamily: 'Italic',
        version: 'Version 2.500',
        copyright: 'Copyright (c) 2026 Test Author',
        designer: 'Test Author',
        manufacturer: 'Pixeel Tests',
        description: 'A test font for metadata round trips.',
        urlOfFontVendor: 'https://example.com/vendor',
        urlOfFontDesigner: 'https://example.com/author',
        postScriptName: '', // regenerate from family+style
      }),
    };
    const { buffer, report } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    expect(report.validation?.ok).toBe(true);
    const parsed = { data: parseTtf(buffer) };
    const names = (parsed.data as any).name;
    expect(names.fontFamily).toBe('MetaFont');
    expect(names.fontSubFamily).toBe('Italic');
    expect(names.version).toBe('Version 2.500');
    expect(names.copyright).toBe('Copyright (c) 2026 Test Author');
    expect(names.designer).toBe('Test Author');
    expect(names.manufacturer).toBe('Pixeel Tests');
    expect(names.urlOfFontVendor).toBe('https://example.com/vendor');
    expect(names.postScriptName).toBe('MetaFont-Italic');
  });
});

describe('license workflow', () => {
  it('builds the OFL license text with holder and reserved names', () => {
    const text = buildOFLLicense({ copyrightHolder: 'Jane Doe', year: '2026', reservedFontNames: '"MyPixel"' });
    expect(text).toContain('Copyright (c) 2026, Jane Doe');
    expect(text).toContain('with Reserved Font Name "MyPixel".');
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(text).toContain('PERMISSION & CONDITIONS');
    expect(text.length).toBeGreaterThan(4000);
    expect(OFL_BODY).toContain('TERMINATION');
  });

  it('embeds OFL into the name table and LICENSE.txt export', async () => {
    let doc = newTestFont(8, 8, 'OfLFont');
    const withLicense = applyLicense(doc.meta, {
      mode: 'ofl',
      oflCopyrightHolder: 'Pixeel Author',
      oflYear: '2026',
      oflReservedNames: 'OfLFont',
    });
    doc = { ...doc, meta: withLicense };
    expect(doc.meta.urlOfLicence).toBe('https://openfontlicense.org');

    const { buffer } = buildTtf({ doc, sourceTtf: null, options: { preserveHinting: true, preserveKerning: true, validate: true } });
    const parsed = { data: parseTtf(buffer) };
    const names = (parsed.data as any).name;
    expect(names.licence).toContain('SIL OPEN FONT LICENSE');
    expect(names.urlOfLicence).toBe('https://openfontlicense.org');

    const txt = buildLicenseTxt(doc.meta);
    expect(txt).toContain('Reserved Font Name OfLFont');
    expect(txt).toContain('DISCLAIMER');
  });

  it('never replaces imported licensing silently (custom mode preserves)', () => {
    let doc = newTestFont(8, 8, 'ImportedLook');
    doc = { ...doc, meta: { ...doc.meta, licence: 'Original license text.', urlOfLicence: 'https://orig.example' } };
    const untouched = applyLicense(doc.meta, { mode: 'imported' });
    expect(untouched.licence).toBe('Original license text.');
    const custom = applyLicense(doc.meta, { mode: 'custom', customText: 'New terms', customUrl: 'https://new.example' });
    expect(custom.licence).toBe('New terms');
  });
});
