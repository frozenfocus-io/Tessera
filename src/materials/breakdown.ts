import { isCreativeOnly } from '../blocks/items';
import type { Catalog, Recipe } from '../catalog/types';

/**
 * Raw material breakdown ("Rohstoff-Aufschlüsselung"): works the recipes backwards until only
 * things remain that are mined or gathered (stone brick stairs -> stone bricks -> stone ->
 * cobblestone). Per item the cheapest way is the default; every item can be switched to another
 * recipe or be treated as a raw material.
 */

/**
 * Things the game can also make from a recipe, but that players gather directly: wool from
 * sheep, coal and diamonds from ores (without silk touch the ore drops the item itself).
 */
const DEFAULT_RAW = new Set([
  ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map(
    (c) => `minecraft:${c}_wool`,
  ),
  ...['coal', 'raw_iron', 'raw_copper', 'raw_gold', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'quartz', 'slime_ball', 'dried_kelp', 'wheat'].map((i) => `minecraft:${i}`),
]);

const VANILLA_STATIONS = new Set(['Werkbank', 'Steinschneider', 'Ofen', 'Schmelzofen', 'Räucherofen', 'Lagerfeuer', 'Schmiedetisch']);

/**
 * A tiny cost per step in the chain: with equal materials the shorter way wins (stone slabs
 * straight from stone in the stonecutter, not via stone bricks).
 */
const CRAFT_EFFORT = 1e-4;

/** Common tags of NeoForge (c:…) that the mods folder does not define, mapped to vanilla items. */
const COMMON_TAG_FALLBACK: Record<string, string> = {
  'c:rods/wooden': 'minecraft:stick',
  'c:strings': 'minecraft:string',
  'c:leathers': 'minecraft:leather',
  'c:feathers': 'minecraft:feather',
  'c:stones': 'minecraft:stone',
  'c:cobblestones': 'minecraft:cobblestone',
  'c:cobblestones/normal': 'minecraft:cobblestone',
  'c:sands': 'minecraft:sand',
  'c:gravels': 'minecraft:gravel',
  'c:obsidians': 'minecraft:obsidian',
  'c:glass_blocks': 'minecraft:glass',
  'c:glass_blocks/colorless': 'minecraft:glass',
  'c:glass_panes': 'minecraft:glass_pane',
  'c:glass_panes/colorless': 'minecraft:glass_pane',
  'c:chests': 'minecraft:chest',
  'c:chests/wooden': 'minecraft:chest',
  'c:bricks/normal': 'minecraft:brick',
  'c:bricks/nether': 'minecraft:nether_brick',
  'c:gunpowders': 'minecraft:gunpowder',
  'c:slime_balls': 'minecraft:slime_ball',
  'c:crops/wheat': 'minecraft:wheat',
  'c:eggs': 'minecraft:egg',
  'c:bones': 'minecraft:bone',
  'c:ender_pearls': 'minecraft:ender_pearl',
  'c:fences/wooden': 'minecraft:oak_fence',
  'c:fence_gates/wooden': 'minecraft:oak_fence_gate',
};

export interface RecipeOption {
  recipe: Recipe;
  /** Raw material units per produced item (lower is cheaper). */
  cost: number;
}

/** Recipes indexed for working backwards, with the cost of every item. */
export class RecipeBook {
  readonly byOutput = new Map<string, Recipe[]>();
  readonly cost = new Map<string, number>();
  /** Cheapest recipe per item; following these never runs in circles. */
  private best = new Map<string, Recipe>();
  /** Items only reachable through cycles (raw iron <-> raw iron block): treated as raw. */
  private cycleRaw = new Set<string>();
  /** "Unpacking" recipes (iron block -> 9 ingots): allowed, but never preferred on a tie. */
  private unpacking = new Set<Recipe>();

