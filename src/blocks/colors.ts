import { namespaceOf, shortName, type BlockState } from '../core/blockstate';
import { DOWN, EAST, NORTH, SOUTH, UP, WEST, faceIndex } from './faces';

/**
 * Preview colours for vanilla blocks (Minecraft 1.21.1), approximating the average texture colour.
 * Stage 2 replaces these with colours read from the actual game and mod jars; until then this
 * table is the fallback. Unknown blocks get a stable colour from a hash of their id and are marked.
 */

type Rgb = number;

type ColorSpec =
  | Rgb
  | { side: Rgb; top?: Rgb; bottom?: Rgb }
  | { pillar: true; end: Rgb; side: Rgb }
  | { front: Rgb; side: Rgb; top?: Rgb; bottom?: Rgb; back?: Rgb };

export type ColorSource = 'exact' | 'family' | 'guess' | 'unknown';

export interface ResolvedColors {
  /** RGB per face (index order of faces.ts). */
  faces: [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];
  source: ColorSource;
  /** Shown with a warning pattern: modded/unknown blocks whose colour is not reliable. */
  marked: boolean;
  /** Representative colour for swatches. */
  swatch: Rgb;
}

export const DYES = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;

// Longest prefixes first so "light_blue" wins over "blue".
const DYES_BY_LENGTH = [...DYES].sort((a, b) => b.length - a.length);

const WOOL = [0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c527, 0x70b919, 0xed8dac, 0x3e4447, 0x8e8e86, 0x158991, 0x792aac, 0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519];
const CONCRETE = [0xcfd5d6, 0xe06100, 0xa9309f, 0x2389c6, 0xf0af15, 0x5ea818, 0xd5658e, 0x36393d, 0x7d7d73, 0x157788, 0x64209c, 0x2c2e8f, 0x603b1f, 0x495b24, 0x8e2020, 0x080a0f];
const CONCRETE_POWDER = [0xe1e3e3, 0xe3831f, 0xc053b8, 0x4ab4d5, 0xe8c736, 0x7dbd29, 0xe499b5, 0x4c5154, 0x9a9a94, 0x24939d, 0x8337b1, 0x4649a6, 0x7d5435, 0x61772c, 0xa83632, 0x191a1f];
const TERRACOTTA = [0xd1b2a1, 0xa15325, 0x95576c, 0x706c8a, 0xba8523, 0x677535, 0xa04d4e, 0x392a23, 0x876b62, 0x575b5b, 0x764656, 0x4a3b5b, 0x4d3323, 0x4c532a, 0x8f3d2e, 0x251610];
const GLAZED = [0xbcd4ca, 0x9a935b, 0xd064bf, 0x5ea4d0, 0xeac058, 0xa2c537, 0xeb9ab5, 0x535a5d, 0x90a6a7, 0x34767d, 0x6d3098, 0x2f408b, 0x776a55, 0x758e43, 0xb53b35, 0x431e20];
const STAINED_GLASS = [0xffffff, 0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919];
const SHULKER = [0xd8dcdd, 0xea6a08, 0xad38a4, 0x31a5d5, 0xf8bc1d, 0x63ac17, 0xe6799d, 0x373a3e, 0x7c7c73, 0x147987, 0x67209c, 0x2c2e8c, 0x6a4224, 0x4f6520, 0x8c1f1e, 0x19191d];

interface WoodColors {
  planks: Rgb;
  log: Rgb;
  logTop: Rgb;
  stripped: Rgb;
  strippedTop: Rgb;
  leaves: Rgb;
}

