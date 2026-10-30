import { signal } from '@preact/signals';
import { makeState, type BlockState } from '../core/blockstate';
import { log } from '../debug/log';
import { folderStatus, folderVersions, grantAccess, writeProjectFile } from '../platform/folder';
import { completeState } from '../tess/connect';
import { composeOrient, cellLine, replaceRoleSort, setCellEdit, setOrientation } from '../tess/edit';
import { turnState, Xf } from '../tess/xform';
import { backupVersion, EditHistory, listVersions, versionDir, versionLabel, type VersionBackend } from './editCore';
import { openBytes, parseFile } from './importer';
import { browserVersions, type FileLink } from './persistence';
import type { Project } from './project';
import { replaceProject } from './planFiles';
import { activeId, projects, showToast } from './workspace';

/**
 * Editing building plans in the app (Etappe 4c). Every change rewrites the .tess text (edit.ts)
 * and goes through writePlan: build it first (a change that breaks the plan is not written),
 * keep the old text as a version, write the file, swap the tab's Project. Undo and redo work on
 * the text, 100 steps per tab. History and edit mode are kept by tab id, so they survive the
 * swap of the Project.
 */

const histories = new Map<string, EditHistory>();
/** Bumped whenever a history changes (buttons enable and disable). */
export const historyRevision = signal(0);
/** Tabs in edit mode (by project id). */
export const editMode = signal<ReadonlySet<string>>(new Set());
/** The block whose edit menu is open (volume coordinates) and where the menu sits on screen. */
export const editTarget = signal<{ id: string; x: number; y: number; z: number; left: number; top: number } | null>(null);
/** Versions dialog: the tab it is open for. */
export const versionsFor = signal<string | null>(null);
/** File names written by Tessera right now: the file watch does not take them as changes from outside. */
export const selfWrites = new Set<string>();

const queues = new Map<string, Promise<unknown>>();

function historyOf(p: Project): EditHistory {
  let h = histories.get(p.id);
  if (!h) histories.set(p.id, (h = new EditHistory()));
  return h;
}

export function canUndo(p: Project): boolean {
  void historyRevision.value;
  return (histories.get(p.id)?.undo.length ?? 0) > 0;
}

export function canRedo(p: Project): boolean {
  void historyRevision.value;
  return (histories.get(p.id)?.redo.length ?? 0) > 0;
}

/** Whether a tab can be edited: a building plan in version 2, not a version opened read-only. */
export function editable(p: Project): boolean {
  return p.isPlan && !p.readOnly && !!p.data.plan;
}

export function isEditing(p: Project): boolean {
  return editMode.value.has(p.id);
}

export function setEditing(p: Project, on: boolean): void {
  const next = new Set(editMode.value);
  if (on) next.add(p.id);
  else next.delete(p.id);
  editMode.value = next;
  if (!on) editTarget.value = null;
}

/** The current Project of a tab (it is swapped on every change). */
function current(id: string): Project | null {
  return projects.value.find((x) => x.id === id) ?? null;
}

/** Runs edits of one tab one after the other (fast Ctrl+Z presses). */
function serial<T>(id: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(task, task);
  queues.set(
    id,
    next.catch(() => undefined),
  );
  return next;
}

// ---- versions

/** Where the versions of a tab live: next to its file in the project folder, else in the browser. */
function backendFor(link: FileLink | null, tabId: string): { b: VersionBackend; dir: string } {
  if (link && folderStatus.value === 'ready') return { b: folderVersions, dir: versionDir(link.name) };
  return { b: browserVersions, dir: `tab-${tabId}` };
}

function backendOf(p: Project): { b: VersionBackend; dir: string } {
  return backendFor(p.link.value, p.id);
}

/** Keeps a text as a version of a tab (before a write or before a change from outside is taken over). */
export async function backupText(link: FileLink | null, tabId: string, bytes: Uint8Array): Promise<void> {
  const { b, dir } = backendFor(link, tabId);
  try {
    await backupVersion(b, dir, bytes);
  } catch (e) {
    log.warn('versions', `Version von ${link?.name ?? tabId} konnte nicht gesichert werden`, e);
  }
}

/** Keeps the tab's current text as a version. */
export function keepVersion(p: Project, bytes: Uint8Array = p.source): Promise<void> {
  return backupText(p.link.value, p.id, bytes);
}

export interface VersionEntry {
  name: string;
  label: string;
}

