import { log } from '../debug/log';
import type { VersionBackend } from './editCore';
import type { PersistedState } from './project';

/**
 * Browser storage for the open tabs (IndexedDB): view state, progress and a copy of the file, so
 * tabs survive closing the browser. Building plans additionally live as .tess files in the
 * project folder; a tab linked to such a file reads it from there on restart and keeps the copy
 * here only as a fallback. The folder handle itself is stored here too.
 */
const DB_NAME = 'tessera';
const DB_VERSION = 2;

/** A tab's link to a .tess file in the project folder. */
export interface FileLink {
  /** File name inside the folder "projekte". */
  name: string;
  size: number;
  lastModified: number;
}

export interface StoredProject {
  id: string;
  name: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  state: PersistedState;
  link?: FileLink | null;
}

interface WorkspaceMeta {
  key: 'workspace';
  order: string[];
  activeId: string | null;
}

interface FolderMeta {
  key: 'folder';
  handle: FileSystemDirectoryHandle;
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    const meta: FolderMeta = { key: 'folder', handle };
    tx.objectStore('meta').put(meta);
    await done(tx);
  } catch (e) {
    log.warn('storage', 'Projektordner konnte nicht gemerkt werden', e);
  }
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const tx = db.transaction('meta', 'readonly');
    const meta = await request(tx.objectStore('meta').get('folder') as IDBRequest<FolderMeta | undefined>);
    return meta?.handle ?? null;
  } catch (e) {
    log.warn('storage', 'Gemerkter Projektordner konnte nicht gelesen werden', e);
    return null;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      // Version 2 (Etappe 4c): versions of plans without a project folder, key "<dir>/<name>".
      if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB konnte nicht geöffnet werden'));
    req.onblocked = () => log.warn('storage', 'IndexedDB ist blockiert (anderer Tab offen?)');
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transaktion fehlgeschlagen'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaktion abgebrochen'));
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveProjectSource(id: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction('sources', 'readwrite');
    tx.objectStore('sources').put(bytes, id);
    await done(tx);
  } catch (e) {
    log.warn('storage', 'Projektdatei konnte nicht im Browser gespeichert werden', e);
  }
}

export async function saveProjectState(p: StoredProject): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(p);
    await done(tx);
  } catch (e) {
    log.warn('storage', 'Projektzustand konnte nicht gespeichert werden', e);
  }
}

export async function deleteStoredProject(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(['projects', 'sources'], 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.objectStore('sources').delete(id);
    await done(tx);
  } catch (e) {
    log.warn('storage', 'Projekt konnte nicht aus dem Browser-Speicher entfernt werden', e);
  }
}

export async function saveWorkspace(order: string[], activeId: string | null): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    const meta: WorkspaceMeta = { key: 'workspace', order, activeId };
    tx.objectStore('meta').put(meta);
    await done(tx);
  } catch (e) {
    log.warn('storage', 'Tab-Reihenfolge konnte nicht gespeichert werden', e);
  }
}

export interface RestoredProject {
  stored: StoredProject;
  source: Uint8Array;
}

export async function loadWorkspace(): Promise<{ projects: RestoredProject[]; activeId: string | null }> {
  try {
    const db = await openDb();
    const tx = db.transaction(['projects', 'sources', 'meta'], 'readonly');
    const [all, meta] = await Promise.all([
      request(tx.objectStore('projects').getAll() as IDBRequest<StoredProject[]>),
      request(tx.objectStore('meta').get('workspace') as IDBRequest<WorkspaceMeta | undefined>),
    ]);
    const order = meta?.order ?? [];
    // Only tabs that were open at the end of the last session (closed ones may linger briefly).
    const listed = meta ? all.filter((p) => order.includes(p.id)) : all;
    const orphans = all.filter((p) => !listed.includes(p));
    all.length = 0;
    all.push(...listed);
    all.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.createdAt - b.createdAt;
    });
    const out: RestoredProject[] = [];
    for (const p of all) {
      const src = await request(tx.objectStore('sources').get(p.id) as IDBRequest<Uint8Array | ArrayBuffer | undefined>);
      if (!src) continue;
      out.push({ stored: p, source: src instanceof Uint8Array ? src : new Uint8Array(src) });
    }
    for (const o of orphans) void deleteStoredProject(o.id);
    return { projects: out, activeId: meta?.activeId ?? null };
  } catch (e) {
    log.warn('storage', 'Gespeicherte Projekte konnten nicht geladen werden', e);
    return { projects: [], activeId: null };
  }
}

/** Asks the browser to keep IndexedDB data even under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    const granted = await navigator.storage.persist();
    log.info('storage', granted ? 'Dauerhafter Speicher gewährt' : 'Dauerhafter Speicher nicht gewährt (Browser entscheidet selbst)');
    return granted;
  } catch (e) {
    log.warn('storage', 'Dauerhafter Speicher konnte nicht angefragt werden', e);
    return null;
  }
}

/** Versions of plans without a project folder, in the browser (key "<dir>/<name>"). */
export const browserVersions: VersionBackend = {
  async list(dir) {
    const db = await openDb();
    const keys = (await request(db.transaction('versions', 'readonly').objectStore('versions').getAllKeys())) as string[];
    return keys.filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1));
  },
  async write(dir, name, bytes) {
    const db = await openDb();
    const tx = db.transaction('versions', 'readwrite');
    tx.objectStore('versions').put(bytes, `${dir}/${name}`);
    await done(tx);
  },
  async read(dir, name) {
    const db = await openDb();
    const v = await request(db.transaction('versions', 'readonly').objectStore('versions').get(`${dir}/${name}`));
    return v instanceof Uint8Array ? v : null;
  },
  async remove(dir, name) {
    const db = await openDb();
    const tx = db.transaction('versions', 'readwrite');
    tx.objectStore('versions').delete(`${dir}/${name}`);
    await done(tx);
  },
};
