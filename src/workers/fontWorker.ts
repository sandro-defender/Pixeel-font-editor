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
  /** 'source-missing': the request named a source the worker does not hold; resend it with the data */
  code?: 'source-missing';
}

/** Most recently used source tables kept in the worker (each can be several MB). */
const SOURCE_CACHE_LIMIT = 4;

declare const self: DedicatedWorkerGlobalScope;

const sourceCache = new Map<string, TtfLike>();

function cacheSource(ref: string, ttf: TtfLike): void {
  sourceCache.delete(ref); // re-insert so the Map keeps least-recently-used order first
  sourceCache.set(ref, ttf);
  while (sourceCache.size > SOURCE_CACHE_LIMIT) {
    const oldest = sourceCache.keys().next().value;
    if (oldest === undefined) break;
    sourceCache.delete(oldest);
  }
}

class SourceMissingError extends Error {}

function resolveSource(req: WorkerExportReq | WorkerPreviewReq): TtfLike | null {
  if (!req.sourceRef) return null;
  if (req.sourceTtf) {
    cacheSource(req.sourceRef, req.sourceTtf);
    return req.sourceTtf;
  }
  const cached = sourceCache.get(req.sourceRef);
  if (!cached) throw new SourceMissingError(`Source ${req.sourceRef} is not loaded in the worker.`);
  cacheSource(req.sourceRef, cached);
  return cached;
}

self.onmessage = (ev: MessageEvent<WorkerReq>) => {
  const req = ev.data;
  try {
    if (req.type === 'register') {
      cacheSource(req.sourceRef, req.sourceTtf);
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
        options: { preserveHinting: false, preserveKerning: true, validate: false },
      });
      postMessage({ reqId: req.reqId, ok: true, buffer } satisfies WorkerResp, [buffer]);
      return;
    }
  } catch (err) {
    const reqId = (req as { reqId?: number }).reqId ?? -1;
    const code = err instanceof SourceMissingError ? 'source-missing' : undefined;
    postMessage({ reqId, ok: false, error: err instanceof Error ? err.message : String(err), code } satisfies WorkerResp);
  }
};
