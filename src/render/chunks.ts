import type { Volume } from '../core/volume';

/** Chunk edge length in blocks. 32³ keeps per-chunk vertex counts and remesh cost moderate. */
export const CHUNK = 32;

export interface ChunkCoord {
  key: string;
  ox: number;
  oy: number;
  oz: number;
  sx: number;
  sy: number;
  sz: number;
}

/** All chunks covering the volume, bottom to top (so lower layers appear first while loading). */
export function chunkGrid(v: Pick<Volume, 'sizeX' | 'sizeY' | 'sizeZ'>, size = CHUNK): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let oy = 0; oy < v.sizeY; oy += size)
    for (let oz = 0; oz < v.sizeZ; oz += size)
      for (let ox = 0; ox < v.sizeX; ox += size) {
        out.push({
          key: `${ox / size},${oy / size},${oz / size}`,
          ox,
          oy,
          oz,
          sx: Math.min(size, v.sizeX - ox),
          sy: Math.min(size, v.sizeY - oy),
          sz: Math.min(size, v.sizeZ - oz),
        });
      }
  return out;
}

/**
 * Copies a chunk plus a one-block border (for face culling) out of the volume.
 * Returns null if the chunk interior is completely empty.
 */
export function extractChunk(v: Volume, c: ChunkCoord): Uint16Array | null {
  const W = c.sx + 2;
  const H = c.sy + 2;
  const D = c.sz + 2;
  const out = new Uint16Array(W * H * D);
  const { sizeX, sizeY, sizeZ, data } = v;
  let nonAir = 0;
  for (let py = 0; py < H; py++) {
    const y = c.oy + py - 1;
    if (y < 0 || y >= sizeY) continue;
    const interiorY = py >= 1 && py <= c.sy;
    for (let pz = 0; pz < D; pz++) {
      const z = c.oz + pz - 1;
      if (z < 0 || z >= sizeZ) continue;
      const interiorZ = interiorY && pz >= 1 && pz <= c.sz;
      const src = (y * sizeZ + z) * sizeX;
      const dst = (py * D + pz) * W;
      const x0 = Math.max(0, c.ox - 1);
      const x1 = Math.min(sizeX, c.ox + c.sx + 1);
      for (let x = x0; x < x1; x++) {
        const b = data[src + x];
        out[dst + (x - c.ox + 1)] = b;
        if (b !== 0 && interiorZ && x >= c.ox && x < c.ox + c.sx) nonAir++;
      }
    }
  }
  return nonAir > 0 ? out : null;
}

/** Layers y-1 .. y+1 of the whole volume with a one-block border in x and z (for the layer cap). */
export function extractLayerSlab(v: Volume, y: number): Uint16Array {
  const W = v.sizeX + 2;
  const D = v.sizeZ + 2;
  const out = new Uint16Array(W * D * 3);
  for (let ly = 0; ly < 3; ly++) {
    const yy = y + ly - 1;
    if (yy < 0 || yy >= v.sizeY) continue;
    for (let z = 0; z < v.sizeZ; z++) {
      const src = (yy * v.sizeZ + z) * v.sizeX;
      out.set(v.data.subarray(src, src + v.sizeX), (ly * D + z + 1) * W + 1);
    }
  }
  return out;
}
