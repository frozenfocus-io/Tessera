import { makeState, type BlockState } from '../core/blockstate';
import { TessError } from './syntax';

/**
 * Sparse block grid the compiler writes into. Coordinates may be negative; the size of the
 * result follows from the content (no fixed work area). Besides the block, each cell remembers
 * what put it there: the kind of part (so Bauteile can check where they land, e.g. a window in a
 * beam) and the origin (the statement that set it, shown in the hover card).
 *
 * Storage: chunks of 16×16×16 cells with typed arrays (state index and packed part/origin),
 * looked up through a map of chunk keys. That keeps large plans fast and compact compared with
 * one map entry per block.
 */

/** What a cell belongs to. */
export const Part = {
  Plain: 0,
  /** Corner posts and timber frame posts: windows and doors should not cut through them. */
  Structure: 1,
  /** Window and door openings with their frame. */
  Opening: 2,
  Roof: 3,
  /** Attachments outside the wall: sills, shutters. */
  Attachment: 4,
  /** Horizontal beams (timber frame sill, top, rails, kranz): a door may cut the sill. */
  Beam: 5,
  /** Diagonal braces of a timber frame. */
  Strut: 6,
} as const;
export type Part = (typeof Part)[keyof typeof Part];

/** Coordinate limit of Bau-Sprache 1 (Bau-Sprache 2 allows 4000). */
export const LIMIT = 2000;
export const LIMIT_V2 = 4000;

const OFF = 4096;
const SPAN = 8192;

/** Number key of a cell (used by sets and maps of cells outside the grid). */
export function cellKey(x: number, y: number, z: number): number {
  return ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF);
}

export function keyToCell(k: number): [number, number, number] {
  const z = (k % SPAN) - OFF;
  const r = Math.floor(k / SPAN);
  const y = (r % SPAN) - OFF;
  const x = Math.floor(r / SPAN) - OFF;
  return [x, y, z];
}

export interface CellInfo {
  part: Part;
  /** Line of the statement that set the cell (first line of the statement). */
  line: number;
  /** Origin id (index into Grid.origins). */
  origin: number;
}

/** Where a block comes from: the statement line and, inside modules, the chain of calls. */
export interface Origin {
  line: number;
  /** Lines of the module calls that led here, innermost last (empty outside modules). */
  chain: readonly number[];
}

const BITS = 4;
const SIZE = 1 << BITS; // 16
const MASK = SIZE - 1;
const CELLS = SIZE * SIZE * SIZE;
const COFF = 512; // chunk coordinate offset
const CSPAN = 1024;

export class Chunk {
  /** State index per cell, 0 = empty. */
  readonly ids = new Uint16Array(CELLS);
  /** part | origin << 3 */
  readonly info = new Uint32Array(CELLS);
  count = 0;
  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
  ) {}
}

function chunkKey(cx: number, cy: number, cz: number): number {
  return ((cx + COFF) * CSPAN + (cy + COFF)) * CSPAN + (cz + COFF);
}

export class Grid {
  /** Local palette; index 0 is the empty cell. */
  readonly states: BlockState[] = [makeState('minecraft:air')];
  private readonly stateIndex = new Map<string, number>();
  readonly chunks = new Map<number, Chunk>();
  /** Origins of blocks; index 0 = unknown. */
  readonly origins: Origin[] = [{ line: 0, chain: [] }];
  private readonly originIndex = new Map<string, number>();
  private cells = 0;
  private last: Chunk | null = null;
  private lastKey = -1;
  /** Counts every set (statement limits). */
  sets = 0;

  constructor(readonly limit = LIMIT) {}

  stateId(s: BlockState): number {
    let i = this.stateIndex.get(s.key);
    if (i === undefined) {
      i = this.states.length;
      if (i > 0xffff) throw new TessError(0, 'Der Bauplan hat mehr als 65535 verschiedene Blockzustände.');
      this.states.push(s);
      this.stateIndex.set(s.key, i);
    }
    return i;
  }

  originId(line: number, chain: readonly number[] = []): number {
    const key = chain.length ? `${line}|${chain.join(',')}` : String(line);
    let i = this.originIndex.get(key);
    if (i === undefined) {
      i = this.origins.length;
      this.origins.push({ line, chain: [...chain] });
      this.originIndex.set(key, i);
    }
    return i;
  }

  private chunkAt(x: number, y: number, z: number, create: boolean): Chunk | null {
    const cx = x >> BITS;
    const cy = y >> BITS;
    const cz = z >> BITS;
    const k = chunkKey(cx, cy, cz);
    if (k === this.lastKey) return this.last;
    let c = this.chunks.get(k);
    if (!c) {
      if (!create) return null;
      c = new Chunk(cx, cy, cz);
      this.chunks.set(k, c);
    }
    this.last = c;
    this.lastKey = k;
    return c;
  }

