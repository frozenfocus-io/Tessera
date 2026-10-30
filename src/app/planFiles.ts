import { batch, effect } from '@preact/signals';
import { ImportError } from '../core/importFile';
import { log } from '../debug/log';
import {
  ensureFolder,
  fileStamp,
  folderStatus,
  readProjectFile,
  refreshFolder,
  tessFileName,
  writeProjectFile,
  type FileStamp,
} from '../platform/folder';
import { saveFile } from '../platform/save';
import { openBytes, parseFile, persistWorkspace, storedOf } from './importer';
import { saveProjectSource, saveProjectState, type FileLink } from './persistence';
import { keepVersion, selfWrites } from './planEdit';
import { Project } from './project';
import { getViewer, releaseProject } from './viewController';
import { activeId, catalog, projects, showToast } from './workspace';

/**
 * Building plans in the project folder. A tab opened from the folder (or saved into it) stays
 * linked to its .tess file: when the file changes on disk – edited by hand or replaced by a new
 * version from Claude – the tab rebuilds itself and keeps camera, layer and progress. If the new
 * version has errors, the tab keeps the last good build and shows the messages.
 */

const same = (a: FileStamp, b: FileStamp): boolean => a.size === b.size && a.lastModified === b.lastModified;

/** Swaps a project for a freshly built one in the same tab, keeping its view and progress. */
export function replaceProject(p: Project, bytes: Uint8Array, data: Project['data'], link: FileLink | null): Project {
  const state = p.persisted();
  const viewer = getViewer();
  if (p.id === activeId.value && viewer) state.camera = viewer.getCameraState();
  releaseProject(p);
  const fresh = new Project({ id: p.id, name: p.name, fileName: p.fileName, createdAt: p.createdAt, source: bytes, data, catalog: catalog.value });
  fresh.restore(state);
  fresh.camera = state.camera ?? p.camera;
  fresh.link.value = link;
  batch(() => {
    const active = activeId.value;
    projects.value = projects.value.map((x) => (x === p ? fresh : x));
    activeId.value = active;
  });
  void saveProjectSource(fresh.id, bytes);
  void saveProjectState(storedOf(fresh));
  return fresh;
}

/** Builds a plan from new bytes. On errors the tab keeps its last good build. */
async function rebuild(p: Project, bytes: Uint8Array, link: FileLink | null, reason: string): Promise<Project | null> {
  try {
    const { result } = await parseFile(p.fileName, bytes);
    if (!projects.value.includes(p)) return null;
    const fresh = replaceProject(p, bytes, result, link);
    log.info('plan', `${p.name}: ${reason}`, { blocks: result.analysis.nonAir, warnings: result.info.warnings.length });
    return fresh;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const detail = e instanceof ImportError ? e.detail : undefined;
    log.error('plan', `${p.name}: ${message}`, detail ?? e);
    if (link) p.fileIssue.value = { message, detail, stamp: link };
    showToast('error', `„${p.name}“: ${message}`, detail ? `${detail}\n\nDer Tab zeigt weiter die letzte fehlerfreie Fassung.` : undefined, 12000);
    return null;
  }
}

/** Opens a plan from the project folder, or switches to its tab if it is open already. */
export async function openFromFolder(name: string): Promise<void> {
  const open = projects.value.find((p) => p.link.value?.name === name);
  if (open) {
    activeId.value = open.id;
    return;
  }
  try {
    const file = await readProjectFile(name);
    if (!file) {
      showToast('error', `„${name}“ ist nicht mehr im Projektordner.`);
      void refreshFolder();
      return;
    }
    await openBytes(name, file.bytes, { link: { name, ...file.stamp } });
  } catch (e) {
    log.error('folder', `${name} konnte nicht gelesen werden`, e);
    showToast('error', `„${name}“ konnte nicht gelesen werden.`);
  }
}

