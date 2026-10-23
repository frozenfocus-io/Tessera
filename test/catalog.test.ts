import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBlockModel, KIND_CROSS, KIND_CUBE, KIND_SHAPE, FLAG_MARKED, FLAG_TRANSLUCENT } from '../src/blocks/blockModel';
import { CatalogBuilder } from '../src/catalog/build';
import { findMinecraftFiles, findModFiles, type PickedFile } from '../src/catalog/folders';
import { parseModsToml } from '../src/catalog/jar';
import { decodePng, summarizeImage } from '../src/catalog/png';
import { normalizeRecipe } from '../src/catalog/recipes';
import { resolveFromCatalog } from '../src/catalog/runtime';
import { appliedFor, matchCondition, rotateBoxes, rotateFaces } from '../src/catalog/states';
import { makeState, parseBlockState } from '../src/core/blockstate';
import { deLang, encodePng, modJar, solid, vanillaJar } from './helpers/jarFixtures';

function build() {
  const b = new CatalogBuilder();
  b.addJar('1.21.1.jar', vanillaJar());
  b.addJar('testmod-1.2.3.jar', modJar());
  b.addLanguage('de_de', deLang());
  return b.build();
}

describe('PNG decoding', () => {
  it('decodes RGBA and averages colour and coverage', () => {
    const img = decodePng(encodePng(4, 2, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 0])));
    expect([img.width, img.height]).toEqual([4, 2]);
    expect(Array.from(img.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    const s = summarizeImage(img);
    expect(s.rgb).toBe(0xff0000);
    expect(s.coverage).toBeCloseTo(0.5);
  });
  it('uses the first frame of animated textures', () => {
    const img = decodePng(encodePng(2, 4, (_x, y) => (y < 2 ? [0, 255, 0, 255] : [255, 255, 255, 255])));
    expect(summarizeImage(img, 2).rgb).toBe(0x00ff00);
  });
});

describe('rotations', () => {
  it('rotates boxes like Minecraft (x first, then y)', () => {
    // upper half of the stairs model on the east side, rotated to face south
    expect(rotateBoxes([8, 8, 0, 16, 16, 16], 0, 1)).toEqual([0, 8, 8, 16, 16, 16]);
    // x = 90 turns up into north
    expect(rotateBoxes([0, 12, 0, 16, 16, 16], 1, 0)).toEqual([0, 0, 0, 16, 16, 4]);
    // half=top stairs: x = 180 flips the bottom slab to the top
    expect(rotateBoxes([0, 0, 0, 16, 8, 16], 2, 0)).toEqual([0, 8, 0, 16, 16, 16]);
  });
  it('rotates face colours with the model', () => {
    const f = ['E', 'W', 'U', 'D', 'S', 'N'];
    expect(rotateFaces(f, 0, 1)).toEqual(['N', 'S', 'U', 'D', 'E', 'W']);
    expect(rotateFaces(f, 1, 0)).toEqual(['E', 'W', 'S', 'N', 'D', 'U']);
    // a log lying along x: ends east and west
    expect(rotateFaces(['s', 's', 'end', 'end', 's', 's'], 1, 1)).toEqual(['end', 'end', 's', 's', 's', 's']);
  });
  it('matches multipart conditions', () => {
    expect(matchCondition({ north: 'true' }, { north: 'true', south: 'false' })).toBe(true);
    expect(matchCondition({ north: 'low|tall' }, { north: 'none' })).toBe(false);
    expect(matchCondition({ OR: [{ north: 'true' }, { east: 'true' }] }, { north: 'false', east: 'true' })).toBe(true);
    expect(matchCondition({ AND: [{ north: 'true' }, { east: 'true' }] }, { north: 'false', east: 'true' })).toBe(false);
  });
});

