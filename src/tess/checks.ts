import type { BlockState } from '../core/blockstate';
import { sturdyFace } from './connect';
import { DIR, opposite, type Facing } from './geometry';
import { infoOrigin, type Grid } from './grid';
import type { Diagnostic } from './syntax';

/**
 * Checks after compiling (Bau-Sprache 2, 11): blocks without the support the game needs (Halt),
 * groups of blocks that touch nothing that stands on the ground (Schweben) and water or lava
 * that would flow away (Fließen). They run on the finished grid with complete states.
 *
 * Schweben counts blocks as connected when they share a face or an edge (18-neighbourhood):
 * roofs of stairs, tapering walls and railings only touch along edges, and the game holds them
 * all the same. With faces only, every stair roof would be reported.
 */

const CHUNK = 16;
const CELLS = CHUNK * CHUNK * CHUNK;

const name = (s: BlockState): string => (s.name.startsWith('minecraft:') ? s.name.slice(10) : '');

// ---------------------------------------------------------------------------
// Halt

type Rule =
  | { kind: 'below'; label: string; posts: boolean; any: boolean }
  | { kind: 'above'; label: string }
  | { kind: 'behind'; label: string; sturdy: boolean }
  | { kind: 'sides'; label: string }
  | { kind: 'soil'; label: string; soil: (below: string, s: BlockState | null) => boolean }
  | { kind: 'gravity'; label: string }
  | { kind: 'upperHalf'; label: string };

const DIRT = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'moss_block', 'mud', 'muddy_mangrove_roots']);
const CROPS: Record<string, string> = {
  wheat: 'Weizen',
  carrots: 'Karotten',
  potatoes: 'Kartoffeln',
  beetroots: 'Rote Bete',
  melon_stem: 'Melonenstiel',
  pumpkin_stem: 'Kürbisstiel',
  torchflower_crop: 'Fackellilie',
  pitcher_crop: 'Kannenpflanze',
};
const FLOWERS = new Set([
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'torchflower',
  'short_grass',
  'fern',
  'pink_petals',
  'oak_sapling',
  'spruce_sapling',
  'birch_sapling',
  'jungle_sapling',
  'acacia_sapling',
  'dark_oak_sapling',
  'cherry_sapling',
  'azalea',
  'flowering_azalea',
]);
const DOUBLE_PLANTS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'pitcher_plant']);
const GRAVITY = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|[a-z_]+_concrete_powder)$/;

