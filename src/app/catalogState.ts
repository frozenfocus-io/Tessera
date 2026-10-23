import { hostedExtras } from '../platform/examples';
import { batch } from '@preact/signals';
import { deleteStoredCatalog, loadStoredCatalog, storeCatalog } from '../catalog/store';
import { CATALOG_FORMAT, type Catalog } from '../catalog/types';
import { log } from '../debug/log';
import { recompilePlans } from './planFiles';
import { Project } from './project';
import { getViewer, releaseProject } from './viewController';
import { activeId, catalog, catalogOrigin, projects, showToast } from './workspace';

function usable(c: unknown): c is Catalog {
  return !!c && typeof c === 'object' && (c as Catalog).format === CATALOG_FORMAT && typeof (c as Catalog).blocks === 'object';
}

/** At startup: the stored catalog, else a test catalog shipped next to the app (katalog.json). */
export async function loadCatalogAtStartup(): Promise<void> {
  const stored = await loadStoredCatalog();
  if (usable(stored)) {
    catalog.value = stored;
    catalogOrigin.value = 'imported';
    log.info('catalog', 'Katalog geladen', summary(stored));
    return;
  }
  if (!hostedExtras()) return;
  try {
    const res = await fetch('katalog.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const text = await res.text();
    if (text.trimStart().startsWith('<')) return;
    const c = JSON.parse(text) as unknown;
    if (usable(c)) {
      catalog.value = c;
      catalogOrigin.value = 'bundled';
      log.info('catalog', 'Test-Katalog geladen', summary(c));
    }
  } catch {
    // No bundled catalog: the normal case.
  }
}

export function summary(c: Catalog): Record<string, unknown> {
  return {
    minecraft: c.minecraft,
    createdAt: c.createdAt,
    sources: c.sources.length,
    blocks: Object.keys(c.blocks).length,
    recipes: c.recipes.length,
    families: Object.keys(c.families).length,
  };
}

/** Uses a freshly read catalog: stores it and rebuilds all open projects with it. */
export async function useCatalog(c: Catalog): Promise<boolean> {
  const saved = await storeCatalog(c);
  catalog.value = c;
  catalogOrigin.value = 'imported';
  rebuildProjects();
  log.info('catalog', 'Neuer Katalog', summary(c));
  if (!saved) showToast('error', 'Der Katalog ist aktiv, ließ sich aber nicht dauerhaft speichern.', 'Nach dem Neuladen muss er erneut eingelesen werden.');
  return saved;
}

export async function removeCatalog(): Promise<void> {
  await deleteStoredCatalog();
  catalog.value = null;
  catalogOrigin.value = 'none';
  rebuildProjects();
  log.info('catalog', 'Katalog entfernt');
}

/** Rebuilds every open project with the current catalog, keeping its view and progress. */
export function rebuildProjects(): void {
  const viewer = getViewer();
  const list = projects.value.map((p) => {
    const state = p.persisted();
    if (p.id === activeId.value && viewer) state.camera = viewer.getCameraState();
    releaseProject(p);
    const fresh = new Project({ id: p.id, name: p.name, fileName: p.fileName, createdAt: p.createdAt, source: p.source, data: p.data, catalog: catalog.value });
    fresh.restore(state);
    fresh.camera = state.camera;
    fresh.link.value = p.link.value;
    fresh.fileIssue.value = p.fileIssue.value;
    fresh.fileMissing.value = p.fileMissing.value;
    return fresh;
  });
  batch(() => {
    const active = activeId.value;
    activeId.value = null;
    projects.value = list;
    activeId.value = active;
  });
  // Building plans pick their stairs and slabs from the catalog: build them again.
  void recompilePlans();
}
