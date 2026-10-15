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

/** Offline standard templates; selecting one never changes the source metadata. */
export function standardLicenseText(id: 'ofl' | 'mit', holder: string): string {
  const year = String(new Date().getFullYear());
  if (id === 'ofl') return buildOFLLicense({ copyrightHolder: holder, year });
  return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}
