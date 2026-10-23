/// <reference lib="webworker" />
import { CatalogBuilder, type BuildProgress } from '../catalog/build';
import type { Catalog, CatalogSource } from '../catalog/types';

/**
 * Builds the block catalog off the main thread. Jars are read one after the other so that at
 * most one is held in memory at a time.
 */

export interface CatalogJob {
  /** The Minecraft client jar (1.21.1.jar). */
  minecraft: File | null;
  /** German language file from the launcher's asset objects. */
  languageDe: File | null;
  mods: File[];
}

export type CatalogWorkerMessage =
  | { type: 'progress'; progress: BuildProgress }
  | { type: 'source'; source: CatalogSource }
  | { type: 'done'; catalog: Catalog; ms: number }
  | { type: 'error'; message: string };

export async function runCatalogJob(job: CatalogJob, post: (m: CatalogWorkerMessage) => void): Promise<void> {
  const t0 = performance.now();
  const builder = new CatalogBuilder();
  const jars = [...(job.minecraft ? [job.minecraft] : []), ...job.mods];
  let done = 0;
  for (const file of jars) {
    post({ type: 'progress', progress: { phase: 'jar', done, total: jars.length, label: file.name } });
    const bytes = new Uint8Array(await file.arrayBuffer());
    for (const source of builder.addJar(file.name, bytes)) post({ type: 'source', source });
    done++;
  }
  if (job.languageDe) builder.addLanguage('de_de', new Uint8Array(await job.languageDe.arrayBuffer()));
  const catalog = builder.build((progress) => post({ type: 'progress', progress }));
  post({ type: 'done', catalog, ms: performance.now() - t0 });
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
if (typeof scope.addEventListener === 'function' && typeof (globalThis as { document?: unknown }).document === 'undefined') {
  scope.addEventListener('message', (e: MessageEvent<CatalogJob>) => {
    runCatalogJob(e.data, (m) => scope.postMessage(m)).catch((err) => {
      scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies CatalogWorkerMessage);
    });
  });
}
