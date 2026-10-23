import { buildFamilies, roleFromId, TAG_ROLES } from './families';
import { parseJson, readJar, readModInfo, text, type JarFiles } from './jar';
import { GeometryRegistry, ModelResolver, rl, TextureStore } from './models';
import { normalizeRecipe, type RecipeContext } from './recipes';
import { parseBlockstate } from './states';
import { TagCollector } from './tags';
import { CATALOG_FORMAT, type BlockRole, type Catalog, type CatalogBlock, type CatalogItem, type CatalogSource, type Recipe } from './types';

/**
 * Builds the catalog from jars, one jar at a time so that the big ones never need to be held
 * in memory together: textures are summarised right away, only the small JSON files are kept.
 * Pure TypeScript; runs in a worker in the app and in Node for tests.
 */

export interface BuildProgress {
  phase: 'jar' | 'models' | 'recipes' | 'done';
  done: number;
  total: number;
  label?: string;
}

/** Vanilla items whose block has another id (see also blocks/items.ts). */
const VANILLA_ITEM_OF: Record<string, string> = {
  wall_torch: 'torch',
  soul_wall_torch: 'soul_torch',
  redstone_wall_torch: 'redstone_torch',
  redstone_wire: 'redstone',
  tripwire: 'string',
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  cocoa: 'cocoa_beans',
  sweet_berry_bush: 'sweet_berries',
  cave_vines: 'glow_berries',
  cave_vines_plant: 'glow_berries',
  kelp_plant: 'kelp',
  water: 'water_bucket',
  lava: 'lava_bucket',
};

export class CatalogBuilder {
  /** JSON files by path; later jars override earlier ones like resource packs do. */
  private files = new Map<string, Uint8Array>();
  private textures = new TextureStore();
  private tags = new TagCollector();
  private recipeFiles: { id: string; bytes: Uint8Array; source: number }[] = [];
  private sources: CatalogSource[] = [];
  private blockSource = new Map<string, number>();
  private extraLang: { lang: string; bytes: Uint8Array }[] = [];
  private mods = new Set<string>(['minecraft']);
  private minecraft: string | null = null;
  private warnings: string[] = [];

