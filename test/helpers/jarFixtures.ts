import { strToU8, zipSync, zlibSync } from 'fflate';

/** Tiny PNG encoder for test textures (8-bit RGBA, no filtering). */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (1 + width * 4) + 1 + x * 4;
      const [r, g, b, a] = pixel(x, y);
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const chunks: Uint8Array[] = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])];
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  chunks.push(chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0)));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const solid = (r: number, g: number, b: number, a = 255) => () => [r, g, b, a] as [number, number, number, number];

export function json(v: unknown): Uint8Array {
  return strToU8(JSON.stringify(v));
}

/** A jar (zip) from a path -> content map. */
export function makeJar(files: Record<string, Uint8Array | string | object>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, v] of Object.entries(files)) {
    entries[path] = v instanceof Uint8Array ? v : typeof v === 'string' ? strToU8(v) : json(v);
  }
  return zipSync(entries);
}

const FACES = (tex: Record<string, string>, extra: Record<string, unknown> = {}) =>
  Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map((d) => [d, { texture: tex[d] ?? tex.all, ...extra }]));

/** A small vanilla-like jar: the parent models, a few blocks, textures, tags, recipes, lang. */
export function vanillaJar(): Uint8Array {
  return makeJar({
    'version.json': { id: '1.21.1', name: '1.21.1' },
    'net/minecraft/Main.class': new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
    'assets/minecraft/models/block/block.json': { textures: { particle: '#all' } },
    'assets/minecraft/models/block/cube.json': {
      parent: 'block/block',
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: FACES({ down: '#down', up: '#up', north: '#north', south: '#south', west: '#west', east: '#east' }) }],
    },
    'assets/minecraft/models/block/cube_all.json': {
      parent: 'block/cube',
      textures: { particle: '#all', down: '#all', up: '#all', north: '#all', east: '#all', south: '#all', west: '#all' },
    },
    'assets/minecraft/models/block/cube_column.json': {
      parent: 'block/cube',
      textures: { particle: '#side', down: '#end', up: '#end', north: '#side', east: '#side', south: '#side', west: '#side' },
    },
    'assets/minecraft/models/block/stairs.json': {
      parent: 'block/block',
      elements: [
        { from: [0, 0, 0], to: [16, 8, 16], faces: FACES({ all: '#side', down: '#bottom', up: '#top' }) },
        { from: [8, 8, 0], to: [16, 16, 16], faces: FACES({ all: '#side', up: '#top' }) },
      ],
    },
    'assets/minecraft/models/block/slab.json': {
      parent: 'block/block',
      elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: FACES({ all: '#side', down: '#bottom', up: '#top' }) }],
    },
    'assets/minecraft/models/block/cross.json': {
      elements: [
        { from: [0.8, 0, 8], to: [15.2, 16, 8], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: { north: { texture: '#cross' }, south: { texture: '#cross' } } },
        { from: [8, 0, 0.8], to: [8, 16, 15.2], rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, faces: { west: { texture: '#cross' }, east: { texture: '#cross' } } },
      ],
    },
    'assets/minecraft/models/block/stone.json': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } },
    'assets/minecraft/models/block/oak_log.json': { parent: 'minecraft:block/cube_column', textures: { end: 'minecraft:block/oak_log_top', side: 'minecraft:block/oak_log' } },
    'assets/minecraft/models/block/glass.json': { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/glass' } },
    'assets/minecraft/models/block/stone_stairs.json': { parent: 'minecraft:block/stairs', textures: { bottom: 'minecraft:block/stone', top: 'minecraft:block/stone', side: 'minecraft:block/stone' } },
    'assets/minecraft/models/block/stone_slab.json': { parent: 'minecraft:block/slab', textures: { bottom: 'minecraft:block/stone', top: 'minecraft:block/stone', side: 'minecraft:block/stone' } },
    'assets/minecraft/models/block/poppy.json': { parent: 'minecraft:block/cross', textures: { cross: 'minecraft:block/poppy' } },
    'assets/minecraft/models/block/chest.json': { textures: { particle: 'minecraft:block/oak_planks' } },
    'assets/minecraft/blockstates/stone.json': { variants: { '': [{ model: 'minecraft:block/stone' }, { model: 'minecraft:block/stone', y: 90 }] } },
    'assets/minecraft/blockstates/oak_log.json': {
      variants: {
        'axis=x': { model: 'minecraft:block/oak_log', x: 90, y: 90 },
        'axis=y': { model: 'minecraft:block/oak_log' },
        'axis=z': { model: 'minecraft:block/oak_log', x: 90 },
      },
    },
    'assets/minecraft/blockstates/glass.json': { variants: { '': { model: 'minecraft:block/glass' } } },
    'assets/minecraft/blockstates/stone_stairs.json': {
      variants: {
        'facing=east,half=bottom,shape=straight': { model: 'minecraft:block/stone_stairs' },
        'facing=south,half=bottom,shape=straight': { model: 'minecraft:block/stone_stairs', y: 90 },
        'facing=north,half=top,shape=straight': { model: 'minecraft:block/stone_stairs', x: 180, y: 270 },
      },
    },
    'assets/minecraft/blockstates/stone_slab.json': { variants: { 'type=bottom': { model: 'minecraft:block/stone_slab' }, 'type=double': { model: 'minecraft:block/stone' } } },
    'assets/minecraft/blockstates/poppy.json': { variants: { '': { model: 'minecraft:block/poppy' } } },
    'assets/minecraft/blockstates/chest.json': { variants: { '': { model: 'minecraft:block/chest' } } },
    'assets/minecraft/models/item/stone.json': { parent: 'minecraft:block/stone' },
    'assets/minecraft/models/item/oak_log.json': { parent: 'minecraft:block/oak_log' },
    'assets/minecraft/models/item/glass.json': { parent: 'minecraft:block/glass' },
    'assets/minecraft/models/item/stone_stairs.json': { parent: 'minecraft:block/stone_stairs' },
    'assets/minecraft/models/item/stone_slab.json': { parent: 'minecraft:block/stone_slab' },
    'assets/minecraft/models/item/poppy.json': { parent: 'minecraft:item/generated' },
    'assets/minecraft/models/item/chest.json': { parent: 'minecraft:item/chest' },
    'assets/minecraft/models/item/cobblestone.json': { parent: 'minecraft:item/generated' },
    'assets/minecraft/textures/block/stone.png': encodePng(16, 16, solid(125, 125, 125)),
    'assets/minecraft/textures/block/oak_log.png': encodePng(16, 16, solid(110, 85, 50)),
    'assets/minecraft/textures/block/oak_log_top.png': encodePng(16, 16, solid(160, 130, 80)),
    'assets/minecraft/textures/block/oak_planks.png': encodePng(16, 16, solid(162, 131, 79)),
    'assets/minecraft/textures/block/glass.png': encodePng(16, 16, (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [220, 240, 240, 255] : [0, 0, 0, 0])),
    'assets/minecraft/textures/block/poppy.png': encodePng(16, 16, (x, y) => (x > 5 && x < 10 && y < 10 ? [200, 30, 30, 255] : [0, 0, 0, 0])),
    'assets/minecraft/textures/gui/widgets.png': encodePng(4, 4, solid(255, 0, 255)),
    'assets/minecraft/lang/en_us.json': { 'block.minecraft.stone': 'Stone', 'block.minecraft.stone_stairs': 'Stone Stairs', 'item.minecraft.cobblestone': 'Cobblestone' },
    'data/minecraft/tags/block/stairs.json': { values: ['#minecraft:stone_ish_stairs'] },
    'data/minecraft/tags/block/stone_ish_stairs.json': { values: ['minecraft:stone_stairs'] },
    'data/minecraft/tags/block/slabs.json': { values: ['minecraft:stone_slab'] },
    'data/minecraft/tags/item/stone_crafting_materials.json': { values: ['minecraft:cobblestone', 'minecraft:stone'] },
    'data/minecraft/recipe/stone.json': { type: 'minecraft:smelting', ingredient: { item: 'minecraft:cobblestone' }, result: { id: 'minecraft:stone' } },
    'data/minecraft/recipe/stone_stairs.json': {
      type: 'minecraft:crafting_shaped',
      key: { '#': { item: 'minecraft:stone' } },
      pattern: ['#  ', '## ', '###'],
      result: { id: 'minecraft:stone_stairs', count: 4 },
    },
    'data/minecraft/recipe/stone_stairs_from_stone_stonecutting.json': {
      type: 'minecraft:stonecutting',
      ingredient: { item: 'minecraft:stone' },
      result: { id: 'minecraft:stone_stairs', count: 1 },
    },
    'data/minecraft/recipe/stone_slab.json': { type: 'minecraft:crafting_shaped', key: { '#': { item: 'minecraft:stone' } }, pattern: ['###'], result: { id: 'minecraft:stone_slab', count: 6 } },
    'data/minecraft/recipe/firework_rocket.json': { type: 'minecraft:crafting_special_firework_rocket' },
  });
}

