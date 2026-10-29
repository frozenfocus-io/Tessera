import { makeState, shortName, type BlockState } from '../core/blockstate';
import { resolveShape } from '../blocks/shapes';
import { ccw, DIR, FACINGS, opposite, type Facing } from './geometry';
import type { Grid } from './grid';

/**
 * Connected blocks. In the game, fences, walls, panes and stair corners take their shape only
 * when they are placed or a neighbour changes. A file must already carry the final state, or
 * the 3D view, the material list and later the export would be wrong. This pass rebuilds the
 * vanilla rules on the finished grid (FenceBlock, IronBarsBlock, WallBlock, StairBlock):
 * because the game recomputes these states from the neighbours, applying the rules once to the
 * final arrangement gives the same result as building it block by block.
 *
 * Mod blocks with their own rules are only covered where they follow the vanilla naming
 * (…_fence, …_wall, …_pane, …_stairs).
 */

type Side = Facing | 'up' | 'down';

const id = (s: BlockState): string => shortName(s.name).replace(/^[a-z0-9_.-]+:/, '');

export const isStairs = (s: BlockState | null): boolean => !!s && id(s).endsWith('_stairs');
const isSlab = (s: BlockState): boolean => id(s).endsWith('_slab');
const isFence = (s: BlockState | null): boolean => !!s && id(s).endsWith('_fence');
const isGate = (s: BlockState | null): boolean => !!s && id(s).endsWith('_fence_gate');
const isWall = (s: BlockState | null): boolean => !!s && id(s).endsWith('_wall') && !id(s).endsWith('_sign') && !id(s).endsWith('_banner');
const isBars = (s: BlockState | null): boolean => !!s && (id(s).endsWith('_pane') || id(s) === 'iron_bars');
const isWoodenFence = (s: BlockState): boolean => !id(s).includes('nether_brick');

/** Blocks the game never connects to even though their faces are full (isExceptionForConnection). */
function isException(s: BlockState): boolean {
  const n = id(s);
  return n.endsWith('_leaves') || n === 'barrier' || n === 'pumpkin' || n === 'carved_pumpkin' || n === 'jack_o_lantern' || n === 'melon' || n.endsWith('shulker_box');
}

/** Whether a block's face on `side` is full (Block.isFaceSturdy for the cases that matter here). */
export function sturdyFace(s: BlockState | null, side: Side): boolean {
  if (!s) return false;
  if (isStairs(s)) {
    const half = s.props.half ?? 'bottom';
    if (side === 'up') return half === 'top';
    if (side === 'down') return half === 'bottom';
    return s.props.facing === side;
  }
  if (isSlab(s)) {
    const t = s.props.type ?? 'bottom';
    return t === 'double' || (side === 'down' && t === 'bottom') || (side === 'up' && t === 'top');
  }
  return resolveShape(s).kind === 'cube';
}

/** Gate in a fence line: connects when the line runs across its opening (FenceGateBlock.connectsToDirection). */
function gateConnects(gate: BlockState, dir: Facing): boolean {
  const f = (gate.props.facing ?? 'north') as Facing;
  const along = f === 'north' || f === 'south' ? 'x' : 'z';
  return (dir === 'east' || dir === 'west' ? 'x' : 'z') === along;
}

function fenceConnects(self: BlockState, n: BlockState | null, dir: Facing): boolean {
  if (!n) return false;
  if (isFence(n) && isWoodenFence(n) === isWoodenFence(self)) return true;
  if (isGate(n) && gateConnects(n, dir)) return true;
  return !isException(n) && sturdyFace(n, opposite(dir));
}

function barsConnect(n: BlockState | null, dir: Facing): boolean {
  if (!n) return false;
  if (isBars(n) || isWall(n)) return true;
  return !isException(n) && sturdyFace(n, opposite(dir));
}

function wallConnects(n: BlockState | null, dir: Facing): boolean {
  if (!n) return false;
  if (isWall(n) || isBars(n)) return true;
  if (isGate(n) && gateConnects(n, dir)) return true;
  return !isException(n) && sturdyFace(n, opposite(dir));
}

/** Blocks that always raise a wall post below them (tag minecraft:wall_post_override, roughly). */
function postOverride(s: BlockState | null): boolean {
  if (!s) return false;
  const n = id(s);
  return /torch$|lantern$|_sign$|_banner$|^redstone_wire$|_pressure_plate$|^tripwire$/.test(n);
}

