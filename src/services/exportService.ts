/** Client for the font worker, with a main-thread fallback. */
import FontWorker from '../workers/fontWorker?worker';
import type { WorkerReq, WorkerResp } from '../workers/fontWorker';
import { buildTtf, type ExportOptions, type ExportReport, type TtfLike } from '../core/fontCodec';
import type { FontDoc } from '../core/types';
import { getSource } from '../core/sourceRegistry';

export interface ExportOutcome {
  buffer: ArrayBuffer;
  report: ExportReport;
}

let worker: Worker | null = null;
let seq = 1;
const pending = new Map<number, (resp: WorkerResp) => void>();
/** sourceRefs the worker already holds */
const workerKnownRefs = new Set<string>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new FontWorker();
    worker.onmessage = (ev: MessageEvent<WorkerResp>) => {
      const cb = pending.get(ev.data.reqId);
      if (cb) {
        pending.delete(ev.data.reqId);
        cb(ev.data);
      }
    };
    worker.onerror = () => {
      // fall back to main thread for future calls
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function attachSource(req: { sourceRef: string | null; sourceTtf?: TtfLike | null }): void {
  if (req.sourceRef && !workerKnownRefs.has(req.sourceRef)) {
    req.sourceTtf = getSource(req.sourceRef);
    if (req.sourceTtf) workerKnownRefs.add(req.sourceRef);
  }
}

/** Full export with validation (runs in the worker). */
export async function exportFont(doc: FontDoc, options: ExportOptions): Promise<ExportOutcome> {
  const w = getWorker();
  if (w) {
    const reqId = seq++;
    const req: WorkerReq = { type: 'export', reqId, doc, options, sourceRef: doc.sourceRef };
    attachSource(req as { sourceRef: string | null; sourceTtf?: TtfLike | null });
    const resp = await new Promise<WorkerResp>((resolve) => {
      pending.set(reqId, resolve);
      w.postMessage(req);
      setTimeout(() => {
        if (pending.has(reqId)) {
          pending.delete(reqId);
          resolve({ reqId, ok: false, error: 'Export timed out.' });
        }
      }, 120_000);
    });
    if (!resp.ok || !resp.buffer || !resp.report) throw new Error(resp.error ?? 'Export failed.');
    return { buffer: resp.buffer, report: resp.report };
  }
  // main-thread fallback
  const { buffer, report } = buildTtf({ doc, sourceTtf: getSource(doc.sourceRef), options });
  return { buffer, report };
}

/** Fast preview build (no validation, no hinting/kerning). */
export async function buildPreviewFont(doc: FontDoc, familySuffix: string): Promise<ArrayBuffer> {
  const w = getWorker();
  if (w) {
    const reqId = seq++;
    const req: WorkerReq = { type: 'preview', reqId, doc, familySuffix, sourceRef: doc.sourceRef };
    attachSource(req as { sourceRef: string | null; sourceTtf?: TtfLike | null });
    const resp = await Promise.race<WorkerResp>([
      new Promise<WorkerResp>((resolve) => {
        pending.set(reqId, resolve);
        w.postMessage(req);
      }),
      new Promise<WorkerResp>((resolve) => setTimeout(() => resolve({ reqId, ok: false, error: 'timeout' }), 30_000)),
    ]);
    pending.delete(reqId);
    if (resp.ok && resp.buffer) return resp.buffer;
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
