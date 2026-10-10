/** One entry point for every font file the editor can open: TTF/OTF, WOFF, WOFF2 and BDF. */
import { importBdfText, type BdfInfo } from './bdf';
import { importFont } from './fontCodec';
import type { TtfLike } from './fontCodec';
import type { FontDoc } from './types';
import { sniffContainer } from './woff';

export interface AnyImportResult {
  doc: FontDoc;
  /** The parsed original, used to preserve hinting/kerning on export. Null for BDF (no outline source). */
  sourceTtf: TtfLike | null;
  warnings: string[];
  kind: 'sfnt' | 'woff' | 'woff2' | 'bdf';
  /** Set for BDF imports. */
  bdf?: BdfInfo;
}

export async function importAnyFont(input: ArrayBuffer | Uint8Array, fileName: string): Promise<AnyImportResult> {
  const buf = input instanceof Uint8Array ? (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer) : input;
  const container = sniffContainer(buf);
  if (container === 'bdf') {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
    const res = importBdfText(text, fileName);
    return { doc: res.doc, sourceTtf: null, warnings: res.warnings, kind: 'bdf', bdf: res.info };
  }
  const res = await importFont(buf, fileName);
  const kind = res.doc.source?.container ?? 'sfnt';
  return { doc: res.doc, sourceTtf: res.sourceTtf, warnings: res.warnings, kind };
}
