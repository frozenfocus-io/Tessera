import { backupText } from './planEdit';
import { batch } from '@preact/signals';
import { looksLikeTess } from '../core/formats/tess';
import { importFile, ImportError, type ImportResult } from '../core/importFile';
import type { Catalog } from '../catalog/types';
import { log } from '../debug/log';
import { folderStatus, readProjectFile } from '../platform/folder';
import type { BlockHints } from '../tess/palette';
import type { ParseRequest, ParseResponse } from '../workers/parseWorker';
import {
  deleteStoredProject,
  loadWorkspace,
  requestPersistentStorage,
  saveProjectSource,
  saveProjectState,
  saveWorkspace,
  type FileLink,
  type StoredProject,
} from './persistence';
import { Project, type PersistedState } from './project';
import { activeId, catalog, importing, projects, showToast } from './workspace';

let parseId = 1;

let hintsCache: { catalog: Catalog; hints: BlockHints } | null = null;

/** What the building language needs from the catalog: known block ids and families. */
export function hintsFor(c: Catalog | null): BlockHints | undefined {
  if (!c) return undefined;
  if (hintsCache?.catalog === c) return hintsCache.hints;
  const families: Record<string, Partial<Record<string, string>>> = {};
  for (const [base, f] of Object.entries(c.families)) {
    const m: Partial<Record<string, string>> = {};
    for (const role of ['stairs', 'slab', 'wall', 'fence', 'fence_gate', 'trapdoor', 'door', 'button', 'pressure_plate', 'pane', 'carpet'] as const) {
      if (f.members[role]) m[role] = f.members[role];
    }
    families[base] = m;
  }
  const hints: BlockHints = { known: Object.keys(c.blocks), families };
  hintsCache = { catalog: c, hints };
  return hints;
}

/** Parses a file in a Web Worker (falls back to the main thread if workers are unavailable). */
export function parseFile(fileName: string, bytes: Uint8Array): Promise<{ result: ImportResult; ms: number }> {
  const hints = looksLikeTess(bytes) ? hintsFor(catalog.value) : undefined;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/parseWorker.ts', import.meta.url), { type: 'module', name: 'parse' });
    } catch (e) {
      log.warn('import', 'Parse-Worker nicht verfügbar, lese im Hauptthread', e);
      try {
        const t0 = performance.now();
        resolve({ result: importFile(fileName, bytes, { hints }), ms: performance.now() - t0 });
      } catch (err) {
        reject(err);
      }
      return;
    }
    const id = parseId++;
    worker.onmessage = (ev: MessageEvent<ParseResponse>) => {
      worker.terminate();
      const msg = ev.data;
      if (msg.ok) resolve({ result: msg.result, ms: msg.ms });
      else {
        const err = msg.error.userFacing
          ? new ImportError(msg.error.message, msg.error.detail, msg.error.diagnostics)
          : new Error(msg.error.message);
        if (msg.error.stack) err.stack = msg.error.stack;
        reject(err);
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      log.warn('import', 'Parse-Worker abgestürzt, lese im Hauptthread', { message: ev.message });
      try {
        const t0 = performance.now();
        resolve({ result: importFile(fileName, bytes, { hints }), ms: performance.now() - t0 });
      } catch (err) {
        reject(err);
      }
    };
    // The worker gets a copy; the original bytes stay here for saving and the debug package.
    const req: ParseRequest = { id, fileName, bytes, hints };
    worker.postMessage(req);
  });
}

function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) : fileName;
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function storedOf(p: Project): StoredProject {
  return { id: p.id, name: p.name, fileName: p.fileName, createdAt: p.createdAt, updatedAt: Date.now(), state: p.persisted(), link: p.link.value };
}

/** Saves the project's view state shortly after the last change. */
export function scheduleSave(p: Project): void {
  clearTimeout(saveTimers.get(p.id));
  saveTimers.set(
    p.id,
    setTimeout(() => {
      saveTimers.delete(p.id);
      // A version opened read-only is not kept across restarts.
      if (projects.value.includes(p) && !p.readOnly) void saveProjectState(storedOf(p));
    }, 400),
  );
}

/** Becomes true once the previous session's tabs are restored; before that nothing is overwritten. */
let workspaceRestored = false;

export function persistWorkspace(): void {
  if (!workspaceRestored) return;
  void saveWorkspace(
    projects.value.filter((p) => !p.readOnly).map((p) => p.id),
    activeId.value,
  );
}

export interface OpenOptions {
  id?: string;
  name?: string;
  createdAt?: number;
  state?: Partial<PersistedState>;
  activate?: boolean;
  persist?: boolean;
  /** The .tess file in the project folder the tab belongs to. */
  link?: FileLink | null;
  /** A version opened from the version store: nothing can be edited or saved. */
  readOnly?: boolean;
}

