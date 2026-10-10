/** Client for the font worker, with a main-thread fallback. */
import type { WorkerExportReq, WorkerPreviewReq, WorkerReq, WorkerResp } from '../workers/fontWorker';
import { buildTtf, type ExportOptions, type ExportReport, type TtfLike } from '../core/fontCodec';
import type { FontDoc } from '../core/types';
import { getSource } from '../core/sourceRegistry';

export interface ExportOutcome {
  buffer: ArrayBuffer;
  report: ExportReport;
}

const EXPORT_TIMEOUT_MS = 120_000;
const PREVIEW_TIMEOUT_MS = 30_000;

let workerPromise: Promise<Worker | null> | null = null;
let seq = 1;
const pending = new Map<number, (resp: WorkerResp) => void>();
/** sourceRefs the current worker already holds (reset whenever a new worker starts) */
const workerKnownRefs = new Set<string>();

/** Start (once) the worker; returns null where workers are unavailable. */
function getWorker(): Promise<Worker | null> {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (typeof Worker === 'undefined') return null;
      try {
        // Lazy import keeps the worker module out of non-browser test runs.
        const mod = await import('../workers/fontWorker?worker');
        const worker = new mod.default();
        workerKnownRefs.clear();
        worker.onmessage = (ev: MessageEvent<WorkerResp>) => {
          const cb = pending.get(ev.data.reqId);
          if (cb) {
            pending.delete(ev.data.reqId);
            cb(ev.data);
          }
        };
        worker.onerror = () => {
          // the next request starts a fresh worker; pending requests fall back to the main thread
          worker.terminate();
          workerPromise = null;
          for (const cb of pending.values()) cb({ reqId: -1, ok: false, error: 'worker crashed' });
          pending.clear();
        };
        return worker;
      } catch {
        return null;
      }
    })();
  }
  return workerPromise;
}

/**
 * Post one request to the worker and wait for its answer (or a timeout).
 * The source table is only sent when the worker is not known to hold it; if
 * the worker reports `source-missing` the request is resent once with it.
 */
async function askWorker(worker: Worker, payload: WorkerExportReq | WorkerPreviewReq, timeoutMs: number): Promise<WorkerResp> {
  const sourceRef = payload.sourceRef;

  const send = (attachSource: boolean): Promise<WorkerResp> => {
    const reqId = seq++;
    const sourceTtf = attachSource && sourceRef ? getSource(sourceRef) : null;
    const message = { ...payload, reqId, sourceTtf } as WorkerReq;
    const response = new Promise<WorkerResp>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(reqId)) resolve({ reqId, ok: false, error: 'Worker timed out.' });
      }, timeoutMs);
      pending.set(reqId, (resp) => {
        clearTimeout(timer);
        resolve(resp);
      });
    });
    if (sourceRef && sourceTtf) workerKnownRefs.add(sourceRef);
    worker.postMessage(message);
    return response;
  };

  const resp = await send(!!sourceRef && !workerKnownRefs.has(sourceRef));
  if (!resp.ok && resp.code === 'source-missing' && sourceRef && getSource(sourceRef)) {
    workerKnownRefs.delete(sourceRef);
    return send(true);
  }
  return resp;
}

/** Full export with validation (runs in the worker when available). */
export async function exportFont(doc: FontDoc, options: ExportOptions): Promise<ExportOutcome> {
  const worker = await getWorker();
  if (worker) {
    const resp = await askWorker(worker, { type: 'export', reqId: 0, doc, options, sourceRef: doc.sourceRef }, EXPORT_TIMEOUT_MS);
    if (resp.ok && resp.buffer && resp.report) return { buffer: resp.buffer, report: resp.report };
    // the worker failed: fall back to the main thread (a real font problem surfaces there too)
  }
  const { buffer, report } = buildTtf({ doc, sourceTtf: getSource(doc.sourceRef), options });
  return { buffer, report };
}

/** Fast preview build (no validation, no hinting/kerning). */
export async function buildPreviewFont(doc: FontDoc, familySuffix: string): Promise<ArrayBuffer> {
  const worker = await getWorker();
  if (worker) {
    const resp = await askWorker(worker, { type: 'preview', reqId: 0, doc, familySuffix, sourceRef: doc.sourceRef }, PREVIEW_TIMEOUT_MS);
    if (resp.ok && resp.buffer) return resp.buffer;
    // otherwise fall through to the main-thread build below
  }
  const { buffer } = buildTtf({
    doc: {
      ...doc,
      meta: {
        ...doc.meta,
        fontFamily: `${doc.meta.fontFamily} ${familySuffix}`,
        postScriptName: `Preview${familySuffix.replace(/[^A-Za-z0-9]/g, '')}`,
      },
    },
    sourceTtf: getSource(doc.sourceRef),
    options: { preserveHinting: false, preserveKerning: false, validate: false },
  });
  return buffer;
}
