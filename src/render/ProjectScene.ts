import * as THREE from 'three';
import { KIND_CUBE, type BlockModel } from '../blocks/blockModel';
import { log } from '../debug/log';
import type { Bounds, Volume } from '../core/volume';
import { createBlockMaterials, MODE_ALL, MODE_SINGLE, type BlockMaterials } from './blockMaterial';
import { chunkGrid, extractChunk, extractLayerSlab, type ChunkCoord } from './chunks';
import { makeBlockMesh } from './geometry';
import { CancelledError, type MeshPool } from './meshPool';
import { meshCapLayer, prepareTables, type ChunkMeshResult, type MeshTables } from './mesher';
import { HoverOutline, TypeOutlines } from './outlines';

export interface SceneStats {
  chunksTotal: number;
  chunksMeshed: number;
  chunksEmpty: number;
  opaqueQuads: number;
  translucentQuads: number;
  vertices: number;
  /** Sum of per-chunk meshing time in the workers. */
  workerMs: number;
  /** Wall-clock time from start to the last chunk. */
  wallMs: number;
  extractMs: number;
  mode: 'workers' | 'main-thread';
  workers: number;
  done: boolean;
  errors: number;
}

/**
 * Max. outlined blocks. Beyond that, outlines are limited to the current layer (or left out in the
 * full view): thousands of wireframes are unreadable anyway, and the colour tint still shows all.
 */
export const MAX_OUTLINES = 20_000;

export interface OutlineInfo {
  shown: number;
  /** Blocks of the highlighted types in the visible layers. */
  total: number;
  limit: 'none' | 'layer' | 'off';
}
const MAX_IN_FLIGHT = 24;

/**
 * Everything the 3D view needs for one project: chunk meshes, the layer cap, outlines and
 * per-project materials. Projects never share scene objects or materials.
 */
export class ProjectScene {
  readonly scene = new THREE.Scene();
  readonly materials: BlockMaterials;
  readonly outlines = new TypeOutlines();
  /** Blocks of a marked line of a building plan (clicked hint). */
  readonly marks = new TypeOutlines(0xff7a5c);
  readonly hover = new HoverOutline();
  readonly stats: SceneStats;
  /** Called when something visible changed (the viewer then renders a frame). */
  onChange: () => void = () => {};

  private readonly chunkGroup = new THREE.Group();
  private readonly capGroup = new THREE.Group();
  private readonly layerFrame: THREE.LineLoop;
  private readonly ground: THREE.Group;
  private readonly mainTables: MeshTables;
  private readonly typeIndex = new Map<number, Int32Array>();
  private disposed = false;
  private viewMode = MODE_ALL;
  private viewLayer = 0;
  private highlightTypes: number[] = [];

  constructor(
    private readonly projectId: string,
    private readonly volume: Volume,
    private readonly bounds: Bounds | null,
    private readonly model: BlockModel,
    private readonly pool: MeshPool,
  ) {
    this.materials = createBlockMaterials(model.types.length, volume.sizeY);
    const marked = new Set(model.types.filter((t) => t.marked).map((t) => t.typeId));
    this.materials.setTypeMask(new Set(), marked);
    this.mainTables = prepareTables(model.table);
    this.stats = {
      chunksTotal: 0,
      chunksMeshed: 0,
      chunksEmpty: 0,
      opaqueQuads: 0,
      translucentQuads: 0,
      vertices: 0,
      workerMs: 0,
      wallMs: 0,
      extractMs: 0,
      mode: pool.mode,
      workers: pool.workerCount,
      done: false,
      errors: 0,
    };

    this.scene.add(this.chunkGroup, this.capGroup, this.outlines.group, this.marks.group, this.hover.object);
    this.ground = this.makeGround();
    this.scene.add(this.ground);
    this.layerFrame = this.makeLayerFrame();
    this.scene.add(this.layerFrame);
  }

