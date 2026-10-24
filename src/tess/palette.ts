import { normalizeName, parseBlockState, type BlockState } from '../core/blockstate';
import { asciiKey, FollowUpError, TessError, type Statement, type Token } from './syntax';

/**
 * Role palettes: a building names roles (mauer, dach, rahmen …) and the file maps each role to
 * one or more blocks, optionally weighted ("70 % Steinziegel, 20 % rissig, 10 % bemoost").
 * Bauteile ask a role for a member of its family (block, stairs, slab, wall, fence …), so a
 * palette swap takes stairs and slabs along. Roles exist only inside their file; block ids are
 * resolved at once, nothing outside the compiler sees a role name.
 */

export type Member =
  | 'block'
  | 'stairs'
  | 'slab'
  | 'wall'
  | 'fence'
  | 'fence_gate'
  | 'trapdoor'
  | 'door'
  | 'button'
  | 'pressure_plate'
  | 'pane'
  | 'carpet';

/** Member names in the language (Bau-Sprache 2). */
export const MEMBER_KEYS: Record<string, Member> = {
  block: 'block',
  treppe: 'stairs',
  stufe: 'slab',
  mauer: 'wall',
  zaun: 'fence',
  zauntor: 'fence_gate',
  falltuer: 'trapdoor',
  tuer: 'door',
  knopf: 'button',
  druckplatte: 'pressure_plate',
  scheibe: 'pane',
  teppich: 'carpet',
};
const V1_MEMBER_KEYS: Record<string, Member> = { treppe: 'stairs', stufe: 'slab', mauer: 'wall', zaun: 'fence' };