const WOODS: Record<string, WoodColors> = {
  oak: { planks: 0xa2834f, log: 0x6d5532, logTop: 0x9a7d4d, stripped: 0xb0904f, strippedTop: 0xa0814c, leaves: 0x5b8f2a },
  spruce: { planks: 0x735531, log: 0x3a2711, logTop: 0x6d5131, stripped: 0x745a34, strippedTop: 0x6c5432, leaves: 0x3f6340 },
  birch: { planks: 0xc0af79, log: 0xd8d7d2, logTop: 0xc1b07a, stripped: 0xc4b07b, strippedTop: 0xbea870, leaves: 0x6e9a3f },
  jungle: { planks: 0xa07351, log: 0x574319, logTop: 0x9a6e4c, stripped: 0xab8454, strippedTop: 0xa6784f, leaves: 0x4f8e1e },
  acacia: { planks: 0xa85a32, log: 0x686059, logTop: 0x965a37, stripped: 0xaf5d3c, strippedTop: 0xa65a39, leaves: 0x5e8a27 },
  dark_oak: { planks: 0x42311b, log: 0x3c2e1a, logTop: 0x4b3820, stripped: 0x604b30, strippedTop: 0x4d3a22, leaves: 0x45781c },
  mangrove: { planks: 0x763631, log: 0x534329, logTop: 0x6f3b2e, stripped: 0x773632, strippedTop: 0x6d302c, leaves: 0x4c8231 },
  cherry: { planks: 0xe3b3ad, log: 0x3a2129, logTop: 0xb87b7c, stripped: 0xd7929b, strippedTop: 0xd3909b, leaves: 0xe9a8c7 },
  bamboo: { planks: 0xc2af51, log: 0x7f9030, logTop: 0x9eaa4e, stripped: 0xc5ae4f, strippedTop: 0xb9a74b, leaves: 0x5d912a },
  crimson: { planks: 0x653147, log: 0x5c1a1e, logTop: 0x6f2d39, stripped: 0x8a3a5a, strippedTop: 0x7a3550, leaves: 0x730303 },
  warped: { planks: 0x2b6863, log: 0x3a3a4d, logTop: 0x356b66, stripped: 0x3a9894, strippedTop: 0x348882, leaves: 0x167879 },
};
const WOOD_NAMES_BY_LENGTH = Object.keys(WOODS).sort((a, b) => b.length - a.length);

const COPPER_STAGES: Record<string, { block: Rgb; cut: Rgb }> = {
  '': { block: 0xc06c50, cut: 0xbf6b51 },
  exposed: { block: 0xa17e68, cut: 0x9a7965 },
  weathered: { block: 0x6c9a6e, cut: 0x6d9370 },
  oxidized: { block: 0x52a385, cut: 0x4f9a7e },
};

const stone = 0x7d7d7d;
const dirt = 0x866043;
const netherrack = 0x612626;

