import { describe, expect, it } from 'vitest';
import { makeState, parseBlockState } from '../src/core/blockstate';
import type { Volume } from '../src/core/volume';
import { buildBlockModel } from '../src/blocks/blockModel';
import { chunkGrid, extractChunk, extractLayerSlab } from '../src/render/chunks';
import { meshCapLayer, meshChunk, prepareTables, type MeshBuffers } from '../src/render/mesher';

function volume(sizeX: number, sizeY: number, sizeZ: number, keys: string[], cells: [number, number, number, number][]): Volume {
  const palette = [makeState('minecraft:air'), ...keys.map(parseBlockState)];
  const data = new Uint16Array(sizeX * sizeY * sizeZ);
  for (const [x, y, z, p] of cells) data[(y * sizeZ + z) * sizeX + x] = p;
  return { sizeX, sizeY, sizeZ, palette, data };
}

function meshAll(v: Volume, chunkSize = 32) {
  const tables = prepareTables(buildBlockModel(v.palette).table);
  let opaque = 0;
  let translucent = 0;
  const parts: MeshBuffers[] = [];
  for (const c of chunkGrid(v, chunkSize)) {
    const data = extractChunk(v, c);
    if (!data) continue;
    const r = meshChunk(tables, { data, sx: c.sx, sy: c.sy, sz: c.sz, ox: c.ox, oy: c.oy, oz: c.oz });
    opaque += r.opaque?.quadCount ?? 0;
    translucent += r.translucent?.quadCount ?? 0;
    if (r.opaque) parts.push(r.opaque);
  }
  return { opaque, translucent, parts };
}

describe('mesher', () => {
  it('emits 6 faces for a single cube', () => {
    expect(meshAll(volume(1, 1, 1, ['minecraft:stone'], [[0, 0, 0, 1]])).opaque).toBe(6);
  });

  it('merges equal neighbours within a layer', () => {
    const v = volume(2, 1, 1, ['minecraft:stone'], [[0, 0, 0, 1], [1, 0, 0, 1]]);
    expect(meshAll(v).opaque).toBe(6);
  });

  it('never merges across layers and culls the shared face', () => {
    const v = volume(1, 2, 1, ['minecraft:stone'], [[0, 0, 0, 1], [0, 1, 0, 1]]);
    // 4 sides x 2 layers + top + bottom
    expect(meshAll(v).opaque).toBe(10);
  });

  it('does not merge different block types', () => {
    const v = volume(2, 1, 1, ['minecraft:stone', 'minecraft:cobblestone'], [[0, 0, 0, 1], [1, 0, 0, 2]]);
    expect(meshAll(v).opaque).toBe(10);
  });

  it('handles translucent blocks', () => {
    const glass = volume(2, 1, 1, ['minecraft:glass'], [[0, 0, 0, 1], [1, 0, 0, 1]]);
    expect(meshAll(glass)).toMatchObject({ opaque: 0, translucent: 6 });
    const mixed = volume(2, 1, 1, ['minecraft:stone', 'minecraft:glass'], [[0, 0, 0, 1], [1, 0, 0, 2]]);
    // stone keeps its face towards the glass, the glass loses its face towards the stone
    expect(meshAll(mixed)).toMatchObject({ opaque: 6, translucent: 5 });
  });

  it('culls faces across chunk borders', () => {
    const cells: [number, number, number, number][] = [];
    for (let x = 0; x < 4; x++) cells.push([x, 0, 0, 1]);
    const v = volume(4, 1, 1, ['minecraft:stone'], cells);
    // chunk size 2: two chunks, each with a merged 2-block run; the faces between the chunks are culled
    const r = meshAll(v, 2);
    expect(r.opaque).toBe(10); // per chunk: top, bottom, north, south + 1 outer end = 5
  });

  it('emits stairs as shape faces and culls only against solid neighbours', () => {
    const stairs = 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight]';
    expect(meshAll(volume(1, 1, 1, [stairs], [[0, 0, 0, 1]])).opaque).toBe(10);
    // a stone block to the north hides the stairs' full north face
    const v = volume(1, 1, 2, [stairs, 'minecraft:stone'], [[0, 0, 1, 1], [0, 0, 0, 2]]);
    expect(meshAll(v).opaque).toBe(9 + 5);
  });

  it('stores layer and type per vertex in chunk-relative 1/16 units', () => {
    const v = volume(1, 3, 1, ['minecraft:stone'], [[0, 2, 0, 1]]);
    const { parts } = meshAll(v);
    const b = parts[0];
    const layers = new Set<number>();
    for (let i = 0; i < b.vertexCount; i++) layers.add(b.layerType[i * 2]);
    expect([...layers]).toEqual([2]);
    let maxY = 0;
    for (let i = 0; i < b.vertexCount; i++) maxY = Math.max(maxY, b.positions[i * 3 + 1]);
    expect(maxY).toBe(48);
  });

  it('builds the layer cap from hidden top faces', () => {
    const v = volume(2, 2, 1, ['minecraft:stone', 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight]'], [
      [0, 0, 0, 1],
      [0, 1, 0, 1],
      [1, 0, 0, 2],
      [1, 1, 0, 1],
    ]);
    const tables = prepareTables(buildBlockModel(v.palette).table);
    const cap = meshCapLayer(tables, extractLayerSlab(v, 0), v.sizeX, v.sizeZ, 0);
    // stone top (hidden by stone above) + the stairs' step top (hidden by stone above)
    expect(cap.opaque?.quadCount).toBe(2);
    for (let i = 0; i < cap.opaque!.vertexCount; i++) expect(cap.opaque!.positions[i * 3 + 1]).toBe(16);
    const top = meshCapLayer(tables, extractLayerSlab(v, 1), v.sizeX, v.sizeZ, 1);
    expect(top.opaque).toBeNull();
  });
});
