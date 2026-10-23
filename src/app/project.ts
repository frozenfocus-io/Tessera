import { signal } from '@preact/signals';
import { buildBlockModel, type BlockModel, type BlockTypeInfo } from '../blocks/blockModel';
import { itemName } from '../catalog/runtime';
import type { Catalog } from '../catalog/types';
import type { ImportResult } from '../core/importFile';
import type { Bounds } from '../core/volume';
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
  readonly materials: MaterialIndex;
  readonly bounds: Bounds | null;
  /** Lowest and highest non-empty layer (schematic y, inclusive). */
  readonly minLayer: number;
  readonly maxLayer: number;
  readonly unknownBlocks: UnknownBlock[];

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
  }) {
    this.id = opts.id ?? newId();
    this.name = opts.name;
    this.fileName = opts.fileName;
    this.createdAt = opts.createdAt ?? Date.now();
    this.source = opts.source;
    this.data = opts.data;
    this.catalog = opts.catalog ?? null;
    this.model = buildBlockModel(opts.data.volume.palette, this.catalog);
    const catalog = this.catalog;
    this.materials = new MaterialIndex(this.model.entries, opts.data.analysis.layerHist, opts.data.volume.sizeY, (item) => itemName(catalog, item));
    this.bounds = opts.data.analysis.bounds;
    this.minLayer = this.bounds ? this.bounds.minY : 0;
    this.maxLayer = this.bounds ? this.bounds.maxY - 1 : 0;
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

  /** Blocks per type id over the whole project. */
  typeCount(typeId: number): number {
    const totals = this.data.analysis.paletteTotals;
    let n = 0;
    this.model.entries.forEach((e, i) => {
      if (e.typeId === typeId) n += totals[i];
    });
    return n;
  }

  /** Blocks of a type in one layer. */
  typeCountInLayer(typeId: number, y: number): number {
    const { offsets, pairs } = this.data.analysis.layerHist;
    let n = 0;
    for (let i = offsets[y]; i < offsets[y + 1]; i++) if (this.model.table.typeId[pairs[i * 2]] === typeId) n += pairs[i * 2 + 1];
    return n;
  }

  /** Placed blocks in finished layers. */
  doneBlocks(): number {
    let n = 0;
    for (const y of this.done.value) n += this.data.analysis.layerCounts[y] ?? 0;
    return n;
  }

  persisted(): PersistedState {
    return {
      layer: this.layer.value,
      viewMode: this.viewMode.value,
      done: [...this.done.value].sort((a, b) => a - b),
      materialMode: this.materialMode.value,
      camera: this.camera,
      pinned: this.pinned.value,
      recipeChoice: { ...this.recipeChoice.value },
      materialView: this.materialView.value,
    };
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
