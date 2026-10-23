import { normalizeName } from '../core/blockstate';
import { asciiKey, FollowUpError, TessError, type Statement } from './syntax';

/**
 * Role palettes: a building names roles (mauer, dach, rahmen …) and the file maps each role to
 * one or more blocks, optionally weighted ("70 % Steinziegel, 20 % rissig, 10 % bemoost").
 * Bauteile ask a role for a member of its family (block, stairs, slab, wall, fence), so a
 * palette swap takes stairs and slabs along. Roles exist only inside their file; block ids are
 * resolved at once, nothing outside the compiler sees a role name.
 */

export type Member = 'block' | 'stairs' | 'slab' | 'wall' | 'fence';

const MEMBER_KEYS: Record<string, Member> = { treppe: 'stairs', stufe: 'slab', mauer: 'wall', zaun: 'fence' };
const MEMBER_LABEL: Record<Member, string> = { block: 'Block', stairs: 'Treppe', slab: 'Stufe', wall: 'Mauer', fence: 'Zaun' };
const MEMBER_SUFFIX: Record<Exclude<Member, 'block'>, string> = { stairs: '_stairs', slab: '_slab', wall: '_wall', fence: '_fence' };

/** What the block catalog knows, if one is loaded: all block ids and the block families. */
export interface BlockHints {
  known?: readonly string[] | null;
  families?: Readonly<Record<string, Readonly<Partial<Record<string, string>>>>> | null;
}

interface Variant {
  id: string;
  weight: number;
}

export interface Role {
  name: string;
  line: number;
  variants: Variant[];
  overrides: Partial<Record<Member, string>>;
}

// Without a catalog: blocks that have no stairs, slabs or walls in vanilla.
const NO_FAMILY = /^(cracked_|chiseled_|infested_)|(_log|_wood|_stem|_hyphae|terracotta|_concrete|_concrete_powder|_wool|glass|_ore|_leaves|_door|_trapdoor|_pane)$/;
const VANILLA_WALLS = new Set(
  'cobblestone mossy_cobblestone stone_bricks mossy_stone_bricks andesite diorite granite bricks sandstone red_sandstone prismarine nether_bricks red_nether_bricks end_stone_bricks blackstone polished_blackstone polished_blackstone_bricks cobbled_deepslate polished_deepslate deepslate_bricks deepslate_tiles mud_bricks tuff polished_tuff tuff_bricks'.split(
    ' ',
  ),
);
const NO_STAIRS = new Set(['smooth_stone', 'deepslate', 'calcite', 'dripstone_block']);

/** Member id from the naming pattern: stone_bricks -> stone_brick_stairs, oak_planks -> oak_stairs. */
export function memberByName(base: string, member: Exclude<Member, 'block'>): string[] {
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

export class Palette {
  readonly roles = new Map<string, Role>();
  seed = 1;
  private readonly known: ReadonlySet<string> | null;
  private readonly families: BlockHints['families'];
  private readonly memberCache = new Map<string, string | null>();

  constructor(hints: BlockHints = {}) {
    this.known = hints.known ? new Set(hints.known) : null;
    this.families = hints.families ?? null;
  }

  /** True when a catalog is loaded and does not know the block. */
  isUnknown(id: string): boolean {
    return this.known !== null && !this.known.has(id);
  }

  /** `rolle <name> <block>[:gewicht] … [treppe=… stufe=… mauer=… zaun=…]` */
  define(st: Statement): Role {
    const [nameTok, ...rest] = st.args;
    if (!nameTok || nameTok.kind !== 'word') throw new TessError(st.line, 'Nach „rolle“ fehlt der Name der Rolle, z. B. „rolle mauer stone_bricks“.');
    const name = asciiKey(nameTok.text);
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TessError(st.line, `„${nameTok.text}“ ist kein gültiger Rollenname (Buchstaben, Ziffern, Unterstrich).`);
    if (this.roles.has(name)) throw new TessError(st.line, `Die Rolle „${name}“ gibt es schon (Zeile ${this.roles.get(name)!.line}).`);
    const role: Role = { name, line: st.line, variants: [], overrides: {} };
    for (const t of rest) {
      if (t.kind === 'pair') {
        const m = MEMBER_KEYS[t.key];
        if (!m) throw new TessError(st.line, `Unbekannte Angabe „${t.key}=“ in der Rolle (erlaubt: treppe, stufe, mauer, zaun).`);
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

  role(name: string, line: number, what = 'Rolle'): Role {
    const r = this.roles.get(asciiKey(name));
    if (!r && this.failed.has(asciiKey(name))) throw new FollowUpError(line, `Rolle „${name}“ fehlt wegen eines Fehlers in ihrer Zeile.`);
    if (!r) {
      const list = [...this.roles.keys()].join(', ') || 'noch keine';
      throw new TessError(line, `${what} „${name}“ ist nicht festgelegt. Lege sie mit „rolle ${name} <block>“ an (vorhanden: ${list}).`);
    }
    return r;
  }

  /** Family member of one block, or null if there is none. */
  member(base: string, member: Member): string | null {
    if (member === 'block') return base;
    const key = `${base}|${member}`;
    if (this.memberCache.has(key)) return this.memberCache.get(key)!;
    let found: string | null = null;
    const fam = this.families?.[base];
    if (fam?.[member]) found = fam[member]!;
    if (!found) {
      const path = base.slice(base.indexOf(':') + 1);
      for (const c of memberByName(base, member)) {
        if (this.known) {
          if (this.known.has(c)) {
            found = c;
            break;
          }
          continue;
        }
        // No catalog: trust the naming pattern for vanilla, except where vanilla has no such block.
        if (NO_FAMILY.test(path)) break;
        if (member === 'stairs' && NO_STAIRS.has(path)) break;
        if (member === 'wall' && base.startsWith('minecraft:') && !VANILLA_WALLS.has(path)) break;
        if (member === 'fence' && base.startsWith('minecraft:') && !path.endsWith('_planks') && path !== 'nether_bricks') break;
        found = c;
        break;
      }
    }
    this.memberCache.set(key, found);
    return found;
  }

  /** Block id for a role at one cell; a mixed role picks its variant with the file's seed. */
  pick(role: Role, member: Member, x: number, y: number, z: number, line: number): string {
    const fixed = role.overrides[member];
    if (fixed) return fixed;
    let total = 0;
    const options: Variant[] = [];
    for (const v of role.variants) {
      const id = this.member(v.id, member);
      if (!id) continue;
      options.push({ id, weight: v.weight });
      total += v.weight;
    }
    if (options.length === 0) {
      const key = Object.entries(MEMBER_KEYS).find(([, m]) => m === member)?.[0] ?? member;
      throw new TessError(
        line,
        `Zur Rolle „${role.name}“ (Zeile ${role.line}) gibt es keine ${MEMBER_LABEL[member]}: „${role.variants[0].id}“ hat keine. Gib sie in der Rolle an, z. B. „${key}=…“.`,
      );
    }
    if (options.length === 1) return options[0].id;
    let r = cellRandom(this.seed, x, y, z) * total;
    for (const o of options) {
      r -= o.weight;
      if (r < 0) return o.id;
    }
    return options[options.length - 1].id;
  }
}
