import { CellSet } from './cells';
import { pack3 } from './compile-base';
import type { FormObj } from './compile-forms';
import type { ChunkWatcher, Grid } from './grid';
import type { BlockSpec, RoleRef } from './palette';
import type { RoofBlock, RoofDef } from './roof';

/**
 * Roof groups (Bau-Sprache 2, 5.3): roofs whose base areas touch are drawn together as one roof.
 * A new roof of a group used to draw the whole group again; now only a window around the change
 * is drawn again (compile-roofs.ts), with the same blocks as before. For that a group keeps the
 * blocks it would draw (its target) and the grid tells it when a later statement changes one of
 * those cells, so that the rules for such cells (kept, placed between two roofs) are checked
 * again where something happened.
 */

export interface RoofExtra {
  role: RoleRef;
  giebel: RoleRef;
  firstzier: BlockSpec | null;
  spitze: BlockSpec | null;
  form: FormObj;
  line: number;
}

/** Box of cells (inclusive). */
export interface CellBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
}

export class RoofGroup implements ChunkWatcher {
  roofs: RoofDef[] = [];
  /** Per roof: role, giebel role, decorations. */
  extra: RoofExtra[] = [];
  /** Cells the group placed when it was last drawn. */
  placed = new Set<number>();
  /**
   * Cells of the group's blocks that later statements replaced or cleared, with the sequence
   * number of the roof statement that noticed it: only roofs from then on may build there again.
   */
  kept = new Map<number, number>();
  /** Order of the groups (Compiler.groups): larger is later. */
  stamp = 0;

  // ---- Drawing a part of the group. Valid when `ready`; a drawing of the whole group sets it.

  ready = false;
  /** A drawing threw half-way: the group is drawn whole from now on. */
  broken = false;
  /** Blocks of the whole group as renderRoofs gives them, by cell (roof = index in roofs). */
  target = new Map<number, RoofBlock>();
  /** Cells of the target that something changed since the group was last drawn. */
  readonly dirty = new Set<number>();
  /** Roofs with their Krüppelwalm hips resolved for the group (same order as roofs). */
  resolved: RoofDef[] = [];
  /** Free gable ends of the Krüppelwalm roofs, by roof index. */
  free = new Map<number, [boolean, boolean]>();
  /** Index of each roof in roofs. */
  index = new Map<RoofDef, number>();
  /** Tip cells of the target by roof index. */
  tips = new Map<number, Set<number>>();
  /** Largest shell thickness (dicke) of the roofs. */
  dicke = 1;
  /** Origins of the roofs (their blocks are the group's own). */
  origins = new Set<number>();
  /** Sequence number of the earliest roof (blocks placed later between the roofs stay). */
  firstSeq = 0;
  /** Palette seed when the group was drawn (block variants depend on it). */
  seed = 0;
  /** Watched chunks: chunk key → one cell of the chunk. */
  readonly watched = new Map<number, number>();

  cellChanged(x: number, y: number, z: number): void {
    const k = pack3(x, y, z);
    if (this.target.has(k)) this.dirty.add(k);
  }

  /** Watches the chunks of the given target cells. */
  watch(grid: Grid, blocks: Iterable<RoofBlock>): void {
    for (const b of blocks) {
      const ck = ((b.x >> 4) + 1024) * 4194304 + ((b.y >> 4) + 1024) * 2048 + ((b.z >> 4) + 1024);
      if (this.watched.has(ck)) continue;
      this.watched.set(ck, pack3(b.x, b.y, b.z));
      grid.watch(b.x, b.y, b.z, this);
    }
  }

  /** Ends all watches (merged into another group, drawn whole from now on, or compiling is done). */
  unwatch(grid: Grid, unpack: (k: number) => [number, number, number]): void {
    for (const k of this.watched.values()) {
      const [x, y, z] = unpack(k);
      grid.unwatch(x, y, z, this);
    }
    this.watched.clear();
  }
}

// ---------------------------------------------------------------------------

const BUCKET_BITS = 4;

