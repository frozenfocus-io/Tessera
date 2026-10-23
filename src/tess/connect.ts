import { makeState, shortName, type BlockState } from '../core/blockstate';
import { resolveShape } from '../blocks/shapes';
import { ccw, DIR, FACINGS, opposite, type Facing } from './geometry';
import { keyToCell, type Grid } from './grid';

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
 * Fills in the properties a placed block has in the game, so every state is complete
 * (waterlogged=false, closed doors, unpowered trapdoors …). Given properties stay.
 */
export function completeState(s: BlockState): BlockState {
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

/** Completes all states and computes connections and stair shapes on the finished grid. */
export function connectBlocks(grid: Grid): void {
  const completed = new Map<number, BlockState>();
  for (const [k, i] of grid.cells) {
    let c = completed.get(i);
    if (!c) {
      c = completeState(grid.states[i]);
      completed.set(i, c);
    }
    if (c !== grid.states[i]) grid.replace(k, c);
  }

  // Stairs depend on their neighbours' facing and half only, fences and panes on neighbour
  // types: both are order-independent. Walls look at the wall above, so they go top-down.
  const walls: number[] = [];
  const updates: [number, BlockState][] = [];
  for (const [k, i] of grid.cells) {
    const s = grid.states[i];
    const [x, y, z] = keyToCell(k);
    if (isStairs(s)) {
      const shape = stairShape(s, grid, x, y, z);
      if (shape !== s.props.shape) updates.push([k, makeState(s.name, { ...s.props, shape })]);
    } else if (isFence(s) || isBars(s)) {
      const props: Record<string, string> = { ...s.props };
      for (const f of FACINGS) {
        const [dx, dz] = DIR[f];
        const n = grid.get(x + dx, y, z + dz);
        props[f] = String(isFence(s) ? fenceConnects(s, n, f) : barsConnect(n, f));
      }
      updates.push([k, makeState(s.name, props)]);
    } else if (isWall(s)) {
      walls.push(k);
    }
  }
  for (const [k, s] of updates) grid.replace(k, s);
  walls.sort((a, b) => keyToCell(b)[1] - keyToCell(a)[1]);
  for (const k of walls) {
    const [x, y, z] = keyToCell(k);
    const s = grid.states[grid.cells.get(k)!];
    grid.replace(k, makeState(s.name, wallState(s, grid, x, y, z)));
  }
}