/** Explicit colours by short block id (minecraft namespace). */
const TABLE: Record<string, ColorSpec> = {
  // Stone family
  stone,
  cobblestone: 0x7a7a7a,
  mossy_cobblestone: 0x6e775f,
  stone_bricks: 0x7a7979,
  mossy_stone_bricks: 0x737a62,
  cracked_stone_bricks: 0x767574,
  chiseled_stone_bricks: 0x777677,
  smooth_stone: 0x9e9e9e,
  granite: 0x956756,
  polished_granite: 0x9a6a59,
  diorite: 0xbdbdbd,
  polished_diorite: 0xc1c1c3,
  andesite: 0x888889,
  polished_andesite: 0x848685,
  deepslate: { pillar: true, end: 0x56565a, side: 0x505053 },
  cobbled_deepslate: 0x4d4d51,
  polished_deepslate: 0x484849,
  deepslate_bricks: 0x464646,
  cracked_deepslate_bricks: 0x414141,
  deepslate_tiles: 0x363637,
  cracked_deepslate_tiles: 0x343434,
  chiseled_deepslate: 0x36363a,
  reinforced_deepslate: 0x50534f,
  tuff: 0x6c6d67,
  polished_tuff: 0x626864,
  tuff_bricks: 0x626860,
  chiseled_tuff: 0x5b5f5a,
  chiseled_tuff_bricks: 0x626562,
  calcite: 0xdfe0dc,
  dripstone_block: 0x866b5c,
  pointed_dripstone: 0x866b5c,
  blackstone: 0x2a2328,
  gilded_blackstone: 0x382b26,
  polished_blackstone: 0x353038,
  polished_blackstone_bricks: 0x302a31,
  cracked_polished_blackstone_bricks: 0x2c2529,
  chiseled_polished_blackstone: 0x353036,
  basalt: { pillar: true, end: 0x515156, side: 0x4d4d52 },
  polished_basalt: { pillar: true, end: 0x636363, side: 0x5a5a5e },
  smooth_basalt: 0x48484e,
  bedrock: 0x555555,
  obsidian: 0x0f0b19,
  crying_obsidian: 0x200a3c,
  sandstone: { side: 0xd8cb9b, top: 0xdbd0a3, bottom: 0xd9ca9a },
  cut_sandstone: 0xd9ce9f,
  chiseled_sandstone: { side: 0xd8ca9b, top: 0xdbd0a3 },
  smooth_sandstone: 0xe0d6aa,
  red_sandstone: { side: 0xba631d, top: 0xb5621f },
  cut_red_sandstone: 0xbd6620,
  chiseled_red_sandstone: { side: 0xb7601c, top: 0xb5621f },
  smooth_red_sandstone: 0xb5621f,
  bricks: 0x976253,
  mud_bricks: 0x89684f,
  packed_mud: 0x8e6b50,
  mud: 0x3c393d,
  prismarine: 0x639c97,
  prismarine_bricks: 0x63ab9e,
  dark_prismarine: 0x335b4c,
  sea_lantern: 0xacc7be,
  nether_bricks: 0x2c1519,
  cracked_nether_bricks: 0x281416,
  chiseled_nether_bricks: 0x2f171c,
  red_nether_bricks: 0x450709,
  quartz_block: 0xece6df,
  smooth_quartz: 0xece6df,
  quartz_bricks: 0xeae5de,
  chiseled_quartz_block: { side: 0xe7e2da, top: 0xe9e4dc },
  quartz_pillar: { pillar: true, end: 0xe8e3d9, side: 0xece7e0 },
  purpur_block: 0xa97da9,
  purpur_pillar: { pillar: true, end: 0xab82ab, side: 0xab81ab },
  end_stone: 0xdbdea0,
  end_stone_bricks: 0xdae0a2,
  terracotta: 0x985e43,

  // Ores and mineral blocks
  coal_ore: 0x737373,
  iron_ore: 0x88817b,
  copper_ore: 0x7c7d78,
  gold_ore: 0x8f8c7d,
  redstone_ore: 0x846b6b,
  emerald_ore: 0x6c8874,
  lapis_ore: 0x63708a,
  diamond_ore: 0x799392,
  deepslate_coal_ore: 0x4a4a4c,
  deepslate_iron_ore: 0x6a645f,
  deepslate_copper_ore: 0x5c5d59,
  deepslate_gold_ore: 0x73674e,
  deepslate_redstone_ore: 0x68494b,
  deepslate_emerald_ore: 0x4e6857,
  deepslate_lapis_ore: 0x4f5a73,
  deepslate_diamond_ore: 0x536a6a,
  nether_gold_ore: 0x73362a,
  nether_quartz_ore: 0x75413e,
  ancient_debris: { side: 0x5f4039, top: 0x5e4038 },
  coal_block: 0x101010,
  iron_block: 0xdcdcdc,
  gold_block: 0xf6d03d,
  diamond_block: 0x62ede4,
  emerald_block: 0x2acb57,
  lapis_block: 0x1f438c,
  redstone_block: 0xaf1805,
  netherite_block: 0x42393e,
  amethyst_block: 0x8562bf,
  budding_amethyst: 0x8460ba,
  amethyst_cluster: 0xa27ed6,
  large_amethyst_bud: 0xa27ed6,
  medium_amethyst_bud: 0xa27ed6,
  small_amethyst_bud: 0xa27ed6,
  raw_iron_block: 0xa6886b,
  raw_copper_block: 0x9a6a4f,
  raw_gold_block: 0xdda92e,

  // Earth
  grass_block: { side: dirt, top: 0x6fa83e, bottom: dirt },
  dirt,
  coarse_dirt: 0x77553b,
  rooted_dirt: 0x90674c,
  podzol: { side: dirt, top: 0x5b3f18, bottom: dirt },
  mycelium: { side: dirt, top: 0x6f6265, bottom: dirt },
  dirt_path: { side: dirt, top: 0x947a41, bottom: dirt },
  farmland: { side: dirt, top: 0x5a3a1e, bottom: dirt },
  sand: 0xdbcfa3,
  red_sand: 0xbe6621,
  suspicious_sand: 0xdacda0,
  gravel: 0x847f7f,
  suspicious_gravel: 0x807c7b,
  clay: 0xa0a6b3,
  moss_block: 0x596e2d,
  moss_carpet: 0x596e2d,
  muddy_mangrove_roots: { pillar: true, end: 0x463b2d, side: 0x463b2d },
  mangrove_roots: 0x4b3b26,
  snow_block: 0xf9fefe,
  snow: 0xf9fefe,
  powder_snow: 0xf8fdfd,
  ice: 0x91b7fd,
  packed_ice: 0x8db4fa,
  blue_ice: 0x74a8fd,
  frosted_ice: 0x8bb4fa,
  sculk: 0x0d1e24,
  sculk_vein: 0x0d2e33,
  sculk_catalyst: { side: 0x2c3d3c, top: 0x0f2026 },
  sculk_sensor: 0x16575c,
  calibrated_sculk_sensor: 0x2e4c59,
  sculk_shrieker: { side: 0x4f5e58, top: 0xc6cda6 },

  // Nether / End
  netherrack,
  nether_wart_block: 0x730303,
  warped_wart_block: 0x167879,
  crimson_nylium: { side: netherrack, top: 0x831f1f, bottom: netherrack },
  warped_nylium: { side: netherrack, top: 0x2b7265, bottom: netherrack },
  soul_sand: 0x513e32,
  soul_soil: 0x4b392e,
  glowstone: 0xc8a167,
  shroomlight: 0xf19347,
  magma_block: 0x8e3f1f,
  end_rod: 0xe6dcd2,
  chorus_plant: 0x5d395d,
  chorus_flower: 0x977497,
  dragon_egg: 0x0c0910,
  end_portal_frame: { side: 0xa2a56f, top: 0x5b7966, bottom: 0xdbdea0 },
  respawn_anchor: { side: 0x251a35, top: 0x2a1747 },
  lodestone: { side: 0x77787d, top: 0x8f9095 },
  crimson_fungus: 0x8e1c1e,
  warped_fungus: 0x1b7c6c,
  crimson_roots: 0x7e0f18,
  warped_roots: 0x138771,
  nether_sprouts: 0x149684,
  twisting_vines: 0x148a7d,
  twisting_vines_plant: 0x148a7d,
  weeping_vines: 0x891a13,
  weeping_vines_plant: 0x891a13,
  nether_wart: 0xa2242b,
  ochre_froglight: { pillar: true, end: 0xf4e4ae, side: 0xf2e1a8 },
  verdant_froglight: { pillar: true, end: 0xd4eccb, side: 0xd0e8c6 },
  pearlescent_froglight: { pillar: true, end: 0xebd4e2, side: 0xe8d0df },

  // Plants
  short_grass: 0x6f9f3a,
  tall_grass: 0x6f9f3a,
  fern: 0x5f8e33,
  large_fern: 0x5f8e33,
  dead_bush: 0x6b4f29,
  seagrass: 0x3d8c38,
  tall_seagrass: 0x3d8c38,
  kelp: 0x578f2b,
  kelp_plant: 0x578f2b,
  dried_kelp_block: 0x3a4229,
  sugar_cane: 0x95c165,
  bamboo: 0x5d912a,
  bamboo_sapling: 0x5d912a,
  cactus: { side: 0x557f2b, top: 0x6b8e37 },
  sweet_berry_bush: 0x3a6531,
  cave_vines: 0x5a6d27,
  cave_vines_plant: 0x5a6d27,
  vine: 0x4d7f1e,
  glow_lichen: 0x6f8b7d,
  hanging_roots: 0xa87c5e,
  lily_pad: 0x208030,
  small_dripleaf: 0x5c8a2b,
  big_dripleaf: 0x6f9f31,
  big_dripleaf_stem: 0x5a8a2e,
  azalea: 0x6a8a30,
  flowering_azalea: 0x7a7d4a,
  azalea_leaves: 0x5d7a2d,
  flowering_azalea_leaves: 0x6e7b44,
  spore_blossom: 0xd669a6,
  pink_petals: 0xf2a4c9,
  dandelion: 0xf7e43c,
  poppy: 0xed302c,
  blue_orchid: 0x2da9f1,
  allium: 0xb583e5,
  azure_bluet: 0xdfe8eb,
  red_tulip: 0xd33a17,
  orange_tulip: 0xe8822a,
  white_tulip: 0xe4f0e9,
  pink_tulip: 0xeeb2d6,
  oxeye_daisy: 0xe9e9e4,
  cornflower: 0x4f70d4,
  lily_of_the_valley: 0xe7e7e7,
  wither_rose: 0x282a1b,
  torchflower: 0xe39646,
  sunflower: 0xf2c82f,
  lilac: 0xcf9cd8,
  rose_bush: 0xbe2d24,
  peony: 0xe6b9e7,
  pitcher_plant: 0x6c8bc7,
  brown_mushroom: 0x957055,
  red_mushroom: 0xd94a3a,
  brown_mushroom_block: 0x956f51,
  red_mushroom_block: 0xc82f2d,
  mushroom_stem: 0xcbc4b9,
  cobweb: 0xe5e5e5,
  wheat: 0x8eaa3c,
  carrots: 0x4f9c33,
  potatoes: 0x4f9c33,
  beetroots: 0x46852f,
  melon_stem: 0x6f9a3a,
  pumpkin_stem: 0x6f9a3a,
  attached_melon_stem: 0x6f9a3a,
  attached_pumpkin_stem: 0x6f9a3a,
  cocoa: 0x8c5a2b,
  torchflower_crop: 0x5f8f32,
  pitcher_crop: 0x6a8f3b,
  melon: { side: 0x6f9118, top: 0xa9a11f },
  pumpkin: { side: 0xc67418, top: 0xc2731a },
  carved_pumpkin: { front: 0xa85e12, side: 0xc67418, top: 0xc2731a, bottom: 0xc2731a },
  jack_o_lantern: { front: 0xe3a33a, side: 0xc67418, top: 0xc2731a, bottom: 0xc2731a },
  hay_block: { pillar: true, end: 0xa6883a, side: 0xa68b0c },
  bone_block: { pillar: true, end: 0xd2ceb4, side: 0xe1ddc9 },
  sponge: 0xc3c04a,
  wet_sponge: 0xab9a2f,
  honey_block: 0xf9bd3c,
  honeycomb_block: 0xe59e2c,
  slime_block: 0x74b95a,
  bee_nest: { front: 0xc49a4c, side: 0xc9a250, top: 0xcba052, bottom: 0xcba052 },
  beehive: { front: 0x9e7944, side: 0xb48d51, top: 0xb89156, bottom: 0xb89156 },
  frogspawn: 0x6f5c59,
  turtle_egg: 0xe4e3c0,
  sniffer_egg: 0x8a3e2f,
  sea_pickle: 0x6e7531,
  tube_coral_block: 0x3157cf,
  brain_coral_block: 0xcf5b9f,
  bubble_coral_block: 0xa119a8,
  fire_coral_block: 0xa4232f,
  horn_coral_block: 0xd8c842,

  // Functional / decorative
  crafting_table: { side: 0x81653e, top: 0x7f5d37, bottom: 0xa2834f },
  furnace: { front: 0x575757, side: 0x6e6e6e, top: 0x707070, bottom: 0x707070 },
  blast_furnace: { front: 0x515152, side: 0x6c6c6b, top: 0x6f6f6f, bottom: 0x6f6f6f },
  smoker: { front: 0x4f4840, side: 0x5b5245, top: 0x56504a, bottom: 0x56504a },
  dispenser: { front: 0x5e5e5e, side: 0x6e6e6e, top: 0x707070, bottom: 0x707070 },
  dropper: { front: 0x5e5e5e, side: 0x6e6e6e, top: 0x707070, bottom: 0x707070 },
  observer: { front: 0x646464, side: 0x5f5f5f, top: 0x626262, back: 0x4b4b4b },
  piston: { front: 0xa2834f, side: 0x736a5c, back: 0x6c6c6c },
  sticky_piston: { front: 0x77a25c, side: 0x736a5c, back: 0x6c6c6c },
  piston_head: 0xa2834f,
  barrel: { front: 0x8e6b3e, side: 0x865f36, back: 0x7c5732 },
  bookshelf: { side: 0x75603f, top: 0xa2834f },
  chiseled_bookshelf: { front: 0x7b6141, side: 0xa2834f, top: 0xa2834f },
  lectern: 0xad8a52,
  composter: 0x70502c,
  cartography_table: { side: 0x59432b, top: 0x6a5639 },
  fletching_table: { side: 0xc5b485, top: 0xc8b889 },
  smithing_table: { side: 0x39393f, top: 0x3d3f47 },
  loom: { side: 0xa8957a, top: 0xb79e7a },
  stonecutter: 0x7b7671,
  grindstone: 0x8e8e8e,
  anvil: 0x444444,
  chipped_anvil: 0x444444,
  damaged_anvil: 0x444444,
  bell: 0xf2ca4d,
  cauldron: 0x3f3f3f,
  water_cauldron: 0x3f3f3f,
  lava_cauldron: 0x3f3f3f,
  powder_snow_cauldron: 0x3f3f3f,
  hopper: 0x464646,
  brewing_stand: 0x7b6853,
  enchanting_table: { side: 0x1f1a2a, top: 0x9c2b33, bottom: 0x0f0b19 },
  beacon: 0x75ded9,
  conduit: 0x9e8b6c,
  spawner: 0x24353f,
  trial_spawner: 0x2f3e4a,
  vault: 0x3a4249,
  crafter: { side: 0x6d5f5c, top: 0x7a6a63 },
  heavy_core: 0x5a5f69,
  jukebox: { side: 0x5a3d2d, top: 0x5e3c2b },
  note_block: 0x59392a,
  tnt: { side: 0xb84530, top: 0xc24a33, bottom: 0xc24a33 },
  target: 0xe3afa0,
  redstone_lamp: 0x5f361c,
  daylight_detector: 0x827763,
  chest: 0xa26f2e,
  trapped_chest: 0xa26f2e,
  ender_chest: 0x283a3b,
  ladder: 0x7c6237,
  scaffolding: 0xaf8b4d,
  torch: 0xe7c15a,
  wall_torch: 0xe7c15a,
  soul_torch: 0x6ee2e9,
  soul_wall_torch: 0x6ee2e9,
  redstone_torch: 0xcc2c14,
  redstone_wall_torch: 0xcc2c14,
  lantern: 0x8a6e42,
  soul_lantern: 0x4a6a75,
  campfire: 0x6d5a3c,
  soul_campfire: 0x4e5e62,
  chain: 0x3f4250,
  iron_bars: 0x6e6f70,
  iron_door: 0xc2c1c1,
  iron_trapdoor: 0xc9c9c9,
  lightning_rod: 0xc06c50,
  rail: 0x7e6b54,
  powered_rail: 0x9a7d3e,
  detector_rail: 0x7a6152,
  activator_rail: 0x6e5547,
  redstone_wire: 0xb01010,
  repeater: 0x9f9f9f,
  comparator: 0xa3a3a3,
  lever: 0x6e5a3a,
  tripwire_hook: 0x8a7b5e,
  tripwire: 0xdadada,
  flower_pot: 0x7c4535,
  decorated_pot: 0x985e43,
  cake: 0xe9dccb,
  candle: 0xe9d7ad,
  candle_cake: 0xe9dccb,
  glass: 0xc0f5fe,
  glass_pane: 0xc0f5fe,
  tinted_glass: 0x2c2730,
  water: 0x3f76e4,
  bubble_column: 0x3f76e4,
  lava: 0xcf5b14,
  nether_portal: 0x5b0db5,
  end_portal: 0x0b0b13,
  end_gateway: 0x0b0b13,
  skeleton_skull: 0xc9c9c9,
  skeleton_wall_skull: 0xc9c9c9,
  wither_skeleton_skull: 0x333333,
  wither_skeleton_wall_skull: 0x333333,
  zombie_head: 0x6e9a62,
  zombie_wall_head: 0x6e9a62,
  creeper_head: 0x63a853,
  creeper_wall_head: 0x63a853,
  player_head: 0x6e4f34,
  player_wall_head: 0x6e4f34,
  dragon_head: 0x1e1e1e,
  dragon_wall_head: 0x1e1e1e,
  piglin_head: 0xe1997a,
  piglin_wall_head: 0xe1997a,
  shulker_box: 0x8b5f8b,
  command_block: 0xc77e4f,
  chain_command_block: 0x7fa58f,
  repeating_command_block: 0x6a52a5,
  structure_block: 0x5e4f59,
  jigsaw: 0x4b3b4b,
  barrier: 0xe03030,
  light: 0xf5f5a0,
  moving_piston: 0x736a5c,
  heavy_weighted_pressure_plate: 0xdcdcdc,
  light_weighted_pressure_plate: 0xf6d03d,
  fire: 0xe08a2e,
  soul_fire: 0x52c8d0,
};