export async function versionsOf(p: Project): Promise<VersionEntry[]> {
  const { b, dir } = backendOf(p);
  const names = await listVersions(b, dir);
  return names.map((name) => ({ name, label: versionLabel(name) ?? name }));
}

/** Opens a version as a read-only tab. */
export async function openVersion(p: Project, name: string): Promise<void> {
  const { b, dir } = backendOf(p);
  const bytes = await b.read(dir, name);
  if (!bytes) {
    showToast('error', 'Die Version ist nicht mehr da.');
    return;
  }
  const opened = await openBytes(p.fileName, bytes, { name: `${p.name} (Version ${versionLabel(name) ?? name})`, persist: false, readOnly: true });
  if (opened) versionsFor.value = null;
}

/** Restores a version: the current text is kept as a version first; undo brings it back. */
export async function restoreVersion(p: Project, name: string): Promise<void> {
  const { b, dir } = backendOf(p);
  const bytes = await b.read(dir, name);
  if (!bytes) {
    showToast('error', 'Die Version ist nicht mehr da.');
    return;
  }
  if (await applyText(p, bytes)) showToast('success', `Version ${versionLabel(name) ?? name} wiederhergestellt.`, 'Strg+Z holt die vorige Fassung zurück.');
}

// ---- writing

/**
 * Builds the new text, keeps the old one as a version, writes the file (project folder) and
 * swaps the tab's Project. Returns the new Project, or null when the text has errors (nothing
 * is written then).
 */
async function writePlan(p: Project, bytes: Uint8Array): Promise<Project | null> {
  let result;
  try {
    ({ result } = await parseFile(p.fileName, bytes));
  } catch (e) {
    showToast('error', 'Die Änderung wurde nicht übernommen.', e instanceof Error ? e.message : String(e), 12000);
    return null;
  }
  const live = current(p.id);
  if (!live) return null;
  let link = live.link.value;
  // A tab linked to a file writes only into that file: without access the change is not made
  // (otherwise tab and file would drift apart).
  if (link && folderStatus.value !== 'ready' && !(folderStatus.value === 'needs-permission' && (await grantAccess()))) {
    showToast('error', 'Der Projektordner ist nicht erreichbar; die Änderung wurde nicht geschrieben.', 'Unter „Projekte“ den Zugriff erlauben und noch einmal versuchen.');
    return null;
  }
  await keepVersion(live);
  if (link && folderStatus.value === 'ready') {
    selfWrites.add(link.name);
    try {
      const stamp = await writeProjectFile(link.name, bytes);
      // Our own write: the new stamp is what the tab knows, so the watch sees no change from outside.
      link = { name: link.name, ...stamp };
    } catch (e) {
      log.error('folder', `${link.name} konnte nicht geschrieben werden`, e);
      showToast('error', `„${link.name}“ konnte nicht geschrieben werden.`, e instanceof Error ? e.message : undefined);
      return null;
    } finally {
      selfWrites.delete(link.name);
    }
  }
  const fresh = replaceProject(live, bytes, result, link);
  fresh.fileIssue.value = null;
  return fresh;
}

/** A new step: the text before it goes to undo. */
export function applyText(p: Project, next: Uint8Array): Promise<boolean> {
  return serial(p.id, async () => {
    const live = current(p.id);
    if (!live || sameBytes(live.source, next)) return false;
    const before = live.source;
    const fresh = await writePlan(live, next);
    if (!fresh) return false;
    historyOf(live).record(before);
    historyRevision.value++;
    return true;
  });
}

export function undo(p: Project): Promise<boolean> {
  return serial(p.id, async () => {
    const live = current(p.id);
    if (!live) return false;
    const h = historyOf(live);
    const prev = h.back(live.source);
    if (!prev) return false;
    const fresh = await writePlan(live, prev);
    if (!fresh) {
      // Not written: back to the state before.
      h.redo.pop();
      h.undo.push(prev);
      return false;
    }
    historyRevision.value++;
    return true;
  });
}

