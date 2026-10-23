import { shortName, type BlockState } from '../core/blockstate';
import { horizontalSteps } from './faces';

/**
 * Block shapes ("Grundformen") in 1/16 block units. Shapes are approximations of the vanilla
 * block models: good enough to read a building (stairs, slabs, fences, panes, doors, trapdoors,
 * buttons, torches, plants …) without textures. Applies by name pattern, so modded stairs,
 * slabs, fences etc. get the right shape too.
 */
export type Box = [number, number, number, number, number, number];

export type ShapeSpec =
  | { kind: 'none' }
  | { kind: 'cube'; occludes: boolean; translucent: boolean; cullSame: boolean }
  | { kind: 'boxes'; boxes: Box[]; translucent: boolean }
  | { kind: 'cross'; height: number; translucent: boolean };

const NONE: ShapeSpec = { kind: 'none' };
const SOLID: ShapeSpec = { kind: 'cube', occludes: true, translucent: false, cullSame: false };
const CUTOUT: ShapeSpec = { kind: 'cube', occludes: false, translucent: false, cullSame: true };
const CLEAR: ShapeSpec = { kind: 'cube', occludes: false, translucent: true, cullSame: true };

// ---------------------------------------------------------------------------
// Box transforms (all around the block centre).

/** Rotates clockwise (seen from above) by 90° steps: north -> east -> south -> west. */
export function rotY(b: Box, steps: number): Box {
  let [x0, y0, z0, x1, y1, z1] = b;
  const n = ((steps % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    const nx0 = 16 - z1;
    const nx1 = 16 - z0;
    z0 = x0;
    z1 = x1;
    x0 = nx0;
    x1 = nx1;
  }
  return [x0, y0, z0, x1, y1, z1];
}

export function flipY(b: Box): Box {
  return [b[0], 16 - b[4], b[2], b[3], 16 - b[1], b[5]];
}

/** Orients a box modelled for facing=north towards any of the six directions. */
export function toFacing(b: Box, facing: string | undefined): Box {
  if (facing === 'up') return [b[0], 16 - b[5], b[1], b[3], 16 - b[2], b[4]];
  if (facing === 'down') return [b[0], b[2], 16 - b[4], b[3], b[5], 16 - b[1]];
  return rotY(b, horizontalSteps(facing));
}

const along = (boxes: Box[], facing: string | undefined): Box[] => boxes.map((b) => toFacing(b, facing));
const boxes = (list: Box[], translucent = false): ShapeSpec => ({ kind: 'boxes', boxes: list, translucent });

// ---------------------------------------------------------------------------
// Stairs: bottom (or top) slab plus quarter blocks, exactly as vanilla's StairBlock shapes.
// Quarter bits: 1 = NW, 2 = NE, 4 = SW, 8 = SE. Index = shape * 4 + facing2D (S=0, W=1, N=2, E=3).
const STAIR_QUARTERS = [12, 5, 3, 10, 14, 13, 7, 11, 13, 7, 11, 14, 8, 4, 1, 2, 4, 1, 2, 8];
const STAIR_SHAPES = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
const FACING_2D: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 };

export function stairBoxes(facing: string, half: string, shape: string): Box[] {
  const top = half === 'top';
  const s = Math.max(0, STAIR_SHAPES.indexOf(shape));
  const f = FACING_2D[facing] ?? 2;
  const bits = STAIR_QUARTERS[s * 4 + f];
  const [sy0, sy1] = top ? [8, 16] : [0, 8];
  const [qy0, qy1] = top ? [0, 8] : [8, 16];
  const out: Box[] = [[0, sy0, 0, 16, sy1, 16]];
  if (bits & 1) out.push([0, qy0, 0, 8, qy1, 8]);
  if (bits & 2) out.push([8, qy0, 0, 16, qy1, 8]);
  if (bits & 4) out.push([0, qy0, 8, 8, qy1, 16]);
  if (bits & 8) out.push([8, qy0, 8, 16, qy1, 16]);
  return out;
}

// ---------------------------------------------------------------------------

const SIDES = ['north', 'east', 'south', 'west'] as const;

