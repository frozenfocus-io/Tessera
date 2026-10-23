import { describe, expect, it } from 'vitest';
import { makeState, parseBlockState } from '../src/core/blockstate';
import type { Volume } from '../src/core/volume';
import { buildBlockModel } from '../src/blocks/blockModel';
import { raycastVolume } from '../src/render/raycast';

function vol(keys: string[], cells: [number, number, number, number][]): Volume {
  const palette = [makeState('minecraft:air'), ...keys.map(parseBlockState)];
  const data = new Uint16Array(27);
  for (const [x, y, z, p] of cells) data[(y * 3 + z) * 3 + x] = p;
  return { sizeX: 3, sizeY: 3, sizeZ: 3, palette, data };
}

describe('raycast', () => {
  it('hits the top of a cube from above', () => {
    const v = vol(['minecraft:stone'], [[1, 1, 1, 1]]);
    const hit = raycastVolume(v, buildBlockModel(v.palette).table, [1.5, 10, 1.5], [0, -1, 0]);
    expect(hit).toMatchObject({ x: 1, y: 1, z: 1, face: 2 });
    expect(hit!.t).toBeCloseTo(8, 6);
  });

  it('respects the actual shape (bottom slab)', () => {
    const v = vol(['minecraft:stone_slab[type=bottom]'], [[1, 1, 1, 1]]);
    const table = buildBlockModel(v.palette).table;
    const down = raycastVolume(v, table, [1.5, 10, 1.5], [0, -1, 0]);
    expect(down!.t).toBeCloseTo(8.5, 6);
    // a horizontal ray through the empty upper half passes over the slab
    expect(raycastVolume(v, table, [-5, 1.75, 1.5], [1, 0, 0])).toBeNull();
    const side = raycastVolume(v, table, [-5, 1.25, 1.5], [1, 0, 0]);
    expect(side).toMatchObject({ x: 1, y: 1, z: 1, face: 1 });
  });

  it('skips hidden layers', () => {
    const v = vol(['minecraft:stone'], [[1, 0, 1, 1], [1, 1, 1, 1]]);
    const table = buildBlockModel(v.palette).table;
    expect(raycastVolume(v, table, [1.5, 10, 1.5], [0, -1, 0])).toMatchObject({ y: 1 });
    expect(raycastVolume(v, table, [1.5, 10, 1.5], [0, -1, 0], { maxLayer: 0 })).toMatchObject({ y: 0, face: 2 });
    expect(raycastVolume(v, table, [1.5, 10, 1.5], [0, -1, 0], { minLayer: 2, maxLayer: 2 })).toBeNull();
  });

  it('enters the volume from the side at an angle', () => {
    const v = vol(['minecraft:stone'], [[2, 0, 0, 1]]);
    const hit = raycastVolume(v, buildBlockModel(v.palette).table, [-1, 0.5, 0.5], [1, 0, 0.01]);
    expect(hit).toMatchObject({ x: 2, y: 0, z: 0, face: 1 });
  });
});