describe('catalog from jars', () => {
  const c = build();

  it('reads blocks, names and mods', () => {
    expect(c.minecraft).toBe('1.21.1');
    expect(Object.keys(c.blocks).sort()).toEqual(
      ['libmod:lib_block', 'minecraft:chest', 'minecraft:glass', 'minecraft:oak_log', 'minecraft:poppy', 'minecraft:stone', 'minecraft:stone_slab', 'minecraft:stone_stairs', 'testmod:blue_tile', 'testmod:blue_wall_lamp'],
    );
    expect(c.blocks['minecraft:stone'].de).toBe('Stein');
    expect(c.blocks['minecraft:stone'].en).toBe('Stone');
    expect(c.blocks['testmod:blue_tile'].de).toBe('Blaue Fliese');
    expect(c.sources.map((s) => s.mods.map((m) => m.id).join('+'))).toEqual(['minecraft', 'testmod', 'libmod']);
    expect(c.sources[1].mods[0]).toEqual({ id: 'testmod', name: 'Test Mod', version: '1.2.3' });
    expect(c.sources[0].textures).toBe(6); // gui textures are skipped
  });

  it('resolves models: colours per face, shapes, translucency, crosses', () => {
    const log = c.models.find((m) => m.id === 'minecraft:block/oak_log')!;
    expect(log.f).toEqual([0x6e5532, 0x6e5532, 0xa08250, 0xa08250, 0x6e5532, 0x6e5532]);
    expect(log.g).toBe(0);
    expect(c.models.find((m) => m.id === 'minecraft:block/glass')!.tr).toBe(1);
    expect(c.models.find((m) => m.id === 'minecraft:block/stone')!.tr).toBe(0);
    expect(c.models.find((m) => m.id === 'minecraft:block/poppy')!.kind).toBe('cross');
    const chest = c.models.find((m) => m.id === 'minecraft:block/chest')!;
    expect(chest.kind).toBe('empty');
    expect(chest.f[0]).toBe(0xa2834f);
    const stairs = c.models.find((m) => m.id === 'minecraft:block/stone_stairs')!;
    expect(c.geometries[stairs.g]).toEqual([0, 0, 0, 16, 8, 16, 8, 8, 0, 16, 16, 16]);
  });

  it('finds the item that places a block', () => {
    expect(c.blocks['minecraft:stone'].item).toBe('minecraft:stone');
    expect(c.blocks['testmod:blue_wall_lamp'].item).toBe('testmod:blue_lamp');
    expect(c.blocks['libmod:lib_block'].item).toBeNull();
  });

  it('reads recipes, honours load conditions and skips special recipes', () => {
    const cut = c.recipes.find((r) => r.id === 'testmod:blue_tile')!;
    expect(cut).toMatchObject({ station: 'Mechanische Säge (Create)', output: { item: 'testmod:blue_tile', count: 2 } });
    expect(cut.inputs).toEqual([{ options: ['minecraft:stone'], count: 1 }]);
    expect(c.recipes.some((r) => r.id === 'testmod:only_with_othermod')).toBe(false);
    expect(c.recipes.some((r) => r.id === 'minecraft:firework_rocket')).toBe(false);
    const stairs = c.recipes.find((r) => r.id === 'minecraft:stone_stairs')!;
    expect(stairs.inputs).toEqual([{ options: ['minecraft:stone'], count: 6 }]);
    expect(c.itemTags['minecraft:stone_crafting_materials']).toEqual(['minecraft:cobblestone', 'minecraft:stone']);
  });

  it('builds families from tags, recipes and ids', () => {
    expect(c.blocks['minecraft:stone_stairs'].role).toBe('stairs');
    expect(c.blocks['minecraft:stone_slab'].role).toBe('slab');
    expect(c.families['minecraft:stone']).toEqual({
      base: 'minecraft:stone',
      members: { block: 'minecraft:stone', stairs: 'minecraft:stone_stairs', slab: 'minecraft:stone_slab' },
    });
    // the mod adds its block to the vanilla stairs tag; its saw recipe names the base
    expect(c.blocks['testmod:blue_tile'].family).toBe('minecraft:stone');
  });

  it('turns placed states into colours and rotated shapes', () => {
    const logX = resolveFromCatalog(parseBlockState('minecraft:oak_log[axis=x]'), c)!;
    expect(logX.colors.faces[0]).toBe(0xa08250); // the end grain looks east
    expect(logX.colors.faces[2]).toBe(0x6e5532);
    expect(logX.shape).toEqual({ kind: 'cube', occludes: true, translucent: false, cullSame: false });
    const south = resolveFromCatalog(parseBlockState('minecraft:stone_stairs[facing=south,half=bottom,shape=straight]'), c)!;
    expect(south.shape).toEqual({ kind: 'boxes', boxes: [[0, 0, 0, 16, 8, 16], [0, 8, 8, 16, 16, 16]], translucent: false });
    const top = resolveFromCatalog(parseBlockState('minecraft:stone_stairs[facing=north,half=top,shape=straight]'), c)!;
    expect(top.shape?.kind).toBe('boxes');
    expect(appliedFor(c.blocks['minecraft:stone'].states, {})).toHaveLength(1);
    expect(resolveFromCatalog(parseBlockState('minecraft:unknown_thing'), c)).toBeNull();
  });

  it('feeds the block model: names, kinds, unknown blocks', () => {
    const palette = [
      makeState('minecraft:air'),
      parseBlockState('minecraft:stone'),
      parseBlockState('minecraft:glass'),
      parseBlockState('minecraft:poppy'),
      parseBlockState('minecraft:stone_slab[type=bottom]'),
      parseBlockState('testmod:blue_tile[facing=east]'),
      parseBlockState('othermod:mystery'),
      parseBlockState('minecraft:chest[facing=north]'),
    ];
    const m = buildBlockModel(palette, c);
    expect(m.types.map((t) => t.displayName)).toEqual(['Air', 'Stein', 'Glass', 'Poppy', 'Stone Slab', 'Blaue Fliese', 'Mystery (othermod)', 'Chest']);
    expect(m.table.kind[1]).toBe(KIND_CUBE);
    expect(m.table.flags[2] & FLAG_TRANSLUCENT).toBeTruthy();
    expect(m.table.kind[3]).toBe(KIND_CROSS);
    expect(m.table.kind[4]).toBe(KIND_SHAPE);
    expect(m.table.kind[5]).toBe(KIND_SHAPE);
    expect(m.table.flags[6] & FLAG_MARKED).toBeTruthy();
    expect(m.table.flags[5] & FLAG_MARKED).toBeFalsy();
    expect(m.entries[5].items).toEqual([{ item: 'testmod:blue_tile', count: 1 }]);
    expect(m.types[5].mod).toBe('testmod');
  });

  it('survives broken jars and files', () => {
    const b = new CatalogBuilder();
    const sources = b.addJar('kaputt.jar', new Uint8Array([1, 2, 3]));
    expect(sources[0].warnings[0]).toMatch(/kein gültiges/);
    const c2 = b.build();
    expect(Object.keys(c2.blocks)).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('parses mods.toml', () => {
    expect(parseModsToml('[[mods]]\nmodId="a"\ndisplayName=\'A Mod\'\nversion="${file.jarVersion}"\n[[mods]]\nmodId = "b"\n[[dependencies.a]]\nmodId="minecraft"')).toEqual([
      { modId: 'a', displayName: 'A Mod', version: '${file.jarVersion}' },
      { modId: 'b', displayName: 'b', version: '' },
    ]);
  });

  it('normalises ingredient forms', () => {
    const ctx = { mods: new Set(['minecraft']), itemTags: {}, items: new Set<string>() };
    const r = normalizeRecipe(
      'x:y',
      {
        type: 'minecraft:crafting_shapeless',
        ingredients: [{ tag: 'c:ingots/iron' }, [{ item: 'a' }, { item: 'minecraft:b' }], { type: 'neoforge:compound', children: [{ item: 'c' }] }, { fluid: 'water' }],
        result: { item: 'minecraft:thing', count: 3 },
      },
      ctx,
    )!;
    expect(r.inputs).toEqual([
      { options: ['#c:ingots/iron'], count: 1 },
      { options: ['minecraft:a', 'minecraft:b'], count: 1 },
      { options: ['minecraft:c'], count: 1 },
    ]);
    expect(r.output).toEqual({ item: 'minecraft:thing', count: 3 });
  });

  it('finds the Minecraft jar, German names and mods in picked folders', async () => {
    const file = (name: string, content = '') => new File([content], name);
    const index = JSON.stringify({ objects: { 'minecraft/lang/de_de.json': { hash: 'ab12' + '0'.repeat(36) } } });
    const picked: PickedFile[] = [
      { path: 'Install/versions/1.21.1/1.21.1.jar', file: file('1.21.1.jar') },
      { path: 'Install/versions/1.21.1/1.21.1.json', file: file('1.21.1.json', JSON.stringify({ assetIndex: { id: '17' } })) },
      { path: 'Install/versions/neoforge-21.1.252/neoforge-21.1.252.jar', file: file('neoforge.jar') },
      { path: 'Install/libraries/net/neoforged/neoforge/21.1.252/neoforge-21.1.252-universal.jar', file: file('neoforge-21.1.252-universal.jar') },
      { path: 'Install/versions/1.20.1/1.20.1.jar', file: file('1.20.1.jar') },
      { path: 'Install/assets/indexes/17.json', file: file('17.json', index) },
      { path: `Install/assets/objects/ab/ab12${'0'.repeat(36)}`, file: file('lang') },
    ];
    const mc = await findMinecraftFiles(picked);
    expect(mc.version).toBe('1.21.1');
    expect(mc.jar?.path).toBe('Install/versions/1.21.1/1.21.1.jar');
    expect(mc.languageDe?.path).toBe(`Install/assets/objects/ab/ab12${'0'.repeat(36)}`);
    expect(mc.loaderVersion).toBe('21.1.252');
    expect(mc.notes).toEqual([]);

    const mods = findModFiles([
      { path: 'mods/create.jar', file: file('create.jar') },
      { path: 'mods/old.jar.disabled', file: file('old.jar.disabled') },
      { path: 'mods/.index/x.jar', file: file('x.jar') },
      { path: 'mods/readme.txt', file: file('readme.txt') },
    ]);
    expect(mods.mods.map((m) => m.path)).toEqual(['mods/create.jar']);
    expect(mods.disabled).toBe(1);
  });
});

// With the real game files (not part of the repository): TESSERA_MC_ROOT=<launcher folder>
const root = process.env.TESSERA_MC_ROOT;
describe.runIf(root && existsSync(root))('with the real Minecraft jar', () => {
  it('reads every vanilla block with colours and names', () => {
    const jar = `${root}/versions/1.21.1/1.21.1.jar`;
    const b = new CatalogBuilder();
    b.addJar('1.21.1.jar', new Uint8Array(readFileSync(jar)));
    const objects = `${root}/assets/objects`;
    const index = JSON.parse(readFileSync(`${root}/assets/indexes/17.json`, 'utf8')) as { objects: Record<string, { hash: string }> };
    const hash = index.objects['minecraft/lang/de_de.json'].hash;
    if (readdirSync(objects).includes(hash.slice(0, 2))) b.addLanguage('de_de', new Uint8Array(readFileSync(`${objects}/${hash.slice(0, 2)}/${hash}`)));
    const c = b.build();
    expect(Object.keys(c.blocks).length).toBeGreaterThan(1000);
    expect(c.blocks['minecraft:stone_bricks'].de).toBe('Steinziegel');
    expect(c.families['minecraft:stone_bricks'].members.stairs).toBe('minecraft:stone_brick_stairs');
    const grass = resolveFromCatalog(parseBlockState('minecraft:grass_block[snowy=false]'), c)!;
    const g = (grass.colors.faces[2] >> 8) & 255;
    const r = (grass.colors.faces[2] >> 16) & 255;
    expect(g).toBeGreaterThan(r); // tinted green on top
    expect(c.warnings).toEqual([]);
  });
});

// keep the helper import used even if a test is skipped
void solid;