function connectedSides(p: Readonly<Record<string, string>>): string[] {
  return SIDES.filter((s) => p[s] === 'true' || p[s] === 'low' || p[s] === 'tall');
}

function fenceBoxes(p: Readonly<Record<string, string>>): Box[] {
  const out: Box[] = [[6, 0, 6, 10, 16, 10]];
  for (const side of connectedSides(p)) {
    const steps = horizontalSteps(side);
    out.push(rotY([7, 12, 0, 9, 15, 6], steps), rotY([7, 6, 0, 9, 9, 6], steps));
  }
  return out;
}

function paneBoxes(p: Readonly<Record<string, string>>): Box[] {
  const out: Box[] = [[7, 0, 7, 9, 16, 9]];
  for (const side of connectedSides(p)) out.push(rotY([7, 0, 0, 9, 16, 7], horizontalSteps(side)));
  return out;
}

function wallBoxes(p: Readonly<Record<string, string>>): Box[] {
  const out: Box[] = [];
  const sides = connectedSides(p);
  if (p.up !== 'false' || sides.length === 0) out.push([4, 0, 4, 12, 16, 12]);
  for (const side of sides) {
    const h = p[side] === 'tall' ? 16 : 14;
    out.push(rotY([5, 0, 0, 11, h, 8], horizontalSteps(side)));
  }
  return out;
}

function gateBoxes(p: Readonly<Record<string, string>>): Box[] {
  const dy = p.in_wall === 'true' ? -3 : 0;
  const steps = horizontalSteps(p.facing);
  const list: Box[] = [
    [0, 5, 7, 2, 16, 9],
    [14, 5, 7, 16, 16, 9],
  ];
  if (p.open === 'true') {
    list.push([0, 6, 9, 2, 9, 15], [0, 12, 9, 2, 15, 15], [14, 6, 9, 16, 9, 15], [14, 12, 9, 16, 15, 15]);
  } else {
    list.push([2, 6, 7, 14, 9, 9], [2, 12, 7, 14, 15, 9], [7, 9, 7, 9, 12, 9]);
  }
  return list.map((b) => rotY([b[0], Math.max(0, b[1] + dy), b[2], b[3], b[4] + dy, b[5]], steps));
}

function doorBoxes(p: Readonly<Record<string, string>>): Box[] {
  let b: Box;
  if (p.open === 'true') b = p.hinge === 'right' ? [13, 0, 0, 16, 16, 16] : [0, 0, 0, 3, 16, 16];
  else b = [0, 0, 13, 16, 16, 16];
  return [rotY(b, horizontalSteps(p.facing))];
}

function trapdoorBoxes(p: Readonly<Record<string, string>>): Box[] {
  if (p.open === 'true') return [rotY([0, 0, 13, 16, 16, 16], horizontalSteps(p.facing))];
  return [p.half === 'top' ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16]];
}

/** Box modelled for a block attached to the wall south of it (facing north), oriented by facing. */
function onWall(b: Box, facing: string | undefined): Box {
  return rotY(b, horizontalSteps(facing));
}

function buttonBoxes(p: Readonly<Record<string, string>>): Box[] {
  const pressed = p.powered === 'true';
  const d = pressed ? 1 : 2;
  if (p.face === 'floor' || p.face === 'ceiling') {
    let b: Box = [5, 0, 6, 11, d, 10];
    if (p.facing === 'east' || p.facing === 'west') b = [6, 0, 5, 10, d, 11];
    return [p.face === 'ceiling' ? flipY(b) : b];
  }
  return [onWall([5, 6, 16 - d, 11, 10, 16], p.facing)];
}

function leverBoxes(p: Readonly<Record<string, string>>): Box[] {
  if (p.face === 'floor' || p.face === 'ceiling') {
    let list: Box[] = [[5, 0, 4, 11, 3, 12], [7, 3, 7, 9, 10, 9]];
    if (p.facing === 'east' || p.facing === 'west') list = [[4, 0, 5, 12, 3, 11], [7, 3, 7, 9, 10, 9]];
    return p.face === 'ceiling' ? list.map(flipY) : list;
  }
  return [onWall([5, 4, 13, 11, 12, 16], p.facing), onWall([7, 7, 6, 9, 9, 13], p.facing)];
}

