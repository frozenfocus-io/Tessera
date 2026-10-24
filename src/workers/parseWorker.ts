/// <reference lib="webworker" />
import { importFile, ImportError, type ImportResult } from '../core/importFile';
import type { BlockHints } from '../tess/palette';
import type { Diagnostic } from '../tess/syntax';

export interface ParseRequest {
  id: number;
  fileName: string;
  bytes: Uint8Array;
  /** Catalog knowledge for building plans. */
  hints?: BlockHints;
}

export type ParseResponse =
  | { id: number; ok: true; result: ImportResult; ms: number }
  | {
      id: number;
      ok: false;
      error: { message: string; detail?: string; stack?: string; userFacing: boolean; diagnostics?: Diagnostic[] };
    };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const { id, fileName, bytes, hints } = ev.data;
  const t0 = performance.now();
  try {
    const result = importFile(fileName, bytes, { hints });
    const transfer: Transferable[] = [
      result.volume.data.buffer,
      result.analysis.layerCounts.buffer,
      result.analysis.layerHist.offsets.buffer,
      result.analysis.layerHist.pairs.buffer,
      result.analysis.paletteTotals.buffer,
    ];
    if (result.origins) transfer.push(result.origins.ids.buffer);
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
        diagnostics: e instanceof ImportError ? e.diagnostics : undefined,
      },
    };
    ctx.postMessage(msg);
  }
};
