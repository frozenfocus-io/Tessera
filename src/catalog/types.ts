/**
 * The block catalog: what Tessera knows about every block of the game and the modpack.
 * Built once from the Minecraft jar and the mods folder ("Modpack einlesen"), stored in the
 * browser and shared by all projects. Plain JSON-compatible data so it can be stored in
 * IndexedDB and sent between workers.
 */

export const CATALOG_FORMAT = 1;

/** Face order everywhere: 0 east, 1 west, 2 up, 3 down, 4 south, 5 north (see blocks/faces.ts). */
export type FaceColors = [number, number, number, number, number, number];

/** A model applied by a blockstate: model index and rotation in 90° steps. */
export type Applied = [model: number, x: number, y: number];

/**
 * Multipart condition as in blockstate files: property -> "a|b" alternatives, or OR/AND lists.
 * Stored as found in the file.
 */
export type Condition = { [prop: string]: string } | { OR: Condition[] } | { AND: Condition[] };

export type CatalogStates =
  /** "variants" blockstates: variant key ("facing=east,half=top", "" for all) -> model. */
  | { variants: [key: string, applied: Applied][] }
  /** "multipart" blockstates: every part whose condition holds is drawn. */
  | { multipart: [when: Condition | null, applied: Applied][] };

export interface CatalogModel {
  /** Index into Catalog.geometries, -1 when the model has no usable boxes. */
  g: number;
  /** Average colour per face direction (0xRRGGBB), -1 where the model shows no face. */
  f: FaceColors;
  /** 1 when the textures are see-through (glass, ice, bars), else 0. */
  tr: 0 | 1;
  /** What the model is when it has no boxes. */
  kind: 'boxes' | 'cross' | 'entity' | 'empty' | 'custom';
  /** Particle texture colour, used when there are no faces (chests, signs, fluids). */
  p: number;
  /** Model id, for messages and debugging. */
  id: string;
}

export type BlockRole =
  | 'block'
  | 'stairs'
  | 'slab'
  | 'wall'
  | 'fence'
  | 'fence_gate'
  | 'door'
  | 'trapdoor'
  | 'button'
  | 'pressure_plate'
  | 'pane'
  | 'carpet'
  | 'log'
  | 'other';

export interface CatalogBlock {
  /** Mod (namespace) the block belongs to. */
  mod: string;
  /** Names from the language files. */
  de?: string;
  en?: string;
  /** Item that places the block; null when the block has no item of its own. */
  item: string | null;
  /** Role within its family (stairs, slab, …), from tags, models and names. */
  role: BlockRole;
  /** Family id (the base block's id), when the block belongs to one. */
  family?: string;
  states: CatalogStates;
}

export interface CatalogItem {
  de?: string;
  en?: string;
}

/** One ingredient slot: an item or a tag (prefixed with #), alternatives allowed. */
export interface Ingredient {
  options: string[];
  count: number;
}

export interface Recipe {
  id: string;
  type: string;
  /** Where the recipe is made, in Tessera's words (Werkbank, Steinschneider, …). */
  station: string;
  inputs: Ingredient[];
  output: { item: string; count: number };
}

export interface Family {
  /** Base block id ("minecraft:stone_bricks"). */
  base: string;
  /** Role -> block id. */
  members: Partial<Record<BlockRole, string>>;
}

export interface CatalogSource {
  /** Jar file name. */
  file: string;
  mods: { id: string; name: string; version: string }[];
  blocks: number;
  textures: number;
  recipes: number;
  warnings: string[];
}

export interface Catalog {
  format: typeof CATALOG_FORMAT;
  createdAt: string;
  /** Minecraft version of the vanilla jar, if one was read. */
  minecraft: string | null;
  sources: CatalogSource[];
  blocks: Record<string, CatalogBlock>;
  models: CatalogModel[];
  /** Box lists, 6 integers per box (x0, y0, z0, x1, y1, z1 in 1/16 block units). Index 0 is the full cube. */
  geometries: number[][];
  items: Record<string, CatalogItem>;
  /** Item tags, resolved to item ids (for recipe ingredients). */
  itemTags: Record<string, string[]>;
  recipes: Recipe[];
  families: Record<string, Family>;
  /** Overall notes for the import report. */
  warnings: string[];
}