/** Box of everything a roof can draw: its layers in all variants, eaves below, spire above. */
function roofBox(r: RoofDef): CellBox {
  const sets = [r.base, ...r.layers];
  let n = r.layers.length;
  if (r.hip) {
    // Without hips the layers are widest and highest.
    const v = r.hip.variant(false, false);
    sets.push(...v.layers);
    n = Math.max(n, v.layers.length);
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const s of sets) {
    if (s.isEmpty()) continue;
    x0 = Math.min(x0, s.x0);
    z0 = Math.min(z0, s.z0);
    x1 = Math.max(x1, s.x1);
    z1 = Math.max(z1, s.z1);
  }
  if (x0 === Infinity) x0 = z0 = x1 = z1 = 0;
  return { x0, z0, x1, z1, y0: r.yb - 1, y1: r.yb + n };
}

function bucketKey(bx: number, bz: number): number {
  return (bx + 65536) * 131072 + (bz + 65536);
}

/** All roofs of a compile run by area (buckets of 16×16 columns), to find the roofs near a place. */
export class RoofIndex {
  private readonly buckets = new Map<number, RoofDef[]>();
  private readonly boxes = new Map<RoofDef, CellBox>();

  add(r: RoofDef): void {
    const b = roofBox(r);
    this.boxes.set(r, b);
    for (let bx = b.x0 >> BUCKET_BITS; bx <= b.x1 >> BUCKET_BITS; bx++) {
      for (let bz = b.z0 >> BUCKET_BITS; bz <= b.z1 >> BUCKET_BITS; bz++) {
        const k = bucketKey(bx, bz);
        const list = this.buckets.get(k);
        if (list) list.push(r);
        else this.buckets.set(k, [r]);
      }
    }
  }

  box(r: RoofDef): CellBox {
    return this.boxes.get(r)!;
  }

  /** Roofs whose box meets the columns x0..x1, z0..z1, each once. */
  near(x0: number, z0: number, x1: number, z1: number): RoofDef[] {
    const out = new Set<RoofDef>();
    for (let bx = x0 >> BUCKET_BITS; bx <= x1 >> BUCKET_BITS; bx++) {
      for (let bz = z0 >> BUCKET_BITS; bz <= z1 >> BUCKET_BITS; bz++) {
        const list = this.buckets.get(bucketKey(bx, bz));
        if (!list) continue;
        for (const r of list) {
          const b = this.boxes.get(r)!;
          if (b.x0 <= x1 && b.x1 >= x0 && b.z0 <= z1 && b.z1 >= z0) out.add(r);
        }
      }
    }
    return [...out];
  }
}

// ---------------------------------------------------------------------------

/**
 * Position of a block in the order renderRoofs returns them: layer by layer the surface (then
 * the seal blocks of the layer), then per roof gables, verges and eaves, then decorations and
 * spires. Blocks of a part of a group are placed in this order, as when the whole group is drawn.
 */
export function blockOrder(b: RoofBlock, roofs: readonly RoofDef[]): number[] {
  switch (b.kind) {
    case 'gable': {
      const g = roofs[b.roof].gables[b.line!];
      return [1, b.roof, b.line!, b.y, g.axis === 'x' ? b.x : b.z, 0];
    }
    case 'verge':
      return [2, b.roof, b.line!, b.y + 1, b.z, b.x];
    case 'eave':
      return [3, b.roof, b.z, b.x, 0, 0];
    case 'deco':
      return [4, b.y - 1, b.z, b.x, 0, 0];
    case 'spire':
      return [5, b.roof, 0, 0, 0, 0];
    default:
      return [0, b.y, b.seal ? 1 : 0, b.z, b.x, 0];
  }
}

export function compareOrder(p: readonly number[], q: readonly number[]): number {
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i];
  return 0;
}

/** Cells of a set inside the columns of a box. */
export function clipSet(s: CellSet, b: CellBox): CellSet {
  if (s.isEmpty() || s.x1 < b.x0 || s.x0 > b.x1 || s.z1 < b.z0 || s.z0 > b.z1) return CellSet.EMPTY;
  if (s.x0 >= b.x0 && s.x1 <= b.x1 && s.z0 >= b.z0 && s.z1 <= b.z1) return s;
  return CellSet.build(Math.max(s.x0, b.x0), Math.max(s.z0, b.z0), Math.min(s.x1, b.x1), Math.min(s.z1, b.z1), (x, z) => s.has(x, z));
}

export function inBox(b: CellBox, x: number, y: number, z: number): boolean {
  return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1;
}
