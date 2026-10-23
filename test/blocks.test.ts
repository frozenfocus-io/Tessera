import { describe, expect, it } from 'vitest';
import { parseBlockState } from '../src/core/blockstate';
import { resolveColors, hashColor } from '../src/blocks/colors';
import { EAST, NORTH, SOUTH, UP, WEST } from '../src/blocks/faces';
import { itemCosts, stackSize } from '../src/blocks/items';
import { readableName } from '../src/blocks/names';
import { buildShapeGeometry, FACE_STRIDE } from '../src/blocks/shapeGeometry';
import { resolveShape, stairBoxes, type Box } from '../src/blocks/shapes';
import { buildBlockModel, KIND_CUBE, KIND_SHAPE, FLAG_OCCLUDES, FLAG_MARKED } from '../src/blocks/blockModel';

const S = parseBlockState;

function boxesOf(key: string): Box[] {
  const s = resolveShape(S(key));
  if (s.kind !== 'boxes') throw new Error(`expected boxes for ${key}, got ${s.kind}`);
  return s.boxes;
}

describe('shapes', () => {
  it('builds straight stairs on the facing side', () => {
    expect(stairBoxes('north', 'bottom', 'straight')).toEqual([
      [0, 0, 0, 16, 8, 16],
      [0, 8, 0, 8, 16, 8],
      [8, 8, 0, 16, 16, 8],
    ]);
    // facing east: upper step in the east half (NE + SE)
    expect(stairBoxes('east', 'bottom', 'straight').slice(1)).toEqual([
      [8, 8, 0, 16, 16, 8],
      [8, 8, 8, 16, 16, 16],
    ]);
  });

  it('builds corner stairs like vanilla', () => {
    // inner_left facing north: NW, NE, SW
    expect(stairBoxes('north', 'bottom', 'inner_left').slice(1)).toEqual([
      [0, 8, 0, 8, 16, 8],
      [8, 8, 0, 16, 16, 8],
      [0, 8, 8, 8, 16, 16],
    ]);
    // outer_right facing east: only SE
    expect(stairBoxes('east', 'bottom', 'outer_right').slice(1)).toEqual([[8, 8, 8, 16, 16, 16]]);
    // upside-down: slab on top, quarters below
    expect(stairBoxes('south', 'top', 'straight')).toEqual([
      [0, 8, 0, 16, 16, 16],
      [0, 0, 8, 8, 8, 16],
      [8, 0, 8, 16, 8, 16],
    ]);
  });

  it('places doors, trapdoors and buttons on the right edge', () => {
    expect(boxesOf('minecraft:oak_door[facing=east,half=lower,hinge=left,open=false]')).toEqual([[0, 0, 0, 3, 16, 16]]);
    expect(boxesOf('minecraft:oak_door[facing=east,half=lower,hinge=left,open=true]')).toEqual([[0, 0, 0, 16, 16, 3]]);
    expect(boxesOf('minecraft:oak_door[facing=east,half=lower,hinge=right,open=true]')).toEqual([[0, 0, 13, 16, 16, 16]]);
    expect(boxesOf('minecraft:oak_trapdoor[facing=north,half=bottom,open=true]')).toEqual([[0, 0, 13, 16, 16, 16]]);
    expect(boxesOf('minecraft:oak_trapdoor[facing=east,half=bottom,open=true]')).toEqual([[0, 0, 0, 3, 16, 16]]);
    expect(boxesOf('minecraft:oak_trapdoor[facing=east,half=top,open=false]')).toEqual([[0, 13, 0, 16, 16, 16]]);
    // a button facing south hangs on the wall to its north
    expect(boxesOf('minecraft:oak_button[face=wall,facing=south,powered=false]')).toEqual([[5, 6, 0, 11, 10, 2]]);
  });

  it('connects fences, panes and walls', () => {
    const fence = boxesOf('minecraft:spruce_fence[east=true,north=false,south=false,west=false]');
    expect(fence).toContainEqual([6, 0, 6, 10, 16, 10]);
    expect(fence).toContainEqual([10, 12, 7, 16, 15, 9]);
    expect(fence.length).toBe(3);
    const pane = boxesOf('minecraft:glass_pane[east=false,north=true,south=false,west=false]');
    expect(pane).toEqual([
      [7, 0, 7, 9, 16, 9],
      [7, 0, 0, 9, 16, 7],
    ]);
    const wall = boxesOf('minecraft:cobblestone_wall[east=none,north=tall,south=low,up=false,west=none]');
    expect(wall).toEqual([
      [5, 0, 0, 11, 16, 8],
      [5, 0, 8, 11, 14, 16],
    ]);
  });

  it('classifies cubes, translucent blocks and invisible blocks', () => {
    expect(resolveShape(S('minecraft:stone'))).toMatchObject({ kind: 'cube', occludes: true });
    expect(resolveShape(S('minecraft:white_stained_glass'))).toMatchObject({ kind: 'cube', translucent: true, occludes: false });
    expect(resolveShape(S('minecraft:spruce_slab[type=double]'))).toMatchObject({ kind: 'cube', occludes: true });
    expect(resolveShape(S('minecraft:light'))).toEqual({ kind: 'none' });
    expect(resolveShape(S('minecraft:poppy'))).toMatchObject({ kind: 'cross' });
    expect(resolveShape(S('create:brass_stairs[facing=north,half=bottom,shape=straight]')).kind).toBe('boxes');
  });
});

