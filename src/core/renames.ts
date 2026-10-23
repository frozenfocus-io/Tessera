import { makeState, type BlockState } from './blockstate';

/**
 * Renames between Minecraft versions, so files from other versions map onto the
 * target version (1.21.1). Only blocks that buildings realistically contain are covered;
 * anything else stays as is and is reported as unknown by the block rules.
 */
interface RenameRule {
  /** Applies when the file's data version is below this value. */
  before?: number;
  /** Applies when the file's data version is at least this value. */
  since?: number;
  from: string;
  to: string;
}

const RULES: RenameRule[] = [
  // 1.14 (1952): signs got wood types, the old stone slab became the smooth stone slab.
  { before: 1952, from: 'minecraft:sign', to: 'minecraft:oak_sign' },
  { before: 1952, from: 'minecraft:wall_sign', to: 'minecraft:oak_wall_sign' },
  { before: 1952, from: 'minecraft:stone_slab', to: 'minecraft:smooth_stone_slab' },
  // 1.17 (2724)
  { before: 2724, from: 'minecraft:grass_path', to: 'minecraft:dirt_path' },
  // 1.20.3 (3698)
  { before: 3698, from: 'minecraft:grass', to: 'minecraft:short_grass' },
  // Newer files (1.21.9+): the plain chain became the iron chain.
  { since: 4554, from: 'minecraft:iron_chain', to: 'minecraft:chain' },
];

const WALL_SIDES = ['north', 'east', 'south', 'west'] as const;

export interface RenameResult {
  state: BlockState;
  renamedFrom?: string;
}

export function applyRenames(state: BlockState, dataVersion: number | null): RenameResult {
  const dv = dataVersion ?? 0;
  let name = state.name;
  const props: Record<string, string> = { ...state.props };
  let changed = false;

  for (const r of RULES) {
    if (r.from !== name) continue;
    if (r.before !== undefined && !(dataVersion !== null && dv < r.before)) continue;
    if (r.since !== undefined && !(dataVersion !== null && dv >= r.since)) continue;
    name = r.to;
    changed = true;
  }

  // 1.16 (2566): wall sides changed from true/false to none/low/tall.
  if (name.endsWith('_wall')) {
    for (const side of WALL_SIDES) {
      const v = props[side];
      if (v === 'true') {
        props[side] = 'low';
        changed = true;
      } else if (v === 'false') {
        props[side] = 'none';
        changed = true;
      }
    }
  }

  if (!changed) return { state };
  const next = makeState(name, props);
  return next.key === state.key ? { state } : { state: next, renamedFrom: state.key };
}
