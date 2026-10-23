import { describe, expect, it } from 'vitest';
import { CatalogBuilder } from '../src/catalog/build';
import { findNeoForge, type PickedFile } from '../src/catalog/folders';
import { CATALOG_FORMAT, type Catalog, type Recipe } from '../src/catalog/types';
import { breakDown, RecipeBook } from '../src/materials/breakdown';
import { makeJar, vanillaJar } from './helpers/jarFixtures';

let n = 0;
function recipe(output: string, count: number, inputs: [string | string[], number][], station = 'Werkbank'): Recipe {
  return {
    id: `test:r${n++}`,
    type: station === 'Ofen' ? 'minecraft:smelting' : station === 'Steinschneider' ? 'minecraft:stonecutting' : 'minecraft:crafting_shaped',
    station,
    inputs: inputs.map(([o, c]) => ({ options: Array.isArray(o) ? o : [o], count: c })),
    output: { item: output, count },
  };
}

function catalog(recipes: Recipe[], itemTags: Record<string, string[]> = {}): Catalog {
  const items: Catalog['items'] = {};
  for (const r of recipes) {
    items[r.output.item] = {};
    for (const i of r.inputs) for (const o of i.options) if (!o.startsWith('#')) items[o] = {};
  }
  return { format: CATALOG_FORMAT, createdAt: '', minecraft: '1.21.1', sources: [], blocks: {}, models: [], geometries: [], items, itemTags, recipes, families: {}, warnings: [] };
}

const mc = (id: string) => `minecraft:${id}`;

// A small slice of the vanilla recipes, enough for the typical cases.
const VANILLA = [
  recipe(mc('stone'), 1, [[mc('cobblestone'), 1]], 'Ofen'),
  recipe(mc('stone_bricks'), 4, [[mc('stone'), 4]]),
  recipe(mc('stone_bricks'), 1, [[mc('stone'), 1]], 'Steinschneider'),
  recipe(mc('stone_brick_stairs'), 4, [[mc('stone_bricks'), 6]]),
  recipe(mc('stone_brick_stairs'), 1, [[mc('stone_bricks'), 1]], 'Steinschneider'),
  recipe(mc('stone_brick_stairs'), 1, [[mc('stone'), 1]], 'Steinschneider'),
  recipe(mc('oak_planks'), 4, [[mc('oak_log'), 1]]),
  recipe(mc('stick'), 4, [[mc('oak_planks'), 2]]),
  recipe(mc('oak_fence'), 3, [[mc('oak_planks'), 4], [mc('stick'), 2]]),
  recipe(mc('iron_ingot'), 1, [[mc('raw_iron'), 1]], 'Ofen'),
  recipe(mc('iron_ingot'), 1, [[mc('iron_ore'), 1]], 'Ofen'),
  recipe(mc('iron_ingot'), 9, [[mc('iron_block'), 1]]),
  recipe(mc('iron_block'), 1, [[mc('iron_ingot'), 9]]),
  recipe(mc('raw_iron'), 9, [[mc('raw_iron_block'), 1]]),
  recipe(mc('raw_iron_block'), 1, [[mc('raw_iron'), 9]]),
  recipe(mc('white_wool'), 1, [[mc('string'), 4]]),
  recipe(mc('piston'), 1, [[mc('oak_planks'), 3], [['#c:cobblestones'], 4], [['#c:ingots/iron'], 1], [mc('redstone'), 1]]),
];
const TAGS = {
  'c:cobblestones': [mc('infested_cobblestone'), mc('cobblestone'), mc('mossy_cobblestone')],
};

