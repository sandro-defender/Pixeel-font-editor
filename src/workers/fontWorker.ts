/**
 * Web Worker for expensive font operations (TTF export/validation and
 * preview builds) so the UI stays responsive.
 *
 * Source ttf objects are cached in the worker keyed by `sourceRef` to avoid
 * re-shipping multi-megabyte structures on every preview rebuild.
 */
/// <reference lib="webworker" />
import { buildTtf, type ExportOptions, type ExportReport, type TtfLike } from '../core/fontCodec';
import type { FontDoc } from '../core/types';

export interface WorkerExportReq {
  type: 'export';
  reqId: number;
  doc: FontDoc;
  options: ExportOptions;
  sourceRef: string | null;
  sourceTtf?: TtfLike | null; // only needed the first time per sourceRef
}

export interface WorkerPreviewReq {
  type: 'preview';
  reqId: number;
  doc: FontDoc;
  familySuffix: string;
  sourceRef: string | null;
  sourceTtf?: TtfLike | null;
}

export interface WorkerRegisterReq {
  type: 'register';
  reqId?: number;
  sourceRef: string;
  sourceTtf: TtfLike;
}

export type WorkerReq = WorkerExportReq | WorkerPreviewReq | WorkerRegisterReq;

export interface WorkerResp {
  reqId: number;
  ok: boolean;
  buffer?: ArrayBuffer;
  report?: ExportReport;
  error?: string;
}

declare const self: DedicatedWorkerGlobalScope;

const sourceCache = new Map<string, TtfLike>();

function resolveSource(req: WorkerExportReq | WorkerPreviewReq): TtfLike | null {
  if (req.sourceTtf) {
    if (req.sourceRef) sourceCache.set(req.sourceRef, req.sourceTtf);
    return req.sourceTtf;
  }
  if (req.sourceRef) return sourceCache.get(req.sourceRef) ?? null;
  return null;
}

self.onmessage = (ev: MessageEvent<WorkerReq>) => {
  const req = ev.data;
  try {
    if (req.type === 'register') {
      sourceCache.set(req.sourceRef, req.sourceTtf);
      postMessage({ reqId: req.reqId ?? 0, ok: true } satisfies WorkerResp);
      return;
    }
    if (req.type === 'export') {
      const { buffer, report } = buildTtf({ doc: req.doc, sourceTtf: resolveSource(req), options: req.options });
      postMessage({ reqId: req.reqId, ok: true, buffer, report } satisfies WorkerResp, [buffer]);
      return;
    }
    if (req.type === 'preview') {
      // Preview builds skip validation; override family so the browser
      // actually reloads the @font-face.
      const doc: FontDoc = {
        ...req.doc,
        meta: {
          ...req.doc.meta,
          fontFamily: `${req.doc.meta.fontFamily} ${req.familySuffix}`,
          postScriptName: `Preview${req.familySuffix.replace(/[^A-Za-z0-9]/g, '')}`,
        },
      };
      const { buffer } = buildTtf({
        doc,
        sourceTtf: resolveSource(req),
        options: { preserveHinting: false, preserveKerning: false, validate: false },
      });
      postMessage({ reqId: req.reqId, ok: true, buffer } satisfies WorkerResp, [buffer]);
      return;
    }
  } catch (err) {
    const reqId = (req as { reqId?: number }).reqId ?? -1;
    postMessage({ reqId, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies WorkerResp);
  }
};