  /** Reads one jar (vanilla first, then the mods). */
  addJar(fileName: string, bytes: Uint8Array): CatalogSource[] {
    const added: CatalogSource[] = [];
    let parts: JarFiles[];
    try {
      parts = readJar(fileName, bytes);
    } catch (e) {
      const source: CatalogSource = { file: fileName, mods: [], blocks: 0, textures: 0, recipes: 0, warnings: [e instanceof Error ? e.message : String(e)] };
      this.sources.push(source);
      return [source];
    }
    for (const jar of parts) {
      const index = this.sources.length;
      const source: CatalogSource = { file: jar.name, mods: [], blocks: 0, textures: 0, recipes: 0, warnings: [] };
      for (const m of readModInfo(jar)) {
        source.mods.push({ id: m.modId, name: m.displayName, version: m.version });
        this.mods.add(m.modId);
      }
      const version = jar.files.get('version.json');
      if (version) {
        try {
          const v = parseJson(version) as { id?: string; name?: string };
          this.minecraft = v.id ?? v.name ?? this.minecraft;
          if (!source.mods.length) source.mods.push({ id: 'minecraft', name: 'Minecraft', version: this.minecraft ?? '' });
        } catch {
          // not the vanilla jar after all
        }
      }
      for (const [path, data] of jar.files) {
        if (path.endsWith('.png')) {
          if (this.textures.addPng(path, data)) source.textures++;
          continue;
        }
        const ns = /^(?:assets|data)\/([^/]+)\//.exec(path)?.[1];
        if (ns) this.mods.add(ns);
        if (/^data\/[^/]+\/tags\//.test(path)) {
          try {
            this.tags.add(path, parseJson(data));
          } catch {
            source.warnings.push(`Tag nicht lesbar: ${path}`);
          }
          continue;
        }
        const rm = /^data\/([^/]+)\/(?:recipe|recipes)\/(.+)\.json$/.exec(path);
        if (rm) {
          this.recipeFiles.push({ id: `${rm[1]}:${rm[2]}`, bytes: data, source: index });
          continue;
        }
        const bm = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/.exec(path);
        if (bm) {
          const id = `${bm[1]}:${bm[2]}`;
          if (!this.blockSource.has(id)) source.blocks++;
          this.blockSource.set(id, index);
        }
        this.files.set(path, data);
      }
      if (!source.mods.length) {
        const namespaces = new Set([...jar.files.keys()].map((p) => /^(?:assets|data)\/([^/]+)\//.exec(p)?.[1]).filter(Boolean) as string[]);
        // Mods also write into the "minecraft" namespace (tags); that does not make them Minecraft.
        for (const ns of namespaces) if (ns !== 'minecraft' || namespaces.size === 1) source.mods.push({ id: ns, name: ns, version: '' });
      }
      this.sources.push(source);
      added.push(source);
    }
    return added;
  }

  /** Language files that are not inside a jar (vanilla de_de from the launcher's assets). */
  addLanguage(lang: 'de_de' | 'en_us', bytes: Uint8Array): void {
    this.extraLang.push({ lang, bytes });
  }

  build(onProgress?: (p: BuildProgress) => void): Catalog {
    const geometries = new GeometryRegistry();
    const resolver = new ModelResolver(this.files, this.textures, geometries);

    // ---- language
    const de = new Map<string, string>();
    const en = new Map<string, string>();
    for (const [path, data] of this.files) {
      const m = /^assets\/[^/]+\/lang\/(de_de|en_us)\.json$/.exec(path);
      if (!m) continue;
      mergeLang(m[1] === 'de_de' ? de : en, data);
    }
    for (const l of this.extraLang) mergeLang(l.lang === 'de_de' ? de : en, l.bytes);
    const name = (kind: 'block' | 'item', id: string): { de?: string; en?: string } => {
      const key = `${kind}.${id.replace(':', '.').replace(/\//g, '.')}`;
      return { de: de.get(key), en: en.get(key) };
    };

    // ---- items
    const itemIds = new Set<string>();
    for (const path of this.files.keys()) {
      const m = /^assets\/([^/]+)\/models\/item\/(.+)\.json$/.exec(path);
      if (m) itemIds.add(`${m[1]}:${m[2]}`);
    }

    // ---- blocks
    const blockTags = this.tags.resolveAll('block');
    const itemTags = this.tags.resolveAll('item');
    const roleByTag = new Map<string, BlockRole>();
    for (const [tag, role] of Object.entries(TAG_ROLES)) for (const b of blockTags[tag] ?? []) if (!roleByTag.has(b)) roleByTag.set(b, role);

    const blocks: Record<string, CatalogBlock> = {};
    const blockPaths = [...this.files.keys()].filter((p) => /^assets\/[^/]+\/blockstates\/.+\.json$/.test(p));
    let done = 0;
    for (const path of blockPaths) {
      const m = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/.exec(path)!;
      const id = `${m[1]}:${m[2]}`;
      if (++done % 200 === 0) onProgress?.({ phase: 'models', done, total: blockPaths.length });
      let states = null;
      try {
        states = parseBlockstate(parseJson(this.files.get(path)!), (model) => resolver.resolve(rl(model, m[1])));
      } catch {
        states = null;
      }
      if (!states) {
        this.sourceWarning(id, `Blockstate nicht lesbar: ${id}`);
        continue;
      }
      // Wall variants (banners, signs) and entity blocks (item frames) are named after their item.
      let n = name('block', id);
      if (!n.de && !n.en) n = name('block', id.replace(/_wall_/, '_'));
      if (!n.de && !n.en) n = name('item', id);
      blocks[id] = {
        mod: m[1],
        ...(n.de ? { de: n.de } : {}),
        ...(n.en ? { en: n.en } : {}),
        item: this.itemFor(id, itemIds),
        role: roleByTag.get(id) ?? roleFromId(id),
        states,
      };
    }

    // ---- items with names (blocks' items and everything recipes mention)
    const items: Record<string, CatalogItem> = {};
    const addItem = (id: string) => {
      if (items[id]) return;
      const n = name('item', id);
      const nb = n.de || n.en ? n : name('block', id);
      items[id] = { ...(nb.de ? { de: nb.de } : {}), ...(nb.en ? { en: nb.en } : {}) };
    };
    for (const id of itemIds) addItem(id);

    // ---- recipes
    // A later file with the same id replaces the earlier one completely, like in data packs:
    // NeoForge and mods rewrite vanilla recipes, or switch them off with a condition.
    const lastFile = new Map<string, { bytes: Uint8Array; source: number }>();
    for (const f of this.recipeFiles) lastFile.set(f.id, f);
    const ctx: RecipeContext = { mods: this.mods, itemTags, items: itemIds };
    const recipes: Recipe[] = [];
    let r = 0;
    for (const [id, f] of lastFile) {
      if (++r % 500 === 0) onProgress?.({ phase: 'recipes', done: r, total: lastFile.size });
      try {
        const recipe = normalizeRecipe(id, parseJson(f.bytes), ctx);
        if (!recipe) continue;
        recipes.push(recipe);
        this.sources[f.source].recipes++;
        addItem(recipe.output.item);
        for (const ing of recipe.inputs) for (const o of ing.options) if (!o.startsWith('#')) addItem(o);
      } catch {
        // A broken recipe file is skipped; the game would skip it too.
      }
    }

    const families = buildFamilies(blocks, recipes);
    if (resolver.missing.size) {
      this.warnings.push(`${resolver.missing.size} Modelle nicht gefunden (z. B. ${[...resolver.missing].slice(0, 3).join(', ')}); Blöcke damit erscheinen vereinfacht.`);
    }
    if (this.textures.failed.length) this.warnings.push(`${this.textures.failed.length} Texturen ließen sich nicht lesen.`);
    onProgress?.({ phase: 'done', done: 1, total: 1 });

    return {
      format: CATALOG_FORMAT,
      createdAt: new Date().toISOString(),
      minecraft: this.minecraft,
      sources: this.sources,
      blocks,
      models: resolver.models,
      geometries: geometries.list,
      items,
      itemTags,
      recipes,
      families,
      warnings: this.warnings,
    };
  }

  private itemFor(id: string, itemIds: ReadonlySet<string>): string | null {
    if (itemIds.has(id)) return id;
    const [ns, path] = id.split(':');
    if (ns === 'minecraft' && VANILLA_ITEM_OF[path]) return `minecraft:${VANILLA_ITEM_OF[path]}`;
    // Wall variants are placed with the standing item: "x_wall_torch" -> "x_torch".
    const wall = path.replace(/_wall_(torch|sign|hanging_sign|banner|head|skull|fan)$/, '_$1');
    if (wall !== path && itemIds.has(`${ns}:${wall}`)) return `${ns}:${wall}`;
    // Otherwise what the block drops when broken.
    const loot = this.files.get(`data/${ns}/loot_table/blocks/${path}.json`) ?? this.files.get(`data/${ns}/loot_tables/blocks/${path}.json`);
    if (loot) {
      const drop = firstLootItem(loot);
      if (drop && itemIds.has(drop)) return drop;
    }
    return null;
  }

  private sourceWarning(blockId: string, message: string): void {
    const s = this.blockSource.get(blockId);
    if (s !== undefined && this.sources[s].warnings.length < 20) this.sources[s].warnings.push(message);
  }
}

function mergeLang(into: Map<string, string>, data: Uint8Array): void {
  try {
    const j = JSON.parse(text(data)) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && (k.startsWith('block.') || k.startsWith('item.'))) into.set(k, v);
  } catch {
    // ignore broken language files
  }
}

function firstLootItem(data: Uint8Array): string | null {
  try {
    const j = parseJson(data) as { pools?: { entries?: unknown[] }[] };
    const visit = (e: unknown): string | null => {
      if (!e || typeof e !== 'object') return null;
      const o = e as { type?: string; name?: string; children?: unknown[] };
      if ((o.type === 'minecraft:item' || o.type === 'item') && typeof o.name === 'string') return rl(o.name);
      for (const c of o.children ?? []) {
        const r = visit(c);
        if (r) return r;
      }
      return null;
    };
    for (const pool of j.pools ?? []) for (const e of pool.entries ?? []) {
      const r = visit(e);
      if (r) return r;
    }
  } catch {
    // ignore
  }
  return null;
}