const DEAD_CORAL = 0x827b76;
const CORAL: Record<string, Rgb> = {
  tube: 0x3157cf,
  brain: 0xcf5b9f,
  bubble: 0xa119a8,
  fire: 0xa4232f,
  horn: 0xd8c842,
};

/** Family suffixes whose colour equals the base block's colour. */
const FAMILY_SUFFIXES = [
  '_stairs',
  '_slab',
  '_wall',
  '_fence_gate',
  '_fence',
  '_door',
  '_trapdoor',
  '_button',
  '_pressure_plate',
  '_wall_hanging_sign',
  '_hanging_sign',
  '_wall_sign',
  '_sign',
];

function uniform(c: Rgb): ResolvedColors['faces'] {
  return [c, c, c, c, c, c];
}

function fromSpec(spec: ColorSpec, state: BlockState): ResolvedColors['faces'] {
  if (typeof spec === 'number') return uniform(spec);
  if ('pillar' in spec) {
    const f = uniform(spec.side);
    const axis = state.props.axis ?? 'y';
    if (axis === 'x') f[EAST] = f[WEST] = spec.end;
    else if (axis === 'z') f[SOUTH] = f[NORTH] = spec.end;
    else f[UP] = f[DOWN] = spec.end;
    return f;
  }
  if ('front' in spec) {
    const f = uniform(spec.side);
    if (spec.top !== undefined) f[UP] = spec.top;
    if (spec.bottom !== undefined) f[DOWN] = spec.bottom;
    const facing = faceIndex(state.props.facing ?? 'north');
    if (facing >= 0) {
      f[facing] = spec.front;
      if (spec.back !== undefined) f[facing ^ 1] = spec.back;
    }
    return f;
  }
  const f = uniform(spec.side);
  if (spec.top !== undefined) f[UP] = spec.top;
  f[DOWN] = spec.bottom ?? spec.top ?? spec.side;
  return f;
}