/** Saves a plan into the project folder and links the tab to the file. */
export async function saveToFolder(p: Project): Promise<void> {
  if (!p.isPlan || p.readOnly) return;
  const name = p.link.value?.name ?? tessFileName(p.fileName);
  if (folderStatus.value === 'unsupported') {
    const outcome = await saveFile(new Blob([p.source as BlobPart], { type: 'text/plain' }), name);
    if (outcome === 'saved') showToast('info', `${name} wurde heruntergeladen.`, 'Für einen Projektordner braucht der Browser die File System Access API (siehe README).');
    return;
  }
  if (!(await ensureFolder())) return;
  try {
    if (!p.link.value) {
      const existing = await fileStamp(name);
      if (existing && !window.confirm(`„${name}“ gibt es im Projektordner schon. Überschreiben?`)) return;
    }
    const stamp = await writeProjectFile(name, p.source);
    p.link.value = { name, ...stamp };
    p.fileMissing.value = false;
    p.fileIssue.value = null;
    void saveProjectState(storedOf(p));
    persistWorkspace();
    log.info('folder', `Gespeichert: ${name}`);
    showToast('success', `Gespeichert: projekte/${name}`, 'Änderungen an der Datei übernimmt Tessera ab jetzt von selbst.');
  } catch (e) {
    log.error('folder', `${name} konnte nicht gespeichert werden`, e);
    showToast('error', `„${name}“ konnte nicht gespeichert werden.`, e instanceof Error ? e.message : undefined);
  }
}

let checking = false;

/** Compares linked files with what the tabs show and rebuilds the changed ones. */
export async function checkLinkedFiles(): Promise<void> {
  if (checking || folderStatus.value !== 'ready') return;
  checking = true;
  try {
    for (const p of projects.value) {
      const link = p.link.value;
      if (!link || selfWrites.has(link.name)) continue;
      let stamp: FileStamp | null;
      try {
        stamp = await fileStamp(link.name);
      } catch {
        continue;
      }
      if (!stamp) {
        if (!p.fileMissing.value) {
          p.fileMissing.value = true;
          log.warn('folder', `${link.name} fehlt im Projektordner`);
          showToast('info', `„${link.name}“ fehlt im Projektordner.`, 'Der Tab zeigt die letzte Fassung. „Im Projektordner speichern“ legt die Datei neu an.');
        }
        continue;
      }
      p.fileMissing.value = false;
      if (same(stamp, link)) continue;
      const issue = p.fileIssue.value;
      if (issue && same(issue.stamp, stamp)) continue;
      const file = await readProjectFile(link.name);
      // Written by Tessera meanwhile, or the tab was rebuilt meanwhile: not a change from outside.
      if (!file || selfWrites.has(link.name) || !projects.value.includes(p) || p.link.value !== link) continue;
      // Before a change from outside is taken over, the text the tab shows is kept as a version.
      await keepVersion(p);
      const fresh = await rebuild(p, file.bytes, { name: link.name, ...file.stamp }, 'Datei geändert, neu aufgebaut');
      if (fresh) showToast('success', `„${p.name}“ neu geladen.`, fresh.data.info.warnings.length ? `${fresh.data.info.warnings.length} Hinweis(e) im Projekt.` : undefined);
    }
  } finally {
    checking = false;
  }
}

/** Builds every open plan again (after a new catalog: families and known blocks may differ). */
export async function recompilePlans(): Promise<void> {
  for (const p of projects.value) if (p.isPlan) await rebuild(p, p.source, p.link.value, 'mit neuem Katalog neu aufgebaut');
}

/** Watches linked files: every 1.5 s while the page is visible, and when the window gets focus. */
export function startFileWatch(): () => void {
  const tick = () => {
    if (document.visibilityState === 'visible') void checkLinkedFiles();
  };
  const timer = setInterval(tick, 1500);
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', tick);
  const stopReady = effect(() => {
    if (folderStatus.value === 'ready') tick();
  });
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', tick);
    document.removeEventListener('visibilitychange', tick);
    stopReady();
  };
}
