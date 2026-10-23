import { signal } from '@preact/signals';
import type { BuildProgress } from '../catalog/build';
import type { Catalog, CatalogSource } from '../catalog/types';
import { log } from '../debug/log';
import type { CatalogJob, CatalogWorkerMessage } from '../workers/catalogWorker';
import { summary, useCatalog } from './catalogState';
import { showToast } from './workspace';

/** State of a running "Modpack einlesen". */
export interface ImportRun {
  progress: BuildProgress | null;
  sources: CatalogSource[];
  error: string | null;
  done: { ms: number; catalog: Catalog } | null;
}

export const catalogRun = signal<ImportRun | null>(null);

export async function importCatalog(job: CatalogJob): Promise<void> {
  if (catalogRun.value && !catalogRun.value.done && !catalogRun.value.error) return;
  catalogRun.value = { progress: null, sources: [], error: null, done: null };
  log.info('catalog', 'Modpack einlesen', { minecraft: job.minecraft?.name ?? null, languageDe: !!job.languageDe, mods: job.mods.length });

  const onMessage = (m: CatalogWorkerMessage) => {
    const run = catalogRun.value;
    if (!run) return;
    if (m.type === 'progress') catalogRun.value = { ...run, progress: m.progress };
    else if (m.type === 'source') {
      catalogRun.value = { ...run, sources: [...run.sources, m.source] };
      for (const w of m.source.warnings.slice(0, 3)) log.warn('catalog', `${m.source.file}: ${w}`);
    } else if (m.type === 'error') {
      catalogRun.value = { ...run, error: m.message };
      log.error('catalog', `Einlesen fehlgeschlagen: ${m.message}`);
    } else if (m.type === 'done') {
      // "Fertig" only once the catalog is stored: closing the tab earlier would lose it.
      catalogRun.value = { ...run, progress: { phase: 'done', done: 0, total: 1 } };
      log.info('catalog', `Eingelesen in ${Math.round(m.ms)} ms`, summary(m.catalog));
      void useCatalog(m.catalog).then(() => {
        const now = catalogRun.value;
        if (now) catalogRun.value = { ...now, done: { ms: m.ms, catalog: m.catalog } };
        showToast('success', 'Katalog eingelesen. Alle offenen Projekte nutzen ihn jetzt.');
      });
    }
  };

  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../workers/catalogWorker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    log.warn('catalog', 'Kein Web Worker, lese im Hauptthread', e);
  }
  if (worker) {
    const w = worker;
    await new Promise<void>((resolve) => {
      w.onmessage = (e: MessageEvent<CatalogWorkerMessage>) => {
        onMessage(e.data);
        if (e.data.type === 'done' || e.data.type === 'error') {
          w.terminate();
          resolve();
        }
      };
      w.onerror = (e) => {
        onMessage({ type: 'error', message: e.message || 'Fehler im Worker' });
        w.terminate();
        resolve();
      };
      w.postMessage(job);
    });
    return;
  }
  try {
    const { runCatalogJob } = await import('../workers/catalogWorker');
    await runCatalogJob(job, onMessage);
  } catch (e) {
    onMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

export function resetCatalogRun(): void {
  const run = catalogRun.value;
  if (run && !run.done && !run.error) return;
  catalogRun.value = null;
}
