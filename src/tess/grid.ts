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
  /** Window glass and door leaves (Bau-Sprache 1: also their frame). */
  Opening: 2,
  Roof: 3,
  /** Attachments outside the wall: sills, shutters, lanterns, railings. */
  Attachment: 4,
  /** Horizontal beams (timber frame sill, top, rails, kranz): a door may cut the sill. */
  Beam: 5,
  /** Diagonal braces of a timber frame. */
  Strut: 6,
  /** Bau-Sprache 2: frames of windows, doors and gates (lintel, reveal, arch stairs, bars). */
  Frame: 7,
  /** Bau-Sprache 2: Anbauten (balcony, walkway, oriel, dormer, corner turrets). */
  Annex: 8,
} as const;
export type Part = (typeof Part)[keyof typeof Part];

/** Bits of the part in a cell's info word; the origin id takes the rest. */
const PART_BITS = 4;
const PART_MASK = (1 << PART_BITS) - 1;

/** Part of a raw info word (Chunk.info, Grid.forEach). */
export function infoPart(v: number): Part {
  return (v & PART_MASK) as Part;
}

/** Origin id of a raw info word. */
export function infoOrigin(v: number): number {
  return v >>> PART_BITS;
}

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
  /** Bauabschnitt (index into Grid.sections; 0 = none). */
  section: number;
  /** Inside modules: "in modul turm, gebaut in Zeile 88" (innermost first). */
  ctx: string;
}

const BITS = 4;
const SIZE = 1 << BITS; // 16
const MASK = SIZE - 1;
const CELLS = SIZE * SIZE * SIZE;
const COFF = 512; // chunk coordinate offset
const CSPAN = 1024;

/** Told about every change of a cell in a watched chunk (roof groups of the compiler). */
export interface ChunkWatcher {
  cellChanged(x: number, y: number, z: number): void;
}

export class Chunk {
  /** State index per cell, 0 = empty. */
  readonly ids = new Uint16Array(CELLS);
  /** part | origin << 4 */
  readonly info = new Uint32Array(CELLS);
  count = 0;
  /** Watchers of the chunk (Grid.watch), null when nobody watches. */
  watchers: ChunkWatcher[] | null = null;
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
  readonly origins: Origin[] = [{ line: 0, chain: [], section: 0, ctx: '' }];
  /** Bauabschnitte by index; 0 is "no section". */
  readonly sections: string[] = [''];
  private readonly originIndex = new Map<string, number>();
  /** Watchers of chunks that do not exist yet; they move to the chunk when it is made. */
  private readonly pendingWatchers = new Map<number, ChunkWatcher[]>();
  private cells = 0;
  private last: Chunk | null = null;
  private lastKey = -1;
  /** Counts every set (tests). */
  sets = 0;
  /** Cells the connection pass leaves alone (zeichen … fest=ja); a later set or clear frees them. */
  readonly fixed = new Set<number>();

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

  /**
   * Origin id of a statement (line and module chain). A tag keeps parts of one statement apart
   * (a dormer's roof and its walls) while the hover shows the same line.
   */
  originId(line: number, chain: readonly number[] = [], tag = '', section = 0, ctx = ''): number {
    const key = (chain.length ? `${line}|${chain.join(',')}` : String(line)) + (tag ? `#${tag}` : '') + (section ? `§${section}` : '');
    let i = this.originIndex.get(key);
    if (i === undefined) {
      i = this.origins.length;
      this.origins.push({ line, chain: [...chain], section, ctx });
      this.originIndex.set(key, i);
    }
    return i;
  }

  /** Takes origins and sections of another grid (same ids), for a turned copy. */
  copyMeta(from: Grid): void {
    this.origins.length = 0;
    this.origins.push(...from.origins);
    this.originIndex.clear();
    for (const [k, v] of from.originIndex) this.originIndex.set(k, v);
    this.sections.length = 0;
    this.sections.push(...from.sections);
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
      const w = this.pendingWatchers.get(k);
      if (w) {
        c.watchers = w;
        this.pendingWatchers.delete(k);
      }
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
    c.info[i] = (part | (origin << PART_BITS)) >>> 0;
    this.sets++;
    if (this.fixed.size) this.fixed.delete(cellKey(x, y, z));
    if (c.watchers) this.changed(c.watchers, x, y, z);
  }

  clear(x: number, y: number, z: number): void {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    if (c.ids[i] === 0) return;
    c.ids[i] = 0;
    c.info[i] = 0;
    if (this.fixed.size) this.fixed.delete(cellKey(x, y, z));
    c.count--;
    this.cells--;
    if (c.watchers) this.changed(c.watchers, x, y, z);
  }

  private changed(watchers: ChunkWatcher[], x: number, y: number, z: number): void {
    for (const w of watchers) w.cellChanged(x, y, z);
  }

  /** Tells w about every later change of a cell in the chunk of (x, y, z). */
  watch(x: number, y: number, z: number, w: ChunkWatcher): void {
    const k = chunkKey(x >> BITS, y >> BITS, z >> BITS);
    const c = this.chunks.get(k);
    if (c) {
      c.watchers ??= [];
      if (!c.watchers.includes(w)) c.watchers.push(w);
      return;
    }
    const p = this.pendingWatchers.get(k);
    if (!p) this.pendingWatchers.set(k, [w]);
    else if (!p.includes(w)) p.push(w);
  }

  /** Ends watch(x, y, z, w). */
  unwatch(x: number, y: number, z: number, w: ChunkWatcher): void {
    const k = chunkKey(x >> BITS, y >> BITS, z >> BITS);
    const c = this.chunks.get(k);
    const list = c ? c.watchers : this.pendingWatchers.get(k);
    if (!list) return;
    const i = list.indexOf(w);
    if (i >= 0) list.splice(i, 1);
    if (list.length) return;
    if (c) c.watchers = null;
    else this.pendingWatchers.delete(k);
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
    const origin = v >>> PART_BITS;
    return { part: (v & PART_MASK) as Part, origin, line: this.origins[origin]?.line ?? 0 };
  }

  /** Origin id of a cell (0 for empty cells). */
  originAt(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return 0;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    return c.ids[i] === 0 ? 0 : c.info[i] >>> PART_BITS;
  }

  /** Raw info word of a cell (part and origin), 0 for empty cells. */
  infoAt(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return 0;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    return c.ids[i] === 0 ? 0 : c.info[i];
  }

  /** Replaces the state of an occupied cell, keeping part and origin (connection pass). */
  replaceId(x: number, y: number, z: number, id: number): void {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return;
    const i = ((y & MASK) << 8) | ((z & MASK) << 4) | (x & MASK);
    if (c.ids[i] === 0) return;
    c.ids[i] = id;
    if (c.watchers) this.changed(c.watchers, x, y, z);
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
