import { namespaceOf, shortName, type BlockState } from '../core/blockstate';

/**
 * What a placed block costs as items in Survival. Used for the material list.
 * Returns an empty list for blocks that are not placed from an item (air, fire, the upper half
 * of a door, the foot of a bed, flowing water, …).
 */
export interface ItemCost {
  item: string;
  count: number;
}

/** Blocks that cannot be obtained in Survival. They are counted but flagged. */
const CREATIVE_ONLY = new Set([
  'bedrock', 'barrier', 'light', 'command_block', 'chain_command_block', 'repeating_command_block',
  'structure_block', 'jigsaw', 'end_portal_frame', 'reinforced_deepslate', 'spawner', 'trial_spawner',
  'vault', 'budding_amethyst', 'petrified_oak_slab', 'farmland', 'dirt_path', 'frogspawn',
  'infested_stone', 'infested_cobblestone', 'infested_stone_bricks', 'infested_mossy_stone_bricks',
  'infested_cracked_stone_bricks', 'infested_chiseled_stone_bricks', 'infested_deepslate',
]);

const NOT_ITEMS = new Set([
  'air', 'cave_air', 'void_air', 'structure_void', 'fire', 'soul_fire', 'nether_portal', 'end_portal',
  'end_gateway', 'moving_piston', 'piston_head', 'frosted_ice', 'bubble_column',
]);

const TALL_PLANTS = new Set([
  'tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'tall_seagrass',
  'small_dripleaf', 'pitcher_crop',
]);

/** Block id -> item id where they differ (minecraft namespace, short ids). */
const ITEM_OF: Record<string, string> = {
  wall_torch: 'torch',
  soul_wall_torch: 'soul_torch',
  redstone_wall_torch: 'redstone_torch',
  redstone_wire: 'redstone',
  tripwire: 'string',
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  melon_stem: 'melon_seeds',
  attached_melon_stem: 'melon_seeds',
  pumpkin_stem: 'pumpkin_seeds',
  attached_pumpkin_stem: 'pumpkin_seeds',
  cocoa: 'cocoa_beans',
  sweet_berry_bush: 'sweet_berries',
  torchflower_crop: 'torchflower_seeds',
  pitcher_crop: 'pitcher_pod',
  cave_vines: 'glow_berries',
  cave_vines_plant: 'glow_berries',
  kelp_plant: 'kelp',
  twisting_vines_plant: 'twisting_vines',
  weeping_vines_plant: 'weeping_vines',
  bamboo_sapling: 'bamboo',
  big_dripleaf_stem: 'big_dripleaf',
  tall_seagrass: 'seagrass',
  water_cauldron: 'cauldron',
  lava_cauldron: 'cauldron',
  powder_snow_cauldron: 'cauldron',
  water: 'water_bucket',
  lava: 'lava_bucket',
  powder_snow: 'powder_snow_bucket',
  farmland: 'dirt',
  dirt_path: 'dirt',
};

/** Items that stack to 16 or 1 (everything else stacks to 64). */
export function stackSize(item: string): number {
  const id = shortName(item);
  if (id.endsWith('_bed') || id.endsWith('shulker_box') || id.endsWith('_bucket') || id === 'cake') return 1;
  if (id.endsWith('_sign') || id.endsWith('_hanging_sign') || id.endsWith('_banner') || id === 'snowball') return 16;
  return 64;
}

export function isCreativeOnly(item: string): boolean {
  return namespaceOf(item) === 'minecraft' && CREATIVE_ONLY.has(shortName(item));
}

export function itemCosts(state: BlockState): ItemCost[] {
  const ns = namespaceOf(state.name);
  const id = shortName(state.name).replace(/^[a-z0-9_.-]+:/, '');
  const p = state.props;
  const item = (s: string, count = 1): ItemCost[] => [{ item: `${ns}:${s}`, count }];

  if (ns === 'minecraft' && NOT_ITEMS.has(id)) return [];

  // Two-block structures: count one half only.
  if (p.half === 'upper' && (id.endsWith('_door') || TALL_PLANTS.has(id))) return [];
  if (id.endsWith('_bed') && p.part === 'foot') return [];

  if (id.endsWith('_slab') && p.type === 'double') return item(id, 2);
  if ((id === 'water' || id === 'lava') && p.level !== undefined && p.level !== '0') return [];

  if (ns === 'minecraft') {
    if (id.startsWith('potted_')) {
      const plant = id.slice(7);
      const plantItem = plant === 'azalea_bush' ? 'azalea' : plant === 'flowering_azalea_bush' ? 'flowering_azalea' : plant;
      return [
        { item: 'minecraft:flower_pot', count: 1 },
        { item: `minecraft:${plantItem}`, count: 1 },
      ];
    }
    if (id.endsWith('_wall_sign')) return item(id.replace('_wall_sign', '_sign'));
    if (id.endsWith('_wall_hanging_sign')) return item(id.replace('_wall_hanging_sign', '_hanging_sign'));
    if (id.endsWith('_wall_banner')) return item(id.replace('_wall_banner', '_banner'));
    if (id.endsWith('_wall_head')) return item(id.replace('_wall_head', '_head'));
    if (id.endsWith('_wall_skull')) return item(id.replace('_wall_skull', '_skull'));
    if (id.endsWith('_wall_fan')) return item(id.replace('_wall_fan', '_fan'));
    if (id.endsWith('candle_cake')) {
      const candle = id === 'candle_cake' ? 'candle' : id.replace('_candle_cake', '_candle');
      return [
        { item: 'minecraft:cake', count: 1 },
        { item: `minecraft:${candle}`, count: 1 },
      ];
    }
    if (id.endsWith('candle')) return item(id, clampInt(p.candles, 1, 4));
    if (id === 'sea_pickle') return item(id, clampInt(p.pickles, 1, 4));
    if (id === 'turtle_egg') return item(id, clampInt(p.eggs, 1, 4));
    if (id === 'snow') return item(id, clampInt(p.layers, 1, 8));
    if (id === 'pink_petals') return item(id, clampInt(p.flower_amount, 1, 4));
    if (id.startsWith('infested_')) return item(id.slice(9) === 'deepslate' ? 'deepslate' : id.slice(9));
    const mapped = ITEM_OF[id];
    if (mapped) return item(mapped);
  }
  return item(id);
}

function clampInt(v: string | undefined, min: number, max: number): number {
  const n = parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
