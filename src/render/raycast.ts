import { KIND_CUBE, KIND_NONE, type RenderTable } from '../blocks/blockModel';
import type { Volume } from '../core/volume';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  palette: number;
  /** Face index (faces.ts order) of the hit surface. */
  face: number;
  /** Distance along the (normalised) ray. */
  t: number;
}

export interface RayFilter {
  /** Highest visible layer (inclusive). */
  maxLayer?: number;
  /** Lowest visible layer (inclusive). */
  minLayer?: number;
}

const FULL_BOX = Float32Array.from([0, 0, 0, 16, 16, 16]);

/** Ray vs. axis aligned box. Returns entry distance and face or null. */
function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): { t: number; face: number } | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let face = -1;
  // X slab
  if (dx !== 0) {
    const a = (x0 - ox) / dx;
    const b = (x1 - ox) / dx;
    const tn = Math.min(a, b);
    const tf = Math.max(a, b);
    if (tn > tmin) {
      tmin = tn;
      face = dx > 0 ? 1 : 0; // entering through -X face when moving +X
    }
    tmax = Math.min(tmax, tf);
  } else if (ox < x0 || ox > x1) return null;
  if (dy !== 0) {
    const a = (y0 - oy) / dy;
    const b = (y1 - oy) / dy;
    const tn = Math.min(a, b);
    const tf = Math.max(a, b);
    if (tn > tmin) {
      tmin = tn;
      face = dy > 0 ? 3 : 2;
    }
    tmax = Math.min(tmax, tf);
  } else if (oy < y0 || oy > y1) return null;
  if (dz !== 0) {
    const a = (z0 - oz) / dz;
    const b = (z1 - oz) / dz;
    const tn = Math.min(a, b);
    const tf = Math.max(a, b);
    if (tn > tmin) {
      tmin = tn;
      face = dz > 0 ? 5 : 4;
    }
    tmax = Math.min(tmax, tf);
  } else if (oz < z0 || oz > z1) return null;
  if (tmax < Math.max(tmin, 0)) return null;
  return { t: tmin, face };
}

/**
 * Finds the first visible block along a ray (voxel DDA, Amanatides & Woo), testing the actual
 * block shape inside each cell so the cursor can point "through" the open part of a slab or stair.
 * World units are blocks; block (x, y, z) occupies [x, x+1] × [y, y+1] × [z, z+1].
 */
export function raycastVolume(
  v: Volume,
  table: RenderTable,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  filter: RayFilter = {},
  maxDistance = 1e6,
): RayHit | null {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (len === 0) return null;
  const dx = direction[0] / len;
  const dy = direction[1] / len;
  const dz = direction[2] / len;
  const [ox, oy, oz] = origin;
  const { sizeX, sizeY, sizeZ, data } = v;

  const entry = rayBox(ox, oy, oz, dx, dy, dz, 0, 0, 0, sizeX, sizeY, sizeZ);
  if (!entry) return null;
  let t = Math.max(0, entry.t);
  const minLayer = filter.minLayer ?? 0;
  const maxLayer = filter.maxLayer ?? sizeY - 1;

  const eps = 1e-6;
  let x = Math.floor(ox + dx * (t + eps));
  let y = Math.floor(oy + dy * (t + eps));
  let z = Math.floor(oz + dz * (t + eps));
  x = Math.min(sizeX - 1, Math.max(0, x));
  y = Math.min(sizeY - 1, Math.max(0, y));
  z = Math.min(sizeZ - 1, Math.max(0, z));

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) / dx : stepX < 0 ? (x - ox) / dx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) / dy : stepY < 0 ? (y - oy) / dy : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : stepZ < 0 ? (z - oz) / dz : Infinity;

  for (let guard = 0; guard < 100000; guard++) {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return null;
    if (t > maxDistance) return null;
    if (y >= minLayer && y <= maxLayer) {
      const p = data[(y * sizeZ + z) * sizeX + x];
      if (p !== 0 && table.kind[p] !== KIND_NONE) {
        const boxes = table.kind[p] === KIND_CUBE ? FULL_BOX : table.shapes[table.shapeIndex[p]].boxes;
        let best: { t: number; face: number } | null = null;
        for (let i = 0; i < boxes.length; i += 6) {
          const hit = rayBox(
            ox, oy, oz, dx, dy, dz,
            x + boxes[i] / 16, y + boxes[i + 1] / 16, z + boxes[i + 2] / 16,
            x + boxes[i + 3] / 16, y + boxes[i + 4] / 16, z + boxes[i + 5] / 16,
          );
          if (hit && hit.t >= 0 && (!best || hit.t < best.t)) best = hit;
        }
        if (best) return { x, y, z, palette: p, face: best.face, t: best.t };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