function swatchOf(faces: ResolvedColors['faces']): Rgb {
  return faces[UP];
}

function dyeIndex(id: string): { dye: number; rest: string } | null {
  for (const d of DYES_BY_LENGTH) {
    if (id.startsWith(d + '_')) return { dye: DYES.indexOf(d), rest: id.slice(d.length + 1) };
  }
  return null;
}

function woodOf(id: string): { wood: WoodColors; rest: string; stripped: boolean } | null {
  let s = id;
  let stripped = false;
  if (s.startsWith('stripped_')) {
    stripped = true;
    s = s.slice(9);
  }
  for (const w of WOOD_NAMES_BY_LENGTH) {
    if (s.startsWith(w + '_')) return { wood: WOODS[w], rest: s.slice(w.length + 1), stripped };
  }
  return null;
}

/** Colour rules for dye-coloured families (wool, concrete, glass, beds, …). */
function dyeFamily(id: string): ColorSpec | null {
  const m = dyeIndex(id);
  if (!m) return null;
  const i = m.dye;
  switch (m.rest) {
    case 'wool':
    case 'carpet':
    case 'bed':
    case 'banner':
    case 'wall_banner':
      return WOOL[i];
    case 'concrete':
      return CONCRETE[i];
    case 'concrete_powder':
      return CONCRETE_POWDER[i];
    case 'terracotta':
      return TERRACOTTA[i];
    case 'glazed_terracotta':
      return GLAZED[i];
    case 'stained_glass':
    case 'stained_glass_pane':
      return STAINED_GLASS[i];
    case 'candle':
    case 'candle_cake':
      return m.rest === 'candle' ? WOOL[i] : 0xe9dccb;
    case 'shulker_box':
      return SHULKER[i];
    default:
      return null;
  }
}

