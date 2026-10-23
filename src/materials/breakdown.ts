import { isCreativeOnly } from '../blocks/items';
import type { Catalog, Ingredient, Recipe } from '../catalog/types';

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
  // Natural blocks with a recipe that builders still mine.
  ...['andesite', 'diorite', 'granite', 'magma_block', 'dripstone_block'].map((i) => `minecraft:${i}`),
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
  /**
   * Recipes Tessera may pick by itself. Vanilla items are made the vanilla way; mods only add
   * alternatives to choose from (Create's millstone does not turn cobblestone into gravel by
   * default). A vanilla item without a vanilla recipe is gathered in the world.
   */
  private automatic = new Map<string, Recipe[]>();

  constructor(private readonly catalog: Catalog) {
    const all = catalog.recipes;
    const packs = new Set<string>();
    for (const r of all) if (r.inputs.length === 1 && r.inputs[0].options.length === 1 && r.inputs[0].count >= 4 && r.output.count === 1) packs.add(`${r.inputs[0].options[0]}>${r.output.item}`);
    for (const r0 of all) {
      const r = this.withGroupBase(r0);
      if (!r || r.inputs.some((i) => i.options.includes(r.output.item))) continue;
      if (r.inputs.length === 1 && r.inputs[0].count === 1 && r.output.count >= 4 && r.inputs[0].options.length === 1 && packs.has(`${r.output.item}>${r.inputs[0].options[0]}`)) this.unpacking.add(r);
      const list = this.byOutput.get(r.output.item);
      if (list) list.push(r);
      else this.byOutput.set(r.output.item, [r]);
    }
    for (const [item, recipes] of this.byOutput) {
      if (DEFAULT_RAW.has(item)) continue;
      const usable = item.startsWith('minecraft:') ? recipes.filter((r) => r.id.startsWith('minecraft:')) : recipes;
      if (usable.length) this.automatic.set(item, usable);
    }
    this.computeCosts();
  }

  /**
   * Conversions inside a group ("any stone of Create's ochrum palette -> cut ochrum", the
   * ingredient tag contains the output): made from the group's base block. The base itself is
   * gathered, not converted.
   */
  private withGroupBase(r: Recipe): Recipe | null {
    let changed = false;
    const inputs: (Ingredient | null)[] = r.inputs.map((ing) => {
      const tag = ing.options.find((o) => o.startsWith('#') && this.expand(o).includes(r.output.item));
      if (!tag) return ing;
      changed = true;
      const base = this.groupBase(tag);
      return base && base !== r.output.item ? { options: [base], count: ing.count } : null;
    });
    if (!changed) return r;
    return inputs.every((i): i is Ingredient => i !== null) ? { ...r, inputs } : null;
  }

  /** The base block of a group: named like the tag ("…/ochrum" -> create:ochrum), else the shortest name. */
  private groupBase(tag: string): string | null {
    const members = this.expand(tag);
    const name = tag.split(/[:/]/).pop();
    const named = members.filter((m) => m.endsWith(`:${name}`));
    if (named.length) return named.find((m) => m.startsWith('minecraft:')) ?? named[0];
    let best: string | null = null;
    for (const m of members) if (!best || m.length - m.indexOf(':') < best.length - best.indexOf(':')) best = m;
    return best;
  }

  /** What can fill an ingredient slot. From tags vanilla items first: oak planks, not a mod's charred planks. */
  private candidates(options: readonly string[]): string[] {
    const all = options.flatMap((o) => this.expand(o));
    const vanilla = all.filter((i) => i.startsWith('minecraft:'));
    return vanilla.length && vanilla.length < all.length ? vanilla : all;
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
   * What a raw material costs. Ores need silk touch, so mining their drops wins, also against
   * ore doubling in mod machines. Blocks that survival players cannot get (infested stone in
   * "#c:cobblestones") are never picked.
   */
  private rawCost(item: string): number {
    if (isCreativeOnly(item)) return Infinity;
    return /_ore$|ancient_debris/.test(item) ? 4 : 1;
  }

  private computeCosts(): void {
    const cost = this.cost;
    for (const item of this.automatic.keys()) cost.set(item, Infinity);
    const unitCost = (item: string): number => cost.get(item) ?? this.rawCost(item);
    const relax = () => {
      // Bellman-Ford style relaxation with strict improvements only: costs only go down, and
      // the recorded best recipes form no cycles.
      for (let pass = 0; pass < 60; pass++) {
        let changed = false;
        for (const [item, recipes] of this.automatic) {
          if (this.cycleRaw.has(item)) continue;
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
    };
    relax();
    // Items that are only made from each other (flax <-> flax block, raw zinc <-> its block):
    // one of each circle is gathered, then everything made from it gets its recipes back.
    for (let round = 0; round < 100; round++) {
      const stuck = [...this.automatic.keys()].filter((i) => !Number.isFinite(cost.get(i)!));
      if (!stuck.length) break;
      for (const item of this.circleStarts(new Set(stuck), unitCost)) {
        this.cycleRaw.add(item);
        cost.set(item, this.rawCost(item) === Infinity ? 1 : this.rawCost(item));
        this.best.delete(item);
      }
      relax();
    }
  }

  /**
   * Of the stuck items, the circles that depend on nothing else stuck; from each the item that
   * is "unpacked" in it (9 flax from a flax block), else the one used most, else the shortest id.
   */
  private circleStarts(stuck: ReadonlySet<string>, unitCost: (item: string) => number): string[] {
    const edges = new Map<string, { to: string; out: number }[]>();
    for (const item of stuck) {
      const list: { to: string; out: number }[] = [];
      for (const r of this.automatic.get(item) ?? []) {
        for (const ing of r.inputs) {
          const cands = this.candidates(ing.options);
          if (cands.some((c) => Number.isFinite(unitCost(c)))) continue;
          for (const c of cands) if (stuck.has(c)) list.push({ to: c, out: r.output.count });
        }
      }
      edges.set(item, list);
    }
    // Tarjan's strongly connected components (iterative enough for these sizes).
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const comp = new Map<string, number>();
    const comps: string[][] = [];
    let counter = 0;
    const visit = (v: string, depth: number) => {
      index.set(v, counter);
      low.set(v, counter++);
      stack.push(v);
      onStack.add(v);
      for (const { to } of edges.get(v)!) {
        if (!index.has(to)) {
          if (depth < 2000) visit(to, depth + 1);
          low.set(v, Math.min(low.get(v)!, low.get(to) ?? index.get(to)!));
        } else if (onStack.has(to)) low.set(v, Math.min(low.get(v)!, index.get(to)!));
      }
      if (low.get(v) === index.get(v)) {
        const c: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.set(w, comps.length);
          c.push(w);
        } while (w !== v);
        comps.push(c);
      }
    };
    for (const v of stuck) if (!index.has(v)) visit(v, 0);

    const starts: string[] = [];
    comps.forEach((members, ci) => {
      // Only circles that wait for nothing outside themselves.
      if (members.some((m) => edges.get(m)!.some((e) => comp.get(e.to) !== ci))) return;
      let best = members[0];
      let bestKey: [number, number, number] = [-1, -1, 0];
      for (const m of members) {
        const unpacked = Math.max(0, ...edges.get(m)!.map((e) => e.out));
        const used = members.reduce((n, x) => n + edges.get(x)!.filter((e) => e.to === m).length, 0);
        const key: [number, number, number] = [unpacked, used, -m.length];
        if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
          best = m;
          bestKey = key;
        }
      }
      starts.push(best);
    });
    return starts;
  }


  /** Cost of one output item with this recipe. */
  recipeCost(r: Recipe, unitCost: (item: string) => number = (i) => this.cost.get(i) ?? this.rawCost(i)): number {
    let total = 0;
    for (const ing of r.inputs) {
      let best = Infinity;
      for (const it of this.candidates(ing.options)) best = Math.min(best, unitCost(it));
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
    for (const it of this.candidates(options)) {
      const c = this.cost.get(it) ?? this.rawCost(it);
      if (c < bestCost) {
        best = it;
        bestCost = c;
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
