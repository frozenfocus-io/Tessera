import { signal } from '@preact/signals';
import { buildBlockModel, type BlockModel, type BlockTypeInfo } from '../blocks/blockModel';
import { itemName } from '../catalog/runtime';
import type { Catalog } from '../catalog/types';
import type { OriginEntry } from '../core/formats/tess';
import type { ImportResult } from '../core/importFile';
import { analyzeVolume, type Bounds, type VolumeAnalysis } from '../core/volume';
import { MaterialIndex } from '../materials/materialList';
import type { OutlineInfo, ProjectScene, SceneStats } from '../render/ProjectScene';
import type { CameraState } from '../render/Viewer';
import type { FileStamp } from '../platform/folder';
import type { FileLink } from './persistence';

export type ViewMode = 'all' | 'slice' | 'single';
export type MaterialMode = 'all' | 'layer' | 'from' | 'open';

/** The part of a project's state that is saved and restored. */
export interface PersistedState {
  layer: number;
  viewMode: ViewMode;
  done: number[];
  materialMode: MaterialMode;
  camera: CameraState | null;
  pinned: string | null;
  /** Raw material breakdown: item -> chosen recipe id or "raw". */
  recipeChoice?: Record<string, string>;
  /** Material list or raw materials. */
  materialView?: 'blocks' | 'raw';
  /** Building plans: chosen Bauabschnitt by name ('' = whole building). */
  section?: string;
  /** Finished layers per Bauabschnitt (by name). */
  sectionDone?: Record<string, number[]>;
}

/** What layers, materials and progress refer to: the whole building or one Bauabschnitt. */
export interface Scope {
  section: number;
  analysis: VolumeAnalysis;
  materials: MaterialIndex;
  minLayer: number;
  maxLayer: number;
  /** Per cell (volume order): 1 inside the section; null for the whole building. */
  mask: Uint8Array | null;
}

export interface HoverInfo {
  x: number;
  y: number;
  z: number;
  palette: number;
  typeId: number;
}

export interface UnknownBlock {
  name: string;
  displayName: string;
  count: number;
}

let counter = 0;
function newId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `p${Date.now().toString(36)}${(counter++).toString(36)}${rnd}`;
}

/**
 * One opened file. Completely self-contained (architecture rule "Isolation"): its own palette,
 * block model, materials, scene and view state. Nothing here is shared with other projects.
 */
export class Project {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly createdAt: number;
  readonly source: Uint8Array;
  readonly data: ImportResult;
  readonly model: BlockModel;
  readonly bounds: Bounds | null;
  readonly unknownBlocks: UnknownBlock[];
  /** A version opened from the version store: nothing can be edited or saved. */
  readonly readOnly: boolean;
  /** Building plans: the Bauabschnitt that layers, materials and progress refer to (0 = all). */
  readonly section = signal(0);
  private readonly scopes = new Map<number, Scope>();
  /** Finished layers of the other Bauabschnitte (the current one is `done`). */
  private readonly doneOf = new Map<number, ReadonlySet<number>>();

  readonly layer = signal(0);
  readonly viewMode = signal<ViewMode>('all');
  readonly done = signal<ReadonlySet<number>>(new Set());
  readonly materialMode = signal<MaterialMode>('all');
  /** Material list or raw material breakdown. */
  readonly materialView = signal<'blocks' | 'raw'>('blocks');
  /** Per item: which recipe the raw material breakdown uses ("raw" = gather it). */
  readonly recipeChoice = signal<Readonly<Record<string, string>>>({});
  /** Item pinned from the material list (its blocks stay highlighted). */
  readonly pinned = signal<string | null>(null);
  /** Building plans: the line whose blocks are marked (a clicked hint), in modules with its chain. Not saved. */
  readonly markedLine = signal<{ line: number; ctx: string } | null>(null);
  readonly hover = signal<HoverInfo | null>(null);
  readonly meshProgress = signal<{ done: number; total: number } | null>(null);
  readonly sceneStats = signal<SceneStats | null>(null);
  /** How many blocks of the highlighted type got a wireframe (large counts are limited). */
  readonly outlineInfo = signal<OutlineInfo>({ shown: 0, total: 0, limit: 'none' });
  /** Revision counter, bumped on every saved-state change (drives persistence). */
  readonly revision = signal(0);
  /** Building plans: the .tess file in the project folder this tab belongs to. */
  readonly link = signal<FileLink | null>(null);
  /** The linked file changed but could not be built; the tab still shows the last good version. */
  readonly fileIssue = signal<{ message: string; detail?: string; stamp: FileStamp } | null>(null);
  /** The linked file is gone from the folder. */
  readonly fileMissing = signal(false);

