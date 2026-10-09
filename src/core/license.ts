/** License workflow helpers. */
import type { FontMeta } from './types';
import { buildOFLLicense } from './oflText';

export type LicenseMode = 'custom' | 'ofl' | 'imported';

export interface LicenseChoice {
  mode: LicenseMode;
  /** Custom license text (mode 'custom'). */
  customText?: string;
  customUrl?: string;
  /** OFL template fields (mode 'ofl'). */
  oflCopyrightHolder?: string;
  oflYear?: string;
  oflReservedNames?: string;
}

export const LICENSING_DISCLAIMER =
  'Choosing a license here does NOT establish ownership or the right to re-license. ' +
  'Only license fonts you created yourself, or that their existing license explicitly allows you to modify and re-distribute. ' +
  'Imported copyright and license information is preserved by default and never replaced silently.';

/** Apply a license choice onto font metadata, producing the name-table fields. */
export function applyLicense(meta: FontMeta, choice: LicenseChoice): FontMeta {
  if (choice.mode === 'ofl') {
    const text = buildOFLLicense({
      copyrightHolder: choice.oflCopyrightHolder ?? '',
      year: choice.oflYear,
      reservedFontNames: choice.oflReservedNames,
    });
    return {
      ...meta,
      licence: text,
      urlOfLicence: 'https://openfontlicense.org',
      copyright:
        meta.copyright.trim() ||
        `Copyright (c) ${choice.oflYear ?? new Date().getFullYear()}, ${choice.oflCopyrightHolder ?? ''}`.trim(),
    };
  }
  if (choice.mode === 'custom') {
    return {
      ...meta,
      licence: choice.customText ?? '',
      urlOfLicence: choice.customUrl ?? '',
    };
  }
  return meta; // 'imported': keep whatever the font carries
}

/** Build a standalone LICENSE.txt for download. */
export function buildLicenseTxt(meta: FontMeta, choice?: LicenseChoice): string {
  if (choice?.mode === 'ofl') {
    return buildOFLLicense({
      copyrightHolder: choice.oflCopyrightHolder ?? meta.designer ?? meta.fontFamily,
      year: choice.oflYear,
      reservedFontNames: choice.oflReservedNames,
    });
  }
  if (meta.licence.trim()) return meta.licence;
  const lines: string[] = [`${meta.fontFamily} ${meta.fontSubFamily}`];
  if (meta.copyright.trim()) lines.push(meta.copyright);
  if (meta.designer.trim()) lines.push(`Author: ${meta.designer}`);
  lines.push('', 'All rights reserved unless otherwise stated.');
  return lines.join('\n');
}
