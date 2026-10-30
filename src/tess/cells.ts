import type { Facing } from './geometry';

/**
 * Sets of cells in one layer (x, z), stored as a bitmap over their bounding rectangle. Forms,
 * profiles and roofs are computed with them: outlines, offsets (Chebyshev dilation and erosion),
 * differences between layers, distances.
 */

/** Side directions in the order the language uses for ties: n, o, s, w. */
export const SIDES: readonly { dx: number; dz: number; facing: Facing; bit: number }[] = [
  { dx: 0, dz: -1, facing: 'north', bit: 1 },
  { dx: 1, dz: 0, facing: 'east', bit: 2 },
  { dx: 0, dz: 1, facing: 'south', bit: 4 },
  { dx: -1, dz: 0, facing: 'west', bit: 8 },
];
export const ALL_SIDES = 15;
export const DIAGONALS: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export function sideBit(f: Facing): number {
  return f === 'north' ? 1 : f === 'east' ? 2 : f === 'south' ? 4 : 8;
}

export class CellSet {
  private constructor(
    readonly x0: number,
    readonly z0: number,
    readonly w: number,
    readonly h: number,
    readonly bits: Uint8Array,
    readonly count: number,
  ) {}

  static readonly EMPTY = new CellSet(0, 0, 0, 0, new Uint8Array(0), 0);