const MEMBER_LABEL: Record<Member, string> = {
  block: 'Block',
  stairs: 'Treppe',
  slab: 'Stufe',
  wall: 'Mauer',
  fence: 'Zaun',
  fence_gate: 'Zauntor',
  trapdoor: 'Falltür',
  door: 'Tür',
  button: 'Knopf',
  pressure_plate: 'Druckplatte',
  pane: 'Scheibe',
  carpet: 'Teppich',
};
const MEMBER_WORD: Record<Member, string> = Object.fromEntries(Object.entries(MEMBER_KEYS).map(([k, m]) => [m, k])) as Record<Member, string>;
const MEMBER_SUFFIX: Record<Exclude<Member, 'block'>, string> = {
  stairs: '_stairs',
  slab: '_slab',
  wall: '_wall',
  fence: '_fence',
  fence_gate: '_fence_gate',
  trapdoor: '_trapdoor',
  door: '_door',
  button: '_button',
  pressure_plate: '_pressure_plate',
  pane: '_pane',
  carpet: '_carpet',
};
/** Suffix checks in an order where longer suffixes win (_fence_gate before _fence). */
const SUFFIX_ORDER: [string, Member][] = [
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

export function memberLabel(m: Member): string {
  return MEMBER_LABEL[m];
}

/** The member a block id is itself, by its name (oak_fence → fence). */
export function memberOfId(blockId: string): Member {
  const path = blockId.slice(blockId.indexOf(':') + 1);
  if (path.endsWith('_wall_sign') || path.endsWith('_wall_banner') || path.endsWith('_wall_torch')) return 'block';
  for (const [suffix, m] of SUFFIX_ORDER) if (path.endsWith(suffix)) return m;
  return 'block';
}

/** What the block catalog knows, if one is loaded: all block ids and the block families. */
export interface BlockHints {
  known?: readonly string[] | null;
  families?: Readonly<Record<string, Readonly<Partial<Record<string, string>>>>> | null;
}

interface Variant {
  id: string;
  weight: number;
}

export type Pattern = { kind: 'einzeln' } | { kind: 'flecken'; n: number } | { kind: 'lagen'; n: number };

export interface Role {
  name: string;
  line: number;
  variants: Variant[];
  overrides: Partial<Record<Member, string>>;
  pattern: Pattern;
  /** Hash of the name: patterns of different roles differ. */
  salt: number;
  /** Per member: block ids with weights (filled on first use). */
  options?: Partial<Record<Member, { ids: string[]; cum: number[]; total: number }>>;
}

/** A role, optionally with a family member: `holz`, `holz:zaun`. */
export interface RoleRef {
  role: Role;
  member: Member;
  /** Whether the member was written out (`holz:treppe`). */
  explicit: boolean;
}

/** Where a block comes from in a statement: a role (member) or a fixed block state. */
export type BlockSpec = { kind: 'role'; ref: RoleRef } | { kind: 'state'; state: BlockState };

// Without a catalog: blocks that have no stairs, slabs or walls in vanilla.
const NO_FAMILY = /^(cracked_|chiseled_|infested_)|(_log|_wood|_stem|_hyphae|terracotta|_concrete|_concrete_powder|_wool|glass|_ore|_leaves|_door|_trapdoor|_pane)$/;
const VANILLA_WALLS = new Set(
  'cobblestone mossy_cobblestone stone_bricks mossy_stone_bricks andesite diorite granite bricks sandstone red_sandstone prismarine nether_bricks red_nether_bricks end_stone_bricks blackstone polished_blackstone polished_blackstone_bricks cobbled_deepslate polished_deepslate deepslate_bricks deepslate_tiles mud_bricks tuff polished_tuff tuff_bricks'.split(
    ' ',
  ),
);
const NO_STAIRS = new Set(['smooth_stone', 'deepslate', 'calcite', 'dripstone_block']);
const COLORS = new Set('white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black'.split(' '));

/** Member id from the naming pattern: stone_bricks -> stone_brick_stairs, oak_planks -> oak_stairs. */
export function memberByName(base: string, member: 'stairs' | 'slab' | 'wall' | 'fence'): string[] {
  const i = base.indexOf(':');
  const ns = base.slice(0, i);
  const path = base.slice(i + 1);
  const stems: string[] = [];
  if (path.endsWith('_planks')) stems.push(path.slice(0, -7));
  else if (path.endsWith('bricks') || path.endsWith('tiles')) stems.push(path.slice(0, -1));
  else if (path.endsWith('_block')) stems.push(path.slice(0, -6), path);
  else stems.push(path);
  return stems.map((s) => `${ns}:${s}${MEMBER_SUFFIX[member]}`);
}

/** Bau-Sprache 2: name patterns for the members that version 1 did not have. */
function memberByName2(base: string, member: Exclude<Member, 'block' | 'stairs' | 'slab' | 'wall' | 'fence'>): string[] {
  const i = base.indexOf(':');
  const ns = base.slice(0, i);
  const path = base.slice(i + 1);
  const planks = path.endsWith('_planks') ? path.slice(0, -7) : null;
  const out: string[] = [];
  switch (member) {
    case 'fence_gate':
      if (planks) out.push(`${planks}_fence_gate`);
      break;
    case 'trapdoor':
      if (planks) out.push(`${planks}_trapdoor`);
      else if (path === 'iron_block') out.push('iron_trapdoor');
      break;
    case 'door':
      if (planks) out.push(`${planks}_door`);
      else if (path === 'iron_block') out.push('iron_door');
      break;
    case 'button':
    case 'pressure_plate': {
      const suffix = member === 'button' ? '_button' : '_pressure_plate';
      if (planks) out.push(`${planks}${suffix}`);
      else if (path === 'stone' || path === 'polished_blackstone') out.push(`${path}${suffix}`);
      else if (ns !== 'minecraft') out.push(`${path}${suffix}`);
      break;
    }
    case 'pane':
      if (path === 'glass' || path.endsWith('_stained_glass') || path.endsWith('_glass')) out.push(`${path}_pane`);
      break;
    case 'carpet':
      if (path.endsWith('_wool')) out.push(`${path.slice(0, -5)}_carpet`);
      else if (path === 'moss_block') out.push('moss_carpet');
      break;
  }
  return out.map((p) => `${ns}:${p}`);
}

/** Small, fast, deterministic hash of the seed and a cell: the same file always looks the same. */
export function cellRandom(seed: number, x: number, y: number, z: number, salt = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const v of [x, y, z, salt]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Same hash without the array (hot path). */
function hash4(seed: number, x: number, y: number, z: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (z | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (salt | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function stringHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Trilinear interpolation of uniform lattice values is not uniform itself (values bunch up
 * around 0.5), so the weights of a mixed role would not hold. This table maps the
 * interpolated value back to an even distribution (empirical CDF, computed once).
 */
const CDF_BINS = 1024;
let cdfTable: Float64Array | null = null;
function equalizer(): Float64Array {
  if (cdfTable) return cdfTable;
  const counts = new Float64Array(CDF_BINS);
  const n = 200_000;
  for (let i = 0; i < n; i++) {
    const r = (k: number) => hash4(12345, i, k, 0, 99);
    const u = r(0);
    const v = r(1);
    const w = r(2);
    const c = [r(3), r(4), r(5), r(6), r(7), r(8), r(9), r(10)];
    const x00 = c[0] + (c[1] - c[0]) * u;
    const x10 = c[2] + (c[3] - c[2]) * u;
    const x01 = c[4] + (c[5] - c[4]) * u;
    const x11 = c[6] + (c[7] - c[6]) * u;
    const y0 = x00 + (x10 - x00) * v;
    const y1 = x01 + (x11 - x01) * v;
    const val = y0 + (y1 - y0) * w;
    counts[Math.min(CDF_BINS - 1, Math.floor(val * CDF_BINS))]++;
  }
  const t = new Float64Array(CDF_BINS + 1);
  let acc = 0;
  for (let i = 0; i < CDF_BINS; i++) {
    t[i] = acc / n;
    acc += counts[i];
  }
  t[CDF_BINS] = 1;
  cdfTable = t;
  return t;
}

/** Patch noise in [0,1): lattice points every n cells, trilinear in between, evened out. */
export function patchNoise(seed: number, n: number, x: number, y: number, z: number): number {
  const fx = x / n;
  const fy = y / n;
  const fz = z / n;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fy - iy;
  const w = fz - iz;
  const c000 = hash4(seed, ix, iy, iz, 7);
  const c100 = hash4(seed, ix + 1, iy, iz, 7);
  const c010 = hash4(seed, ix, iy + 1, iz, 7);
  const c110 = hash4(seed, ix + 1, iy + 1, iz, 7);
  const c001 = hash4(seed, ix, iy, iz + 1, 7);
  const c101 = hash4(seed, ix + 1, iy, iz + 1, 7);
  const c011 = hash4(seed, ix, iy + 1, iz + 1, 7);
  const c111 = hash4(seed, ix + 1, iy + 1, iz + 1, 7);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  const val = y0 + (y1 - y0) * w;
  const t = equalizer();
  const f = Math.min(CDF_BINS - 1e-9, Math.max(0, val * CDF_BINS));
  const b = Math.floor(f);
  const out = t[b] + (t[b + 1] - t[b]) * (f - b);
  return Math.min(0.999999, Math.max(0, out));
}

export class Palette {
  readonly roles = new Map<string, Role>();
  seed = 1;
  private readonly known: ReadonlySet<string> | null;
  private readonly families: BlockHints['families'];
  private readonly memberCache = new Map<string, string | null>();

  constructor(
    hints: BlockHints = {},
    readonly version: 1 | 2 = 1,
  ) {
    this.known = hints.known ? new Set(hints.known) : null;
    this.families = hints.families ?? null;
  }

  /** True when a catalog is loaded and does not know the block. */
  isUnknown(id: string): boolean {
    return this.known !== null && !this.known.has(id);
  }

  /** `rolle <name> <block>[:gewicht] … [<glied>=… …] [muster=…]` */
  define(st: Statement, tokens: readonly Token[] = st.args): Role {
    const [nameTok, ...rest] = tokens;
    if (!nameTok || nameTok.kind !== 'word') throw new TessError(st.line, 'Nach „rolle“ fehlt der Name der Rolle, z. B. „rolle mauer stone_bricks“.');
    const name = asciiKey(nameTok.text);
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TessError(st.line, `„${nameTok.text}“ ist kein gültiger Rollenname (Buchstaben, Ziffern, Unterstrich).`);
    if (this.roles.has(name)) throw new TessError(st.line, `Die Rolle „${name}“ gibt es schon (Zeile ${this.roles.get(name)!.line}).`);
    if (this.version === 2 && MEMBER_KEYS[name] && name !== 'tuer') {
      // `tuer` stays allowed: it is the default role of doors since version 1.
      throw new TessError(st.line, `„${name}“ ist der Name eines Glieds (${name}=…); nimm einen anderen Rollennamen.`);
    }
    const role: Role = { name, line: st.line, variants: [], overrides: {}, pattern: { kind: 'einzeln' }, salt: stringHash(name) };
    const keys = this.version === 1 ? V1_MEMBER_KEYS : MEMBER_KEYS;
    for (const t of rest) {
      if (t.kind === 'pair') {
        if (this.version === 2 && t.key === 'muster') {
          role.pattern = parsePattern(t.value, st.line);
          continue;
        }
        const m = keys[t.key];
        if (!m || m === 'block') {
          const allowed = Object.keys(keys)
            .filter((k) => keys[k] !== 'block')
            .concat(this.version === 2 ? ['muster'] : [])
            .join(', ');
          throw new TessError(st.line, `Unbekannte Angabe „${t.key}=“ in der Rolle (erlaubt: ${allowed}).`);
        }
        if (this.version === 2 && t.value.includes('[')) throw new TessError(st.line, `„${t.key}=${t.value}“: Glieder stehen ohne Zustände.`);
        role.overrides[m] = normalizeName(t.value);
        continue;
      }
      if (t.kind !== 'word') throw new TessError(st.line, `„${t.text}“ ist kein Block. Eine Rolle listet Block-IDs, z. B. „stone_bricks:70“.`);
      if (t.text.includes('[')) throw new TessError(st.line, `„${t.text}“: Eine Rolle nimmt Blöcke ohne Zustände; Ausrichtung und Form rechnet Tessera selbst.`);
      // "stone_bricks:70", "minecraft:stone_bricks:70" or without weight (block paths are never pure numbers).
      const m = /^(.+):(\d+)$/.exec(t.text);
      const [id, weight] = m ? [m[1], parseInt(m[2], 10)] : [t.text, 1];
      if (!(weight > 0)) throw new TessError(st.line, `„${t.text}“: Das Gewicht muss größer als 0 sein.`);
      role.variants.push({ id: normalizeName(id), weight });
    }
    if (role.variants.length === 0) throw new TessError(st.line, `Die Rolle „${name}“ hat keinen Block.`);
    this.roles.set(name, role);
    return role;
  }

  private readonly failed = new Set<string>();

  /** A `rolle` line with an error: uses of the role are follow-up errors, reported once. */
  markFailed(name: string): void {
    this.failed.add(asciiKey(name));
  }

  isFailed(name: string): boolean {
    return this.failed.has(asciiKey(name));
  }

  role(name: string, line: number, what = 'Rolle'): Role {
    const r = this.roles.get(asciiKey(name));
    if (!r && this.failed.has(asciiKey(name))) throw new FollowUpError(line, `Rolle „${name}“ fehlt wegen eines Fehlers in ihrer Zeile.`);
    if (!r) {
      const list = [...this.roles.keys()].join(', ') || 'noch keine';
      throw new TessError(line, `${what} „${name}“ ist nicht festgelegt. Lege sie mit „rolle ${name} <block>“ an (vorhanden: ${list}).`);
    }
    return r;
  }

  /** `rolle` or `rolle:glied` (Bau-Sprache 2). */
  roleRef(text: string, line: number, what = 'Rolle'): RoleRef {
    const i = text.indexOf(':');
    if (i < 0) return { role: this.role(text, line, what), member: 'block', explicit: false };
    const name = text.slice(0, i);
    const word = asciiKey(text.slice(i + 1));
    const role = this.role(name, line, what);
    const member = MEMBER_KEYS[word];
    if (!member) throw new TessError(line, `„${text.slice(i + 1)}“ ist kein Glied. Möglich: ${Object.keys(MEMBER_KEYS).join(', ')}.`);
    return { role, member, explicit: true };
  }

  /** Block-Angabe: `rolle`, `rolle:glied` or a block id with or without states. Role names win. */
  blockSpec(text: string, line: number): BlockSpec {
    if (!text.includes('[')) {
      const i = text.indexOf(':');
      const head = asciiKey(i < 0 ? text : text.slice(0, i));
      if (this.roles.has(head) || this.failed.has(head)) {
        if (i >= 0 && !MEMBER_KEYS[asciiKey(text.slice(i + 1))]) {
          throw new TessError(line, `„${text}“: „${text.slice(i + 1)}“ ist kein Glied der Rolle „${head}“. Möglich: ${Object.keys(MEMBER_KEYS).join(', ')}.`);
        }
        return { kind: 'role', ref: this.roleRef(text, line) };
      }
    }
    if (!/^[a-z0-9_.:/-]+(\[.*\])?$/i.test(text)) throw new TessError(line, `„${text}“ ist weder eine Rolle noch eine Block-ID.`);
    return { kind: 'state', state: parseBlockState(text) };
  }

  /** Family member of one block, or null if there is none. */
  member(base: string, member: Member): string | null {
    if (member === 'block') return base;
    const key = `${base}|${member}`;
    if (this.memberCache.has(key)) return this.memberCache.get(key)!;
    let found: string | null = null;
    if (this.version === 2 && memberOfId(base) === member) found = base;
    const fam = this.families?.[base];
    if (!found && fam?.[member]) found = fam[member]!;
    if (!found) {
      const path = base.slice(base.indexOf(':') + 1);
      const candidates =
        member === 'stairs' || member === 'slab' || member === 'wall' || member === 'fence'
          ? memberByName(base, member)
          : this.version === 2
            ? memberByName2(base, member)
            : [];
      for (const c of candidates) {
        if (this.known) {
          if (this.known.has(c)) {
            found = c;
            break;
          }
          continue;
        }
        // No catalog: trust the naming pattern for vanilla, except where vanilla has no such block.
        if (member === 'stairs' || member === 'slab' || member === 'wall' || member === 'fence') {
          if (NO_FAMILY.test(path)) break;
          if (member === 'stairs' && NO_STAIRS.has(path)) break;
          if (member === 'wall' && base.startsWith('minecraft:') && !VANILLA_WALLS.has(path)) break;
          if (member === 'fence' && base.startsWith('minecraft:') && !path.endsWith('_planks') && path !== 'nether_bricks') break;
        } else if (member === 'pane' && base.startsWith('minecraft:')) {
          if (path !== 'glass' && !(path.endsWith('_stained_glass') && COLORS.has(path.slice(0, -14)))) break;
        } else if (member === 'carpet' && base.startsWith('minecraft:')) {
          if (path !== 'moss_block' && !COLORS.has(path.slice(0, -5))) break;
        }
        found = c;
        break;
      }
    }
    this.memberCache.set(key, found);
    return found;
  }

  private optionsFor(role: Role, member: Member, line: number): { ids: string[]; cum: number[]; total: number } {
    role.options ??= {};
    const cached = role.options[member];
    if (cached) return cached;
    const ids: string[] = [];
    const cum: number[] = [];
    let total = 0;
    for (const v of role.variants) {
      const id = this.member(v.id, member);
      if (!id) continue;
      total += v.weight;
      ids.push(id);
      cum.push(total);
    }
    if (ids.length === 0) {
      const key = this.version === 1 ? (Object.entries(V1_MEMBER_KEYS).find(([, m]) => m === member)?.[0] ?? member) : MEMBER_WORD[member];
      throw new TessError(
        line,
        `Zur Rolle „${role.name}“ (Zeile ${role.line}) gibt es keine ${MEMBER_LABEL[member]}: „${role.variants[0].id}“ hat keine. Gib sie in der Rolle an, z. B. „${key}=…“.`,
      );
    }
    const out = { ids, cum, total };
    role.options[member] = out;
    return out;
  }

  /** Whether a role has a member (without throwing). */
  hasMember(role: Role, member: Member): boolean {
    if (role.overrides[member]) return true;
    return role.variants.some((v) => this.member(v.id, member) !== null);
  }

  /** Block id for a role at one cell; a mixed role picks its variant with the file's seed. */
  pick(role: Role, member: Member, x: number, y: number, z: number, line: number): string {
    const fixed = role.overrides[member];
    if (fixed) return fixed;
    const o = this.optionsFor(role, member, line);
    if (o.ids.length === 1) return o.ids[0];
    let r: number;
    const p = role.pattern;
    if (p.kind === 'einzeln') r = cellRandom(this.seed, x, y, z);
    else if (p.kind === 'flecken') r = patchNoise((this.seed ^ role.salt) >>> 0, p.n, x, y, z);
    else r = hash4((this.seed ^ role.salt) >>> 0, 0, Math.floor(y / p.n), 0, 11);
    r *= o.total;
    for (let i = 0; i < o.ids.length; i++) if (r < o.cum[i]) return o.ids[i];
    return o.ids[o.ids.length - 1];
  }
}

export function parsePattern(value: string, line: number): Pattern {
  const v = asciiKey(value);
  if (v === 'einzeln') return { kind: 'einzeln' };
  const m = /^(flecken|lagen):(\d+)$/.exec(v);
  if (!m) throw new TessError(line, `„muster=${value}“: möglich sind einzeln, flecken:<n> und lagen:<n>, z. B. muster=flecken:3.`);
  const n = parseInt(m[2], 10);
  if (n < 1 || n > 64) throw new TessError(line, `„muster=${value}“: Die Größe muss zwischen 1 und 64 liegen.`);
  return { kind: m[1] as 'flecken' | 'lagen', n };
}