/** Colour rules for wood families (planks, logs, leaves, doors, signs, …). */
function woodFamily(id: string): ColorSpec | null {
  const m = woodOf(id);
  if (!m) return null;
  const { wood, rest, stripped } = m;
  if (rest === 'log' || rest === 'stem' || rest === 'block') {
    return stripped
      ? { pillar: true, end: wood.strippedTop, side: wood.stripped }
      : { pillar: true, end: wood.logTop, side: wood.log };
  }
  if (rest === 'wood' || rest === 'hyphae') return stripped ? wood.stripped : wood.log;
  if (stripped) return null;
  if (rest === 'leaves') return wood.leaves;
  if (rest === 'sapling' || rest === 'propagule') return wood.leaves;
  if (rest === 'planks' || rest === 'mosaic') return wood.planks;
  for (const suffix of FAMILY_SUFFIXES) {
    if ('_' + rest === suffix || rest.endsWith(suffix) || rest === suffix.slice(1)) return wood.planks;
  }
  if (rest === 'mosaic_stairs' || rest === 'mosaic_slab') return wood.planks;
  return null;
}

function copperFamily(id: string): ColorSpec | null {
  let s = id.startsWith('waxed_') ? id.slice(6) : id;
  let stage = '';
  for (const st of ['exposed', 'weathered', 'oxidized']) {
    if (s.startsWith(st + '_')) {
      stage = st;
      s = s.slice(st.length + 1);
    }
  }
  if (!s.includes('copper')) return null;
  const c = COPPER_STAGES[stage];
  if (s.startsWith('cut_copper')) return c.cut;
  if (s === 'copper' || s === 'copper_block' || s.startsWith('copper_') || s === 'chiseled_copper' || s === 'lightning_rod') {
    return c.block;
  }
  return null;
}

