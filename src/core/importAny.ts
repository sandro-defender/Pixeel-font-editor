/** One entry point for every font file the editor can open: TTF/OTF, WOFF, WOFF2 and BDF. */
import { importBdfText, type BdfInfo } from './bdf';
import { importFont } from './fontCodec';
import type { TtfLike } from './fontCodec';
import type { FontDoc } from './types';
import { sniffContainer } from './woff';
import { analyzeCoverage, coverageSummaryLine, type CoverageReport } from './coverage';

export interface AnyImportResult {
  doc: FontDoc;
  /** The parsed original, used to preserve hinting/kerning on export. Null for BDF (no outline source). */
  sourceTtf: TtfLike | null;
  warnings: string[];
  kind: 'sfnt' | 'woff' | 'woff2' | 'bdf';
  /** Set for BDF imports. */
  bdf?: BdfInfo;
  /** Character coverage report of the imported file (computed for every format). */
  coverage: CoverageReport;
}

/** The "which character sets are missing" message shown right after an import. */
export function coverageWarning(coverage: CoverageReport): string {
  const incomplete = coverage.sets.filter((s) => s.present !== s.total);
  const summary = coverageSummaryLine(coverage);
  if (coverage.unusable) return `Character coverage: ${summary}. This font has no editable glyphs.`;
  if (!incomplete.length) return `Character coverage: ${summary} — every required character set is complete.`;
  return `Character coverage: ${summary}. Missing: ${incomplete
    .map((s) => `${s.def.label} (${s.missing + s.blank} of ${s.total})`)
    .join(', ')}. Font ▸ Character coverage & sets… adds them without touching the existing glyphs.`;
}

export async function importAnyFont(input: ArrayBuffer | Uint8Array, fileName: string): Promise<AnyImportResult> {
  const buf = input instanceof Uint8Array ? (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer) : input;
  const container = sniffContainer(buf);
  if (container === 'bdf') {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
    const res = importBdfText(text, fileName);
    const coverage = analyzeCoverage(res.doc);
    return { doc: res.doc, sourceTtf: null, warnings: [...res.warnings, coverageWarning(coverage)], kind: 'bdf', bdf: res.info, coverage };
  }
  const res = await importFont(buf, fileName);
  const kind = res.doc.source?.container ?? 'sfnt';
  return { doc: res.doc, sourceTtf: res.sourceTtf, warnings: [...res.warnings, coverageWarning(res.coverage)], kind, coverage: res.coverage };
}
