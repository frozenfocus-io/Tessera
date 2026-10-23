import { log } from '../debug/log';
import type { Catalog } from './types';

/**
 * The catalog lives in its own IndexedDB database, separate from the projects: it belongs to
 * the program, not to a project, and is rebuilt only when the modpack changes.
 */
const DB_NAME = 'tessera-katalog';
const STORE = 'catalog';
const KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Katalog-Speicher konnte nicht geöffnet werden'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Katalog-Speicher: Fehler'));
  });
}

export async function loadStoredCatalog(): Promise<Catalog | null> {
  try {
    const db = await openDb();
    const c = (await wrap(db.transaction(STORE).objectStore(STORE).get(KEY))) as Catalog | undefined;
    return c ?? null;
  } catch (e) {
    log.warn('catalog', 'Gespeicherter Katalog nicht lesbar', e);
    return null;
  }
}

export async function storeCatalog(c: Catalog): Promise<boolean> {
  try {
    const db = await openDb();
    await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).put(c, KEY));
    return true;
  } catch (e) {
    log.error('catalog', 'Katalog konnte nicht gespeichert werden', e);
    return false;
  }
}

export async function deleteStoredCatalog(): Promise<void> {
  try {
    const db = await openDb();
    await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY));
  } catch (e) {
    log.warn('catalog', 'Katalog konnte nicht gelöscht werden', e);
  }
}