/** Wall states (WallBlock.updateShape): low or tall arms, and whether the post shows. */
function wallState(self: BlockState, grid: Grid, x: number, y: number, z: number): Record<string, string> {
  const above = grid.get(x, y + 1, z);
  const aboveFull = sturdyFace(above, 'down');
  const props: Record<string, string> = { ...self.props };
  const side: Record<Facing, string> = { north: 'none', east: 'none', south: 'none', west: 'none' };
  for (const f of FACINGS) {
    const [dx, dz] = DIR[f];
    if (!wallConnects(grid.get(x + dx, y, z + dz), f)) continue;
    const coveredByWall = !!above && isWall(above) && above.props[f] !== undefined && above.props[f] !== 'none';
    side[f] = aboveFull || coveredByWall ? 'tall' : 'low';
  }
  let up: boolean;
  if (above && isWall(above) && above.props.up === 'true') up = true;
  else {
    const none = (f: Facing) => side[f] === 'none';
    const asymmetric = (none('north') && none('south') && none('east') && none('west')) || none('north') !== none('south') || none('east') !== none('west');
    if (asymmetric) up = true;
    else if ((side.north === 'tall' && side.south === 'tall') || (side.east === 'tall' && side.west === 'tall')) up = false;
    else up = postOverride(above) || aboveFull;
  }
  for (const f of FACINGS) props[f] = side[f];
  props.up = String(up);
  props.waterlogged ??= 'false';
  return props;
}

