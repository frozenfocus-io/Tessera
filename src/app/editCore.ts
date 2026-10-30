/**
 * Undo, redo and the version store of building plans (Etappe 4c), without DOM or browser APIs
 * so the rules can be tested on their own.
 *
 * - Undo/redo work on the file text: every step is the whole text before it, at most 100 per tab.
 * - Versions: before every write from the app and before a change from outside is taken over, the
 *   previous text is kept as projekte/.versionen/<name>/<JJJJ-MM-TT_hh-mm-ss>.tess; the 50 newest
 *   stay. Two backups in the same second get "_2", "_3" … so none is lost.
 */

export const UNDO_LIMIT = 100;
export const VERSION_LIMIT = 50;

export class EditHistory {
  readonly undo: Uint8Array[] = [];
  readonly redo: Uint8Array[] = [];

  constructor(readonly limit = UNDO_LIMIT) {}

  /** A new step: `before` is the text the step changes. Clears redo. */
  record(before: Uint8Array): void {
    this.undo.push(before);
    if (this.undo.length > this.limit) this.undo.splice(0, this.undo.length - this.limit);
    this.redo.length = 0;
  }

  /** Text to go back to (or null); `current` becomes the first redo step. */
  back(current: Uint8Array): Uint8Array | null {
    const prev = this.undo.pop();
    if (!prev) return null;
    this.redo.push(current);
    return prev;
  }

  /** Text to go forward to (or null); `current` becomes an undo step again. */
  forward(current: Uint8Array): Uint8Array | null {
    const next = this.redo.pop();
    if (!next) return null;
    this.undo.push(current);
    if (this.undo.length > this.limit) this.undo.splice(0, this.undo.length - this.limit);
    return next;
  }

  /** A failed write: the step did not happen. */
  dropLast(kind: 'undo' | 'redo'): void {
    (kind === 'undo' ? this.undo : this.redo).pop();
  }
}

/** Where versions are kept: a folder per plan (project folder) or the browser storage. */
export interface VersionBackend {
  list(dir: string): Promise<string[]>;
  write(dir: string, name: string, bytes: Uint8Array): Promise<void>;
  read(dir: string, name: string): Promise<Uint8Array | null>;
  remove(dir: string, name: string): Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-30_16-40-12" in local time. */
export function versionStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

const VERSION_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_(\d+))?\.tess$/;

/** "30.10.2026, 16:40:12" for a version file name; null for other files. */
export function versionLabel(name: string): string | null {
  const m = VERSION_NAME.exec(name);
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}:${m[6]}${m[7] ? ` (${m[7]})` : ''}`;
}

/** Sort key: time, then the counter of the same second. */
function order(name: string): string {
  const m = VERSION_NAME.exec(name)!;
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}_${(m[7] ?? '1').padStart(4, '0')}`;
}

/** Version files of a plan, newest first. */
export async function listVersions(b: VersionBackend, dir: string): Promise<string[]> {
  const names = (await b.list(dir)).filter((n) => VERSION_NAME.test(n));
  return names.sort((p, q) => (order(q) < order(p) ? -1 : order(q) > order(p) ? 1 : 0));
}

/** Keeps `bytes` as a new version and removes all but the newest `keep`. Returns the file name. */
export async function backupVersion(b: VersionBackend, dir: string, bytes: Uint8Array, now = new Date(), keep = VERSION_LIMIT): Promise<string> {
  const existing = new Set(await b.list(dir));
  const stamp = versionStamp(now);
  let name = `${stamp}.tess`;
  for (let k = 2; existing.has(name); k++) name = `${stamp}_${k}.tess`;
  await b.write(dir, name, bytes);
  const all = await listVersions(b, dir);
  for (const old of all.slice(keep)) await b.remove(dir, old);
  return name;
}

/** Folder name of a plan's versions: the file name without .tess. */
export function versionDir(fileName: string): string {
  return fileName.replace(/\.tess$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'bauplan';
}

/** Versions in memory (tests). */
export class MemoryVersions implements VersionBackend {
  readonly dirs = new Map<string, Map<string, Uint8Array>>();
  async list(dir: string): Promise<string[]> {
    return [...(this.dirs.get(dir)?.keys() ?? [])];
  }
  async write(dir: string, name: string, bytes: Uint8Array): Promise<void> {
    let d = this.dirs.get(dir);
    if (!d) this.dirs.set(dir, (d = new Map()));
    d.set(name, bytes.slice());
  }
  async read(dir: string, name: string): Promise<Uint8Array | null> {
    return this.dirs.get(dir)?.get(name) ?? null;
  }
  async remove(dir: string, name: string): Promise<void> {
    this.dirs.get(dir)?.delete(name);
  }
}