  constructor(private readonly catalog: Catalog) {
    const all = catalog.recipes;
    const packs = new Set<string>();
    for (const r of all) if (r.inputs.length === 1 && r.inputs[0].options.length === 1 && r.inputs[0].count >= 4 && r.output.count === 1) packs.add(`${r.inputs[0].options[0]}>${r.output.item}`);
    for (const r of all) {
      if (r.inputs.some((i) => i.options.includes(r.output.item))) continue;
      if (r.inputs.length === 1 && r.inputs[0].count === 1 && r.output.count >= 4 && r.inputs[0].options.length === 1 && packs.has(`${r.output.item}>${r.inputs[0].options[0]}`)) this.unpacking.add(r);
      const list = this.byOutput.get(r.output.item);
      if (list) list.push(r);
      else this.byOutput.set(r.output.item, [r]);
    }
    this.computeCosts();
  }

  /** Items an ingredient stands for. */
  expand(option: string): string[] {
    if (!option.startsWith('#')) return [option];
    const tag = option.slice(1);
    const items = this.catalog.itemTags[tag];
    if (items?.length) return items;
    if (COMMON_TAG_FALLBACK[tag]) return [COMMON_TAG_FALLBACK[tag]];
    // c:ingots/iron -> minecraft:iron_ingot, c:gems/diamond -> minecraft:diamond, …
    const m = /^c:([a-z_]+)\/([a-z_]+)$/.exec(tag);
    if (m) {
      const singular = m[1].replace(/s$/, '');
      const candidates = [`minecraft:${m[2]}_${singular}`, `minecraft:${m[2]}`, `minecraft:${m[2]}_block`];
      if (singular === 'storage_block') candidates.unshift(`minecraft:${m[2]}_block`);
      for (const c of candidates) if (this.catalog.items[c] || this.catalog.blocks[c]) return [c];
    }
    return [];
  }

  /** Raw by default: gathered, or no way to make it. A user choice wins over both. */
  isRaw(item: string, choices: Readonly<Record<string, string>>): boolean {
    const choice = choices[item];
    if (choice === 'raw') return true;
    if (choice && choice !== 'auto' && this.byOutput.get(item)?.some((r) => r.id === choice)) return false;
    return DEFAULT_RAW.has(item) || this.cycleRaw.has(item) || !this.best.has(item);
  }

  /**
   * What a raw material costs: ores need silk touch, so their drops are preferred; blocks that
   * survival players cannot get (infested stone in "#c:cobblestones") are never picked.
   */
  private rawCost(item: string): number {
    if (isCreativeOnly(item)) return Infinity;
    return /_ore$|ancient_debris/.test(item) ? 1.1 : 1;
  }

