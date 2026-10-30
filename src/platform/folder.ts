import { signal } from '@preact/signals';
import { log } from '../debug/log';
import { loadFolderHandle, saveFolderHandle } from '../app/persistence';
import type { VersionBackend } from '../app/editCore';

/**
 * The project folder on disk (File System Access API). The person picks a folder once, e.g.
 * "Tessera"; building plans live in its sub-folder "projekte" as .tess files. The browser keeps
 * the folder handle (in IndexedDB); after a restart it usually asks once more for permission,
 * which needs a click (Brave and Chrome do not grant it silently).
 *
 * Brave ships with the API switched off: brave://flags → "File System Access API" → Enabled.
 * Without the API Tessera still opens .tess files and saves them as downloads.
 */

export type FolderStatus = 'unsupported' | 'none' | 'needs-permission' | 'ready';

export interface FolderFile {
  name: string;
  size: number;
  lastModified: number;
}

/** Name and modification stamp of a file, to notice changes made outside Tessera. */
export interface FileStamp {
  size: number;
  lastModified: number;
}

export const PROJECT_DIR = 'projekte';
export const TESS_EXT = '.tess';

// Parts of the API that TypeScript's DOM types do not include (yet).
type PermissionMode = { mode: 'read' | 'readwrite' };
interface PermissionHandle {
  queryPermission(d: PermissionMode): Promise<PermissionState>;
  requestPermission(d: PermissionMode): Promise<PermissionState>;
}
interface DirectoryPickerWindow {
  showDirectoryPicker(opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>;
}
type IterableDirectory = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

export function folderApiAvailable(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export const folderStatus = signal<FolderStatus>(folderApiAvailable() ? 'none' : 'unsupported');
export const folderName = signal<string | null>(null);
/** .tess files in the project folder, newest first. */
export const folderFiles = signal<FolderFile[]>([]);

let root: FileSystemDirectoryHandle | null = null;
let projectsDir: FileSystemDirectoryHandle | null = null;

async function permission(handle: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const h = handle as unknown as PermissionHandle;
  const d: PermissionMode = { mode: 'readwrite' };
  if ((await h.queryPermission(d)) === 'granted') return true;
  if (!ask) return false;
  return (await h.requestPermission(d)) === 'granted';
}

async function open(handle: FileSystemDirectoryHandle): Promise<void> {
  root = handle;
  projectsDir = await handle.getDirectoryHandle(PROJECT_DIR, { create: true });
  folderName.value = handle.name;
  folderStatus.value = 'ready';
  await refreshFolder();
}

/** At startup: the folder chosen earlier, if the browser still knows it. Never asks. */
export async function restoreFolder(): Promise<void> {
  if (!folderApiAvailable()) return;
  try {
    const handle = await loadFolderHandle();
    if (!handle) return;
    root = handle;
    folderName.value = handle.name;
    if (await permission(handle, false)) await open(handle);
    else folderStatus.value = 'needs-permission';
  } catch (e) {
    log.warn('folder', 'Projektordner konnte nicht wiederhergestellt werden', e);
  }
}

/** Lets the person pick the folder (must run from a click). */
export async function chooseFolder(): Promise<boolean> {
  if (!folderApiAvailable()) return false;
  try {
    const handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({ id: 'tessera', mode: 'readwrite' });
    if (!(await permission(handle, true))) return false;
    await saveFolderHandle(handle);
    await open(handle);
    log.info('folder', `Projektordner gewählt: ${handle.name}`);
    return true;
  } catch (e) {
    if ((e as { name?: string } | null)?.name !== 'AbortError') log.warn('folder', 'Projektordner konnte nicht gewählt werden', e);
    return false;
  }
}

/** Asks again for access to the folder chosen earlier (must run from a click). */
export async function grantAccess(): Promise<boolean> {
  if (!root) return chooseFolder();
  try {
    if (!(await permission(root, true))) return false;
    await open(root);
    log.info('folder', `Zugriff auf Projektordner erteilt: ${root.name}`);
    return true;
  } catch (e) {
    log.warn('folder', 'Zugriff auf den Projektordner wurde nicht erteilt', e);
    return false;
  }
}

/** Makes sure the folder is usable, asking the person if needed (from a click). */
export async function ensureFolder(): Promise<boolean> {
  if (folderStatus.value === 'ready') return true;
  if (folderStatus.value === 'needs-permission') return grantAccess();
  if (folderStatus.value === 'none') return chooseFolder();
  return false;
}

export async function refreshFolder(): Promise<void> {
  if (!projectsDir) return;
  const list: FolderFile[] = [];
  try {
    for await (const entry of (projectsDir as IterableDirectory).values()) {
      if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith(TESS_EXT)) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      list.push({ name: entry.name, size: file.size, lastModified: file.lastModified });
    }
  } catch (e) {
    lost(e);
    return;
  }
  list.sort((a, b) => b.lastModified - a.lastModified);
  folderFiles.value = list;
}

/** The folder vanished or access was withdrawn. */
function lost(e: unknown): void {
  log.warn('folder', 'Projektordner nicht erreichbar', e);
  projectsDir = null;
  folderStatus.value = root ? 'needs-permission' : 'none';
  folderFiles.value = [];
}

async function fileHandle(name: string, create = false): Promise<FileSystemFileHandle | null> {
  if (!projectsDir) return null;
  try {
    return await projectsDir.getFileHandle(name, { create });
  } catch (e) {
    const n = (e as { name?: string } | null)?.name;
    if (n === 'NotFoundError' || n === 'TypeError') return null;
    if (n === 'NotAllowedError' || n === 'SecurityError') lost(e);
    throw e;
  }
}

/** Stamp of a file in the project folder, null if it does not exist. */
export async function fileStamp(name: string): Promise<FileStamp | null> {
  const h = await fileHandle(name);
  if (!h) return null;
  const f = await h.getFile();
  return { size: f.size, lastModified: f.lastModified };
}

export async function readProjectFile(name: string): Promise<{ bytes: Uint8Array; stamp: FileStamp } | null> {
  const h = await fileHandle(name);
  if (!h) return null;
  const f = await h.getFile();
  return { bytes: new Uint8Array(await f.arrayBuffer()), stamp: { size: f.size, lastModified: f.lastModified } };
}

export async function writeProjectFile(name: string, bytes: Uint8Array): Promise<FileStamp> {
  const h = await fileHandle(name, true);
  if (!h) throw new Error('Kein Projektordner');
  const w = await h.createWritable();
  await w.write(bytes as BlobPart);
  await w.close();
  const f = await h.getFile();
  void refreshFolder();
  return { size: f.size, lastModified: f.lastModified };
}

/** A safe .tess file name from a tab or project name. */
export function tessFileName(name: string): string {
  const base = name.replace(/\.tess$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'bauplan';
  return `${base}${TESS_EXT}`;
}

// ---- versions (projekte/.versionen/<name>/…)

export const VERSIONS_DIR = '.versionen';

async function versionFolder(dir: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!projectsDir) return null;
  try {
    const all = await projectsDir.getDirectoryHandle(VERSIONS_DIR, { create });
    return await all.getDirectoryHandle(dir, { create });
  } catch (e) {
    const n = (e as { name?: string } | null)?.name;
    if (n === 'NotFoundError' || n === 'TypeError') return null;
    if (n === 'NotAllowedError' || n === 'SecurityError') lost(e);
    throw e;
  }
}

/** Versions of plans in the project folder. */
export const folderVersions: VersionBackend = {
  async list(dir) {
    const d = await versionFolder(dir, false);
    if (!d) return [];
    const out: string[] = [];
    for await (const entry of (d as IterableDirectory).values()) if (entry.kind === 'file') out.push(entry.name);
    return out;
  },
  async write(dir, name, bytes) {
    const d = await versionFolder(dir, true);
    if (!d) throw new Error('Kein Projektordner');
    const h = await d.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(bytes as BlobPart);
    await w.close();
  },
  async read(dir, name) {
    const d = await versionFolder(dir, false);
    if (!d) return null;
    try {
      const f = await (await d.getFileHandle(name)).getFile();
      return new Uint8Array(await f.arrayBuffer());
    } catch {
      return null;
    }
  },
  async remove(dir, name) {
    const d = await versionFolder(dir, false);
    if (d) await d.removeEntry(name);
  },
};