  private check(x: number, y: number, z: number, line: number): void {
    const l = this.limit;
    if (x > l || x < -l || y > l || y < -l || z > l || z < -l) {
      throw new TessError(line, `Die Position ${x},${y},${z} liegt zu weit draußen (erlaubt sind −${l} bis ${l}).`);
    }
  }

  /** Sets a block (version 1 signature: the origin is the line). */
  set(x: number, y: number, z: number, state: BlockState, part: Part, line: number): void {
    this.check(x, y, z, line);
    this.put(x, y, z, this.stateId(state), part, this.originId(line));
  }

  /** Sets a block by state index and origin id. */
  setId(x: number, y: number, z: number, id: number, part: Part, origin: number): void {
    this.check(x, y, z, this.origins[origin]?.line ?? 0);
    this.put(x, y, z, id, part, origin);
  }

  private put(x: number, y: number, z: number, id: number, part: Part, origin: number): void {
    const c = this.chunkAt(x, y, z, true)!;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    if (c.ids[i] === 0) {
      c.count++;
      this.cells++;
    }
    c.ids[i] = id;
    c.info[i] = part | (origin << 3);
    this.sets++;
  }

  clear(x: number, y: number, z: number): void {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    if (c.ids[i] === 0) return;
    c.ids[i] = 0;
    c.info[i] = 0;
    c.count--;
    this.cells--;
  }

  getId(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return 0;
    return c.ids[((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK)];
  }

  get(x: number, y: number, z: number): BlockState | null {
    const id = this.getId(x, y, z);
    return id === 0 ? null : this.states[id];
  }

  has(x: number, y: number, z: number): boolean {
    return this.getId(x, y, z) !== 0;
  }

  /** Part and origin of an occupied cell, null for an empty one. */
  cellInfo(x: number, y: number, z: number): CellInfo | null {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return null;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    if (c.ids[i] === 0) return null;
    const v = c.info[i];
    const origin = v >>> 3;
    return { part: (v & 7) as Part, origin, line: this.origins[origin]?.line ?? 0 };
  }

  /** Origin id of a cell (0 for empty cells). */
  originAt(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return 0;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    return c.ids[i] === 0 ? 0 : c.info[i] >>> 3;
  }

  /** Replaces the state of an occupied cell, keeping part and origin (connection pass). */
  replaceId(x: number, y: number, z: number, id: number): void {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    if (c.ids[i] !== 0) c.ids[i] = id;
  }

  replace(x: number, y: number, z: number, state: BlockState): void {
    this.replaceId(x, y, z, this.stateId(state));
  }

  /** Visits every occupied cell. */
  forEach(fn: (x: number, y: number, z: number, id: number, info: number) => void): void {
    for (const c of this.chunks.values()) {
      if (c.count === 0) continue;
      const bx = c.cx << BITS;
      const by = c.cy << BITS;
      const bz = c.cz << BITS;
      const { ids, info } = c;
      for (let i = 0; i < CELLS; i++) {
        const id = ids[i];
        if (id === 0) continue;
        fn(bx + (i & MASK), by + (i >> 8), bz + ((i >> 4) & MASK), id, info[i]);
      }
    }
  }

  /** All occupied cells as [x, y, z, state] (tests and small tools). */
  entries(): [number, number, number, BlockState][] {
    const out: [number, number, number, BlockState][] = [];
    this.forEach((x, y, z, id) => out.push([x, y, z, this.states[id]]));
    return out;
  }

  get size(): number {
    return this.cells;
  }

  /** States that at least one cell uses (the local palette also keeps replaced ones). */
  usedStates(): BlockState[] {
    const used = new Uint8Array(this.states.length);
    for (const c of this.chunks.values()) {
      if (c.count === 0) continue;
      const ids = c.ids;
      for (let i = 0; i < CELLS; i++) used[ids[i]] = 1;
    }
    return this.states.filter((_, i) => i > 0 && used[i]);
  }

  /** Inclusive bounds of all occupied cells, null when empty. */
  bounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of this.chunks.values()) {
      if (c.count === 0) continue;
      const bx = c.cx << BITS;
      const by = c.cy << BITS;
      const bz = c.cz << BITS;
      // Whole chunk inside the current bounds: nothing to learn.
      if (bx >= minX && bx + MASK <= maxX && by >= minY && by + MASK <= maxY && bz >= minZ && bz + MASK <= maxZ) continue;
      const ids = c.ids;
      for (let i = 0; i < CELLS; i++) {
        if (ids[i] === 0) continue;
        const x = bx + (i & MASK);
        const y = by + (i >> 8);
        const z = bz + ((i >> 4) & MASK);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (minX === Infinity) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }
}

export function air(): BlockState {
  return makeState('minecraft:air');
}
