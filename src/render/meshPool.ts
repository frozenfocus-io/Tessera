import type { RenderTable } from '../blocks/blockModel';
import { log } from '../debug/log';
import type { MeshWorkerRequest, MeshWorkerResponse } from '../workers/meshWorker';
import { meshChunk, prepareTables, type ChunkInput, type ChunkMeshResult, type MeshTables } from './mesher';

export interface MeshJobResult {
  result: ChunkMeshResult;
  ms: number;
}

interface Job {
  jobId: number;
  projectId: string;
  input: ChunkInput;
  resolve: (r: MeshJobResult) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  dead: boolean;
  projects: Set<string>;
  current?: Job;
}

export class CancelledError extends Error {
  constructor() {
    super('abgebrochen');
    this.name = 'CancelledError';
  }
}

function defaultSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(4, cores - 1));
}

/**
 * Pool of mesh workers. Falls back to meshing on the main thread (in small slices) when Web
 * Workers are unavailable, e.g. when the page is opened from a restricted context.
 */
export class MeshPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private tables = new Map<string, RenderTable>();
  private mainTables = new Map<string, MeshTables>();
  private nextId = 1;
  private mainScheduled = false;
  mode: 'workers' | 'main-thread' = 'workers';

  constructor(size = defaultSize()) {
    try {
      for (let i = 0; i < size; i++) {
        const worker = new Worker(new URL('../workers/meshWorker.ts', import.meta.url), { type: 'module', name: `mesh-${i}` });
        const slot: Slot = { worker, busy: false, dead: false, projects: new Set() };
        worker.onmessage = (ev: MessageEvent<MeshWorkerResponse>) => this.onMessage(slot, ev.data);
        worker.onerror = (ev) => this.onWorkerError(slot, ev);
        this.slots.push(slot);
      }
    } catch (e) {
      log.warn('mesh', 'Web Worker nicht verfügbar – Meshing läuft im Hauptthread.', e);
      this.mode = 'main-thread';
    }
    if (this.slots.length === 0) this.mode = 'main-thread';
    log.info('mesh', `Mesh-Pool bereit: ${this.mode === 'workers' ? `${this.slots.length} Worker` : 'Hauptthread'}`);
  }

  get workerCount(): number {
    return this.slots.filter((s) => !s.dead).length;
  }

  setTables(projectId: string, table: RenderTable): void {
    this.tables.set(projectId, table);
    this.mainTables.delete(projectId);
    for (const s of this.slots) s.projects.delete(projectId);
  }

  /** Forgets a project and cancels its queued jobs. */
  drop(projectId: string): void {
    this.tables.delete(projectId);
    this.mainTables.delete(projectId);
    for (const s of this.slots) {
      if (s.projects.delete(projectId) && !s.dead) {
        const msg: MeshWorkerRequest = { type: 'drop', projectId };
        s.worker.postMessage(msg);
      }
    }
    const keep: Job[] = [];
    for (const j of this.queue) {
      if (j.projectId === projectId) j.reject(new CancelledError());
      else keep.push(j);
    }
    this.queue = keep;
  }

  mesh(projectId: string, input: ChunkInput): Promise<MeshJobResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ jobId: this.nextId++, projectId, input, resolve, reject });
      this.pump();
    });
  }

  get pending(): number {
    return this.queue.length + this.slots.filter((s) => s.busy).length;
  }

  private pump(): void {
    if (this.mode === 'main-thread') {
      this.scheduleMain();
      return;
    }
    for (const slot of this.slots) {
      if (slot.dead || slot.busy) continue;
      const job = this.queue.shift();
      if (!job) break;
      this.assign(slot, job);
    }
  }

  private assign(slot: Slot, job: Job): void {
    const table = this.tables.get(job.projectId);
    if (!table) {
      job.reject(new CancelledError());
      return;
    }
    if (!slot.projects.has(job.projectId)) {
      const msg: MeshWorkerRequest = { type: 'tables', projectId: job.projectId, table };
      slot.worker.postMessage(msg);
      slot.projects.add(job.projectId);
    }
    slot.busy = true;
    slot.current = job;
    const msg: MeshWorkerRequest = { type: 'mesh', jobId: job.jobId, projectId: job.projectId, input: job.input };
    slot.worker.postMessage(msg, [job.input.data.buffer]);
  }

  private onMessage(slot: Slot, msg: MeshWorkerResponse): void {
    const job = slot.current;
    slot.busy = false;
    slot.current = undefined;
    if (job && job.jobId === msg.jobId) {
      if (msg.type === 'meshed') job.resolve({ result: msg.result, ms: msg.ms });
      else job.reject(new Error(msg.message));
    }
    this.pump();
  }

  private onWorkerError(slot: Slot, ev: ErrorEvent): void {
    log.error('mesh', 'Mesh-Worker ist abgestürzt oder konnte nicht starten.', { message: ev.message, file: ev.filename, line: ev.lineno });
    slot.dead = true;
    slot.busy = false;
    const job = slot.current;
    slot.current = undefined;
    try {
      slot.worker.terminate();
    } catch {
      /* ignore */
    }
    if (this.slots.every((s) => s.dead)) {
      this.mode = 'main-thread';
      log.warn('mesh', 'Alle Mesh-Worker ausgefallen – Meshing läuft im Hauptthread weiter.');
    }
    // The job's data buffer was transferred and is lost; the caller re-extracts on failure.
    if (job) job.reject(new Error('Worker-Fehler'));
    this.pump();
  }

  private scheduleMain(): void {
    if (this.mainScheduled || this.queue.length === 0) return;
    this.mainScheduled = true;
    setTimeout(() => {
      this.mainScheduled = false;
      const deadline = performance.now() + 12;
      while (this.queue.length && performance.now() < deadline) {
        const job = this.queue.shift()!;
        const table = this.tables.get(job.projectId);
        if (!table) {
          job.reject(new CancelledError());
          continue;
        }
        let t = this.mainTables.get(job.projectId);
        if (!t) {
          t = prepareTables(table);
          this.mainTables.set(job.projectId, t);
        }
        try {
          const t0 = performance.now();
          const result = meshChunk(t, job.input);
          job.resolve({ result, ms: performance.now() - t0 });
        } catch (e) {
          job.reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
      this.scheduleMain();
    }, 0);
  }

  dispose(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
  }
}
