import { AIR_NAME, isAirName, makeState, normalizeName, type BlockState } from '../blockstate';
import { NbtError, isCompound, type NbtCompound, type NbtValue } from '../nbt/types';
import { applyRenames } from '../renames';
import type { Volume } from '../volume';

/** Largest volume we accept (cells). Beyond that the browser would run out of memory. */
export const MAX_CELLS = 256 * 1024 * 1024;

export type FormatId = 'schem' | 'litematic' | 'structure' | 'tess';

/** What a format parser knows about the file besides the blocks. */
export interface FormatInfo {
  format: FormatId;
  formatLabel: string;
  formatVersion: number;
  dataVersion: number | null;
  /** Position of the minimum corner in the original coordinate system (world or schematic). */
  offset: [number, number, number] | null;
  /** WorldEdit clipboard origin relative to the minimum corner, if stored. */
  weOffset: [number, number, number] | null;
  blockEntityCount: number;
  entityCount: number;
  regions?: number;
  meta?: { name?: string; author?: string; description?: string };
  warnings: string[];
  renames: { from: string; to: string }[];
}

export interface FormatResult {
  volume: Volume;
  info: FormatInfo;
}

/**
 * Builds a normalised, project-local palette: index 0 is air, air variants and structure voids map
 * to air, states are canonical and renamed to the target version, duplicates are merged.
 */
export class PaletteBuilder {
  readonly palette: BlockState[] = [makeState(AIR_NAME)];
  readonly renames: { from: string; to: string }[] = [];
  private readonly keyToIndex = new Map<string, number>([[AIR_NAME, 0]]);

  constructor(private readonly dataVersion: number | null) {}

  add(raw: BlockState): number {
    const { state, renamedFrom } = applyRenames(raw, this.dataVersion);
    if (renamedFrom) this.renames.push({ from: renamedFrom, to: state.key });
    if (isAirName(state.name) || state.name === 'minecraft:structure_void') return 0;
    let index = this.keyToIndex.get(state.key);
    if (index === undefined) {
      index = this.palette.length;
      if (index > 0xffff) throw new NbtError('Die Palette hat mehr als 65535 Einträge.');
      this.palette.push(state);
      this.keyToIndex.set(state.key, index);
    }
    return index;
  }
}

/** Block state from a palette compound {Name: "minecraft:…", Properties: {…}} (litematic, structure). */
export function stateFromCompound(c: NbtValue): BlockState {
  if (!isCompound(c) || typeof c.Name !== 'string') throw new NbtError('Paletteneintrag ohne Blocknamen.');
  const props: Record<string, string> = {};
  const p = c.Properties;
  if (isCompound(p)) {
    for (const [k, v] of Object.entries(p)) props[k.toLowerCase()] = String(v).toLowerCase();
  }
  return makeState(normalizeName(c.Name), props);
}

export function checkCells(sx: number, sy: number, sz: number): number {
  const cells = sx * sy * sz;
  if (cells > MAX_CELLS) {
    throw new NbtError(
      `Die Datei ist mit ${sx}×${sy}×${sz} Blöcken zu groß (maximal ${MAX_CELLS.toLocaleString('de-DE')} Zellen).`,
    );
  }
  return cells;
}

export function asIntList(v: NbtValue | undefined, what: string): number[] {
  if (v instanceof Int32Array) return Array.from(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return v as number[];
  throw new NbtError(`${what} fehlt oder hat das falsche Format.`);
}

export function compoundList(v: NbtValue | undefined): NbtCompound[] {
  return Array.isArray(v) ? (v.filter((x) => isCompound(x)) as NbtCompound[]) : [];
}