function ruleOf(s: BlockState): Rule | null {
  const n = name(s);
  if (!n) return null;
  if (n === 'lantern' || n === 'soul_lantern') {
    return s.props.hanging === 'true' ? { kind: 'above', label: 'Die hängende Laterne' } : { kind: 'below', label: 'Die Laterne', posts: true, any: false };
  }
  if (n === 'torch' || n === 'soul_torch' || n === 'redstone_torch') return { kind: 'below', label: 'Die Fackel', posts: true, any: false };
  if (n === 'wall_torch' || n === 'soul_wall_torch' || n === 'redstone_wall_torch') return { kind: 'behind', label: 'Die Wandfackel', sturdy: true };
  if (n.endsWith('_carpet')) return { kind: 'below', label: 'Der Teppich', posts: false, any: true };
  if (n.endsWith('_pressure_plate')) return { kind: 'below', label: 'Die Druckplatte', posts: true, any: false };
  if (n === 'rail' || n === 'powered_rail' || n === 'detector_rail' || n === 'activator_rail') return { kind: 'below', label: 'Die Schiene', posts: false, any: false };
  if (/(^|_)candle$/.test(n)) return { kind: 'below', label: 'Die Kerze', posts: true, any: false };
  if (n.endsWith('_wall_sign')) return { kind: 'behind', label: 'Das Wandschild', sturdy: false };
  if (n.endsWith('_wall_hanging_sign')) return null;
  if (n.endsWith('_hanging_sign')) return { kind: 'above', label: 'Das Hängeschild' };
  if (n.endsWith('_sign')) return { kind: 'below', label: 'Das Schild', posts: false, any: true };
  if (n.endsWith('_wall_banner')) return { kind: 'behind', label: 'Das Banner', sturdy: false };
  if (n.endsWith('_banner')) return { kind: 'below', label: 'Das Banner', posts: false, any: true };
  if (n === 'ladder') return { kind: 'behind', label: 'Die Leiter', sturdy: true };
  if (n.endsWith('_button')) {
    if (s.props.face === 'floor') return { kind: 'below', label: 'Der Knopf', posts: false, any: false };
    if (s.props.face === 'ceiling') return { kind: 'above', label: 'Der Knopf' };
    return { kind: 'behind', label: 'Der Knopf', sturdy: true };
  }
  if (n === 'vine') return { kind: 'sides', label: 'Die Ranke' };
  if (n === 'glow_lichen') return { kind: 'sides', label: 'Die Leuchtflechte' };
  if (n.endsWith('_door')) return s.props.half === 'upper' ? null : { kind: 'below', label: 'Die Tür', posts: false, any: true };
  if (CROPS[n]) return { kind: 'soil', label: CROPS[n], soil: (b) => b === 'farmland' };
  if (DOUBLE_PLANTS.has(n)) {
    if (s.props.half === 'upper') return { kind: 'upperHalf', label: 'Die Pflanze' };
    return { kind: 'soil', label: 'Die Pflanze', soil: (b) => DIRT.has(b) || b === 'farmland' };
  }
  if (FLOWERS.has(n) || n === 'sweet_berry_bush') return { kind: 'soil', label: 'Die Pflanze', soil: (b) => DIRT.has(b) || b === 'farmland' };
  if (n === 'brown_mushroom' || n === 'red_mushroom') return { kind: 'soil', label: 'Der Pilz', soil: (b, st) => b === 'mycelium' || b === 'podzol' || sturdyFace(st, 'up') };
  if (n === 'nether_wart') return { kind: 'soil', label: 'Die Netherwarze', soil: (b) => b === 'soul_sand' };
  if (n === 'cactus') return { kind: 'soil', label: 'Der Kaktus', soil: (b) => b === 'sand' || b === 'red_sand' || b === 'cactus' };
  if (n === 'sugar_cane') return { kind: 'soil', label: 'Das Zuckerrohr', soil: (b) => b === 'sugar_cane' || b === 'sand' || b === 'red_sand' || DIRT.has(b) };
  if (n === 'dead_bush') return { kind: 'soil', label: 'Der tote Busch', soil: (b) => b === 'sand' || b === 'red_sand' || b.endsWith('terracotta') || DIRT.has(b) };
  if (n === 'lily_pad') return { kind: 'soil', label: 'Das Seerosenblatt', soil: (b) => b === 'water' };
  if (n === 'bamboo') return { kind: 'soil', label: 'Der Bambus', soil: (b) => b === 'bamboo' || DIRT.has(b) || b === 'sand' || b === 'red_sand' || b === 'gravel' };
  if (GRAVITY.test(n)) return { kind: 'gravity', label: n.includes('anvil') ? 'Der Amboss' : n.includes('powder') ? 'Das Betonpulver' : n.includes('gravel') ? 'Der Kies' : 'Der Sand' };
  return null;
}

const isPost = (s: BlockState | null): boolean => {
  if (!s) return false;
  const n = name(s) || s.name;
  return n.endsWith('_fence') || (n.endsWith('_wall') && !n.endsWith('_sign') && !n.endsWith('_banner')) || (n.endsWith('chain') && (s.props.axis ?? 'y') === 'y');
};

const FACE_KEYS: Record<string, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

function supported(grid: Grid, x: number, y: number, z: number, s: BlockState, rule: Rule, minY: number): string | null {
  // The lowest layer stands on the ground (terrain is not part of the plan).
  if (y === minY && (rule.kind === 'below' || rule.kind === 'soil' || rule.kind === 'gravity')) return null;
  switch (rule.kind) {
    case 'below': {
      const b = grid.get(x, y - 1, z);
      if (rule.any ? !!b : sturdyFace(b, 'up') || (rule.posts && isPost(b))) return null;
      return rule.any ? 'darunter fehlt ein Block' : 'darunter fehlt ein Block mit voller Oberseite';
    }
    case 'above': {
      const a = grid.get(x, y + 1, z);
      if (sturdyFace(a, 'down') || isPost(a) || (a !== null && /(_pane|iron_bars)$/.test(a.name))) return null;
      return 'darüber fehlt ein Block, an dem sie hängt';
    }
    case 'behind': {
      const f = (s.props.facing ?? 'north') as Facing;
      const [dx, dz] = DIR[opposite(f)];
      const b = grid.get(x + dx, y, z + dz);
      if (rule.sturdy ? sturdyFace(b, f) : !!b) return null;
      return 'dahinter fehlt der Block, an dem es hängt';
    }
    case 'sides': {
      for (const [k, [dx, dy, dz]] of Object.entries(FACE_KEYS)) if (s.props[k] === 'true' && grid.has(x + dx, y + dy, z + dz)) return null;
      return 'an keiner ihrer Seiten ist ein Block';
    }
    case 'soil': {
      const b = grid.get(x, y - 1, z);
      if (b && rule.soil(name(b) || b.name, b)) return null;
      return 'darunter fehlt passender Boden';
    }
    case 'gravity':
      return grid.has(x, y - 1, z) ? null : 'darunter ist Luft, er fällt herunter';
    case 'upperHalf': {
      const b = grid.get(x, y - 1, z);
      return b && b.name === s.name && b.props.half === 'lower' ? null : 'die untere Hälfte fehlt';
    }
  }
}