  /** Cells x0..x1, z0..z1 (inclusive) for which `pred` holds. */
  static build(x0: number, z0: number, x1: number, z1: number, pred: (x: number, z: number) => boolean): CellSet {
    if (x1 < x0 || z1 < z0) return CellSet.EMPTY;
    const w = x1 - x0 + 1;
    const h = z1 - z0 + 1;
    const bits = new Uint8Array(w * h);
    let n = 0;
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++)
        if (pred(x0 + x, z0 + z)) {
          bits[z * w + x] = 1;
          n++;
        }
    return n === 0 ? CellSet.EMPTY : new CellSet(x0, z0, w, h, bits, n).trim();
  }

  static rect(xa: number, za: number, xb: number, zb: number): CellSet {
    if (xb < xa || zb < za) return CellSet.EMPTY;
    const w = xb - xa + 1;
    const h = zb - za + 1;
    return new CellSet(xa, za, w, h, new Uint8Array(w * h).fill(1), w * h);
  }

  static fromCells(cells: Iterable<readonly [number, number]>): CellSet {
    const list = [...cells];
    if (!list.length) return CellSet.EMPTY;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of list) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const w = x1 - x0 + 1;
    const h = z1 - z0 + 1;
    const bits = new Uint8Array(w * h);
    let n = 0;
    for (const [x, z] of list) {
      const i = (z - z0) * w + (x - x0);
      if (!bits[i]) {
        bits[i] = 1;
        n++;
      }
    }
    return new CellSet(x0, z0, w, h, bits, n);
  }

  get x1(): number {
    return this.x0 + this.w - 1;
  }

  get z1(): number {
    return this.z0 + this.h - 1;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  has(x: number, z: number): boolean {
    const dx = x - this.x0;
    const dz = z - this.z0;
    if (dx < 0 || dz < 0 || dx >= this.w || dz >= this.h) return false;
    return this.bits[dz * this.w + dx] === 1;
  }

  forEach(fn: (x: number, z: number) => void): void {
    const { w, h, bits, x0, z0 } = this;
    for (let z = 0; z < h; z++) {
      const row = z * w;
      for (let x = 0; x < w; x++) if (bits[row + x]) fn(x0 + x, z0 + z);
    }
  }

  list(): [number, number][] {
    const out: [number, number][] = [];
    this.forEach((x, z) => out.push([x, z]));
    return out;
  }

  /** Same cells in the smallest bounding rectangle. */
  private trim(): CellSet {
    if (this.count === 0) return CellSet.EMPTY;
    let xa = Infinity, za = Infinity, xb = -1, zb = -1;
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++)
        if (this.bits[z * this.w + x]) {
          if (x < xa) xa = x;
          if (x > xb) xb = x;
          if (z < za) za = z;
          if (z > zb) zb = z;
        }
    if (xa === 0 && za === 0 && xb === this.w - 1 && zb === this.h - 1) return this;
    const w = xb - xa + 1;
    const h = zb - za + 1;
    const bits = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) bits.set(this.bits.subarray((z + za) * this.w + xa, (z + za) * this.w + xa + w), z * w);
    return new CellSet(this.x0 + xa, this.z0 + za, w, h, bits, this.count);
  }

  shift(dx: number, dz: number): CellSet {
    if (this.count === 0 || (dx === 0 && dz === 0)) return this;
    return new CellSet(this.x0 + dx, this.z0 + dz, this.w, this.h, this.bits, this.count);
  }

  /** Chebyshev dilation: every cell within n steps (8-neighbourhood) of the set. */
  dilate(n: number): CellSet {
    if (n <= 0 || this.count === 0) return n < 0 ? this.erode(-n) : this;
    const w = this.w + 2 * n;
    const h = this.h + 2 * n;
    // Horizontal pass: prefix sums per row.
    const tmp = new Uint8Array(w * h);
    for (let z = 0; z < this.h; z++) {
      const pre = new Int32Array(this.w + 1);
      for (let x = 0; x < this.w; x++) pre[x + 1] = pre[x] + this.bits[z * this.w + x];
      for (let x = 0; x < w; x++) {
        // source columns x-2n .. x (in source coordinates: x - n - n .. x - n + n)
        const a = Math.max(0, x - 2 * n);
        const b = Math.min(this.w - 1, x);
        if (b >= a && pre[b + 1] - pre[a] > 0) tmp[(z + n) * w + x] = 1;
      }
    }
    const bits = new Uint8Array(w * h);
    let count = 0;
    for (let x = 0; x < w; x++) {
      const pre = new Int32Array(h + 1);
      for (let z = 0; z < h; z++) pre[z + 1] = pre[z] + tmp[z * w + x];
      for (let z = 0; z < h; z++) {
        const a = Math.max(0, z - n);
        const b = Math.min(h - 1, z + n);
        if (pre[b + 1] - pre[a] > 0) {
          bits[z * w + x] = 1;
          count++;
        }
      }
    }
    return new CellSet(this.x0 - n, this.z0 - n, w, h, bits, count);
  }

  /** Chebyshev erosion: cells whose whole (2n+1)² square lies in the set. */
  erode(n: number): CellSet {
    if (n <= 0 || this.count === 0) return n < 0 ? this.dilate(-n) : this;
    const { w, h } = this;
    const tmp = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) {
      const pre = new Int32Array(w + 1);
      for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + this.bits[z * w + x];
      for (let x = 0; x < w; x++) {
        const a = x - n;
        const b = x + n;
        if (a < 0 || b >= w) continue;
        if (pre[b + 1] - pre[a] === b - a + 1) tmp[z * w + x] = 1;
      }
    }
    const bits = new Uint8Array(w * h);
    let count = 0;
    for (let x = 0; x < w; x++) {
      const pre = new Int32Array(h + 1);
      for (let z = 0; z < h; z++) pre[z + 1] = pre[z] + tmp[z * w + x];
      for (let z = 0; z < h; z++) {
        const a = z - n;
        const b = z + n;
        if (a < 0 || b >= h) continue;
        if (pre[b + 1] - pre[a] === b - a + 1) {
          bits[z * w + x] = 1;
          count++;
        }
      }
    }
    return count === 0 ? CellSet.EMPTY : new CellSet(this.x0, this.z0, w, h, bits, count).trim();
  }

  private static combine(a: CellSet, b: CellSet, op: (p: boolean, q: boolean) => boolean, bounds: CellSet[]): CellSet {
    const live = bounds.filter((s) => s.count > 0);
    if (!live.length) return CellSet.EMPTY;
    const x0 = Math.min(...live.map((s) => s.x0));
    const z0 = Math.min(...live.map((s) => s.z0));
    const x1 = Math.max(...live.map((s) => s.x1));
    const z1 = Math.max(...live.map((s) => s.z1));
    return CellSet.build(x0, z0, x1, z1, (x, z) => op(a.has(x, z), b.has(x, z)));
  }

  union(b: CellSet): CellSet {
    if (b.count === 0) return this;
    if (this.count === 0) return b;
    return CellSet.combine(this, b, (p, q) => p || q, [this, b]);
  }

  minus(b: CellSet): CellSet {
    if (b.count === 0 || this.count === 0) return this;
    return CellSet.combine(this, b, (p, q) => p && !q, [this]);
  }

  intersect(b: CellSet): CellSet {
    if (b.count === 0 || this.count === 0) return CellSet.EMPTY;
    return CellSet.combine(this, b, (p, q) => p && q, [this]);
  }

  equals(b: CellSet): boolean {
    if (this.count !== b.count) return false;
    let same = true;
    this.forEach((x, z) => {
      if (same && !b.has(x, z)) same = false;
    });
    return same;
  }

  /** Bitmask of sides (SIDES bits) whose neighbour is outside the set. */
  openSides(x: number, z: number): number {
    let m = 0;
    for (const s of SIDES) if (!this.has(x + s.dx, z + s.dz)) m |= s.bit;
    return m;
  }

  /**
   * Steps to the outside over side neighbours: 1 for cells with a side neighbour outside,
   * 2 for the next ring … Returned as a map over the bounding rectangle (0 outside the set).
   */
  insideDistance(): Uint16Array {
    const { w, h, bits } = this;
    const d = new Uint16Array(w * h);
    const queue: number[] = [];
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (!bits[i]) continue;
        const edge = x === 0 || z === 0 || x === w - 1 || z === h - 1 || !bits[i - 1] || !bits[i + 1] || !bits[i - w] || !bits[i + w];
        if (edge) {
          d[i] = 1;
          queue.push(i);
        }
      }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % w;
      const z = (i - x) / w;
      const next = d[i] + 1;
      if (x > 0 && bits[i - 1] && !d[i - 1]) (d[i - 1] = next), queue.push(i - 1);
      if (x < w - 1 && bits[i + 1] && !d[i + 1]) (d[i + 1] = next), queue.push(i + 1);
      if (z > 0 && bits[i - w] && !d[i - w]) (d[i - w] = next), queue.push(i - w);
      if (z < h - 1 && bits[i + w] && !d[i + w]) (d[i + w] = next), queue.push(i + w);
    }
    return d;
  }

  /** Value of a map from insideDistance() at a cell (0 outside). */
  at(map: Uint16Array, x: number, z: number): number {
    const dx = x - this.x0;
    const dz = z - this.z0;
    if (dx < 0 || dz < 0 || dx >= this.w || dz >= this.h) return 0;
    return map[dz * this.w + dx];
  }

  /** Largest n for which erode(n) is not empty (how far the set reaches inwards). */
  depth(): number {
    let n = 0;
    let s: CellSet = this;
    while (!s.isEmpty()) {
      s = s.erode(1);
      if (!s.isEmpty()) n++;
    }
    return n;
  }
}

