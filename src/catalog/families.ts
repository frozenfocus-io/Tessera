import type { BlockRole, CatalogBlock, Family, Recipe } from './types';

/**
 * Block families (stone bricks with their stairs, slab and wall). Tessera needs them so that a
 * palette swap takes the stairs and slabs along. The role comes from tags or the id; the base
 * block from the recipes that make the variant, or from the id when there is no usable recipe.
 */

export const TAG_ROLES: Record<string, BlockRole> = {
  'minecraft:stairs': 'stairs',
  'minecraft:slabs': 'slab',
  'minecraft:walls': 'wall',
  'minecraft:fences': 'fence',
  'minecraft:fence_gates': 'fence_gate',
  'minecraft:doors': 'door',
  'minecraft:trapdoors': 'trapdoor',
  'minecraft:buttons': 'button',
  'minecraft:pressure_plates': 'pressure_plate',
  'minecraft:wool_carpets': 'carpet',
  'c:glass_panes': 'pane',
  'minecraft:logs': 'log',
};

const SUFFIX_ROLES: [string, BlockRole][] = [
  ['_fence_gate', 'fence_gate'],
  ['_pressure_plate', 'pressure_plate'],
  ['_trapdoor', 'trapdoor'],
  ['_stairs', 'stairs'],
  ['_slab', 'slab'],
  ['_wall', 'wall'],
  ['_fence', 'fence'],
  ['_door', 'door'],
  ['_button', 'button'],
  ['_pane', 'pane'],
  ['_carpet', 'carpet'],
];

/** Variant roles that hang off a base block. */
const VARIANT_ROLES = new Set<BlockRole>(['stairs', 'slab', 'wall', 'fence', 'fence_gate', 'door', 'trapdoor', 'button', 'pressure_plate', 'pane', 'carpet']);

export function roleFromId(id: string): BlockRole {
  const path = id.slice(id.indexOf(':') + 1);
  for (const [suffix, role] of SUFFIX_ROLES) if (path.endsWith(suffix)) return role;
  if (/(_log|_stem|_wood|_hyphae)$/.test(path)) return 'log';
  return 'block';
}

/** Base block candidates from the id: "stone_brick_stairs" -> stone_bricks, stone_brick, … */
export function baseCandidates(id: string, role: BlockRole): string[] {
  const i = id.indexOf(':');
  const ns = id.slice(0, i);
  const path = id.slice(i + 1);
  const suffix = SUFFIX_ROLES.find(([, r]) => r === role)?.[0] ?? '';
  if (!suffix || !path.endsWith(suffix)) return [];
  const stem = path.slice(0, -suffix.length);
  const names = [
    stem,
    `${stem}s`,
    `${stem}_planks`,
    `${stem}_block`,
    stem.replace(/_brick$/, '_bricks'),
    stem.replace(/_tile$/, '_tiles'),
    stem.replace(/^(.*)_(\w+)$/, '$1_$2s'),
  ];
  const out: string[] = [];
  for (const n of names) for (const space of [ns, 'minecraft']) out.push(`${space}:${n}`);
  return [...new Set(out)];
}

export function buildFamilies(blocks: Record<string, CatalogBlock>, recipes: readonly Recipe[]): Record<string, Family> {
  // item id -> block id, for recipes that name items
  const blockOfItem = new Map<string, string>();
  for (const [id, b] of Object.entries(blocks)) if (b.item && !blockOfItem.has(b.item)) blockOfItem.set(b.item, id);
  const byOutput = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const list = byOutput.get(r.output.item);
    if (list) list.push(r);
    else byOutput.set(r.output.item, [r]);
  }

  const baseOf = (id: string, b: CatalogBlock): string | null => {
    // 1. A recipe that turns exactly one block into this variant (stonecutter, saw) …
    const own = b.item ? (byOutput.get(b.item) ?? []) : [];
    const candidates: { block: string; score: number }[] = [];
    for (const r of own) {
      for (const ing of r.inputs) {
        if (ing.options.length !== 1 || ing.options[0].startsWith('#')) continue;
        const block = blockOfItem.get(ing.options[0]);
        if (!block || block === id) continue;
        const role = blocks[block]?.role;
        if (role && VARIANT_ROLES.has(role)) continue;
        const single = r.inputs.length === 1;
        candidates.push({ block, score: (single ? 10 : 0) + ing.count });
      }
    }
    candidates.sort((a, b2) => b2.score - a.score);
    if (candidates.length) return candidates[0].block;
    // 2. … otherwise the id: stone_brick_stairs -> stone_bricks.
    for (const c of baseCandidates(id, b.role)) {
      const cb = blocks[c];
      if (cb && !VARIANT_ROLES.has(cb.role)) return c;
    }
    return null;
  };

  const families: Record<string, Family> = {};
  for (const [id, b] of Object.entries(blocks)) {
    if (!VARIANT_ROLES.has(b.role)) continue;
    const base = baseOf(id, b);
    if (!base) continue;
    b.family = base;
    const fam = (families[base] ??= { base, members: { block: base } });
    if (!fam.members[b.role] || id.startsWith('minecraft:')) fam.members[b.role] = id;
    blocks[base].family = base;
  }
  return families;
}