  private makeGround(): THREE.Group {
    const g = new THREE.Group();
    const b = this.bounds ?? { minX: 0, minY: 0, minZ: 0, maxX: this.volume.sizeX, maxY: 1, maxZ: this.volume.sizeZ };
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const margin = 4;
    const size = Math.min(2048, Math.ceil(Math.max(w, d)) + margin * 2);
    // Integer start so that every grid line lies on a block border.
    const x0 = Math.floor(b.minX + w / 2 - size / 2);
    const z0 = Math.floor(b.minZ + d / 2 - size / 2);
    const grid = new THREE.GridHelper(size, size, 0x3a424c, 0x2a3038);
    grid.position.set(x0 + size / 2, b.minY - 0.001, z0 + size / 2);
    const mat = grid.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = 0.7;
    mat.depthWrite = false;
    g.add(grid);
    return g;
  }

  private makeLayerFrame(): THREE.LineLoop {
    const b = this.bounds ?? { minX: 0, minY: 0, minZ: 0, maxX: this.volume.sizeX, maxY: 1, maxZ: this.volume.sizeZ };
    const pts = [
      new THREE.Vector3(b.minX - 0.02, 0, b.minZ - 0.02),
      new THREE.Vector3(b.maxX + 0.02, 0, b.minZ - 0.02),
      new THREE.Vector3(b.maxX + 0.02, 0, b.maxZ + 0.02),
      new THREE.Vector3(b.minX - 0.02, 0, b.maxZ + 0.02),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x48c4b0, transparent: true, opacity: 0.85 });
    const loop = new THREE.LineLoop(geo, mat);
    loop.visible = false;
    loop.frustumCulled = false;
    return loop;
  }

  /** Meshes all chunks in the worker pool. Resolves when done (or the scene was disposed). */
  async build(onProgress?: (done: number, total: number) => void): Promise<SceneStats> {
    const t0 = performance.now();
    this.pool.setTables(this.projectId, this.model.table);
    const chunks = chunkGrid(this.volume);
    this.stats.chunksTotal = chunks.length;
    this.stats.mode = this.pool.mode;
    this.stats.workers = this.pool.workerCount;
    let next = 0;
    let finished = 0;

    await new Promise<void>((resolve) => {
      const submit = (c: ChunkCoord, attempt: number): Promise<void> | null => {
        const te = performance.now();
        const data = extractChunk(this.volume, c);
        this.stats.extractMs += performance.now() - te;
        if (!data) return null;
        return this.pool
          .mesh(this.projectId, { data, sx: c.sx, sy: c.sy, sz: c.sz, ox: c.ox, oy: c.oy, oz: c.oz })
          .then(({ result, ms }) => {
            if (this.disposed) return;
            this.stats.workerMs += ms;
            this.addChunk(result, [c.ox, c.oy, c.oz]);
            this.stats.chunksMeshed++;
          })
          .catch((e: unknown): Promise<void> | void => {
            if (e instanceof CancelledError || this.disposed) return;
            // The chunk data went to the failed worker; extract again and retry once
            // (the pool falls back to the main thread when no worker is left).
            if (attempt === 0) {
              log.warn('mesh', `Chunk ${c.key} wird erneut erzeugt`, e);
              return submit(c, 1) ?? undefined;
            }
            this.stats.errors++;
            log.error('mesh', `Chunk ${c.key} konnte nicht erzeugt werden`, e);
          });
      };
      const launch = (): void => {
        while (!this.disposed && next < chunks.length && next - finished < MAX_IN_FLIGHT) {
          const job = submit(chunks[next++], 0);
          if (!job) {
            this.stats.chunksEmpty++;
            finished++;
            continue;
          }
          void job.finally(() => {
            finished++;
            onProgress?.(finished, chunks.length);
            if (finished >= chunks.length) resolve();
            else launch();
          });
        }
        if (this.disposed || finished >= chunks.length) resolve();
      };
      launch();
    });

    this.stats.wallMs = performance.now() - t0;
    this.stats.done = true;
    this.onChange();
    if (!this.disposed) {
      log.info('mesh', 'Meshing abgeschlossen', {
        chunks: this.stats.chunksTotal,
        empty: this.stats.chunksEmpty,
        quads: this.stats.opaqueQuads + this.stats.translucentQuads,
        vertices: this.stats.vertices,
        wallMs: Math.round(this.stats.wallMs),
        workerMs: Math.round(this.stats.workerMs),
        mode: this.stats.mode,
      });
    }
    return this.stats;
  }

  private addChunk(r: ChunkMeshResult, origin: [number, number, number]): void {
    if (r.opaque) {
      this.chunkGroup.add(makeBlockMesh(r.opaque, this.materials.opaque, origin));
      this.stats.opaqueQuads += r.opaque.quadCount;
      this.stats.vertices += r.opaque.vertexCount;
    }
    if (r.translucent) {
      const m = makeBlockMesh(r.translucent, this.materials.translucent, origin);
      m.renderOrder = 1;
      this.chunkGroup.add(m);
      this.stats.translucentQuads += r.translucent.quadCount;
      this.stats.vertices += r.translucent.vertexCount;
    }
    this.notifyThrottled();
  }

  /** Switches between full view, slicer and single layer. Rebuilds the cap of the current layer. */
  setView(mode: number, layer: number): void {
    this.viewMode = mode;
    this.viewLayer = layer;
    this.materials.setView(mode, layer);
    this.rebuildCap();
    this.layerFrame.visible = mode !== MODE_ALL;
    this.layerFrame.position.y = layer + 1.002;
    this.updateOutlines();
    this.onChange();
  }

  private rebuildCap(): void {
    for (const c of this.capGroup.children) (c as THREE.Mesh).geometry.dispose();
    this.capGroup.clear();
    if (this.viewMode === MODE_ALL) return;
    const y = this.viewLayer;
    if (y < 0 || y >= this.volume.sizeY) return;
    // Positions are Uint16 in 1/16 units relative to the volume origin.
    if (this.volume.sizeX * 16 > 65535 || this.volume.sizeZ * 16 > 65535 || (y + 1) * 16 > 65535) return;
    const r = meshCapLayer(this.mainTables, extractLayerSlab(this.volume, y), this.volume.sizeX, this.volume.sizeZ, y);
    if (r.opaque) this.capGroup.add(makeBlockMesh(r.opaque, this.materials.opaque, [0, 0, 0]));
    if (r.translucent) {
      const m = makeBlockMesh(r.translucent, this.materials.translucent, [0, 0, 0]);
      m.renderOrder = 1;
      this.capGroup.add(m);
    }
  }

  setDoneLayers(done: ReadonlySet<number>): void {
    this.materials.setDoneLayers(done);
    this.onChange();
  }

  setMarkUnknown(on: boolean): void {
    this.materials.setMarkUnknown(on);
    this.onChange();
  }

  /** Highlights block types (colour tint + wireframe outlines of every block of these types). */
  setHighlight(typeIds: readonly number[], dimOthers: number): void {
    this.highlightTypes = [...typeIds];
    const marked = new Set(this.model.types.filter((t) => t.marked).map((t) => t.typeId));
    this.materials.setTypeMask(new Set(typeIds), marked);
    this.materials.setDimOthers(dimOthers);
    this.updateOutlines();
    this.onChange();
  }

  /** Number of outlined blocks and whether the limit cut some off. */
  outlineInfo: OutlineInfo = { shown: 0, total: 0, limit: 'none' };
  private lastNotify = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Requests a frame, at most ~8 times per second while chunks stream in. */
  private notifyThrottled(): void {
    const now = performance.now();
    if (now - this.lastNotify > 120) {
      this.lastNotify = now;
      this.onChange();
    } else if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        this.lastNotify = performance.now();
        this.onChange();
      }, 120);
    }
  }

  private positionsOfType(typeId: number): Int32Array {
    let list = this.typeIndex.get(typeId);
    if (list) return list;
    const { data } = this.volume;
    const table = this.model.table.typeId;
    let n = 0;
    for (let i = 0; i < data.length; i++) if (data[i] !== 0 && table[data[i]] === typeId) n++;
    list = new Int32Array(n);
    n = 0;
    for (let i = 0; i < data.length; i++) if (data[i] !== 0 && table[data[i]] === typeId) list[n++] = i;
    if (this.typeIndex.size > 32) this.typeIndex.delete(this.typeIndex.keys().next().value!);
    this.typeIndex.set(typeId, list);
    return list;
  }

  private updateOutlines(): void {
    if (this.highlightTypes.length === 0) {
      this.outlines.clear();
      this.outlineInfo = { shown: 0, total: 0, limit: 'none' };
      return;
    }
    const { sizeX, sizeZ } = this.volume;
    const layerSize = sizeX * sizeZ;
    const lists = this.highlightTypes.map((t) => this.positionsOfType(t));
    // Indices are sorted by layer (y is the outermost axis), so a layer range is an index range.
    const rangeOf = (lo: number, hi: number) => lists.map((l) => [lowerBound(l, lo), lowerBound(l, hi)] as const);
    const count = (ranges: (readonly [number, number])[]) => ranges.reduce((n, [a, b]) => n + (b - a), 0);

    let lo = 0;
    let hi = Infinity;
    if (this.viewMode !== MODE_ALL) {
      hi = (this.viewLayer + 1) * layerSize;
      if (this.viewMode === MODE_SINGLE) lo = this.viewLayer * layerSize;
    }
    let ranges = rangeOf(lo, hi);
    const total = count(ranges);
    let limit: OutlineInfo['limit'] = 'none';
    if (total > MAX_OUTLINES) {
      if (this.viewMode === MODE_ALL) {
        this.outlines.clear();
        this.outlineInfo = { shown: 0, total, limit: 'off' };
        return;
      }
      ranges = rangeOf(this.viewLayer * layerSize, (this.viewLayer + 1) * layerSize);
      limit = 'layer';
    }

    const n = Math.min(count(ranges), MAX_OUTLINES);
    const out = new Float32Array(n * 3);
    let k = 0;
    for (let li = 0; li < lists.length && k < n; li++) {
      const l = lists[li];
      const [a, b] = ranges[li];
      for (let i = a; i < b && k < n; i++) {
        const idx = l[i];
        const y = Math.floor(idx / layerSize);
        const rem = idx - y * layerSize;
        const z = Math.floor(rem / sizeX);
        out[k * 3] = rem - z * sizeX;
        out[k * 3 + 1] = y;
        out[k * 3 + 2] = z;
        k++;
      }
    }
    this.outlines.set(out, k);
    this.outlineInfo = { shown: k, total, limit };
  }

  /** Outlines the blocks of a marked line (positions in volume coordinates), or clears them. */
  setMarked(positions: Float32Array | null, count: number): void {
    if (positions && count > 0) this.marks.set(positions, Math.min(count, MAX_OUTLINES));
    else this.marks.clear();
    this.onChange();
  }

  showHover(x: number, y: number, z: number, palette: number): void {
    const t = this.model.table;
    const boxes = t.kind[palette] === KIND_CUBE ? [0, 0, 0, 16, 16, 16] : t.shapes[t.shapeIndex[palette]]?.boxes ?? [0, 0, 0, 16, 16, 16];
    this.hover.show(x, y, z, boxes);
    this.onChange();
  }

  hideHover(): void {
    if (!this.hover.object.visible) return;
    this.hover.hide();
    this.onChange();
  }

  get triangleCount(): number {
    return (this.stats.opaqueQuads + this.stats.translucentQuads) * 2;
  }

  dispose(): void {
    this.disposed = true;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.pool.drop(this.projectId);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.materials.dispose();
    this.outlines.dispose();
    this.marks.dispose();
    this.hover.dispose();
    (this.layerFrame.material as THREE.Material).dispose();
    this.ground.traverse((o) => {
      const l = o as THREE.LineSegments;
      if (l.material) (l.material as THREE.Material).dispose();
    });
    this.scene.clear();
  }
}

function lowerBound(arr: Int32Array, value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
