import { log } from '../debug/log';
import type { PersistedState } from './project';

/**
 * Browser storage for the open projects (IndexedDB). Stage 1 keeps imported schematics here so
 * tabs, progress and camera survive closing the browser. From stage 3 on, projects live as
 * .tess files in the project folder; catalog and scans stay in IndexedDB.
 */
const DB_NAME = 'tessera';
const DB_VERSION = 1;

export interface StoredProject {
  id: string;
  name: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  state: PersistedState;
}

interface WorkspaceMeta {
  key: 'workspace';
  order: string[];
  activeId: string | null;
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
