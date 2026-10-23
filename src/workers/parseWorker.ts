/// <reference lib="webworker" />
import { importFile, ImportError, type ImportResult } from '../core/importFile';

export interface ParseRequest {
  id: number;
  fileName: string;
  bytes: Uint8Array;
}

export type ParseResponse =
  | { id: number; ok: true; result: ImportResult; ms: number }
  | { id: number; ok: false; error: { message: string; detail?: string; stack?: string; userFacing: boolean } };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const { id, fileName, bytes } = ev.data;
  const t0 = performance.now();
  try {
    const result = importFile(fileName, bytes);
    const transfer: Transferable[] = [
      result.volume.data.buffer,
      result.analysis.layerCounts.buffer,
      result.analysis.layerHist.offsets.buffer,
      result.analysis.layerHist.pairs.buffer,
      result.analysis.paletteTotals.buffer,
    ];
    const msg: ParseResponse = { id, ok: true, result, ms: performance.now() - t0 };
    ctx.postMessage(msg, transfer);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const msg: ParseResponse = {
      id,
      ok: false,
      error: {
        message: err.message,
        detail: e instanceof ImportError ? e.detail : undefined,
        stack: err.stack,
        userFacing: e instanceof ImportError,
      },
    };
    ctx.postMessage(msg);
  }
};