export function redo(p: Project): Promise<boolean> {
  return serial(p.id, async () => {
    const live = current(p.id);
    if (!live) return false;
    const h = historyOf(live);
    const next = h.forward(live.source);
    if (!next) return false;
    const fresh = await writePlan(live, next);
    if (!fresh) {
      h.undo.pop();
      h.redo.push(next);
      return false;
    }
    historyRevision.value++;
    return true;
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

function textOf(p: Project): string {
  return dec.decode(p.source);
}

async function edit(p: Project, change: (text: string) => string): Promise<boolean> {
  let next: string;
  try {
    next = change(textOf(p));
  } catch (e) {
    showToast('error', 'Die Datei hat sich geändert; die Änderung passt nicht mehr.', e instanceof Error ? e.message : undefined);
    return false;
  }
  return applyText(p, enc.encode(next));
}

// ---- the edits

/** Palette swap: sort `sort` of role `role` becomes another block. */
export function swapSort(p: Project, roleName: string, sort: number, newId: string): Promise<boolean> {
  const role = p.data.plan?.roles.find((r) => r.name === roleName);
  if (!role) return Promise.resolve(false);
  return edit(p, (t) => replaceRoleSort(t, role, sort, newId));
}

/** Turns the whole plan 90° clockwise or mirrors it (line `ausrichtung`). */
export function turnPlan(p: Project, op: 'turn' | 'x' | 'z'): Promise<boolean> {
  const o = p.data.plan?.orient;
  if (!o) return Promise.resolve(false);
  return edit(p, (t) => setOrientation(t, o.line, composeOrient(o, op)));
}

/** File coordinates of a cell (volume coordinates): back through offset and ausrichtung. */
export function fileCell(p: Project, x: number, y: number, z: number): [number, number, number] {
  const off = p.data.info.offset ?? [0, 0, 0];
  const o = p.data.plan?.orient ?? { turn: 0, mirror: null };
  return Xf.of(o.turn, o.mirror).inverse().map(x + off[0], y + off[1], z + off[2]);
}

/** The block at a cell (volume coordinates), or null for air. */
export function blockAt(p: Project, x: number, y: number, z: number): BlockState | null {
  const v = p.data.volume;
  if (x < 0 || y < 0 || z < 0 || x >= v.sizeX || y >= v.sizeY || z >= v.sizeZ) return null;
  const i = v.data[(y * v.sizeZ + z) * v.sizeX + x];
  const s = v.palette[i];
  return s && i !== 0 && s.name !== 'minecraft:air' ? s : null;
}

/** States that Tessera computes itself (connections, stair corners) are not written. */
const COMPUTED = /(_fence|_wall|_pane|iron_bars|glass_pane)$/;
function writtenProps(s: BlockState): Record<string, string> {
  const out: Record<string, string> = { ...s.props };
  if (s.name.endsWith('_stairs')) delete out.shape;
  if (COMPUTED.test(s.name)) for (const k of ['north', 'east', 'south', 'west', 'up']) delete out[k];
  return out;
}

/** States equal to what Tessera completes by itself are left out of the line (shorter, same result). */
function shortState(s: BlockState): BlockState {
  const def = completeState(makeState(s.name)).props;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.props)) if (def[k] !== v) out[k] = v;
  return makeState(s.name, out);
}

/** Sets a cell to a block (or air with null); the line goes to "Änderungen in Tessera". */
export function setCell(p: Project, x: number, y: number, z: number, state: BlockState | null): Promise<boolean> {
  const [fx, fy, fz] = fileCell(p, x, y, z);
  const o = p.data.plan?.orient ?? { turn: 0, mirror: null };
  // The file is not turned: write the state as it is before ausrichtung.
  const written = state ? shortState(turnState(makeState(state.name, writtenProps(state)), Xf.of(o.turn, o.mirror).inverse())) : null;
  return edit(p, (t) => setCellEdit(t, fx, fy, fz, cellLine(fx, fy, fz, written)));
}

/** "Ersetzen": another block; states that make sense for it (same kind of block) stay. */
export function replaceCell(p: Project, x: number, y: number, z: number, newId: string): Promise<boolean> {
  const old = blockAt(p, x, y, z);
  const id = newId.includes(':') ? newId : `minecraft:${newId}`;
  const kind = (n: string) => /_(stairs|slab|wall|fence|fence_gate|trapdoor|door|pane|button|pressure_plate|log|wood|stem|hyphae|pillar|carpet)$/.exec(n)?.[1] ?? (/(_log|_wood|pillar|basalt)$/.test(n) ? 'axis' : '');
  const keep = old && kind(old.name) && kind(old.name) === kind(id) ? old.props : {};
  return setCell(p, x, y, z, makeState(id, { ...keep }));
}

/** Ctrl+Z / Ctrl+Y on the active tab. */
export function undoActive(redoIt: boolean): void {
  const p = current(activeId.value ?? '');
  if (!p || !editable(p)) return;
  void (redoIt ? redo(p) : undo(p));
}
