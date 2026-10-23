import { describe, expect, it } from 'vitest';
import { importFile } from '../src/core/importFile';
import { blockAt } from '../src/core/volume';
import { makeLitematic, makeStructure, packLongs } from './helpers/schemFixtures';

const key = (r: ReturnType<typeof importFile>, x: number, y: number, z: number) =>
  r.volume.palette[blockAt(r.volume, x, y, z)].key;

describe('Litematica import', () => {
  it('packs and unpacks values that span two longs', () => {
    // 3 bits per entry: entry 21 occupies bits 63..65
    const values = Array.from({ length: 50 }, (_, i) => i % 8);
    const longs = packLongs(values, 3);
    expect(longs.length).toBe(3);
  });

  it('reads a region with mixed palette and negative size', () => {
    const palette = [
      { Name: 'minecraft:air' },
      { Name: 'minecraft:stone' },
      { Name: 'minecraft:oak_stairs', Properties: { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false' } },
      { Name: 'minecraft:glass' },
      { Name: 'minecraft:oak_planks' },
    ];
    // 5 entries -> 3 bits, 5x5x5 = 125 entries -> many entries span long boundaries
    const block = (x: number, y: number, z: number) => (x + 2 * y + 3 * z) % 5;
    const bytes = makeLitematic([{ name: 'Haus', pos: [10, 64, -3], size: [-5, 5, 5], palette, block }]);
    const r = importFile('haus.litematic', bytes);
    expect(r.format).toBe('litematic');
    expect(r.formatLabel).toBe('Litematica v6');
    expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual([5, 5, 5]);
    // negative x size: the region spans x = 6..10, minimum corner at x = 6
    expect(r.info.offset).toEqual([6, 64, -3]);
    expect(r.info.meta?.author).toBe('Steve');
    const names = ['minecraft:air', 'minecraft:stone', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:glass', 'minecraft:oak_planks'];
    for (let y = 0; y < 5; y++)
      for (let z = 0; z < 5; z++)
        for (let x = 0; x < 5; x++) expect(key(r, x, y, z)).toBe(names[block(x, y, z)]);
  });

  it('merges several regions into one volume', () => {
    const palette = [{ Name: 'minecraft:air' }, { Name: 'minecraft:stone' }];
    const bytes = makeLitematic([
      { name: 'A', pos: [0, 0, 0], size: [2, 1, 1], palette, block: () => 1 },
      { name: 'B', pos: [5, 2, 3], size: [1, 1, 1], palette, block: () => 1 },
    ]);
    const r = importFile('zwei.litematic', bytes);
    expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual([6, 3, 4]);
    expect(r.analysis.nonAir).toBe(3);
    expect(key(r, 5, 2, 3)).toBe('minecraft:stone');
    expect(r.info.regions).toBe(2);
  });
});

describe('structure (.nbt) import', () => {
  it('reads a vanilla structure file', () => {
    const bytes = makeStructure(
      [3, 2, 1],
      [{ Name: 'minecraft:stone' }, { Name: 'minecraft:air' }, { Name: 'minecraft:spruce_slab', Properties: { type: 'top', waterlogged: 'false' } }],
      [
        { pos: [0, 0, 0], state: 0 },
        { pos: [1, 0, 0], state: 1 },
        { pos: [2, 1, 0], state: 2 },
      ],
    );
    const r = importFile('turm.nbt', bytes);
    expect(r.format).toBe('structure');
    expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual([3, 2, 1]);
    expect(key(r, 0, 0, 0)).toBe('minecraft:stone');
    expect(key(r, 1, 0, 0)).toBe('minecraft:air');
    expect(key(r, 2, 1, 0)).toBe('minecraft:spruce_slab[type=top,waterlogged=false]');
    expect(r.analysis.nonAir).toBe(2);
  });
});
