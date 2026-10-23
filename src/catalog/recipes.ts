import type { Ingredient, Recipe } from './types';

/**
 * Recipes from data/<ns>/recipe/*.json, reduced to "inputs -> output at a station". Vanilla
 * types are read exactly; mod machines (Create and others) through the common
 * "ingredients"/"results" shape. Special recipes without a fixed result are skipped.
 */

const STATIONS: Record<string, string> = {
  'minecraft:crafting_shaped': 'Werkbank',
  'minecraft:crafting_shapeless': 'Werkbank',
  'minecraft:stonecutting': 'Steinschneider',
  'minecraft:smelting': 'Ofen',
  'minecraft:blasting': 'Schmelzofen',
  'minecraft:smoking': 'Räucherofen',
  'minecraft:campfire_cooking': 'Lagerfeuer',
  'minecraft:smithing_transform': 'Schmiedetisch',
  'create:cutting': 'Mechanische Säge (Create)',
  'create:pressing': 'Mechanische Presse (Create)',
  'create:mixing': 'Mixer (Create)',
  'create:compacting': 'Kompaktieren (Create)',
  'create:milling': 'Mühlstein (Create)',
  'create:crushing': 'Mahlwerk (Create)',
  'create:mechanical_crafting': 'Mechanische Werkbank (Create)',
  'create:sequenced_assembly': 'Fertigungsstraße (Create)',
  'create:splashing': 'Waschen (Create)',
  'create:haunting': 'Spuken (Create)',
  'create:deploying': 'Einsetzer (Create)',
  'create:item_application': 'Auftragen (Create)',
  'create:filling': 'Befüller (Create)',
  'create:sandpaper_polishing': 'Schleifpapier (Create)',
};

export function stationOf(type: string): string {
  if (STATIONS[type]) return STATIONS[type];
  if (type.startsWith('chipped:')) return 'Chipped-Werkbank';
  const [ns, path = ''] = type.split(':');
  return `${path.replace(/_/g, ' ')} (${ns})`;
}

type Json = Record<string, unknown>;

export interface RecipeContext {
  mods: ReadonlySet<string>;
  itemTags: Readonly<Record<string, string[]>>;
  items: ReadonlySet<string>;
}

/** Evaluates NeoForge/Forge load conditions. Unknown conditions count as met. */
function conditionsMet(list: unknown, ctx: RecipeContext): boolean {
  if (!Array.isArray(list)) return true;
  return list.every((c) => condition(c, ctx));
}

function condition(c: unknown, ctx: RecipeContext): boolean {
  if (!c || typeof c !== 'object') return true;
  const j = c as Json;
  const type = String(j.type ?? '').replace(/^forge:/, 'neoforge:');
  switch (type) {
    case 'neoforge:mod_loaded':
      return ctx.mods.has(String(j.modid ?? ''));
    case 'neoforge:not':
      return !condition(j.value, ctx);
    case 'neoforge:and':
      return Array.isArray(j.values) ? j.values.every((v) => condition(v, ctx)) : true;
    case 'neoforge:or':
      return Array.isArray(j.values) ? j.values.some((v) => condition(v, ctx)) : true;
    case 'neoforge:tag_empty':
      return (ctx.itemTags[String(j.tag ?? '')] ?? []).length === 0;
    case 'neoforge:item_exists':
      return ctx.items.has(String(j.item ?? ''));
    case 'neoforge:false':
      return false;
    default:
      return true;
  }
}

/** One ingredient as a list of item ids or "#tags". Fluids and unknown forms give null. */
export function ingredientOptions(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return [raw.startsWith('#') ? raw : withNs(raw)];
  if (Array.isArray(raw)) {
    const all = raw.flatMap((r) => ingredientOptions(r) ?? []);
    return all.length ? all : null;
  }
  if (typeof raw !== 'object') return null;
  const j = raw as Json;
  if (typeof j.item === 'string') return [withNs(j.item)];
  if (typeof j.tag === 'string') return [`#${withNs(j.tag)}`];
  if (j.type === 'neoforge:compound' || j.type === 'forge:compound') return ingredientOptions(j.children);
  if (Array.isArray(j.items)) return ingredientOptions(j.items);
  if (typeof j.ingredient === 'object') return ingredientOptions(j.ingredient);
  return null;
}

function withNs(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}

function countOf(raw: unknown): number {
  if (raw && typeof raw === 'object') {
    const j = raw as Json;
    const n = Number(j.count ?? j.amount ?? 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  return 1;
}

/** The (first certain) output item of a recipe. */
function outputOf(j: Json): { item: string; count: number } | null {
  const pick = (r: unknown): { item: string; count: number } | null => {
    if (typeof r === 'string') return { item: withNs(r), count: 1 };
    if (!r || typeof r !== 'object') return null;
    const o = r as Json;
    const id = typeof o.id === 'string' ? o.id : typeof o.item === 'string' ? o.item : null;
    if (!id) return null;
    const chance = Number(o.chance ?? 1);
    if (chance < 1) return null;
    return { item: withNs(id), count: countOf(o) };
  };
  for (const key of ['result', 'output']) {
    const r = j[key];
    const out = Array.isArray(r) ? r.map(pick).find((x) => x) : pick(r);
    if (out) return out;
  }
  if (Array.isArray(j.results)) {
    for (const r of j.results) {
      const out = pick(r);
      if (out) return out;
    }
  }
  return null;
}

/** Groups identical ingredient slots ("6 × stone bricks"). */
function group(slots: string[][]): Ingredient[] {
  const map = new Map<string, Ingredient>();
  for (const options of slots) {
    const key = options.join('|');
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { options, count: 1 });
  }
  return [...map.values()];
}

export function normalizeRecipe(id: string, json: unknown, ctx: RecipeContext): Recipe | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Json;
  const type = typeof j.type === 'string' ? withNs(j.type) : '';
  if (!type || type.includes('crafting_special') || type === 'minecraft:smithing_trim' || type === 'minecraft:crafting_decorated_pot') return null;
  if (!conditionsMet(j['neoforge:conditions'] ?? j.conditions, ctx)) return null;
  const output = outputOf(j);
  if (!output) return null;

  let inputs: Ingredient[] | null = null;
  if (j.pattern && j.key && typeof j.key === 'object') {
    // Shaped (vanilla and Create's mechanical crafting): count the symbols in the pattern.
    const key = j.key as Record<string, unknown>;
    const slots: string[][] = [];
    for (const row of (j.pattern as unknown[]) ?? []) {
      for (const ch of String(row)) {
        if (ch === ' ') continue;
        const opts = ingredientOptions(key[ch]);
        if (opts) slots.push(opts);
      }
    }
    inputs = group(slots);
  } else if (Array.isArray(j.ingredients)) {
    const slots: string[][] = [];
    for (const ing of j.ingredients) {
      const opts = ingredientOptions(ing);
      if (!opts) continue;
      const n = countOf(ing);
      for (let i = 0; i < n; i++) slots.push(opts);
    }
    inputs = group(slots);
  } else if (j.ingredient !== undefined) {
    const opts = ingredientOptions(j.ingredient);
    if (opts) inputs = [{ options: opts, count: countOf(j.ingredient) }];
  } else if (type === 'minecraft:smithing_transform') {
    inputs = (['template', 'base', 'addition'] as const)
      .map((k) => ingredientOptions(j[k]))
      .filter((o): o is string[] => !!o)
      .map((options) => ({ options, count: 1 }));
  }
  if (!inputs || inputs.length === 0) return null;
  return { id, type, station: stationOf(type), inputs, output };
}
