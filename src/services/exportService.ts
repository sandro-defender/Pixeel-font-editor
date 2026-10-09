/** Client for the font worker, with a main-thread fallback. */
import type { WorkerReq, WorkerResp } from '../workers/fontWorker';
import { buildTtf, type ExportOptions, type ExportReport, type TtfLike } from '../core/fontCodec';
import type { FontDoc } from '../core/types';
import { getSource } from '../core/sourceRegistry';

export interface ExportOutcome {
  buffer: ArrayBuffer;
  report: ExportReport;
}

let worker: Worker | null = null;
let workerFailed = false;
let seq = 1;
const pending = new Map<number, (resp: WorkerResp) => void>();
/** sourceRefs the worker already holds */
const workerKnownRefs = new Set<string>();

async function getWorker(): Promise<Worker | null> {
  if (worker || workerFailed) return worker;
  if (typeof Worker === 'undefined') {
    workerFailed = true;
    return null;
  }
  try {
    // Lazy import keeps the worker module out of non-browser test runs.
    const mod = await import('../workers/fontWorker?worker');
    const Ctor = mod.default;
    worker = new Ctor();
    worker.onmessage = (ev: MessageEvent<WorkerResp>) => {
      const cb = pending.get(ev.data.reqId);
      if (cb) {
        pending.delete(ev.data.reqId);
        cb(ev.data);
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      workerFailed = true;
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

function attachSource(req: { sourceRef: string | null; sourceTtf?: TtfLike | null }): void {
  if (req.sourceRef && !workerKnownRefs.has(req.sourceRef)) {
    req.sourceTtf = getSource(req.sourceRef);
    if (req.sourceTtf) workerKnownRefs.add(req.sourceRef);
  }
}

/** Full export with validation (runs in the worker when available). */
export async function exportFont(doc: FontDoc, options: ExportOptions): Promise<ExportOutcome> {
  const w = await getWorker();
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
  // main-thread fallback (tests, old browsers, worker errors)
  const { buffer, report } = buildTtf({ doc, sourceTtf: getSource(doc.sourceRef), options });
  return { buffer, report };
}

/** Fast preview build (no validation, no hinting/kerning). */
export async function buildPreviewFont(doc: FontDoc, familySuffix: string): Promise<ArrayBuffer> {
  const w = await getWorker();
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