// ---------------------------------------------------------------------------

interface ChunkRef {
  ids: Uint16Array;
  info: Uint32Array;
  bx: number;
  by: number;
  bz: number;
}

/** Runs the checks of section 11 and returns their hints. */
export function runChecks(grid: Grid, opts: { floating: boolean; label: (line: number) => string }): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (grid.size === 0) return out;
  const states = grid.states;
  // Per state: halt rule, liquid.
  const rules: (Rule | null)[] = states.map((s, i) => (i === 0 ? null : ruleOf(s)));
  const liquid = states.map((s, i) => i > 0 && (s.name === 'minecraft:water' || s.name === 'minecraft:lava'));
  const bounds = grid.bounds()!;
  const minY = bounds.min[1];

  const halt = new Map<string, { line: number; label: string; why: string; first: [number, number, number]; n: number }>();
  const flow = new Map<number, { first: [number, number, number]; n: number; lava: boolean }>();
  grid.forEach((x, y, z, sid, info) => {
    const rule = rules[sid];
    if (rule) {
      const s = states[sid];
      const why = supported(grid, x, y, z, s, rule, minY);
      if (why) {
        const line = grid.origins[infoOrigin(info)]?.line ?? 0;
        const key = `${line}|${rule.label}|${why}`;
        const e = halt.get(key);
        if (e) e.n++;
        else halt.set(key, { line, label: rule.label, why, first: [x, y, z], n: 1 });
      }
    }
    if (liquid[sid]) {
      let open = false;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (!grid.has(x + dx, y, z + dz)) open = true;
      if (y > minY && !grid.has(x, y - 1, z)) open = true;
      if (open) {
        const line = grid.origins[infoOrigin(info)]?.line ?? 0;
        const e = flow.get(line);
        if (e) e.n++;
        else flow.set(line, { first: [x, y, z], n: 1, lava: states[sid].name === 'minecraft:lava' });
      }
    }
  });
  for (const e of halt.values()) {
    out.push({
      line: e.line,
      level: 'warn',
      message: `Halt: ${e.label} bei ${e.first.join(',')} hat keinen Halt (${e.why})${e.n > 1 ? `; ebenso ${e.n - 1} weitere aus dieser Zeile` : ''}.`,
    });
  }
  for (const [line, e] of flow) {
    out.push({
      line,
      level: 'warn',
      message: `Fließen: ${e.lava ? 'Die Lava' : 'Das Wasser'} bei ${e.first.join(',')} fließt aus (daneben oder darunter ist Luft)${e.n > 1 ? `; ebenso ${e.n - 1} weitere Zellen aus dieser Zeile` : ''}.`,
    });
  }
  if (opts.floating) out.push(...floatingGroups(grid, minY, opts.label));
  return out;
}

/**
 * Schweben: groups of blocks (sharing a face or an edge) without a block in the lowest layer of
 * the project. Works per chunk with flat arrays: a breadth-first fill from all blocks of the
 * lowest layer, then one fill per group that is left.
 */
