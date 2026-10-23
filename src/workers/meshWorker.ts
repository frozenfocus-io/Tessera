/// <reference lib="webworker" />
import type { RenderTable } from '../blocks/blockModel';
import { meshChunk, prepareTables, type ChunkInput, type ChunkMeshResult, type MeshBuffers, type MeshTables } from '../render/mesher';

export type MeshWorkerRequest =
  | { type: 'tables'; projectId: string; table: RenderTable }
  | { type: 'drop'; projectId: string }
  | { type: 'mesh'; jobId: number; projectId: string; input: ChunkInput };

export type MeshWorkerResponse =
  | { type: 'meshed'; jobId: number; result: ChunkMeshResult; ms: number }
  | { type: 'error'; jobId: number; message: string; stack?: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
// Tables are kept per project: projects never share state.
const tables = new Map<string, MeshTables>();

function buffersOf(b: MeshBuffers | null): Transferable[] {
  return b ? [b.positions.buffer, b.colorFace.buffer, b.layerType.buffer, b.indices.buffer] : [];
}

ctx.onmessage = (ev: MessageEvent<MeshWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'tables') {
    tables.set(msg.projectId, prepareTables(msg.table));
    return;
  }
  if (msg.type === 'drop') {
    tables.delete(msg.projectId);
    return;
  }
  const t = tables.get(msg.projectId);
  if (!t) {
    const out: MeshWorkerResponse = { type: 'error', jobId: msg.jobId, message: `Keine Blocktabelle für Projekt ${msg.projectId}` };
    ctx.postMessage(out);
    return;
  }
  try {
    const t0 = performance.now();
    const result = meshChunk(t, msg.input);
    const out: MeshWorkerResponse = { type: 'meshed', jobId: msg.jobId, result, ms: performance.now() - t0 };
    ctx.postMessage(out, [...buffersOf(result.opaque), ...buffersOf(result.translucent)]);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const out: MeshWorkerResponse = { type: 'error', jobId: msg.jobId, message: err.message, stack: err.stack };
    ctx.postMessage(out);
  }
};
