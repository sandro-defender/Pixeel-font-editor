/** Font naming validation + PostScript name generation. */
import type { FontMeta } from './types';

/**
 * Blank starting point for a font's name table.
 *
 * `fullName`, `postScriptName` and `uniqueSubFamily` are left EMPTY on purpose:
 * they are *derived* fields and `deriveMetaFields` fills them from the real
 * family/style. Filling them in here with placeholder text made every new font
 * keep "Untitled Regular" / "Untitled-Regular" no matter what it was called.
 */
export const EMPTY_META: FontMeta = {
  fontFamily: 'Untitled',
  fontSubFamily: 'Regular',
  fullName: '',
  postScriptName: '',
  uniqueSubFamily: '',
  version: 'Version 1.000',
  copyright: '',
  designer: '',
  manufacturer: '',
  description: '',
  urlOfFontVendor: '',
  urlOfFontDesigner: '',
  licence: '',
  urlOfLicence: '',
};

/** Characters allowed in PostScript names (per the OpenType spec). */
const PS_ALLOWED = /[ -~]/; // printable ASCII subset filtered further below
const PS_FORBIDDEN = /[<>[\]{}()\/%\\]/;

export function sanitizePostScriptFragment(s: string): string {
  let out = '';
  for (const ch of s.trim()) {
    if (PS_FORBIDDEN.test(ch)) continue;
    if (ch === ' ' || ch === '\t') continue;
    if (!PS_ALLOWED.test(ch)) continue;
    if (ch.charCodeAt(0) === 45 && out.length === 0) continue; // no leading '-'
    out += ch;
  }
  return out;
}

/**
 * Generate a valid PostScript font name from family + style.
 * Rule: ASCII subset of [!-~] minus [](){}<>/%, no spaces, max 63 chars.
 */
export function makePostScriptName(family: string, style: string): string {
  const f = sanitizePostScriptFragment(family) || 'Font';
  const s = sanitizePostScriptFragment(style) || 'Regular';
  let name = `${f}-${s}`.slice(0, 63);
  if (!/^[!-~]+$/.test(name)) name = 'Font-Regular';
  return name;
}

export function isValidPostScriptName(name: string): boolean {
  if (!name || name.length > 63) return false;
  if (!/^[\x21-\x7e]+$/.test(name)) return false;
  return !PS_FORBIDDEN.test(name);
}

export interface MetaValidation {
  errors: string[];
  warnings: string[];
}

export function validateMeta(meta: FontMeta): MetaValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!meta.fontFamily.trim()) errors.push('Family name is required.');
  if (!meta.fontSubFamily.trim()) errors.push('Style/subfamily is required.');
  if (meta.fontFamily.length > 255) errors.push('Family name is too long (max 255 chars).');
  if (meta.postScriptName.trim()) {
    if (!isValidPostScriptName(meta.postScriptName)) {
      errors.push('PostScript name is invalid: use ASCII without spaces or [](){}<>/% and at most 63 characters.');
    }
  } else {
    errors.push('PostScript name is required.');
  }
  if (!meta.version.trim()) warnings.push('Version is empty — "Version 1.000" will be used.');
  if (meta.fullName && meta.fontFamily && !meta.fullName.includes(meta.fontFamily.trim())) {
    warnings.push('Full name does not contain the family name.');
  }
  if ((meta.licence && !meta.licence.trim()) || (meta.urlOfLicence && !meta.urlOfLicence.trim())) {
    warnings.push('License fields are empty.');
  }
  return { errors, warnings };
}

export function defaultVersionString(): string {
  return 'Version 1.000';
}

/** Sync derived fields (fullName, uniqueSubFamily, postScriptName if empty). */
export function deriveMetaFields(meta: FontMeta): FontMeta {
  const family = meta.fontFamily.trim() || 'Untitled';
  const style = meta.fontSubFamily.trim() || 'Regular';
  return {
    ...meta,
    fontFamily: family,
    fontSubFamily: style,
    fullName: meta.fullName.trim() || `${family} ${style}`,
    uniqueSubFamily: meta.uniqueSubFamily.trim() || `Pixeel: ${family} ${style}`,
    postScriptName: isValidPostScriptName(meta.postScriptName) ? meta.postScriptName : makePostScriptName(family, style),
    version: meta.version.trim() || defaultVersionString(),
  };
}
