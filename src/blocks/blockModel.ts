import type { BlockState } from '../core/blockstate';
import { resolveFromCatalog } from '../catalog/runtime';
import type { Catalog } from '../catalog/types';
import { resolveColors, type ResolvedColors } from './colors';
import { itemCosts, type ItemCost } from './items';
import { readableName } from './names';
import { buildShapeGeometry, FACE_STRIDE, type ShapeGeometry } from './shapeGeometry';
import { resolveShape, type ShapeSpec } from './shapes';

export const KIND_NONE = 0;
export const KIND_CUBE = 1;
export const KIND_SHAPE = 2;
export const KIND_CROSS = 3;

export const FLAG_OCCLUDES = 1;
export const FLAG_TRANSLUCENT = 2;
export const FLAG_CULL_SAME = 4;
export const FLAG_MARKED = 8;

/**
 * Compact per-palette rendering data. Built once per project and sent to the mesh workers.
 * Only plain typed arrays and objects so it survives structured cloning.
 */
export interface RenderTable {
  size: number;
  kind: Uint8Array;
  flags: Uint8Array;
  typeId: Uint16Array;
  /** 0xRRGGBB per face, 6 entries per palette index (face order of faces.ts). */
  faceColors: Uint32Array;
  /** Index into `shapes` for KIND_SHAPE / KIND_CROSS, else -1. */
  shapeIndex: Int32Array;
  /**
   * Bit d set if the block fully covers its side in direction d (face order of faces.ts) with an
   * opaque surface. A neighbour's face towards a fully covered side is hidden.
   */
  fullSides: Uint8Array;
  shapes: ShapeGeometry[];
}

export interface PaletteEntryInfo {
  state: BlockState;
  typeId: number;
  colors: ResolvedColors;
  shape: ShapeSpec;
  items: ItemCost[];
}

/** One block type = one block id, regardless of its state (all oak stairs are one type). */
export interface BlockTypeInfo {
  typeId: number;
  name: string;
  displayName: string;
  marked: boolean;
  swatch: number;
  /** Mod the block comes from, when the catalog knows it. */
  mod?: string;
  /** Family base block id, when the catalog knows it. */
  family?: string;
}

export interface BlockModel {
  table: RenderTable;
  entries: PaletteEntryInfo[];
  types: BlockTypeInfo[];
}

/** How a placed block resolves: from the catalog when one is loaded, else from built-in tables. */
interface Resolved {
  colors: ResolvedColors;
  shape: ShapeSpec;
  items: ItemCost[];
  displayName: string;
  mod?: string;
  family?: string;
}

const AIR: Resolved = {
  colors: { faces: [0, 0, 0, 0, 0, 0], source: 'exact', marked: false, swatch: 0 },
  shape: { kind: 'none' },
  items: [],
  displayName: 'Air',
};

function resolveBlock(state: BlockState, catalog: Catalog | null): Resolved {
  if (catalog) {
    const hit = resolveFromCatalog(state, catalog);
    if (hit) {
      const fallback = resolveShape(state);
      const shape = hit.shape ?? (hit.cross ? (fallback.kind === 'cross' ? fallback : { kind: 'cross' as const, height: 14, translucent: false }) : fallback);
      return { colors: hit.colors, shape, items: catalogItemCosts(state, hit.block.item), displayName: hit.name, mod: hit.block.mod, family: hit.block.family };
    }
    // Not in the catalog: the block is unknown to this game and modpack.
    const c = resolveColors(state);
    return { colors: { ...c, source: 'unknown', marked: true }, shape: resolveShape(state), items: itemCosts(state), displayName: readableName(state.name) };
  }
  return { colors: resolveColors(state), shape: resolveShape(state), items: itemCosts(state), displayName: readableName(state.name) };
}

