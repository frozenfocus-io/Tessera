import type { BlockState } from './blockstate';

/**
 * A block volume as loaded from a file. Self-contained: palette and data belong to exactly one
 * project (architecture rule: nothing is shared between projects).
 *
 * Index order matches the Sponge schematic format: index = (y * sizeZ + z) * sizeX + x.
 * Palette index 0 is always air.
 */
export interface Volume {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly palette: readonly BlockState[];
  readonly data: Uint16Array;
}

/** Inclusive-exclusive content bounds of all non-air blocks. */
export interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number; // exclusive
  maxY: number; // exclusive
  maxZ: number; // exclusive
}

export function volumeIndex(v: Pick<Volume, 'sizeX' | 'sizeZ'>, x: number, y: number, z: number): number {
  return (y * v.sizeZ + z) * v.sizeX + x;
}

export function blockAt(v: Volume, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= v.sizeX || y >= v.sizeY || z >= v.sizeZ) return 0;
  return v.data[(y * v.sizeZ + z) * v.sizeX + x];
}

/**
 * Per-layer palette histogram, stored sparse: for layer y the pairs
 * [paletteIndex, count] live in pairs[offsets[y]*2 .. offsets[y+1]*2).
 */
export interface LayerHistogram {
  offsets: Uint32Array; // length sizeY + 1
  pairs: Uint32Array;
}

export interface VolumeAnalysis {
  bounds: Bounds | null;
  nonAir: number;
  layerCounts: Uint32Array;
  layerHist: LayerHistogram;
  paletteTotals: Uint32Array;
}

/** Content bounds, per-layer counts and per-layer palette histograms in a single pass. */
export function analyzeVolume(v: Volume): VolumeAnalysis {
  const { sizeX, sizeY, sizeZ, data } = v;
  const paletteSize = v.palette.length;
  const layerCounts = new Uint32Array(sizeY);
  const paletteTotals = new Uint32Array(paletteSize);
  const counts = new Uint32Array(paletteSize);
  const touched = new Uint32Array(paletteSize);
  const offsets = new Uint32Array(sizeY + 1);
  let pairs = new Uint32Array(Math.max(16, Math.min(paletteSize * 4, 1 << 20)));
  let pairCount = 0;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let nonAir = 0;
  const layerSize = sizeX * sizeZ;

  for (let y = 0; y < sizeY; y++) {
    offsets[y] = pairCount;
    let nTouched = 0;
    let layerNonAir = 0;
    const base = y * layerSize;
    for (let z = 0; z < sizeZ; z++) {
      const row = base + z * sizeX;
      for (let x = 0; x < sizeX; x++) {
        const p = data[row + x];
        if (p === 0) continue;
        layerNonAir++;
        if (counts[p]++ === 0) touched[nTouched++] = p;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (layerNonAir > 0) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if ((pairCount + nTouched) * 2 > pairs.length) {
        let cap = pairs.length * 2;
        while (cap < (pairCount + nTouched) * 2) cap *= 2;
        const next = new Uint32Array(cap);
        next.set(pairs.subarray(0, pairCount * 2));
        pairs = next;
      }
      // Keep pairs sorted by palette index for deterministic output.
      const list = touched.subarray(0, nTouched).sort();
      for (let i = 0; i < nTouched; i++) {
        const p = list[i];
        pairs[pairCount * 2] = p;
        pairs[pairCount * 2 + 1] = counts[p];
        paletteTotals[p] += counts[p];
        counts[p] = 0;
        pairCount++;
      }
    }
    layerCounts[y] = layerNonAir;
    nonAir += layerNonAir;
  }
  offsets[sizeY] = pairCount;

  const bounds: Bounds | null =
    nonAir > 0 ? { minX, minY, minZ, maxX: maxX + 1, maxY: maxY + 1, maxZ: maxZ + 1 } : null;
  return { bounds, nonAir, layerCounts, layerHist: { offsets, pairs: pairs.slice(0, pairCount * 2) }, paletteTotals };
}