export function deLang(): Uint8Array {
  return json({ 'block.minecraft.stone': 'Stein', 'block.minecraft.stone_stairs': 'Steintreppe', 'block.minecraft.oak_log': 'Eichenstamm' });
}

/** A mod jar with one block that builds on vanilla models, a nested library and a conditional recipe. */
export function modJar(): Uint8Array {
  const nested = makeJar({
    'assets/libmod/blockstates/lib_block.json': { variants: { '': { model: 'libmod:block/lib_block' } } },
    'assets/libmod/models/block/lib_block.json': { parent: 'minecraft:block/cube_all', textures: { all: 'libmod:block/lib' } },
    'assets/libmod/textures/block/lib.png': encodePng(16, 16, solid(10, 200, 10)),
  });
  return makeJar({
    'META-INF/neoforge.mods.toml': `modLoader="javafml"\nloaderVersion="[4,)"\n\n[[mods]] #mod\nmodId="testmod"\nversion="1.2.3"\ndisplayName="Test Mod"\n\n[[dependencies.testmod]]\nmodId="minecraft"\n`,
    'META-INF/jarjar/libmod-1.0.jar': nested,
    'assets/testmod/blockstates/blue_tile.json': { variants: { 'facing=north': { model: 'testmod:block/blue_tile' }, 'facing=east': { model: 'testmod:block/blue_tile', y: 90 } } },
    'assets/testmod/models/block/blue_tile.json': {
      parent: 'minecraft:block/block',
      textures: { all: 'testmod:block/blue', particle: 'testmod:block/blue' },
      elements: [{ from: [0, 0, 0], to: [16, 4, 16], faces: FACES({ all: '#all' }) }, { from: [0, 4, 0], to: [4, 12, 16], faces: FACES({ all: '#all' }) }],
    },
    'assets/testmod/blockstates/blue_wall_lamp.json': { variants: { '': { model: 'testmod:block/blue_tile' } } },
    'assets/testmod/models/item/blue_tile.json': { parent: 'testmod:block/blue_tile' },
    'assets/testmod/models/item/blue_lamp.json': { parent: 'minecraft:item/generated' },
    'assets/testmod/textures/block/blue.png': encodePng(16, 16, solid(30, 60, 200)),
    'assets/testmod/lang/de_de.json': { 'block.testmod.blue_tile': 'Blaue Fliese' },
    'data/testmod/loot_table/blocks/blue_wall_lamp.json': { pools: [{ entries: [{ type: 'minecraft:item', name: 'testmod:blue_lamp' }] }] },
    'data/testmod/recipe/blue_tile.json': {
      type: 'create:cutting',
      ingredients: [{ item: 'minecraft:stone' }],
      results: [{ id: 'testmod:blue_tile', count: 2 }],
    },
    'data/testmod/recipe/only_with_othermod.json': {
      type: 'minecraft:crafting_shapeless',
      'neoforge:conditions': [{ type: 'neoforge:mod_loaded', modid: 'othermod' }],
      ingredients: [{ item: 'minecraft:stone' }],
      result: { id: 'testmod:blue_tile', count: 9 },
    },
    'data/minecraft/tags/block/stairs.json': { values: ['testmod:blue_tile'] },
  });
}