function snowBoxes(p: Readonly<Record<string, string>>): Box[] {
  const layers = Math.min(8, Math.max(1, parseInt(p.layers ?? '1', 10) || 1));
  return [[0, 0, 0, 16, layers * 2, 16]];
}

function multifaceBoxes(p: Readonly<Record<string, string>>): Box[] {
  const out: Box[] = [];
  if (p.north === 'true') out.push([0, 0, 0, 16, 16, 1]);
  if (p.south === 'true') out.push([0, 0, 15, 16, 16, 16]);
  if (p.east === 'true') out.push([15, 0, 0, 16, 16, 16]);
  if (p.west === 'true') out.push([0, 0, 0, 1, 16, 16]);
  if (p.up === 'true') out.push([0, 15, 0, 16, 16, 16]);
  if (p.down === 'true') out.push([0, 0, 0, 16, 1, 16]);
  if (out.length === 0) out.push([0, 15, 0, 16, 16, 16]);
  return out;
}

function axisBoxes(p: Readonly<Record<string, string>>, r0: number, r1: number): Box[] {
  if (p.axis === 'x') return [[0, r0, r0, 16, r1, r1]];
  if (p.axis === 'z') return [[r0, r0, 0, r1, r1, 16]];
  return [[r0, 0, r0, r1, 16, r1]];
}

function standingSignBoxes(p: Readonly<Record<string, string>>): Box[] {
  const r = (parseInt(p.rotation ?? '0', 10) || 0) % 16;
  const alongX = Math.round(r / 4) % 2 === 0; // facing south/north -> board spans east-west
  return [[7, 0, 7, 9, 9, 9], alongX ? [0, 9, 7, 16, 16, 9] : [7, 9, 0, 9, 16, 16]];
}

function cropHeight(id: string, p: Readonly<Record<string, string>>): number {
  const age = parseInt(p.age ?? '0', 10) || 0;
  switch (id) {
    case 'wheat':
      return 2 + age * 2;
    case 'carrots':
    case 'potatoes':
      return 3 + age;
    case 'beetroots':
      return 4 + age * 3;
    case 'nether_wart':
      return 5 + age * 3;
    case 'sweet_berry_bush':
      return 8 + age * 2;
    case 'melon_stem':
    case 'pumpkin_stem':
      return 2 + age * 2;
    default:
      return 16;
  }
}

const CROSS_PLANTS: Record<string, number> = {
  short_grass: 13, grass: 13, fern: 13, dead_bush: 13, dandelion: 10, poppy: 11, blue_orchid: 13,
  allium: 13, azure_bluet: 11, red_tulip: 12, orange_tulip: 12, white_tulip: 12, pink_tulip: 12,
  oxeye_daisy: 12, cornflower: 13, lily_of_the_valley: 12, wither_rose: 12, torchflower: 12,
  cobweb: 16, sugar_cane: 16, tall_grass: 16, large_fern: 16, sunflower: 16, lilac: 16,
  rose_bush: 16, peony: 16, pitcher_plant: 16, seagrass: 16, tall_seagrass: 16, kelp: 16,
  kelp_plant: 16, cave_vines: 16, cave_vines_plant: 16, twisting_vines: 16, twisting_vines_plant: 16,
  weeping_vines: 16, weeping_vines_plant: 16, hanging_roots: 16, crimson_roots: 13, warped_roots: 13,
  nether_sprouts: 6, crimson_fungus: 9, warped_fungus: 9, brown_mushroom: 6, red_mushroom: 7,
  small_dripleaf: 13, spore_blossom: 16, mangrove_propagule: 15, pointed_dripstone: 16,
  amethyst_cluster: 7, large_amethyst_bud: 5, medium_amethyst_bud: 4, small_amethyst_bud: 3,
  bamboo_sapling: 12, pitcher_crop: 16, torchflower_crop: 10, attached_melon_stem: 10,
  attached_pumpkin_stem: 10, wheat: 16, carrots: 16, potatoes: 16, beetroots: 16, nether_wart: 16,
  sweet_berry_bush: 16, melon_stem: 16, pumpkin_stem: 16,
};