function floatingGroups(grid: Grid, minY: number, label: (line: number) => string): Diagnostic[] {
  const chunks: ChunkRef[] = [];
  const index = new Map<string, number>();
  for (const c of grid.chunks.values()) {
    if (c.count === 0) continue;
    index.set(`${c.cx},${c.cy},${c.cz}`, chunks.length);
    chunks.push({ ids: c.ids, info: c.info, bx: c.cx * CHUNK, by: c.cy * CHUNK, bz: c.cz * CHUNK });
  }
  const n = chunks.length;
  // Neighbour chunks: 27 per chunk (-1 = none).
  const nb = new Int32Array(n * 27).fill(-1);
  chunks.forEach((c, i) => {
    const cx = c.bx / CHUNK;
    const cy = c.by / CHUNK;
    const cz = c.bz / CHUNK;
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = index.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (j !== undefined) nb[i * 27 + (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1)] = j;
        }
  });
  const seen = chunks.map(() => new Uint8Array(CELLS));
  const offsets: [number, number, number][] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (m === 0 || m === 3) continue;
        offsets.push([dx, dy, dz]);
      }
  let queue = new Int32Array(1 << 16);
  let qn = 0;
  const push = (ci: number, li: number) => {
    if (qn >= queue.length) {
      const q2 = new Int32Array(queue.length * 2);
      q2.set(queue);
      queue = q2;
    }
    queue[qn++] = ci * CELLS + li;
  };
  /** Fills from the queued cells; calls visit for every cell reached. */
  const fill = (visit: (ci: number, li: number) => void) => {
    for (let qi = 0; qi < qn; qi++) {
      const v = queue[qi];
      const ci = Math.floor(v / CELLS);
      const li = v - ci * CELLS;
      visit(ci, li);
      const lx = li & 15;
      const lz = (li >> 4) & 15;
      const ly = li >> 8;
      for (const [dx, dy, dz] of offsets) {
        let nx = lx + dx;
        let ny = ly + dy;
        let nz = lz + dz;
        let cj = ci;
        if (nx < 0 || nx > 15 || ny < 0 || ny > 15 || nz < 0 || nz > 15) {
          const sx = nx < 0 ? -1 : nx > 15 ? 1 : 0;
          const sy = ny < 0 ? -1 : ny > 15 ? 1 : 0;
          const sz = nz < 0 ? -1 : nz > 15 ? 1 : 0;
          cj = nb[ci * 27 + (sy + 1) * 9 + (sz + 1) * 3 + (sx + 1)];
          if (cj < 0) continue;
          nx -= sx * 16;
          ny -= sy * 16;
          nz -= sz * 16;
        }
        const lj = (ny << 8) | (nz << 4) | nx;
        if (chunks[cj].ids[lj] === 0 || seen[cj][lj]) continue;
        seen[cj][lj] = 1;
        push(cj, lj);
      }
    }
  };
  // 1. Everything connected to the lowest layer.
  chunks.forEach((c, ci) => {
    if (minY < c.by || minY >= c.by + CHUNK) return;
    const ly = minY - c.by;
    for (let li = ly << 8; li < (ly + 1) << 8; li++) {
      if (c.ids[li] === 0 || seen[ci][li]) continue;
      seen[ci][li] = 1;
      push(ci, li);
    }
  });
  fill(() => {});
  // 2. The groups that are left.
  const out: Diagnostic[] = [];
  const groups: { size: number; box: number[]; lines: Map<number, number> }[] = [];
  chunks.forEach((c, ci) => {
    for (let li = 0; li < CELLS; li++) {
      if (c.ids[li] === 0 || seen[ci][li]) continue;
      seen[ci][li] = 1;
      qn = 0;
      push(ci, li);
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const lines = new Map<number, number>();
      let size = 0;
      fill((cj, lj) => {
        const ch = chunks[cj];
        const x = ch.bx + (lj & 15);
        const y = ch.by + (lj >> 8);
        const z = ch.bz + ((lj >> 4) & 15);
        size++;
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (z < box[2]) box[2] = z;
        if (x > box[3]) box[3] = x;
        if (y > box[4]) box[4] = y;
        if (z > box[5]) box[5] = z;
        const line = grid.origins[infoOrigin(ch.info[lj])]?.line ?? 0;
        lines.set(line, (lines.get(line) ?? 0) + 1);
      });
      groups.push({ size, box, lines });
    }
  });
  groups.sort((a, b) => b.size - a.size);
  for (const g of groups) {
    const top = [...g.lines].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const where = g.size === 1 ? `bei ${g.box[0]},${g.box[1]},${g.box[2]}` : `von ${g.box[0]},${g.box[1]},${g.box[2]} bis ${g.box[3]},${g.box[4]},${g.box[5]}`;
    out.push({
      line: top[0][0],
      level: 'warn',
      message: `Schweben: ${g.size === 1 ? 'Ein Block' : `${g.size} Blöcke`} ${where} ${g.size === 1 ? 'hat' : 'haben'} keine Verbindung zum Boden (unterste Lage y=${minY}); die meisten aus ${top.map(([l, k]) => `${label(l)} (${k})`).join(', ')}.`,
    });
  }
  return out;
}