/** Reads one file into a new project and opens it in a new tab (never replaces an open tab). */
export async function openBytes(fileName: string, bytes: Uint8Array, opts: OpenOptions = {}): Promise<Project | null> {
  importing.value = [...importing.value, { fileName }];
  log.info('import', `Lese ${fileName}`, { bytes: bytes.length });
  try {
    const { result, ms } = await parseFile(fileName, bytes);
    const project = new Project({
      id: opts.id,
      name: opts.name ?? baseName(fileName),
      fileName,
      createdAt: opts.createdAt,
      source: bytes,
      data: result,
      catalog: catalog.value,
      readOnly: opts.readOnly,
    });
    if (opts.state) project.restore(opts.state);
    if (opts.link) project.link.value = opts.link;
    log.info('import', `${fileName} gelesen`, {
      format: result.formatLabel,
      minecraft: result.minecraftVersion,
      size: [result.volume.sizeX, result.volume.sizeY, result.volume.sizeZ],
      blocks: result.analysis.nonAir,
      palette: result.volume.palette.length,
      unknown: project.unknownBlocks.length,
      ms: Math.round(ms),
      timings: result.timings,
    });
    for (const w of result.info.warnings) log.warn('import', `${fileName}: ${w}`);
    if (result.info.renames.length) log.info('import', `${fileName}: ${result.info.renames.length} Blockzustände umbenannt`, result.info.renames.slice(0, 20));
    batch(() => {
      projects.value = [...projects.value, project];
      if (opts.activate !== false) activeId.value = project.id;
    });
    if (opts.persist !== false) {
      await saveProjectSource(project.id, bytes);
      await saveProjectState(storedOf(project));
      persistWorkspace();
      void requestPersistentStorage();
    }
    return project;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Building plans: the line-numbered messages are what the person (or Claude) needs.
    const lines = e instanceof ImportError && e.diagnostics ? e.detail : undefined;
    log.error('import', `${fileName} konnte nicht geöffnet werden: ${message}`, lines ?? e);
    showToast('error', `${fileName} konnte nicht geöffnet werden.`, lines ? `${message}\n${lines}` : message, lines ? 20000 : undefined);
    return null;
  } finally {
    importing.value = importing.value.filter((f) => f.fileName !== fileName);
  }
}

export async function openFiles(files: Iterable<File>): Promise<void> {
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await openBytes(file.name, bytes, { link: await sameFileInFolder(file.name, bytes) });
    } catch (e) {
      log.error('import', `${file.name} konnte nicht gelesen werden`, e);
      showToast('error', `${file.name} konnte nicht gelesen werden.`);
    }
  }
}

/** A plan opened from elsewhere that is byte for byte the file in the project folder gets linked to it. */
async function sameFileInFolder(name: string, bytes: Uint8Array): Promise<FileLink | null> {
  if (folderStatus.value !== 'ready' || !looksLikeTess(bytes)) return null;
  try {
    const file = await readProjectFile(name);
    if (!file || file.bytes.length !== bytes.length || !file.bytes.every((b, i) => b === bytes[i])) return null;
    return { name, ...file.stamp };
  } catch {
    return null;
  }
}

const UNDO_MS = 10_000;

/** Closes a tab. Its saved state is kept for a few seconds so the close can be undone. */
export function closeProject(id: string): void {
  const list = projects.value;
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const p = list[idx];
  p.scene?.dispose();
  p.scene = null;
  p.hover.value = null;
  clearTimeout(saveTimers.get(id));
  batch(() => {
    projects.value = list.filter((x) => x.id !== id);
    if (activeId.value === id) {
      const next = projects.value[Math.min(idx, projects.value.length - 1)];
      activeId.value = next?.id ?? null;
    }
  });
  log.info('workspace', `Tab geschlossen: ${p.name}`);
  persistWorkspace();
  const timer = setTimeout(() => void deleteStoredProject(id), UNDO_MS);
  showToast('info', `„${p.name}“ geschlossen.`, p.done.value.size ? 'Der Baufortschritt wird mit dem Tab entfernt.' : undefined, UNDO_MS, {
    label: 'Wiederherstellen',
    run: () => {
      clearTimeout(timer);
      if (projects.value.includes(p)) return;
      const next = [...projects.value];
      next.splice(Math.min(idx, next.length), 0, p);
      batch(() => {
        projects.value = next;
        activeId.value = p.id;
      });
      void saveProjectState(storedOf(p));
      persistWorkspace();
      log.info('workspace', `Tab wiederhergestellt: ${p.name}`);
    },
  });
}

/** Re-opens the tabs of the last session. */
export async function restoreWorkspace(): Promise<void> {
  try {
    await restoreTabs();
  } finally {
    workspaceRestored = true;
    persistWorkspace();
  }
}

async function restoreTabs(): Promise<void> {
  const { projects: stored, activeId: lastActive } = await loadWorkspace();
  if (stored.length === 0) return;
  log.info('workspace', `Stelle ${stored.length} Projekt(e) wieder her`);
  for (const { stored: s, source } of stored) {
    // A building plan in the project folder is read from there: it may have changed meanwhile.
    let bytes = source;
    let link = s.link ?? null;
    let fromFolder = false;
    if (link && folderStatus.value === 'ready') {
      try {
        const file = await readProjectFile(link.name);
        if (file) {
          fromFolder = file.stamp.lastModified !== link.lastModified || file.stamp.size !== link.size;
          // Changed outside while Tessera was closed: keep the last text the tab showed as a version.
          if (fromFolder) await backupText(link, s.id, source);
          bytes = file.bytes;
          link = { name: link.name, ...file.stamp };
        }
      } catch (e) {
        log.warn('folder', `${link.name} konnte nicht aus dem Projektordner gelesen werden`, e);
      }
    }
    const p = await openBytes(s.fileName, bytes, {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      state: s.state,
      activate: false,
      persist: fromFolder,
      link,
    });
    // The changed file did not build: show the last good copy and keep the problem visible.
    if (!p && fromFolder) {
      const fallback = await openBytes(s.fileName, source, { id: s.id, name: s.name, createdAt: s.createdAt, state: s.state, activate: false, persist: false, link: s.link });
      if (fallback && link) fallback.fileIssue.value = { message: 'Die geänderte Datei ließ sich nicht übersetzen.', stamp: link };
    }
  }
  const ids = projects.value.map((p) => p.id);
  activeId.value = lastActive && ids.includes(lastActive) ? lastActive : (ids[0] ?? null);
}