  private computeCosts(): void {
    const cost = this.cost;
    for (const [item] of this.byOutput) if (!DEFAULT_RAW.has(item)) cost.set(item, Infinity);
    const unitCost = (item: string): number => cost.get(item) ?? this.rawCost(item);
    // Bellman-Ford style relaxation with strict improvements only: costs only go down, and the
    // recorded best recipes form no cycles.
    for (let pass = 0; pass < 60; pass++) {
      let changed = false;
      for (const [item, recipes] of this.byOutput) {
        if (DEFAULT_RAW.has(item)) continue;
        for (const r of recipes) {
          const c = this.recipeCost(r, unitCost);
          if (c < cost.get(item)! - 1e-9) {
            cost.set(item, c);
            this.best.set(item, r);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    for (const [item, c] of cost) {
      if (Number.isFinite(c)) continue;
      cost.set(item, 1);
      this.cycleRaw.add(item);
      this.best.delete(item);
    }
  }

  /** Cost of one output item with this recipe. */
  recipeCost(r: Recipe, unitCost: (item: string) => number = (i) => this.cost.get(i) ?? this.rawCost(i)): number {
    let total = 0;
    for (const ing of r.inputs) {
      let best = Infinity;
      for (const o of ing.options) for (const it of this.expand(o)) best = Math.min(best, unitCost(it));
      if (!Number.isFinite(best)) return Infinity;
      total += best * ing.count;
    }
    const penalty = (VANILLA_STATIONS.has(r.station) ? 1 : 1.02) * (this.unpacking.has(r) ? 1.05 : 1);
    return (total / r.output.count) * penalty + CRAFT_EFFORT;
  }

  /** All ways to make an item, cheapest first. */
  options(item: string): RecipeOption[] {
    return (this.byOutput.get(item) ?? [])
      .map((recipe) => ({ recipe, cost: this.recipeCost(recipe) }))
      .filter((o) => Number.isFinite(o.cost))
      .sort((a, b) => a.cost - b.cost);
  }

  chosen(item: string, choices: Readonly<Record<string, string>>): Recipe | null {
    if (this.isRaw(item, choices)) return null;
    const pick = choices[item];
    if (pick && pick !== 'auto') {
      const r = this.byOutput.get(item)?.find((x) => x.id === pick);
      if (r) return r;
    }
    return this.best.get(item) ?? null;
  }

  /** The cheapest concrete item for an ingredient slot. */
  pickOption(options: readonly string[]): string | null {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const o of options) {
      for (const it of this.expand(o)) {
        const c = this.cost.get(it) ?? this.rawCost(it);
        if (c < bestCost) {
          best = it;
          bestCost = c;
        }
      }
    }
    return best;
  }
}

export interface BreakdownStep {
  item: string;
  /** How many items are needed, and how many the crafts produce (crafts come in batches). */
  needed: number;
  produced: number;
  crafts: number;
  recipe: Recipe;
  /** Concrete inputs per craft. */
  inputs: { item: string; count: number }[];
}

export interface Breakdown {
  raw: Map<string, number>;
  steps: BreakdownStep[];
}

/** Works the demand backwards through the chosen recipes, crafting shared parts together. */
export function breakDown(demand: ReadonlyMap<string, number>, book: RecipeBook, choices: Readonly<Record<string, string>> = {}): Breakdown {
  // Order: an item comes before everything it is made from (reverse post-order of the recipe graph).
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  // A user's choice can close a circle (ingots from blocks, blocks from ingots): the item where
  // the circle closes is then treated as raw.
  const forcedRaw = new Set<string>();
  const visit = (item: string, depth: number) => {
    if (state.get(item) || depth > 64) return;
    state.set(item, 1);
    const r = book.chosen(item, choices);
    if (r) {
      for (const ing of r.inputs) {
        const pick = book.pickOption(ing.options);
        if (!pick) continue;
        if (state.get(pick) === 1) forcedRaw.add(item);
        else visit(pick, depth + 1);
      }
    }
    state.set(item, 2);
    order.push(item);
  };
  for (const item of demand.keys()) visit(item, 0);
  order.reverse();

  const need = new Map(demand);
  const raw = new Map<string, number>();
  const steps: BreakdownStep[] = [];
  for (const item of order) {
    const n = need.get(item) ?? 0;
    if (n <= 0) continue;
    const r = forcedRaw.has(item) ? null : book.chosen(item, choices);
    if (!r) {
      raw.set(item, (raw.get(item) ?? 0) + n);
      continue;
    }
    const crafts = Math.ceil(n / r.output.count - 1e-9);
    const inputs: { item: string; count: number }[] = [];
    for (const ing of r.inputs) {
      const pick = book.pickOption(ing.options);
      if (!pick) continue;
      inputs.push({ item: pick, count: ing.count });
      need.set(pick, (need.get(pick) ?? 0) + crafts * ing.count);
    }
    steps.push({ item, needed: n, produced: crafts * r.output.count, crafts, recipe: r, inputs });
  }
  return { raw, steps };
}

const books = new WeakMap<Catalog, RecipeBook>();

/** One recipe book per catalog, built on first use. */
export function recipeBookFor(catalog: Catalog): RecipeBook {
  let b = books.get(catalog);
  if (!b) {
    b = new RecipeBook(catalog);
    books.set(catalog, b);
  }
  return b;
}