const TRANSLUCENT_CUBES = new Set([
  'glass', 'tinted_glass', 'ice', 'frosted_ice', 'slime_block', 'honey_block', 'water', 'bubble_column',
  'beacon', 'end_gateway',
]);

const CUTOUT_CUBES = new Set([
  'spawner', 'trial_spawner', 'vault', 'mangrove_roots', 'scaffolding', 'azalea', 'flowering_azalea',
  'barrier', 'chorus_flower', 'powder_snow', 'composter', 'cauldron', 'water_cauldron', 'lava_cauldron',
  'powder_snow_cauldron', 'hopper',
]);

const INVISIBLE = new Set([
  'air', 'cave_air', 'void_air', 'structure_void', 'light', 'barrier', 'moving_piston', 'fire', 'soul_fire',
]);

const FLAT_1PX = new Set([
  'rail', 'powered_rail', 'detector_rail', 'activator_rail', 'redstone_wire', 'lily_pad', 'pink_petals',
  'frogspawn', 'moss_carpet',
]);

/** Resolves the preview shape of a block state. */
export function resolveShape(state: BlockState): ShapeSpec {
  const id = shortName(state.name).replace(/^[a-z0-9_.-]+:/, '');
  const p = state.props;

  if (INVISIBLE.has(id)) return NONE;
  if (id === 'water' || id === 'bubble_column') return CLEAR;
  if (id === 'lava') return SOLID;

  // --- Families recognised by suffix (also covers modded blocks).
  if (id.endsWith('_slab')) {
    if (p.type === 'double') return SOLID;
    return boxes([p.type === 'top' ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]]);
  }
  if (id.endsWith('_stairs')) return boxes(stairBoxes(p.facing ?? 'north', p.half ?? 'bottom', p.shape ?? 'straight'));
  if (id.endsWith('_fence_gate')) return boxes(gateBoxes(p));
  if (id.endsWith('_fence')) return boxes(fenceBoxes(p));
  if (id.endsWith('_wall')) return boxes(wallBoxes(p));
  if (id.endsWith('_pane') || id === 'iron_bars') return boxes(paneBoxes(p), id.endsWith('glass_pane'));
  if (id.endsWith('_trapdoor')) return boxes(trapdoorBoxes(p));
  if (id.endsWith('_door')) return boxes(doorBoxes(p));
  if (id.endsWith('_carpet')) return boxes([[0, 0, 0, 16, 1, 16]]);
  if (id.endsWith('_pressure_plate')) return boxes([[1, 0, 1, 15, 1, 15]]);
  if (id.endsWith('_button')) return boxes(buttonBoxes(p));
  if (id.endsWith('_wall_hanging_sign')) return boxes([onWall([1, 0, 7, 15, 10, 9], p.facing), onWall([0, 14, 6, 16, 16, 10], p.facing)]);
  if (id.endsWith('_hanging_sign')) return boxes([[1, 0, 7, 15, 10, 9], [7, 10, 7, 9, 16, 9]]);
  if (id.endsWith('_wall_sign')) return boxes([onWall([0, 4, 14, 16, 12, 16], p.facing)]);
  if (id.endsWith('_sign')) return boxes(standingSignBoxes(p));
  if (id.endsWith('_wall_banner')) return boxes([onWall([1, 0, 14, 15, 16, 16], p.facing)]);
  if (id.endsWith('_banner')) return boxes([[7, 0, 7, 9, 16, 9], [1, 4, 7, 15, 16, 8]]);
  if (id.endsWith('_bed')) return boxes([[0, 0, 0, 16, 9, 16]]);
  if (id.endsWith('_candle_cake') || id === 'candle_cake') return boxes([[1, 0, 1, 15, 8, 15], [7, 8, 7, 9, 14, 9]]);
  if (id.endsWith('candle')) return boxes(candleBoxes(parseInt(p.candles ?? '1', 10) || 1));
  if (id === 'piston_head') return boxes(along([[0, 0, 0, 16, 16, 4], [6, 6, 4, 10, 10, 16]], p.facing));
  if (id.endsWith('_wall_head') || id.endsWith('_wall_skull')) return boxes([onWall([4, 4, 8, 12, 12, 16], p.facing)]);
  if (id.endsWith('_head') || id.endsWith('_skull')) return boxes([[4, 0, 4, 12, 8, 12]]);
  if (id.endsWith('_wall_torch') || id === 'wall_torch') return boxes([onWall([7, 3, 12, 9, 13, 14], p.facing)]);
  if (id.endsWith('torch')) return boxes([[7, 0, 7, 9, 10, 9]]);
  if (id.endsWith('_wall_fan')) return boxes([onWall([2, 4, 11, 14, 12, 16], p.facing)]);
  if (id.endsWith('_coral_fan')) return { kind: 'cross', height: 6, translucent: false };
  if (/_coral$/.test(id)) return { kind: 'cross', height: 15, translucent: false };
  if (id.endsWith('_sapling') || id.endsWith('_tulip')) return { kind: 'cross', height: 13, translucent: false };
  if (id.startsWith('potted_')) return boxes([[5, 0, 5, 11, 6, 11], [6, 6, 6, 10, 14, 10]]);
  if (id.endsWith('_stained_glass')) return CLEAR;
  if (id.endsWith('_leaves')) return SOLID;
  if (id.endsWith('_grate')) return CUTOUT;
  if (id.endsWith('shulker_box')) return SOLID;

  const crossH = CROSS_PLANTS[id];
  if (crossH !== undefined) {
    const h = Math.min(crossH, cropHeight(id, p));
    return { kind: 'cross', height: h, translucent: false };
  }

  switch (id) {
    case 'snow':
      return boxes(snowBoxes(p));
    case 'lantern':
    case 'soul_lantern':
      return boxes(
        p.hanging === 'true'
          ? [[5, 1, 5, 11, 8, 11], [6, 8, 6, 10, 10, 10], [7, 10, 7, 9, 16, 9]]
          : [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]],
      );
    case 'chain':
      return boxes(axisBoxes(p, 7, 9));
    case 'end_rod':
    case 'lightning_rod':
      return boxes(along([[7, 7, 0, 9, 9, 16], [6, 6, 15, 10, 10, 16]], p.facing ?? 'up'));
    case 'ladder':
      return boxes([onWall([0, 0, 15, 16, 16, 16], p.facing)]);
    case 'vine':
    case 'glow_lichen':
    case 'sculk_vein':
      return boxes(multifaceBoxes(p));
    case 'chest':
    case 'trapped_chest':
    case 'ender_chest':
      return boxes([[1, 0, 1, 15, 14, 15]]);
    case 'enchanting_table':
      return boxes([[0, 0, 0, 16, 12, 16]]);
    case 'end_portal_frame':
      return boxes(p.eye === 'true' ? [[0, 0, 0, 16, 13, 16], [4, 13, 4, 12, 16, 12]] : [[0, 0, 0, 16, 13, 16]]);
    case 'daylight_detector':
      return boxes([[0, 0, 0, 16, 6, 16]]);
    case 'stonecutter':
      return boxes([[0, 0, 0, 16, 9, 16]]);
    case 'campfire':
    case 'soul_campfire':
      return boxes([[0, 0, 0, 16, 7, 16]]);
    case 'sculk_sensor':
    case 'calibrated_sculk_sensor':
    case 'sculk_shrieker':
      return boxes([[0, 0, 0, 16, 8, 16]]);
    case 'lectern':
      return boxes([[0, 0, 0, 16, 2, 16], [4, 2, 4, 12, 13, 12], [0, 12, 0, 16, 16, 16]]);
    case 'hopper':
      return boxes([[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], [6, 0, 6, 10, 4, 10]]);
    case 'anvil':
    case 'chipped_anvil':
    case 'damaged_anvil':
      return boxes(
        along([[2, 0, 2, 14, 4, 14], [4, 4, 3, 12, 5, 13], [6, 5, 4, 10, 10, 12], [3, 10, 0, 13, 16, 16]], p.facing),
      );
    case 'grindstone':
      return boxes([[4, 4, 2, 12, 16, 14], [2, 0, 6, 4, 12, 10], [12, 0, 6, 14, 12, 10]]);
    case 'bell':
      return boxes([[4, 4, 4, 12, 13, 12], [0, 13, 7, 16, 15, 9]]);
    case 'brewing_stand':
      return boxes([[7, 0, 7, 9, 14, 9], [1, 0, 1, 15, 2, 15]]);
    case 'flower_pot':
      return boxes([[5, 0, 5, 11, 6, 11]]);
    case 'decorated_pot':
    case 'dragon_egg':
    case 'cactus':
      return boxes([[1, 0, 1, 15, 16, 15]]);
    case 'cake': {
      const bites = parseInt(p.bites ?? '0', 10) || 0;
      return boxes([[1 + bites * 2, 0, 1, 15, 8, 15]]);
    }
    case 'sea_pickle':
      return boxes(candleBoxes(parseInt(p.pickles ?? '1', 10) || 1).map((b) => [b[0] - 1, 0, b[2] - 1, b[3] + 1, 6, b[5] + 1] as Box));
    case 'turtle_egg':
      return boxes([[4, 0, 4, 12, 7, 12]]);
    case 'sniffer_egg':
      return boxes([[1, 0, 2, 15, 16, 14]]);
    case 'conduit':
      return boxes([[5, 5, 5, 11, 11, 11]]);
    case 'heavy_core':
      return boxes([[4, 0, 4, 12, 8, 12]]);
    case 'farmland':
    case 'dirt_path':
      return boxes([[0, 0, 0, 16, 15, 16]]);
    case 'honey_block':
      return { kind: 'boxes', boxes: [[1, 0, 1, 15, 15, 15]], translucent: true };
    case 'bamboo':
      return boxes([[6, 0, 6, 9, 16, 9]]);
    case 'big_dripleaf':
      return boxes([[0, 11, 0, 16, 15, 16], [7, 0, 7, 9, 11, 9]]);
    case 'big_dripleaf_stem':
      return boxes([[7, 0, 7, 9, 16, 9]]);
    case 'repeater':
    case 'comparator':
      return boxes([[0, 0, 0, 16, 2, 16]]);
    case 'tripwire':
      return boxes([[0, 1, 7, 16, 2, 9]]);
    case 'tripwire_hook':
      return boxes([onWall([6, 0, 14, 10, 10, 16], p.facing)]);
    case 'lever':
      return boxes(leverBoxes(p));
    case 'cocoa':
      return boxes([rotY([5, 4, 1, 11, 12, 7], horizontalSteps(p.facing))]);
    case 'nether_portal':
      return { kind: 'boxes', boxes: p.axis === 'z' ? [[6, 0, 0, 10, 16, 16]] : [[0, 0, 6, 16, 16, 10]], translucent: true };
    case 'end_portal':
      return boxes([[0, 11, 0, 16, 12, 16]]);
    case 'piston':
    case 'sticky_piston':
      return p.extended === 'true' ? boxes(along([[0, 0, 4, 16, 16, 16]], p.facing)) : SOLID;
    case 'chorus_plant':
      return boxes([[3, 3, 3, 13, 13, 13], ...connectedSides(p).map((s) => rotY([4, 4, 0, 12, 12, 3], horizontalSteps(s))), ...(p.up === 'true' ? [[4, 13, 4, 12, 16, 12] as Box] : []), ...(p.down === 'true' ? [[4, 0, 4, 12, 3, 12] as Box] : [])]);
  }

  if (FLAT_1PX.has(id)) return boxes([[0, 0, 0, 16, 1, 16]]);
  if (TRANSLUCENT_CUBES.has(id)) return CLEAR;
  if (CUTOUT_CUBES.has(id)) return CUTOUT;
  return SOLID;
}

function candleBoxes(n: number): Box[] {
  const spots: Box[] = [
    [7, 0, 7, 9, 6, 9],
    [5, 0, 7, 7, 5, 9],
    [8, 0, 9, 10, 5, 11],
    [9, 0, 5, 11, 4, 7],
  ];
  return spots.slice(0, Math.min(4, Math.max(1, n)));
}