describe('raw material breakdown', () => {
  const book = new RecipeBook(catalog(VANILLA, TAGS));

  it('works recipes back to what is mined, crafting in whole batches', () => {
    const r = breakDown(new Map([[mc('stone_brick_stairs'), 10]]), book);
    // stonecutter from stone is cheapest: 10 stone, smelted from 10 cobblestone
    expect([...r.raw]).toEqual([[mc('cobblestone'), 10]]);
    expect(r.steps.map((s) => [s.item, s.crafts, s.recipe.station])).toEqual([
      [mc('stone_brick_stairs'), 10, 'Steinschneider'],
      [mc('stone'), 10, 'Ofen'],
    ]);
  });

  it('shares intermediate products and rounds every craft up once', () => {
    // 5 fences need 2 crafts (6 fences): 8 planks + 4 sticks; sticks need 2 planks (one craft = 4)
    const r = breakDown(new Map([[mc('oak_fence'), 5], [mc('oak_planks'), 3]]), book);
    const planks = r.steps.find((s) => s.item === mc('oak_planks'))!;
    expect(planks.needed).toBe(3 + 8 + 2);
    expect(planks.crafts).toBe(4);
    expect(r.raw.get(mc('oak_log'))).toBe(4);
  });

  it('prefers gathered items over unpacking and never runs in circles', () => {
    const r = breakDown(new Map([[mc('iron_block'), 2]]), book);
    expect([...r.raw]).toEqual([[mc('raw_iron'), 18]]);
    expect(book.chosen(mc('iron_ingot'), {})!.inputs[0].options).toEqual([mc('raw_iron')]);
  });

  it('treats wool and other gathered things as raw', () => {
    const r = breakDown(new Map([[mc('white_wool'), 5]]), book);
    expect([...r.raw]).toEqual([[mc('white_wool'), 5]]);
  });

  it('never picks blocks that survival players cannot get', () => {
    const r = breakDown(new Map([[mc('piston'), 2]]), book);
    expect(r.raw.get(mc('cobblestone'))).toBe(8);
    expect(r.raw.has(mc('infested_cobblestone'))).toBe(false);
    // c:ingots/iron is not defined here: the fallback maps it to the vanilla ingot
    expect(r.raw.get(mc('raw_iron'))).toBe(2);
  });

  it('follows the user: another recipe, or gather it as it is', () => {
    const viaBricks = book.options(mc('stone_brick_stairs')).find((o) => o.recipe.inputs[0].options[0] === mc('stone_bricks'))!;
    const r1 = breakDown(new Map([[mc('stone_brick_stairs'), 8]]), book, { [mc('stone_brick_stairs')]: viaBricks.recipe.id });
    expect(r1.steps[0].recipe.id).toBe(viaBricks.recipe.id);
    expect(r1.raw.get(mc('cobblestone'))).toBe(8);

    const r2 = breakDown(new Map([[mc('stone_brick_stairs'), 8]]), book, { [mc('stone')]: 'raw' });
    expect([...r2.raw]).toEqual([[mc('stone'), 8]]);

    // A choice that closes a circle (ingots from blocks, blocks from ingots) ends as raw.
    const r3 = breakDown(new Map([[mc('iron_block'), 1]]), book, { [mc('iron_ingot')]: VANILLA[11].id });
    expect(r3.raw.size).toBe(1);
  });

  it('lists the ways to make an item, cheapest first', () => {
    const opts = book.options(mc('stone_brick_stairs'));
    expect(opts.map((o) => o.recipe.station)).toEqual(['Steinschneider', 'Steinschneider', 'Werkbank']);
    expect(opts[2].cost).toBeCloseTo(1.5);
  });
});

describe('recipes overridden by later jars', () => {
  it('lets NeoForge and mods replace or switch off vanilla recipes', () => {
    const b = new CatalogBuilder();
    b.addJar('1.21.1.jar', vanillaJar());
    b.addJar(
      'neoforge-21.1.252-universal.jar',
      makeJar({
        'META-INF/neoforge.mods.toml': '[[mods]]\nmodId="neoforge"\nversion="21.1.252"\ndisplayName="NeoForge"\n',
        'data/c/tags/item/stones.json': { values: ['minecraft:stone'] },
        'data/minecraft/recipe/stone_stairs.json': {
          type: 'minecraft:crafting_shaped',
          key: { '#': { tag: 'c:stones' } },
          pattern: ['#  ', '## ', '###'],
          result: { id: 'minecraft:stone_stairs', count: 4 },
        },
        'data/minecraft/recipe/stone_slab.json': {
          'neoforge:conditions': [{ type: 'neoforge:false' }],
          type: 'minecraft:crafting_shaped',
          key: { '#': { item: 'minecraft:stone' } },
          pattern: ['###'],
          result: { id: 'minecraft:stone_slab', count: 6 },
        },
      }),
    );
    const c = b.build();
    const stairs = c.recipes.filter((r) => r.id === 'minecraft:stone_stairs');
    expect(stairs).toHaveLength(1);
    expect(stairs[0].inputs[0].options).toEqual(['#c:stones']);
    expect(c.itemTags['c:stones']).toEqual(['minecraft:stone']);
    expect(c.recipes.some((r) => r.id === 'minecraft:stone_slab')).toBe(false);
    expect(c.sources.map((s) => s.mods.map((m) => m.id).join())).toEqual(['minecraft', 'neoforge']);
  });
});

describe('finding NeoForge', () => {
  const file = (path: string): PickedFile => ({ path, file: new File([''], path.split('/').pop()!) });
  it('takes the newest NeoForge that belongs to the Minecraft version', () => {
    const picked = [
      file('Install/libraries/net/neoforged/neoforge/21.1.200/neoforge-21.1.200-universal.jar'),
      file('Install/libraries/net/neoforged/neoforge/21.1.252/neoforge-21.1.252-universal.jar'),
      file('Install/libraries/net/neoforged/neoforge/21.4.30-beta/neoforge-21.4.30-beta-universal.jar'),
      file('Install/libraries/net/neoforged/neoforge/21.1.252/neoforge-21.1.252-client.jar'),
      file('Install/libraries/net/neoforged/neoforge/20.4.237/neoforge-20.4.237-universal.jar'),
    ];
    expect(findNeoForge(picked, '1.21.1')?.version).toBe('21.1.252');
    expect(findNeoForge(picked, '1.20.4')?.version).toBe('20.4.237');
    expect(findNeoForge(picked, '1.21')).toBeNull();
    // picked as single files (phones, or without folder access)
    expect(findNeoForge([file('neoforge-21.1.9-universal.jar')], '1.21.1')?.version).toBe('21.1.9');
  });
});