/** Stair shape from the neighbours in front and behind (StairBlock.getStairsShape). */
export function stairShape(self: BlockState, grid: Grid, x: number, y: number, z: number): string {
  const facing = (self.props.facing ?? 'north') as Facing;
  const half = self.props.half ?? 'bottom';
  const at = (f: Facing) => {
    const [dx, dz] = DIR[f];
    return grid.get(x + dx, y, z + dz);
  };
  const canTakeShape = (f: Facing) => {
    const n = at(f);
    return !n || !isStairs(n) || n.props.facing !== facing || (n.props.half ?? 'bottom') !== half;
  };
  const back = at(facing);
  if (isStairs(back) && (back!.props.half ?? 'bottom') === half) {
    const d = (back!.props.facing ?? 'north') as Facing;
    const differentAxis = (d === 'east' || d === 'west') !== (facing === 'east' || facing === 'west');
    if (differentAxis && canTakeShape(opposite(d))) return d === ccw(facing) ? 'outer_left' : 'outer_right';
  }
  const front = at(opposite(facing));
  if (isStairs(front) && (front!.props.half ?? 'bottom') === half) {
    const d = (front!.props.facing ?? 'north') as Facing;
    const differentAxis = (d === 'east' || d === 'west') !== (facing === 'east' || facing === 'west');
    if (differentAxis && canTakeShape(d)) return d === ccw(facing) ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

const AXIS_BLOCK = /(_log|_wood|_stem|_hyphae|basalt|_pillar|froglight)$|^(hay_block|bone_block|bamboo_block|stripped_bamboo_block|deepslate|muddy_mangrove_roots|chain)$/;

/** Whether a block has an `axis` property (logs, pillars …). */
export function hasAxis(blockId: string): boolean {
  return AXIS_BLOCK.test(blockId.slice(blockId.indexOf(':') + 1));
}

/**
 * Bau-Sprache 1: fills in the properties a placed block has in the game. Frozen: tess 1 files
 * must give exactly the result of version 0.3.0.
 */
export function completeStateV1(s: BlockState): BlockState {
  const n = id(s);
  const p: Record<string, string> = { ...s.props };
  const def = (k: string, v: string) => {
    p[k] ??= v;
  };
  if (n.endsWith('_stairs')) {
    def('facing', 'north');
    def('half', 'bottom');
    def('shape', 'straight');
    def('waterlogged', 'false');
  } else if (n.endsWith('_slab')) {
    def('type', 'bottom');
    def('waterlogged', 'false');
  } else if (n.endsWith('_fence_gate')) {
    def('facing', 'north');
    def('in_wall', 'false');
    def('open', 'false');
    def('powered', 'false');
  } else if (n.endsWith('_fence') || n.endsWith('_pane') || n === 'iron_bars') {
    for (const f of FACINGS) def(f, 'false');
    def('waterlogged', 'false');
  } else if (isWall(s)) {
    for (const f of FACINGS) def(f, 'none');
    def('up', 'true');
    def('waterlogged', 'false');
  } else if (n.endsWith('_trapdoor')) {
    def('facing', 'north');
    def('half', 'bottom');
    def('open', 'false');
    def('powered', 'false');
    def('waterlogged', 'false');
  } else if (n.endsWith('_door')) {
    def('facing', 'north');
    def('half', 'lower');
    def('hinge', 'left');
    def('open', 'false');
    def('powered', 'false');
  } else if (hasAxis(s.name)) {
    def('axis', 'y');
  } else if (n === 'lantern' || n === 'soul_lantern') {
    def('hanging', 'false');
    def('waterlogged', 'false');
  }
  return makeState(s.name, p);
}

const SIX = ['north', 'east', 'south', 'west', 'up', 'down'];
const CANDLE = /(^|_)candle$/;

/**
 * Bau-Sprache 2: like version 1, plus the blocks the new instructions and the freestyle
 * commands place (buttons, plates, leaves, ladders, vines, torches, chains …). Given
 * properties stay; nothing a version 1 file contains changes meaning.
 */
export function completeState(s: BlockState): BlockState {
  const n = id(s);
  const vanilla = s.name.startsWith('minecraft:');
  const p: Record<string, string> = { ...s.props };
  const def = (k: string, v: string) => {
    p[k] ??= v;
  };
  if (n.endsWith('_leaves')) {
    // Leaves set by the compiler never decay.
    def('distance', '7');
    p.persistent = 'true';
    def('waterlogged', 'false');
    return makeState(s.name, p);
  }
  if (n.endsWith('_button')) {
    def('face', 'wall');
    def('facing', 'north');
    def('powered', 'false');
    return makeState(s.name, p);
  }
  if (n.endsWith('_pressure_plate')) {
    if (n === 'light_weighted_pressure_plate' || n === 'heavy_weighted_pressure_plate') def('power', '0');
    else def('powered', 'false');
    return makeState(s.name, p);
  }
  if (vanilla) {
    switch (n) {
      case 'ladder':
        def('facing', 'north');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'vine':
        for (const f of ['north', 'east', 'south', 'west', 'up']) def(f, 'false');
        return makeState(s.name, p);
      case 'glow_lichen':
        for (const f of SIX) def(f, 'false');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'wall_torch':
      case 'soul_wall_torch':
        def('facing', 'north');
        return makeState(s.name, p);
      case 'redstone_wall_torch':
        def('facing', 'north');
        def('lit', 'true');
        return makeState(s.name, p);
      case 'redstone_torch':
        def('lit', 'true');
        return makeState(s.name, p);
      case 'chain':
        def('axis', 'y');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'lightning_rod':
        def('facing', 'up');
        def('powered', 'false');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'end_rod':
        def('facing', 'up');
        return makeState(s.name, p);
      case 'campfire':
      case 'soul_campfire':
        def('facing', 'north');
        def('lit', 'true');
        def('signal_fire', 'false');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'farmland':
        def('moisture', '7');
        return makeState(s.name, p);
      case 'water':
      case 'lava':
        def('level', '0');
        return makeState(s.name, p);
      case 'snow':
        def('layers', '1');
        return makeState(s.name, p);
      case 'grass_block':
      case 'podzol':
      case 'mycelium':
        def('snowy', 'false');
        return makeState(s.name, p);
      case 'flower_pot':
        return makeState(s.name, p);
      case 'hay_block':
        def('axis', 'y');
        return makeState(s.name, p);
      case 'sea_pickle':
        def('pickles', '1');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'bell':
        def('attachment', 'floor');
        def('facing', 'north');
        def('powered', 'false');
        return makeState(s.name, p);
      case 'barrel':
        def('facing', 'up');
        def('open', 'false');
        return makeState(s.name, p);
      case 'chest':
      case 'trapped_chest':
        def('facing', 'north');
        def('type', 'single');
        def('waterlogged', 'false');
        return makeState(s.name, p);
      case 'iron_bars':
        break;
      case 'bamboo':
        def('age', '0');
        def('leaves', 'none');
        def('stage', '0');
        return makeState(s.name, p);
      case 'big_dripleaf':
      case 'small_dripleaf':
        break;
      // Plants and crops (Bau-Sprache 2: fields, flower boxes, scattered plants).
      case 'wheat':
      case 'carrots':
      case 'potatoes':
      case 'beetroots':
      case 'melon_stem':
      case 'pumpkin_stem':
      case 'torchflower_crop':
      case 'pitcher_crop':
      case 'sweet_berry_bush':
      case 'nether_wart':
      case 'cactus':
      case 'sugar_cane':
        def('age', '0');
        if (n === 'pitcher_crop') def('half', 'lower');
        return makeState(s.name, p);
      case 'sunflower':
      case 'lilac':
      case 'rose_bush':
      case 'peony':
      case 'tall_grass':
      case 'large_fern':
      case 'pitcher_plant':
        def('half', 'lower');
        return makeState(s.name, p);
      case 'pink_petals':
        def('facing', 'north');
        def('flower_amount', '1');
        return makeState(s.name, p);
      case 'composter':
        def('level', '0');
        return makeState(s.name, p);
      case 'cauldron':
        return makeState(s.name, p);
      case 'water_cauldron':
      case 'powder_snow_cauldron':
        def('level', '3');
        return makeState(s.name, p);
      case 'anvil':
      case 'chipped_anvil':
      case 'damaged_anvil':
        def('facing', 'north');
        return makeState(s.name, p);
      case 'furnace':
      case 'smoker':
      case 'blast_furnace':
        def('facing', 'north');
        def('lit', 'false');
        return makeState(s.name, p);
      case 'grindstone':
        def('face', 'floor');
        def('facing', 'north');
        return makeState(s.name, p);
      case 'beehive':
      case 'bee_nest':
        def('facing', 'north');
        def('honey_level', '0');
        return makeState(s.name, p);
      case 'scaffolding':
        def('bottom', 'false');
        def('distance', '0');
        def('waterlogged', 'false');
        return makeState(s.name, p);
    }
    if (CANDLE.test(n)) {
      def('candles', '1');
      def('lit', 'false');
      def('waterlogged', 'false');
      return makeState(s.name, p);
    }
    if (n.endsWith('_wall_banner')) {
      def('facing', 'north');
      return makeState(s.name, p);
    }
    if (n.endsWith('_banner')) {
      def('rotation', '0');
      return makeState(s.name, p);
    }
    if (n.endsWith('_wall_sign') || n.endsWith('_wall_hanging_sign')) {
      def('facing', 'north');
      def('waterlogged', 'false');
      return makeState(s.name, p);
    }
    if (n.endsWith('_hanging_sign')) {
      def('attached', 'false');
      def('rotation', '0');
      def('waterlogged', 'false');
      return makeState(s.name, p);
    }
    if (n.endsWith('_sign')) {
      def('rotation', '0');
      def('waterlogged', 'false');
      return makeState(s.name, p);
    }
  }
  return completeStateV1(makeState(s.name, p));
}

// ---------------------------------------------------------------------------

const KIND_NONE = 0;
const KIND_STAIRS = 1;
const KIND_FENCE = 2;
const KIND_BARS = 3;
const KIND_WALL = 4;

function kindOf(s: BlockState): number {
  if (isStairs(s)) return KIND_STAIRS;
  if (isFence(s)) return KIND_FENCE;
  if (isBars(s)) return KIND_BARS;
  if (isWall(s)) return KIND_WALL;
  return KIND_NONE;
}

/**
 * Completes all states and computes connections and stair shapes on the finished grid.
 * `version` picks the completion table (1: frozen state of version 0.3.0). Only cells with
 * connecting blocks are looked at, together with their neighbours.
 */
export function connectBlocks(grid: Grid, version: 1 | 2 = 2): void {
  const complete = version === 1 ? completeStateV1 : completeState;
  // 1. Complete every state once, then rewrite the cells.
  const count = grid.states.length;
  const remap = new Uint16Array(count);
  for (let i = 1; i < count; i++) remap[i] = grid.stateId(complete(grid.states[i]));
  for (const c of grid.chunks.values()) {
    if (c.count === 0) continue;
    const ids = c.ids;
    for (let i = 0; i < ids.length; i++) if (ids[i] !== 0) ids[i] = remap[ids[i]];
  }

  // 2. Find connecting blocks (by state, not per cell).
  const kinds = new Uint8Array(grid.states.length);
  let any = false;
  for (let i = 1; i < grid.states.length; i++) {
    kinds[i] = kindOf(grid.states[i]);
    if (kinds[i]) any = true;
  }
  if (!any) return;

  // Stairs depend on their neighbours' facing and half only, fences and panes on neighbour
  // types: both are order-independent. Walls look at the wall above, so they go top-down.
  const walls: number[] = [];
  const updates: [number, number, number, BlockState][] = [];
  grid.forEach((x, y, z, sid) => {
    const k = kinds[sid];
    if (k === KIND_NONE) return;
    const s = grid.states[sid];
    if (k === KIND_STAIRS) {
      const shape = stairShape(s, grid, x, y, z);
      if (shape !== s.props.shape) updates.push([x, y, z, makeState(s.name, { ...s.props, shape })]);
    } else if (k === KIND_FENCE || k === KIND_BARS) {
      const props: Record<string, string> = { ...s.props };
      for (const f of FACINGS) {
        const [dx, dz] = DIR[f];
        const n = grid.get(x + dx, y, z + dz);
        props[f] = String(k === KIND_FENCE ? fenceConnects(s, n, f) : barsConnect(n, f));
      }
      updates.push([x, y, z, makeState(s.name, props)]);
    } else {
      walls.push(x, y, z);
    }
  });
  for (const [x, y, z, s] of updates) grid.replace(x, y, z, s);
  const order = Array.from({ length: walls.length / 3 }, (_, i) => i).sort((a, b) => walls[b * 3 + 1] - walls[a * 3 + 1]);
  for (const i of order) {
    const x = walls[i * 3];
    const y = walls[i * 3 + 1];
    const z = walls[i * 3 + 2];
    const s = grid.get(x, y, z)!;
    grid.replace(x, y, z, makeState(s.name, wallState(s, grid, x, y, z)));
  }
}
