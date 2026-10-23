import { makeState, type BlockState } from '../core/blockstate';
import { TessError } from './syntax';

/**
 * Sparse block grid the compiler writes into. Coordinates may be negative; the size of the
 * result follows from the content (no fixed work area). Besides the block, each cell remembers
 * what put it there, so Bauteile can check where they land (a window in a beam, a door in mid-air).
 */

/** What a cell belongs to. */
export const Part = {
  Plain: 0,
  /** Corner posts and timber frame posts: windows and doors should not cut through them. */
  Structure: 1,
  /** Horizontal beams (timber frame sill and top, kranz): a door may cut the sill. */
  Beam: 5,
  /** Window and door openings with their frame. */
  Opening: 2,
  Roof: 3,
  /** Attachments outside the wall: sills, shutters. */
  Attachment: 4,
} as const;
export type Part = (typeof Part)[keyof typeof Part];

export const LIMIT = 2000;
const OFF = 2048;
const SPAN = 4096;

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
  line: number;
}

export class Grid {
  /** Local palette; index = position. */
  readonly states: BlockState[] = [];
  private readonly stateIndex = new Map<string, number>();
  readonly cells = new Map<number, number>();
  private readonly info = new Map<number, number>();

  stateId(s: BlockState): number {
    let i = this.stateIndex.get(s.key);
    if (i === undefined) {
      i = this.states.length;
      this.states.push(s);
      this.stateIndex.set(s.key, i);
    }
    return i;
  }

  set(x: number, y: number, z: number, state: BlockState, part: Part, line: number): void {
    if (Math.abs(x) > LIMIT || Math.abs(y) > LIMIT || Math.abs(z) > LIMIT) {
      throw new TessError(line, `Die Position ${x},${y},${z} liegt zu weit draußen (erlaubt sind −${LIMIT} bis ${LIMIT}).`);
    }
    const k = cellKey(x, y, z);
    this.cells.set(k, this.stateId(state));
    this.info.set(k, part | (line << 3));
  }

  clear(x: number, y: number, z: number): void {
    const k = cellKey(x, y, z);
    this.cells.delete(k);
    this.info.delete(k);
  }

  get(x: number, y: number, z: number): BlockState | null {
    const i = this.cells.get(cellKey(x, y, z));
    return i === undefined ? null : this.states[i];
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(cellKey(x, y, z));
  }

  cellInfo(x: number, y: number, z: number): CellInfo | null {
    const v = this.info.get(cellKey(x, y, z));
    return v === undefined ? null : { part: (v & 7) as Part, line: v >>> 3 };
  }

  /** Replaces the state of an occupied cell, keeping its origin (used by the connection pass). */
  replace(k: number, state: BlockState): void {
    this.cells.set(k, this.stateId(state));
  }

  get size(): number {
    return this.cells.size;
  }

  /** States that at least one cell uses (the local palette also keeps replaced ones). */
  usedStates(): BlockState[] {
    const used = new Set(this.cells.values());
    return this.states.filter((_, i) => used.has(i));
  }
}

export function air(): BlockState {
  return makeState('minecraft:air');
}