/** Base block candidates for "<base>_stairs" etc. */
function familyBase(id: string): string[] {
  for (const suffix of FAMILY_SUFFIXES) {
    if (!id.endsWith(suffix)) continue;
    const base = id.slice(0, -suffix.length);
    const out = [base, base + 's', base + '_block', base + '_planks'];
    if (base.endsWith('_brick')) out.push(base + 's');
    if (base.endsWith('_tile')) out.push(base + 's');
    if (base === 'petrified_oak') out.push('oak_planks');
    if (base === 'smooth_quartz') out.push('smooth_quartz');
    if (base === 'quartz') out.push('quartz_block');
    if (base === 'purpur') out.push('purpur_block');
    return out;
  }
  return [];
}

function lookup(id: string, state: BlockState, depth = 0): { faces: ResolvedColors['faces']; source: ColorSource } | null {
  const spec = TABLE[id];
  if (spec !== undefined) return { faces: fromSpec(spec, state), source: depth === 0 ? 'exact' : 'family' };
  if (depth > 3) return null;

  if (id.startsWith('waxed_')) return lookup(id.slice(6), state, depth + 1);
  if (id.startsWith('infested_')) return lookup(id.slice(9), state, depth + 1);
  if (id.startsWith('potted_')) return { faces: uniform(TABLE.flower_pot as number), source: 'family' };

  const dye = dyeFamily(id);
  if (dye !== null) return { faces: fromSpec(dye, state), source: 'family' };
  const wood = woodFamily(id);
  if (wood !== null) return { faces: fromSpec(wood, state), source: 'family' };
  const copper = copperFamily(id);
  if (copper !== null) return { faces: fromSpec(copper, state), source: 'family' };

  for (const base of familyBase(id)) {
    const hit = lookup(base, state, depth + 1);
    if (hit) return { faces: hit.faces, source: 'family' };
  }

  // Coral plants and fans
  const coral = /^(dead_)?(tube|brain|bubble|fire|horn)_coral(_block|_fan|_wall_fan)?$/.exec(id);
  if (coral) return { faces: uniform(coral[1] ? DEAD_CORAL : CORAL[coral[2]]), source: 'family' };

  return null;
}