/** Vanilla item rules are exact; for mod blocks the catalog knows the item that places them. */
function catalogItemCosts(state: BlockState, item: string | null): ItemCost[] {
  const base = itemCosts(state);
  if (state.name.startsWith('minecraft:')) return base;
  if (!item) return [];
  return base.map((c, i) => (i === 0 ? { item, count: c.count } : c));
}

export function buildBlockModel(palette: readonly BlockState[], catalog: Catalog | null = null): BlockModel {
  const size = palette.length;
  const kind = new Uint8Array(size);
  const flags = new Uint8Array(size);
  const typeId = new Uint16Array(size);
  const faceColors = new Uint32Array(size * 6);
  const shapeIndex = new Int32Array(size).fill(-1);
  const fullSides = new Uint8Array(size);
  const shapes: ShapeGeometry[] = [];
  const shapeKeys = new Map<string, number>();
  const entries: PaletteEntryInfo[] = [];
  const types: BlockTypeInfo[] = [{ typeId: 0, name: 'minecraft:air', displayName: 'Air', marked: false, swatch: 0 }];
  const typeByName = new Map<string, number>([['minecraft:air', 0]]);

  for (let i = 0; i < size; i++) {
    const state = palette[i];
    const r = i === 0 ? AIR : resolveBlock(state, catalog);
    const { colors, shape, items } = r;

    let t = typeByName.get(state.name);
    if (t === undefined) {
      t = types.length;
      typeByName.set(state.name, t);
      types.push({
        typeId: t,
        name: state.name,
        displayName: r.displayName,
        marked: colors.marked,
        swatch: colors.swatch,
        ...(r.mod ? { mod: r.mod } : {}),
        ...(r.family ? { family: r.family } : {}),
      });
    }
    typeId[i] = t;
    faceColors.set(colors.faces, i * 6);

    let f = 0;
    switch (shape.kind) {
      case 'none':
        kind[i] = KIND_NONE;
        break;
      case 'cube':
        kind[i] = KIND_CUBE;
        if (shape.occludes) {
          f |= FLAG_OCCLUDES;
          fullSides[i] = 0b111111;
        }
        if (shape.translucent) f |= FLAG_TRANSLUCENT;
        if (shape.cullSame) f |= FLAG_CULL_SAME;
        break;
      case 'boxes':
      case 'cross': {
        kind[i] = shape.kind === 'boxes' ? KIND_SHAPE : KIND_CROSS;
        if (shape.translucent) f |= FLAG_TRANSLUCENT;
        const key = shape.kind === 'cross' ? `x${shape.height}` : JSON.stringify(shape.boxes);
        let s = shapeKeys.get(key);
        if (s === undefined) {
          s = shapes.length;
          shapes.push(buildShapeGeometry(shape));
          shapeKeys.set(key, s);
        }
        shapeIndex[i] = s;
        if (shape.kind === 'boxes' && !shape.translucent) fullSides[i] = coveredSides(shapes[s]);
        break;
      }
    }
    if (colors.marked) f |= FLAG_MARKED;
    flags[i] = f;
    entries.push({ state, typeId: t, colors, shape, items });
  }

  return { table: { size, kind, flags, typeId, faceColors, shapeIndex, fullSides, shapes }, entries, types };
}

/** Sides that a single exterior face covers completely (16 × 16 on the cell border). */
function coveredSides(g: ShapeGeometry): number {
  let bits = 0;
  for (let i = 0; i < g.faceCount; i++) {
    const o = i * FACE_STRIDE;
    if (g.faces[o + 7] !== 1) continue;
    const dir = g.faces[o];
    const dx = g.faces[o + 4] - g.faces[o + 1];
    const dy = g.faces[o + 5] - g.faces[o + 2];
    const dz = g.faces[o + 6] - g.faces[o + 3];
    const full = dir < 2 ? dy === 16 && dz === 16 : dir < 4 ? dx === 16 && dz === 16 : dx === 16 && dy === 16;
    if (full) bits |= 1 << dir;
  }
  return bits;
}