describe('shape geometry', () => {
  it('extracts exactly the exterior faces of straight stairs', () => {
    const g = buildShapeGeometry({ kind: 'boxes', boxes: stairBoxes('north', 'bottom', 'straight'), translucent: false });
    const faces: number[][] = [];
    for (let i = 0; i < g.faceCount; i++) faces.push(Array.from(g.faces.slice(i * FACE_STRIDE, (i + 1) * FACE_STRIDE)));
    expect(g.faceCount).toBe(10);
    const count = (dir: number) => faces.filter((f) => f[0] === dir).length;
    expect([count(EAST), count(WEST), count(UP), count(3), count(SOUTH), count(NORTH)]).toEqual([2, 2, 2, 1, 2, 1]);
    // the exposed slab top at y = 8 is not on the cell boundary
    expect(faces).toContainEqual([UP, 0, 8, 8, 16, 8, 16, 0]);
    // the step top at y = 16 is
    expect(faces).toContainEqual([UP, 0, 16, 0, 16, 16, 8, 1]);
    // total exposed area equals the surface area of the solid (in 1/16² units):
    // bottom 256 + tops 256 + north 256 + south 256 + two L-shaped sides 192 each
    const area = faces.reduce((s, f) => {
      const dx = f[4] - f[1], dy = f[5] - f[2], dz = f[6] - f[3];
      return s + (dx === 0 ? dy * dz : dy === 0 ? dx * dz : dx * dy);
    }, 0);
    expect(area).toBe(1408);
  });

  it('removes faces hidden between overlapping boxes', () => {
    const g = buildShapeGeometry({ kind: 'boxes', boxes: [[0, 0, 0, 16, 8, 16], [0, 4, 0, 16, 12, 16]], translucent: false });
    expect(g.faceCount).toBe(6);
  });
});