/** Keyword guesses for vanilla blocks not in the table (keeps unknown vanilla blocks plausible). */
function guess(id: string): Rgb | null {
  const keys: [string, Rgb][] = [
    ['deepslate', 0x4d4d51],
    ['blackstone', 0x302a31],
    ['nether_brick', 0x2c1519],
    ['end_stone', 0xdbdea0],
    ['sandstone', 0xd8cb9b],
    ['prismarine', 0x639c97],
    ['quartz', 0xece6df],
    ['purpur', 0xa97da9],
    ['brick', 0x976253],
    ['tuff', 0x6c6d67],
    ['copper', 0xc06c50],
    ['ice', 0x91b7fd],
    ['glass', 0xc0f5fe],
    ['stone', stone],
    ['ore', 0x7d7d7d],
    ['leaves', 0x5b8f2a],
    ['sapling', 0x5b8f2a],
    ['coral', 0xcf5b9f],
    ['mushroom', 0x957055],
    ['moss', 0x596e2d],
    ['mud', 0x3c393d],
    ['sand', 0xdbcfa3],
  ];
  for (const [k, c] of keys) if (id.includes(k)) return c;
  return null;
}

/** Stable colour from the block id (for unknown blocks). */
export function hashColor(name: string): Rgb {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  const hue = (h % 360) / 360;
  const sat = 0.45 + ((h >>> 9) % 30) / 100;
  const light = 0.42 + ((h >>> 17) % 20) / 100;
  return hslToRgb(hue, sat, light);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export function resolveColors(state: BlockState): ResolvedColors {
  const ns = namespaceOf(state.name);
  const id = shortName(state.name).replace(/^[a-z0-9_.-]+:/, '');
  const isVanilla = ns === 'minecraft';

  if (isVanilla) {
    const hit = lookup(id, state);
    if (hit) {
      const faces = applyStateTweaks(id, state, hit.faces);
      return { faces, source: hit.source, marked: false, swatch: swatchOf(faces) };
    }
    const g = guess(id);
    if (g !== null) return { faces: uniform(g), source: 'guess', marked: false, swatch: g };
    const c = hashColor(state.name);
    return { faces: uniform(c), source: 'unknown', marked: true, swatch: c };
  }

  // Modded blocks: colours are only known after reading the mod jars (stage 2). Use a guess
  // from familiar keywords if possible, otherwise a hash colour, and mark them in both cases.
  const g = lookup(id, state)?.faces ?? (guess(id) !== null ? uniform(guess(id)!) : null);
  if (g) return { faces: g, source: 'guess', marked: true, swatch: swatchOf(g) };
  const c = hashColor(state.name);
  return { faces: uniform(c), source: 'unknown', marked: true, swatch: c };
}

/** Small state-dependent adjustments (snowy grass, lit lamps, …). */
function applyStateTweaks(id: string, state: BlockState, faces: ResolvedColors['faces']): ResolvedColors['faces'] {
  const p = state.props;
  if (p.snowy === 'true' && (id === 'grass_block' || id === 'podzol' || id === 'mycelium')) {
    const f = [...faces] as ResolvedColors['faces'];
    f[UP] = 0xf9fefe;
    return f;
  }
  if (p.lit === 'true' && (id === 'redstone_lamp' || id.endsWith('copper_bulb'))) {
    return uniform(id === 'redstone_lamp' ? 0xcb8a4f : 0xf0c27a);
  }
  if (p.lit === 'true' && (id === 'furnace' || id === 'blast_furnace' || id === 'smoker')) {
    const f = [...faces] as ResolvedColors['faces'];
    const facing = faceIndex(p.facing ?? 'north');
    if (facing >= 0) f[facing] = 0x9a6a3a;
    return f;
  }
  return faces;
}

export function rgbToCss(c: Rgb): string {
  return '#' + c.toString(16).padStart(6, '0');
}