  camera: CameraState | null = null;
  scene: ProjectScene | null = null;

  /** The catalog the block model was built with (null: built-in tables only). */
  readonly catalog: Catalog | null;

  constructor(opts: {
    id?: string;
    name: string;
    fileName: string;
    createdAt?: number;
    source: Uint8Array;
    data: ImportResult;
    catalog?: Catalog | null;
    readOnly?: boolean;
  }) {
    this.id = opts.id ?? newId();
    this.name = opts.name;
    this.fileName = opts.fileName;
    this.createdAt = opts.createdAt ?? Date.now();
    this.source = opts.source;
    this.data = opts.data;
    this.catalog = opts.catalog ?? null;
    this.readOnly = opts.readOnly ?? false;
    this.model = buildBlockModel(opts.data.volume.palette, this.catalog);
    this.bounds = opts.data.analysis.bounds;
    this.layer.value = this.minLayer;

    const totals = opts.data.analysis.paletteTotals;
    const byType = new Map<number, number>();
    this.model.entries.forEach((e, i) => {
      if (i > 0 && totals[i] > 0) byType.set(e.typeId, (byType.get(e.typeId) ?? 0) + totals[i]);
    });
    this.unknownBlocks = this.model.types
      .filter((t: BlockTypeInfo) => t.marked && (byType.get(t.typeId) ?? 0) > 0)
      .map((t) => ({ name: t.name, displayName: t.displayName, count: byType.get(t.typeId) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }

  /** A building plan (.tess) rather than an imported schematic. */
  get isPlan(): boolean {
    return this.data.format === 'tess';
  }

  /** Names of the Bauabschnitte (index 0 = the whole building). */
  get sections(): readonly string[] {
    return this.data.origins?.sections ?? [''];
  }

  /** Layers, materials and progress of the chosen Bauabschnitt (or the whole building). */
  get scope(): Scope {
    const s = this.section.value;
    let sc = this.scopes.get(s);
    if (!sc) {
      sc = this.makeScope(s);
      this.scopes.set(s, sc);
    }
    return sc;
  }

  private makeScope(s: number): Scope {
    const v = this.data.volume;
    let analysis = this.data.analysis;
    let mask: Uint8Array | null = null;
    const o = this.data.origins;
    if (s > 0 && o) {
      mask = new Uint8Array(v.data.length);
      const inSection = o.table.map((e) => e.section === s);
      const data = new Uint16Array(v.data.length) as typeof v.data;
      for (let i = 0; i < v.data.length; i++) {
        if (v.data[i] && inSection[o.ids[i]]) {
          mask[i] = 1;
          data[i] = v.data[i];
        }
      }
      analysis = analyzeVolume({ ...v, data });
    }
    const catalog = this.catalog;
    const materials = new MaterialIndex(this.model.entries, analysis.layerHist, v.sizeY, (item) => itemName(catalog, item));
    const b = analysis.bounds;
    return { section: s, analysis, materials, minLayer: b ? b.minY : 0, maxLayer: b ? b.maxY - 1 : 0, mask };
  }

  get materials(): MaterialIndex {
    return this.scope.materials;
  }

  /** Lowest and highest non-empty layer of the scope (schematic y, inclusive). */
  get minLayer(): number {
    return this.scope.minLayer;
  }

  get maxLayer(): number {
    return this.scope.maxLayer;
  }

  /** Blocks per layer and in all of the scope. */
  get layerCounts(): Uint32Array {
    return this.scope.analysis.layerCounts;
  }

  get blockTotal(): number {
    return this.scope.analysis.nonAir;
  }

  /** "Nordturm" or null for the whole building. */
  get sectionName(): string | null {
    const s = this.section.value;
    return s > 0 ? (this.sections[s] ?? null) : null;
  }

  /** Switches the Bauabschnitt; layer and progress follow it. */
  setSection(s: number): void {
    if (s === this.section.value || s < 0 || s >= this.sections.length) return;
    this.doneOf.set(this.section.value, this.done.value);
    this.section.value = s;
    this.done.value = this.doneOf.get(s) ?? new Set();
    this.layer.value = this.clampLayer(this.layer.value);
    this.touch();
  }

  get layerCount(): number {
    return this.maxLayer - this.minLayer + 1;
  }

  /** 1-based layer number as shown to the user. */
  displayLayer(y: number): number {
    return y - this.minLayer + 1;
  }

  clampLayer(y: number): number {
    return Math.max(this.minLayer, Math.min(this.maxLayer, Math.round(y)));
  }

  /** Building plans: the statement that set the block at a cell (volume coordinates). */
  originAt(x: number, y: number, z: number): OriginEntry | null {
    const o = this.data.origins;
    if (!o) return null;
    const v = this.data.volume;
    if (x < 0 || y < 0 || z < 0 || x >= v.sizeX || y >= v.sizeY || z >= v.sizeZ) return null;
    const id = o.ids[(y * v.sizeZ + z) * v.sizeX + x];
    return id ? (o.table[id] ?? null) : null;
  }

  /**
   * Building plans: all blocks a statement line has set, as block positions (x, y, z triples in
   * volume coordinates) with their bounds; null when the line set no block.
   */
  lineCells(line: number, ctx?: string): { positions: Float32Array; count: number; bounds: Bounds } | null {
    const o = this.data.origins;
    if (!o) return null;
    const hit = new Uint8Array(o.table.length);
    let any = false;
    o.table.forEach((e, i) => {
      // A hint inside a module marks the blocks of its own instance (same chain).
      if (i > 0 && e.line === line && (ctx === undefined || (e.ctx ?? '') === ctx)) {
        hit[i] = 1;
        any = true;
      }
    });
    if (!any) return null;
    const { sizeX, sizeZ } = this.data.volume;
    const ids = o.ids;
    let count = 0;
    for (let i = 0; i < ids.length; i++) if (hit[ids[i]]) count++;
    if (!count) return null;
    const positions = new Float32Array(count * 3);
    const b: Bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    let k = 0;
    const layer = sizeX * sizeZ;
    for (let i = 0; i < ids.length; i++) {
      if (!hit[ids[i]]) continue;
      const y = Math.floor(i / layer);
      const rem = i - y * layer;
      const z = Math.floor(rem / sizeX);
      const x = rem - z * sizeX;
      positions[k++] = x;
      positions[k++] = y;
      positions[k++] = z;
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (z < b.minZ) b.minZ = z;
      if (x + 1 > b.maxX) b.maxX = x + 1;
      if (y + 1 > b.maxY) b.maxY = y + 1;
      if (z + 1 > b.maxZ) b.maxZ = z + 1;
    }
    return { positions, count, bounds: b };
  }

  /** Marks the blocks of a line (clicked hint); the same line again or null clears it. */
  markLine(line: number | null, ctx = ''): void {
    const m = this.markedLine.value;
    this.markedLine.value = line === null || (m && m.line === line && m.ctx === ctx) ? null : { line, ctx };
  }

  /** Blocks per type id over the scope. */
  typeCount(typeId: number): number {
    const totals = this.scope.analysis.paletteTotals;
    let n = 0;
    this.model.entries.forEach((e, i) => {
      if (e.typeId === typeId) n += totals[i];
    });
    return n;
  }

  /** Blocks of a type in one layer. */
  typeCountInLayer(typeId: number, y: number): number {
    const { offsets, pairs } = this.scope.analysis.layerHist;
    let n = 0;
    for (let i = offsets[y]; i < offsets[y + 1]; i++) if (this.model.table.typeId[pairs[i * 2]] === typeId) n += pairs[i * 2 + 1];
    return n;
  }

  /** Placed blocks in finished layers. */
  doneBlocks(): number {
    let n = 0;
    for (const y of this.done.value) n += this.layerCounts[y] ?? 0;
    return n;
  }

  persisted(): PersistedState {
    return {
      layer: this.layer.value,
      viewMode: this.viewMode.value,
      done: [...(this.section.value > 0 ? (this.doneOf.get(0) ?? new Set<number>()) : this.done.value)].sort((a, b) => a - b),
      materialMode: this.materialMode.value,
      camera: this.camera,
      pinned: this.pinned.value,
      recipeChoice: { ...this.recipeChoice.value },
      materialView: this.materialView.value,
      ...(this.sections.length > 1 ? { section: this.sectionName ?? '', sectionDone: this.sectionDoneByName() } : {}),
    };
  }

  private sectionDoneByName(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    const all = new Map(this.doneOf);
    all.set(this.section.value, this.done.value);
    for (const [s, set] of all) if (s > 0 && set.size && this.sections[s]) out[this.sections[s]] = [...set].sort((a, b) => a - b);
    return out;
  }

  restore(s: Partial<PersistedState>): void {
    if (typeof s.layer === 'number') this.layer.value = this.clampLayer(s.layer);
    if (s.viewMode === 'all' || s.viewMode === 'slice' || s.viewMode === 'single') this.viewMode.value = s.viewMode;
    if (Array.isArray(s.done)) this.done.value = new Set(s.done.filter((y) => y >= this.minLayer && y <= this.maxLayer));
    if (s.materialMode === 'all' || s.materialMode === 'layer' || s.materialMode === 'from' || s.materialMode === 'open') {
      this.materialMode.value = s.materialMode;
    }
    if (s.camera && Array.isArray(s.camera.position) && Array.isArray(s.camera.target)) this.camera = s.camera;
    if (typeof s.pinned === 'string') this.pinned.value = s.pinned;
    if (s.recipeChoice && typeof s.recipeChoice === 'object') {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.recipeChoice)) if (typeof v === 'string') clean[k] = v;
      this.recipeChoice.value = clean;
    }
    if (s.materialView === 'blocks' || s.materialView === 'raw') this.materialView.value = s.materialView;
    if (s.sectionDone && typeof s.sectionDone === 'object') {
      for (const [name, list] of Object.entries(s.sectionDone)) {
        const i = this.sections.indexOf(name);
        if (i > 0 && Array.isArray(list)) this.doneOf.set(i, new Set(list.filter((y) => typeof y === 'number')));
      }
    }
    if (typeof s.section === 'string' && s.section) {
      const i = this.sections.indexOf(s.section);
      if (i > 0) {
        this.doneOf.set(0, this.done.value);
        this.section.value = i;
        this.done.value = this.doneOf.get(i) ?? new Set();
        if (typeof s.layer === 'number') this.layer.value = this.clampLayer(s.layer);
      }
    }
  }

  touch(): void {
    this.revision.value++;
  }

  // ---- state changes used by UI and keyboard

  setLayer(y: number, enterSlice = true): void {
    this.layer.value = this.clampLayer(y);
    if (enterSlice && this.viewMode.value === 'all') this.viewMode.value = 'slice';
    this.touch();
  }

  stepLayer(delta: number): void {
    if (this.viewMode.value === 'all') {
      this.viewMode.value = 'slice';
    } else {
      this.layer.value = this.clampLayer(this.layer.value + delta);
    }
    this.touch();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.value = mode;
    this.touch();
  }

  toggleDone(y = this.layer.value): void {
    const next = new Set(this.done.value);
    if (next.has(y)) next.delete(y);
    else next.add(y);
    this.done.value = next;
    this.touch();
  }

  setMaterialMode(m: MaterialMode): void {
    this.materialMode.value = m;
    this.touch();
  }

  setMaterialView(v: 'blocks' | 'raw'): void {
    this.materialView.value = v;
    this.touch();
  }

  chooseRecipe(item: string, choice: string): void {
    const next = { ...this.recipeChoice.value };
    if (choice === 'auto') delete next[item];
    else next[item] = choice;
    this.recipeChoice.value = next;
    this.touch();
  }

  togglePinned(item: string | null): void {
    this.pinned.value = this.pinned.value === item ? null : item;
    this.touch();
  }

  setPinned(item: string | null): void {
    if (this.pinned.value === item) return;
    this.pinned.value = item;
    this.touch();
  }
}