describe('colours', () => {
  it('derives family colours and orients pillars and fronts', () => {
    const bricks = resolveColors(S('minecraft:stone_bricks'));
    const stairs = resolveColors(S('minecraft:stone_brick_stairs[facing=east,half=top,shape=straight]'));
    expect(stairs.faces[UP]).toBe(bricks.faces[UP]);
    expect(stairs.source).toBe('family');
    const logX = resolveColors(S('minecraft:oak_log[axis=x]'));
    expect(logX.faces[EAST]).not.toBe(logX.faces[UP]);
    expect(logX.faces[EAST]).toBe(logX.faces[WEST]);
    const piston = resolveColors(S('minecraft:piston[extended=false,facing=east]'));
    expect(piston.faces[EAST]).toBe(0xa2834f);
    expect(piston.faces[WEST]).toBe(0x6c6c6c);
    expect(resolveColors(S('minecraft:light_blue_concrete')).faces[UP]).toBe(0x2389c6);
    expect(resolveColors(S('minecraft:waxed_weathered_cut_copper_slab[type=bottom]')).source).toBe('family');
    expect(resolveColors(S('minecraft:dark_oak_fence')).faces[UP]).toBe(0x42311b);
  });

  it('marks modded and unknown blocks with a stable hash colour', () => {
    const a = resolveColors(S('somemod:mystery_block'));
    expect(a.marked).toBe(true);
    expect(a.faces[UP]).toBe(hashColor('somemod:mystery_block'));
    expect(resolveColors(S('minecraft:stone')).marked).toBe(false);
  });
});

describe('items', () => {
  const cost = (k: string) => itemCosts(S(k));
  it('counts what Survival placement needs', () => {
    expect(cost('minecraft:spruce_slab[type=double]')).toEqual([{ item: 'minecraft:spruce_slab', count: 2 }]);
    expect(cost('minecraft:oak_door[half=upper,facing=east,hinge=left,open=false]')).toEqual([]);
    expect(cost('minecraft:oak_door[half=lower,facing=east,hinge=left,open=false]')).toEqual([{ item: 'minecraft:oak_door', count: 1 }]);
    expect(cost('minecraft:red_bed[part=foot,facing=north]')).toEqual([]);
    expect(cost('minecraft:wall_torch[facing=north]')).toEqual([{ item: 'minecraft:torch', count: 1 }]);
    expect(cost('minecraft:oak_wall_sign[facing=north]')).toEqual([{ item: 'minecraft:oak_sign', count: 1 }]);
    expect(cost('minecraft:potted_poppy')).toEqual([
      { item: 'minecraft:flower_pot', count: 1 },
      { item: 'minecraft:poppy', count: 1 },
    ]);
    expect(cost('minecraft:white_candle[candles=3,lit=false]')).toEqual([{ item: 'minecraft:white_candle', count: 3 }]);
    expect(cost('minecraft:water[level=0]')).toEqual([{ item: 'minecraft:water_bucket', count: 1 }]);
    expect(cost('minecraft:water[level=3]')).toEqual([]);
    expect(cost('minecraft:air')).toEqual([]);
    expect(cost('minecraft:wheat[age=7]')).toEqual([{ item: 'minecraft:wheat_seeds', count: 1 }]);
  });

  it('knows stack sizes', () => {
    expect(stackSize('minecraft:stone')).toBe(64);
    expect(stackSize('minecraft:oak_sign')).toBe(16);
    expect(stackSize('minecraft:red_bed')).toBe(1);
    expect(stackSize('minecraft:water_bucket')).toBe(1);
  });
});

describe('block model', () => {
  it('builds a render table with shared types per block id', () => {
    const palette = ['minecraft:air', 'minecraft:stone', 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight]', 'minecraft:oak_stairs[facing=south,half=bottom,shape=straight]', 'other:thing'].map(S);
    const m = buildBlockModel(palette);
    expect(m.table.kind[1]).toBe(KIND_CUBE);
    expect(m.table.flags[1] & FLAG_OCCLUDES).toBeTruthy();
    expect(m.table.kind[2]).toBe(KIND_SHAPE);
    expect(m.table.typeId[2]).toBe(m.table.typeId[3]);
    expect(m.table.shapeIndex[2]).not.toBe(m.table.shapeIndex[3]);
    expect(m.table.flags[4] & FLAG_MARKED).toBeTruthy();
    expect(m.types.map((t) => t.displayName)).toEqual(['Air', 'Stone', 'Oak Stairs', 'Thing (other)']);
  });

  it('formats readable names', () => {
    expect(readableName('minecraft:stone_brick_stairs')).toBe('Stone Brick Stairs');
    expect(readableName('minecraft:lily_of_the_valley')).toBe('Lily of the Valley');
  });
});
