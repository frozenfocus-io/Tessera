import { describe, expect, it } from 'vitest';
import { makeState, parseBlockState } from '../src/core/blockstate';
import { analyzeVolume, type Volume } from '../src/core/volume';
import { buildBlockModel } from '../src/blocks/blockModel';
import { MaterialIndex, describeSlots, formatShulkers, formatStacks } from '../src/materials/materialList';

function vol(keys: string[], layers: number[][]): Volume {
  // layers[y] = palette indices along x (sizeZ = 1)
  const sizeX = Math.max(...layers.map((l) => l.length));
  const palette = [makeState('minecraft:air'), ...keys.map(parseBlockState)];
  const data = new Uint16Array(sizeX * layers.length);
  layers.forEach((row, y) => row.forEach((p, x) => (data[y * sizeX + x] = p)));
  return { sizeX, sizeY: layers.length, sizeZ: 1, palette, data };
}

describe('material list', () => {
  const v = vol(
    ['minecraft:stone', 'minecraft:oak_slab[type=double]', 'minecraft:oak_door[half=lower,facing=north,hinge=left,open=false]', 'minecraft:oak_door[half=upper,facing=north,hinge=left,open=false]', 'minecraft:oak_slab[type=bottom]'],
    [
      [1, 1, 2, 3],
      [1, 5, 4, 0],
    ],
  );
  const model = buildBlockModel(v.palette);
  const a = analyzeVolume(v);
  const index = new MaterialIndex(model.entries, a.layerHist, v.sizeY);

  it('sums items over all layers', () => {
    const s = index.summarize(() => true);
    const byItem = Object.fromEntries(s.rows.map((r) => [r.item, r.count]));
    expect(byItem).toEqual({ 'minecraft:stone': 3, 'minecraft:oak_slab': 3, 'minecraft:oak_door': 1 });
    expect(s.blocks).toBe(7);
    // sorted by count, ties by name
    expect(s.rows.map((r) => r.item)).toEqual(['minecraft:oak_slab', 'minecraft:stone', 'minecraft:oak_door']);
  });

  it('restricts to a selection of layers', () => {
    const s = index.summarize((y) => y === 1);
    expect(Object.fromEntries(s.rows.map((r) => [r.item, r.count]))).toEqual({ 'minecraft:stone': 1, 'minecraft:oak_slab': 1 });
  });

  it('counts slots and shulker boxes by slots, not by items', () => {
    // 3 stone + 3 oak slabs + 1 door: every item needs its own slot, even a partial stack.
    const s = index.summarize(() => true);
    expect(s.rows.map((r) => r.slots)).toEqual([1, 1, 1]);
    expect(s.totalStacks).toBe(3);
    expect(s.totalShulkers).toBeCloseTo(3 / 27);

    // 65 items of one block need two slots.
    const many = vol(['minecraft:stone'], [new Array<number>(65).fill(1)]);
    const m = new MaterialIndex(buildBlockModel(many.palette).entries, analyzeVolume(many).layerHist, many.sizeY).summarize(() => true);
    expect(m.rows[0]).toMatchObject({ count: 65, stacks: 1, remainder: 1, slots: 2 });
    expect(m.rows[0].shulkers).toBeCloseTo(2 / 27);
  });

  it('formats stacks and shulker boxes', () => {
    expect(formatStacks({ stacks: 3, remainder: 12, stackSize: 64 })).toBe('3 × 64 + 12');
    expect(formatStacks({ stacks: 0, remainder: 12, stackSize: 64 })).toBe('12');
    expect(formatStacks({ stacks: 2, remainder: 0, stackSize: 16 })).toBe('2 × 16');
    expect(formatShulkers(1)).toBe('1,0');
    expect(formatShulkers(31 / 27)).toBe('1,1');
    expect(formatShulkers(2 / 27)).toBe('0,1');
    expect(formatShulkers(1 / 27)).toBe('<0,1');
    expect(formatShulkers(0)).toBe('–');
    expect(describeSlots(31)).toBe('1 volle Shulker-Kiste + 4 Plätze');
    expect(describeSlots(54)).toBe('2 volle Shulker-Kisten');
    expect(describeSlots(1)).toBe('1 Platz');
    expect(describeSlots(0)).toBe('0 Plätze');
  });
});