/**
 * Chebyshev distances (8-neighbourhood steps) from a source set, for the cells of `region`.
 * Cells of the source have distance 0; unreachable cells within maxD get maxD + 1.
 */
export class ChebDistance {
  private readonly map: Int32Array;
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;

  constructor(source: CellSet, region: CellSet, readonly maxD: number) {
    const parts = [source, region].filter((s) => !s.isEmpty());
    if (!parts.length) {
      this.x0 = this.z0 = this.w = this.h = 0;
      this.map = new Int32Array(0);
      return;
    }
    this.x0 = Math.min(...parts.map((s) => s.x0)) - 1;
    this.z0 = Math.min(...parts.map((s) => s.z0)) - 1;
    this.w = Math.max(...parts.map((s) => s.x1)) + 2 - this.x0;
    this.h = Math.max(...parts.map((s) => s.z1)) + 2 - this.z0;
    const { w, h } = this;
    const map = new Int32Array(w * h).fill(maxD + 1);
    const queue: number[] = [];
    source.forEach((x, z) => {
      const i = (z - this.z0) * w + (x - this.x0);
      map[i] = 0;
      queue.push(i);
    });
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const d = map[i];
      if (d >= maxD) continue;
      const x = i % w;
      const z = (i - x) / w;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const j = nz * w + nx;
          if (map[j] > d + 1) {
            map[j] = d + 1;
            queue.push(j);
          }
        }
    }
    this.map = map;
  }

  get(x: number, z: number): number {
    const dx = x - this.x0;
    const dz = z - this.z0;
    if (dx < 0 || dz < 0 || dx >= this.w || dz >= this.h) return this.maxD + 1;
    return this.map[dz * this.w + dx];
  }
}

/** First side neighbour (order n, o, s, w) that is in `target`, else null. */
export function sideTowards(x: number, z: number, target: (x: number, z: number) => boolean): Facing | null {
  for (const s of SIDES) if (target(x + s.dx, z + s.dz)) return s.facing;
  return null;
}

/**
 * Facing towards `target`: a side neighbour in order n, o, s, w; with only a diagonal
 * neighbour, along z or x towards it. Used by the parts that keep the rule of Etappe 4
 * (cornice, walkway, battlements, outer stairs, turret corbels); roofs, Kranzdach and the
 * corbels of 4.3 use `cornerFacing`.
 */
export function facingTowardsSet(x: number, z: number, target: (x: number, z: number) => boolean, diagonalAxis: 'x' | 'z'): Facing | null {
  const side = sideTowards(x, z, target);
  if (side) return side;
  for (const [dx, dz] of DIAGONALS) {
    if (!target(x + dx, z + dz)) continue;
    if (diagonalAxis === 'z') return dz < 0 ? 'north' : 'south';
    return dx < 0 ? 'west' : 'east';
  }
  return null;
}

/**
 * Facing of a roof stair, Kranzdach stair or corbel towards `target` (spec 4.3, 5.2, 5.5):
 * towards its side neighbour; with side neighbours around a corner (inner corner, valley)
 * along x, i.e. east or west; with only a diagonal neighbour (outer corner) along z. On a slant
 * that steps two cells at a time, inner and outer corners then face along different axes and
 * the connection pass turns them into a zigzag of corners, alike on all four slants. Opposite
 * neighbours only (a gap): east before west, north before south.
 */
export function cornerFacing(x: number, z: number, target: (x: number, z: number) => boolean): Facing | null {
  if (target(x + 1, z)) return 'east';
  if (target(x - 1, z)) return 'west';
  if (target(x, z - 1)) return 'north';
  if (target(x, z + 1)) return 'south';
  for (const [dx, dz] of DIAGONALS) if (target(x + dx, z + dz)) return dz < 0 ? 'north' : 'south';
  return null;
}
