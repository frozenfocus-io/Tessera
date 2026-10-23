import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFile, ImportError } from '../src/core/importFile';
import { blockAt } from '../src/core/volume';
import { nbt, writeNbt } from '../src/core/nbt/writer';
import { gzipSync } from 'fflate';
import { makeSpongeSchem } from './helpers/schemFixtures';

const key = (r: ReturnType<typeof importFile>, x: number, y: number, z: number) =>
  r.volume.palette[blockAt(r.volume, x, y, z)].key;

describe('Sponge schematic import', () => {
  // 3 x 2 x 2 test volume. Layer 0: stone row along x at z=0, oak stairs at (2,0,1).
  // Layer 1: glass at (0,1,0). Everything else air. Air is deliberately NOT palette index 0.
  const palette = {
    'minecraft:stone': 0,
    'minecraft:air': 1,
    'minecraft:oak_stairs[waterlogged=false,shape=straight,half=bottom,facing=north]': 2,
    'minecraft:glass': 3,
  };
  const block = (x: number, y: number, z: number) => {
    if (y === 0 && z === 0) return 0;
    if (y === 0 && x === 2 && z === 1) return 2;
    if (y === 1 && x === 0 && z === 0) return 3;
    return 1;
  };

  for (const version of [1, 2, 3] as const) {
    it(`reads version ${version}`, () => {
      const bytes = makeSpongeSchem({ version, sizeX: 3, sizeY: 2, sizeZ: 2, palette, block, offset: [10, -60, 5], weOffset: [-1, 0, -2] });
      const r = importFile('test.schem', bytes);
      expect(r.info.formatVersion).toBe(version);
      expect(r.compression).toBe('gzip');
      expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual([3, 2, 2]);
      expect(r.volume.palette[0].name).toBe('minecraft:air');
      expect(key(r, 0, 0, 0)).toBe('minecraft:stone');
      expect(key(r, 2, 0, 0)).toBe('minecraft:stone');
      expect(key(r, 2, 0, 1)).toBe('minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]');
      expect(key(r, 0, 1, 0)).toBe('minecraft:glass');
      expect(key(r, 1, 1, 1)).toBe('minecraft:air');
      expect(r.analysis.nonAir).toBe(5);
      expect(Array.from(r.analysis.layerCounts)).toEqual([4, 1]);
      expect(r.analysis.bounds).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 2, maxZ: 2 });
      expect(r.info.offset).toEqual([10, -60, 5]);
      if (version === 1) {
        expect(r.info.dataVersion).toBeNull();
        expect(r.info.blockEntityCount).toBe(1);
      } else {
        expect(r.info.weOffset).toEqual([-1, 0, -2]);
      }
      if (version === 3) expect(r.info.blockEntityCount).toBe(1);
    });
  }

  it('builds sparse per-layer histograms', () => {
    const bytes = makeSpongeSchem({ version: 2, sizeX: 3, sizeY: 2, sizeZ: 2, palette, block });
    const r = importFile('t.schem', bytes);
    const { offsets, pairs } = r.analysis.layerHist;
    const layer = (y: number) => {
      const out: Record<string, number> = {};
      for (let i = offsets[y]; i < offsets[y + 1]; i++) out[r.volume.palette[pairs[i * 2]].name] = pairs[i * 2 + 1];
      return out;
    };
    expect(layer(0)).toEqual({ 'minecraft:stone': 3, 'minecraft:oak_stairs': 1 });
    expect(layer(1)).toEqual({ 'minecraft:glass': 1 });
  });

  it('decodes multi-byte varints (palette > 128 entries)', () => {
    const pal: Record<string, number> = { 'minecraft:air': 0 };
    for (let i = 1; i < 300; i++) pal[`minecraft:test_block_${i}`] = i;
    const size = 20; // 20 x 1 x 20 = 400 cells
    const bytes = makeSpongeSchem({
      version: 2,
      sizeX: size,
      sizeY: 1,
      sizeZ: size,
      palette: pal,
      block: (x, _y, z) => (z * size + x) % 300,
    });
    const r = importFile('big.schem', bytes);
    for (const [x, z] of [[0, 0], [7, 6], [19, 14], [19, 19]]) {
      const idx = (z * size + x) % 300;
      expect(key(r, x, 0, z)).toBe(idx === 0 ? 'minecraft:air' : `minecraft:test_block_${idx}`);
    }
    expect(r.volume.palette.length).toBe(300);
  });

  it('maps air variants and structure voids to air and merges equal states', () => {
    const bytes = makeSpongeSchem({
      version: 2,
      sizeX: 5,
      sizeY: 1,
      sizeZ: 1,
      palette: {
        'minecraft:cave_air': 0,
        'minecraft:void_air': 1,
        'minecraft:structure_void': 2,
        'minecraft:oak_log[axis=y]': 3,
        'oak_log[ axis = y ]': 4,
      },
      block: (x) => x,
    });
    const r = importFile('a.schem', bytes);
    expect(r.analysis.nonAir).toBe(2);
    expect(r.volume.palette.map((s) => s.key)).toEqual(['minecraft:air', 'minecraft:oak_log[axis=y]']);
  });

  it('renames blocks from older versions', () => {
    const bytes = makeSpongeSchem({
      version: 2,
      dataVersion: 2586, // 1.16.5
      sizeX: 3,
      sizeY: 1,
      sizeZ: 1,
      palette: { 'minecraft:grass': 0, 'minecraft:grass_path': 1, 'minecraft:cobblestone_wall[east=true,north=false,south=false,up=true,waterlogged=false,west=false]': 2 },
      block: (x) => x,
    });
    const r = importFile('old.schem', bytes);
    expect(key(r, 0, 0, 0)).toBe('minecraft:short_grass');
    expect(key(r, 1, 0, 0)).toBe('minecraft:dirt_path');
    expect(key(r, 2, 0, 0)).toBe('minecraft:cobblestone_wall[east=low,north=none,south=none,up=true,waterlogged=false,west=none]');
    expect(r.info.renames.length).toBe(3);
    expect(r.minecraftVersion).toBe('1.16.5');
  });

  it('keeps "grass" for files that are new enough and warns about newer versions', () => {
    const bytes = makeSpongeSchem({ version: 3, dataVersion: 4189, sizeX: 1, sizeY: 1, sizeZ: 1, palette: { 'minecraft:stone': 0 }, block: () => 0 });
    const r = importFile('new.schem', bytes);
    expect(r.minecraftVersion).toBe('1.21.4');
    expect(r.info.warnings.some((w) => w.includes('1.21.4'))).toBe(true);
  });

  it('accepts uncompressed files', () => {
    const bytes = makeSpongeSchem({ version: 2, sizeX: 1, sizeY: 1, sizeZ: 1, palette: { 'minecraft:stone': 0 }, block: () => 0, gzip: false });
    const r = importFile('raw.schem', bytes);
    expect(r.compression).toBe('none');
    expect(r.analysis.nonAir).toBe(1);
  });

  it('reports incomplete block data', () => {
    const bytes = makeSpongeSchem({ version: 2, sizeX: 4, sizeY: 1, sizeZ: 1, palette: { 'minecraft:stone': 0 }, block: () => 0, truncateCells: 3 });
    expect(() => importFile('cut.schem', bytes)).toThrow(/unvollständig/);
  });

  it('gives helpful messages for other formats and broken files', () => {
    const lite = gzipSync(writeNbt('', nbt.compound({ MinecraftDataVersion: nbt.int(3955), Regions: nbt.compound({}), Version: nbt.int(6) }) as never));
    expect(() => importFile('x.litematic', lite)).toThrow(/Litematic/);
    expect(() => importFile('x.schem', Uint8Array.from([0x1f, 0x8b, 1, 2, 3]))).toThrow(ImportError);
    expect(() => importFile('x.schem', new TextEncoder().encode('hello world'))).toThrow(/NBT/);
  });

  const sample = process.env.TESSERA_SAMPLE_SCHEM;
  it.runIf(sample && existsSync(sample))('reads the real-world sample file', () => {
    const r = importFile('sample.schem', new Uint8Array(readFileSync(sample!)));
    expect(r.info.formatVersion).toBe(2);
    expect([r.volume.sizeX, r.volume.sizeY, r.volume.sizeZ]).toEqual([25, 44, 22]);
    expect(r.analysis.nonAir).toBe(1131);
    expect(r.analysis.bounds?.maxY).toBe(32);
    expect(r.minecraftVersion).toBe('1.20.1');
  });
});
