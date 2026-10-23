import type { BlockState } from '../core/blockstate';
import type { ResolvedColors } from '../blocks/colors';
import { readableName } from '../blocks/names';
import type { Box, ShapeSpec } from '../blocks/shapes';
import { appliedFor, rotateBoxes, rotateFaces } from './states';
import type { Catalog, CatalogBlock } from './types';

/**
 * Looking up placed blocks in the catalog: which models a state uses, the resulting shape
 * (boxes rotated like in the game) and colours per face.
 */

export interface CatalogHit {
  block: CatalogBlock;
  colors: ResolvedColors;
  /** null when the models give no usable shape (entity blocks, fluids, custom loaders). */
  shape: ShapeSpec | null;
  /** True when the models describe a cross-shaped plant. */
  cross: boolean;
  name: string;
}

export function blockName(c: Catalog | null, id: string): string {
  const b = c?.blocks[id];
  return b?.de ?? b?.en ?? readableName(id);
}

export function itemName(c: Catalog | null, id: string): string {
  const it = c?.items[id];
  if (it?.de || it?.en) return (it.de ?? it.en)!;
  return blockName(c, id);
}

/** What a catalog was read from: Minecraft version, NeoForge version and the mods (without those two). */
export function catalogContents(c: Catalog): { minecraft: string | null; neoforge: string | null; mods: { id: string; name: string }[] } {
  let neoforge: string | null = null;
  const mods: { id: string; name: string }[] = [];
  for (const s of c.sources) {
    for (const m of s.mods) {
      if (m.id === 'neoforge') neoforge = m.version || '?';
      else if (m.id !== 'minecraft') mods.push({ id: m.id, name: m.name });
    }
  }
  return { minecraft: c.minecraft, neoforge, mods };
}

export function resolveFromCatalog(state: BlockState, c: Catalog): CatalogHit | null {
  const block = c.blocks[state.name];
  if (!block) return null;
  const applied = appliedFor(block.states, state.props);
  const boxes: number[] = [];
  const faceSum = new Float64Array(6 * 4);
  let translucent = false;
  let allBoxes = applied.length > 0;
  let cross = false;
  let particle = -1;
  for (const [mi, x, y] of applied) {
    const m = c.models[mi];
    if (!m) continue;
    if (m.p !== -1 && particle === -1) particle = m.p;
    if (m.tr) translucent = true;
    if (m.kind === 'boxes' && m.g >= 0) boxes.push(...rotateBoxes(c.geometries[m.g], x, y));
    else allBoxes = false;
    if (m.kind === 'cross') cross = true;
    const faces = rotateFaces(m.f, x, y);
    for (let d = 0; d < 6; d++) {
      const col = faces[d];
      if (col < 0) continue;
      faceSum[d * 4] += (col >> 16) & 255;
      faceSum[d * 4 + 1] += (col >> 8) & 255;
      faceSum[d * 4 + 2] += col & 255;
      faceSum[d * 4 + 3] += 1;
    }
  }

  // Colours: per face where the models show one, the mean of the others where they don't.
  const faces: number[] = [];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let d = 0; d < 6; d++) {
    const w = faceSum[d * 4 + 3];
    if (w > 0) {
      const col = (Math.round(faceSum[d * 4] / w) << 16) | (Math.round(faceSum[d * 4 + 1] / w) << 8) | Math.round(faceSum[d * 4 + 2] / w);
      faces.push(col);
      r += faceSum[d * 4] / w;
      g += faceSum[d * 4 + 1] / w;
      b += faceSum[d * 4 + 2] / w;
      n++;
    } else {
      faces.push(-1);
    }
  }
  const fallback = n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n) : particle !== -1 ? particle : 0x8a8a8a;
  const filled = faces.map((col) => (col < 0 ? fallback : col)) as ResolvedColors['faces'];
  // Swatch: the sides are what you see of a block most of the time.
  const sides = [filled[0], filled[1], filled[4], filled[5]];
  const swatch = averageRgb(sides);

  let shape: ShapeSpec | null = null;
  if (allBoxes && boxes.length) {
    const list: Box[] = [];
    for (let i = 0; i < boxes.length; i += 6) list.push(boxes.slice(i, i + 6) as Box);
    const full = list.some((bx) => bx[0] === 0 && bx[1] === 0 && bx[2] === 0 && bx[3] === 16 && bx[4] === 16 && bx[5] === 16);
    shape = full
      ? { kind: 'cube', occludes: !translucent, translucent, cullSame: translucent }
      : { kind: 'boxes', boxes: dedupe(list), translucent };
  }
  return {
    block,
    colors: { faces: filled, source: 'exact', marked: false, swatch },
    shape,
    cross: cross && !boxes.length,
    name: block.de ?? block.en ?? readableName(state.name),
  };
}

function dedupe(list: Box[]): Box[] {
  const seen = new Set<string>();
  return list.filter((b) => {
    const k = b.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function averageRgb(list: number[]): number {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of list) {
    r += (c >> 16) & 255;
    g += (c >> 8) & 255;
    b += c & 255;
  }
  const n = list.length || 1;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}
