import type { BlockState } from '../core/blockstate';
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
}

export interface BlockModel {
  table: RenderTable;
  entries: PaletteEntryInfo[];
  types: BlockTypeInfo[];
}

export function buildBlockModel(palette: readonly BlockState[]): BlockModel {
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
    const colors: ResolvedColors =
      i === 0 ? { faces: [0, 0, 0, 0, 0, 0], source: 'exact', marked: false, swatch: 0 } : resolveColors(state);
    const shape: ShapeSpec = i === 0 ? { kind: 'none' } : resolveShape(state);
    const items = i === 0 ? [] : itemCosts(state);

    let t = typeByName.get(state.name);
    if (t === undefined) {
      t = types.length;
      typeByName.set(state.name, t);
      types.push({ typeId: t, name: state.name, displayName: readableName(state.name), marked: colors.marked, swatch: colors.swatch });
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
