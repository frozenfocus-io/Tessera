import { stairQuarters } from '../blocks/shapes';
import { CellSet, ChebDistance, facingTowardsSet, SIDES } from './cells';
import { ccw, opposite, type Facing } from './geometry';
import { TessError } from './syntax';

/**
 * Dachmaschine of Bau-Sprache 2. A roof is computed in layers: layer 0 lies on top of the
 * form's highest wall layer. Each layer's outline O(y) is the base area F (the top outline plus
 * overhang) shrunk by the profile's inset a(y), in the metric of the roof type (across the
 * ridge for gable roofs, from all sides for hip roofs, over the radius for round forms). The
 * blocks of a layer follow from O(y) and O(y+1): stairs on the step edge, full blocks where the
 * roof runs vertically, upside-down stairs where it flares outwards, slabs on the ridge.
 *
 * Roofs whose base areas overlap or touch are united: the layer outlines of the group are the
 * unions of all its roofs' outlines (in absolute layers), so valleys and cross gables come out
 * of the same rules.
 */

export interface ProfileElem {
  dx: number;
  dy: number;
}

export type RoofProfile = { kind: 'list'; elems: ProfileElem[] } | { kind: 'kuppel' };

export const ROOF_PRESETS: Record<string, string> = {
  glocke: '2/1,1/1,1/2,1/3',
  mansard: '1/3,1/3,2/1',
  zwiebel: '-1/1,-1/1,0/2,1/1,1/1,1/2,1/2,1/3',
};

export function parseRoofProfile(value: string, line: number): RoofProfile {
  const v = value.toLowerCase();
  if (v === 'kuppel') return { kind: 'kuppel' };
  const text = ROOF_PRESETS[v] ?? value;
  const elems: ProfileElem[] = [];
  for (const part of text.split(',')) {
    const m = /^(-?\d+)\/(\d+)$/.exec(part.trim());
    if (!m) throw new TessError(line, `„profil=${value}“: Einträge haben die Form dx/dy, z. B. profil=1/2 oder profil=2/1,1/1; Voreinstellungen: glocke, mansard, zwiebel, kuppel.`);
    const dx = parseInt(m[1], 10);
    const dy = parseInt(m[2], 10);
    if (dy < 1) throw new TessError(line, `„profil=${value}“: dy muss mindestens 1 sein.`);
    if (Math.abs(dx) > 16 || dy > 64) throw new TessError(line, `„profil=${value}“: „${part}“ ist zu groß.`);
    elems.push({ dx, dy });
  }
  return { kind: 'list', elems };
}

/** Inset a(y) of a profile; the last element repeats. Null for layers past a dome's top. */
export function insetAt(p: RoofProfile, y: number, radius: number): number | null {
  if (p.kind === 'kuppel') {
    const q = (radius + 0.5) ** 2 - y * y;
    if (q < 0) return null;
    return radius - Math.floor(Math.sqrt(q));
  }
  let y0 = 0;
  let a0 = 0;
  const els = p.elems;
  for (let i = 0; ; i++) {
    const e = els[Math.min(i, els.length - 1)];
    if (y < y0 + e.dy) return a0 + Math.floor((e.dx * (y - y0)) / e.dy);
    y0 += e.dy;
    a0 += e.dx;
    if (i > 100_000) return a0;
  }
}

export type RoofType = 'sattel' | 'pult' | 'krueppelwalm' | 'walm' | 'zelt' | 'kegel' | 'helm';

export interface GableWall {
  /** Wall line: cells (fixed, t) for axis 'z' runs or (t, fixed) for axis 'x'. */
  axis: 'x' | 'z';
  fixed: number;
  lo: number;
  hi: number;
  /** Direction pointing away from the roofed body (out of the gable). */
  out: Facing;
}

/** One roof, computed: absolute base layer and the outline of each layer. */
export interface RoofDef {
  index: number;
  type: RoofType;
  /** Origin id of the statement (blocks of this roof carry it). */
  origin: number;
  /** Statement sequence number (for "blocks placed between two roofs"). */
  seq: number;
  /** Absolute layer of roof layer 0. */
  yb: number;
  layers: CellSet[];
  /** Per layer: sides that count for the shell (bitmask n=1, o=2, s=4, w=8). */
  dirs: number[];
  /** Axis across the ridge for gable-type roofs (the final layer is read along it). */
  crossAxis: 'x' | 'z' | null;
  /** Base area F (layer 0 before bending). */
  base: CellSet;
  /** The roofed form's top outline (traufe: "outside the wall"). */
  wall: CellSet;
  gables: GableWall[];
  /** Verge columns: outermost cells along the ridge, with the direction towards the building. */
  verge: { axis: 'x' | 'z'; at: number; towards: Facing }[];
  kante: boolean;
  traufe: 'treppe' | 'stufe' | null;
  dicke: number;
  fuellen: boolean;
  hasRidgeDeco: boolean;
  hasTip: boolean;
  /** Krüppelwalm: the hips at the two gable ends (layers/dirs above hold both hips). */
  hip?: HipEnds;
  /** Roofs of Anbauten against a wall: only cells in front of the wall are built. */
  keep?: (x: number, z: number) => boolean;
  /** Drawing a window of a group (compile-roofs.ts): the whole layers, while `layers` are cut to the window. */
  full?: CellSet[];
}

export interface HipEnds {
  /** First hipped layer. */
  from: number;
  /** Gable wall lines of the two ends. */
  ends: readonly [GableWall, GableWall];
  /** Layer outlines and shell sides with the hip at the first and/or the second end. */
  variant(first: boolean, second: boolean): { layers: CellSet[]; dirs: number[] };
}

export function layerOf(r: RoofDef, Y: number): CellSet {
  const i = Y - r.yb;
  return i >= 0 && i < r.layers.length ? r.layers[i] : CellSet.EMPTY;
}

/**
 * Krüppelwalm roofs in a group: an end whose gable lies against or inside another roof of the
 * group at the first hipped layer is not a free gable (its gable falls away, 5.3), so it gets no
 * hip either; the roof runs on there like a gable roof and its ridge meets the other roof.
 */
export function resolveHips(roofs: readonly RoofDef[]): RoofDef[] {
  const owners = new Map<number, LayerOwners>();
  return roofs.map((r, ri) => {
    const h = r.hip;
    if (!h || roofs.length < 2) return r;
    const Y = r.yb + h.from;
    const at = owners.get(Y) ?? new LayerOwners(roofs, Y);
    owners.set(Y, at);
    const free = h.ends.map((g) => {
      const [ox, oz] = FACING_STEP[g.out];
      for (let t = g.lo; t <= g.hi; t++) {
        const [x, z] = g.axis === 'x' ? [t, g.fixed] : [g.fixed, t];
        if (at.other(x, z, ri) || at.other(x + ox, z + oz, ri)) return false;
      }
      return true;
    });
    if (free[0] && free[1]) return r;
    const v = h.variant(free[0], free[1]);
    return { ...r, layers: v.layers, dirs: v.dirs };
  });
}

/**
 * Whether the two gable ends of a Krüppelwalm roof are free, by the test of resolveHips: none
 * of the other roofs (those of `roofs` that `other` accepts by index) covers the wall line of the
 * end or the cells in front of it at the first hipped layer. For a few roofs near r.
 */
export function hipFree(r: RoofDef, other: (index: number) => boolean, roofs: readonly RoofDef[]): [boolean, boolean] {
  const h = r.hip!;
  const Y = r.yb + h.from;
  const free = h.ends.map((g) => {
    const [ox, oz] = FACING_STEP[g.out];
    for (let t = g.lo; t <= g.hi; t++) {
      const [x, z] = g.axis === 'x' ? [t, g.fixed] : [g.fixed, t];
      if (roofs.some((o, oi) => other(oi) && (layerOf(o, Y).has(x, z) || layerOf(o, Y).has(x + ox, z + oz)))) return false;
    }
    return true;
  });
  return [free[0], free[1]];
}

export type RoofBlockKind =
  | 'stair' // half=bottom, facing
  | 'belly' // upside-down stair, facing
  | 'slab' // bottom slab
  | 'full'
  | 'ridge' // ridge slab (final layer, line)
  | 'tip' // single cell at the top
  | 'ridgeStair' // stair of a two-wide final layer
  | 'gable'
  | 'verge' // upside-down stair under the gable edge
  | 'eave' // upside-down stair or top slab under the eaves
  | 'deco' // firstzier above a ridge cell
  | 'spire'; // spitze above the tip

export interface RoofBlock {
  x: number;
  y: number;
  z: number;
  kind: RoofBlockKind;
  facing?: Facing;
  /** For eaves: slab instead of stair. */
  slab?: boolean;
  /** Roof the block belongs to (index into the group's roofs). */
  roof: number;
  /** Gables and verges: index of the line in the roof's gables or verge (drawing order). */
  line?: number;
  /** Full block that seals the attic next to an open stair side (drawn after the layer). */
  seal?: true;
  /** Belly facing taken from the distance to the layer below (wide belly). */
  wide?: true;
}

const FACING_STEP: Record<Facing, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Length of the run through (x, z) along one axis. */
function run(set: CellSet, x: number, z: number, axis: 'x' | 'z'): [number, number] {
  const [dx, dz] = axis === 'x' ? [1, 0] : [0, 1];
  let a = 0;
  while (set.has(x - (a + 1) * dx, z - (a + 1) * dz)) a++;
  let b = 0;
  while (set.has(x + (b + 1) * dx, z + (b + 1) * dz)) b++;
  return [a, b];
}

/**
 * A cell of a roof's last layer: ridge slab, tip, or a stair facing the middle. Gable-type roofs
 * read the layer across the ridge; others treat what remains after one more step inwards
 * (erosion by one cell) as the next layer, so a 3×3 top becomes stairs around a tip.
 */
function finalCell(r: RoofDef, S: CellSet, x: number, z: number): { kind: RoofBlockKind; facing?: Facing } {
  if (S.count === 1) return { kind: 'tip' };
  if (!r.crossAxis) {
    const inner = S.erode(1);
    if (!inner.isEmpty()) {
      if (inner.has(x, z)) return inner.count === 1 ? { kind: 'tip' } : finalCell(r, inner, x, z);
      const f = facingTowardsSet(x, z, (a, c) => inner.has(a, c), 'z');
      return f ? { kind: 'stair', facing: f } : { kind: 'slab' };
    }
  }
  const [xa, xb] = run(S, x, z, 'x');
  const [za, zb] = run(S, x, z, 'z');
  const lenX = xa + xb + 1;
  const lenZ = za + zb + 1;
  if (lenX === 1 && lenZ === 1) return { kind: 'tip' };
  const axis = r.crossAxis ?? (lenZ <= lenX ? 'z' : 'x');
  const [a, b] = axis === 'x' ? [xa, xb] : [za, zb];
  const len = a + b + 1;
  if (len === 1) return { kind: 'ridge' };
  const delta = (b - a) / 2; // > 0: the middle lies ahead (+axis)
  if (delta === 0) return { kind: 'ridge' };
  const j = Math.ceil(Math.abs(delta));
  if (j >= 2) return { kind: 'slab' };
  const facing: Facing = axis === 'x' ? (delta > 0 ? 'east' : 'west') : delta > 0 ? 'south' : 'north';
  return { kind: 'ridgeStair', facing };
}

const QUARTER_SIDE: Record<Facing, number> = { north: 1 | 2, south: 4 | 8, east: 2 | 8, west: 1 | 4 };

/** Shape of a roof stair from the stairs of the same layer (as the connection pass will set it). */
function shapeIn(b: RoofBlock, get: (x: number, z: number) => RoofBlock | undefined): string {
  const isStair = (n: RoofBlock | undefined): n is RoofBlock => !!n && !!n.facing && (n.kind === 'stair' || n.kind === 'ridgeStair' || n.kind === 'belly');
  const half = (n: RoofBlock) => (n.kind === 'belly' ? 'top' : 'bottom');
  const f = b.facing!;
  const at = (d: Facing) => {
    const [dx, dz] = FACING_STEP[d];
    return get(b.x + dx, b.z + dz);
  };
  const canTake = (d: Facing) => {
    const n = at(d);
    return !isStair(n) || n.facing !== f || half(n) !== half(b);
  };
  const back = at(f);
  if (isStair(back) && half(back) === half(b)) {
    const d = back.facing!;
    if ((d === 'east' || d === 'west') !== (f === 'east' || f === 'west') && canTake(opposite(d))) return d === ccw(f) ? 'outer_left' : 'outer_right';
  }
  const front = at(opposite(f));
  if (isStair(front) && half(front) === half(b)) {
    const d = front.facing!;
    if ((d === 'east' || d === 'west') !== (f === 'east' || f === 'west') && canTake(d)) return d === ccw(f) ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

/** Whether a surface block leaves the side towards `dir` partly open. */
function opensTowards(n: RoofBlock, dir: Facing, get: (x: number, z: number) => RoofBlock | undefined): boolean {
  if (n.kind === 'slab' || n.kind === 'ridge') return true;
  if (n.kind !== 'stair' && n.kind !== 'ridgeStair' && n.kind !== 'belly') return false;
  const q = stairQuarters(n.facing!, shapeIn(n, get));
  const need = QUARTER_SIDE[dir];
  return (q & need) !== need;
}

/**
 * The roofs that cover the cells of one layer, in the order of the group: the union of their
 * outlines, and per cell the first roof (cells of several roofs also list all of them). Sparse
 * layers (a long diagonal row of roofs) keep the first roofs in a map instead of an array.
 */
class LayerOwners {
  readonly union: CellSet;
  private readonly x0: number = 0;
  private readonly z0: number = 0;
  private readonly w: number = 0;
  private readonly h: number = 0;
  private readonly dense: Int32Array | null = null;
  private readonly sparse = new Map<number, number>();
  private readonly more = new Map<number, number[]>();

  constructor(roofs: readonly RoofDef[], Y: number) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    let cells = 0;
    for (const r of roofs) {
      const L = layerOf(r, Y);
      if (L.isEmpty()) continue;
      x0 = Math.min(x0, L.x0);
      z0 = Math.min(z0, L.z0);
      x1 = Math.max(x1, L.x1);
      z1 = Math.max(z1, L.z1);
      cells += L.count;
    }
    if (x0 === Infinity) {
      this.union = CellSet.EMPTY;
      return;
    }
    this.x0 = x0;
    this.z0 = z0;
    const w = (this.w = x1 - x0 + 1);
    this.h = z1 - z0 + 1;
    const dense = w * this.h <= 4 * cells + 4096 ? (this.dense = new Int32Array(w * this.h).fill(-1)) : null;
    const list: [number, number][] = [];
    roofs.forEach((r, i) => {
      layerOf(r, Y).forEach((x, z) => {
        const k = (z - z0) * w + (x - x0);
        const f = dense ? dense[k] : (this.sparse.get(k) ?? -1);
        if (f < 0) {
          if (dense) dense[k] = i;
          else {
            this.sparse.set(k, i);
            list.push([x, z]);
          }
        } else {
          const m = this.more.get(k);
          if (m) m.push(i);
          else this.more.set(k, [f, i]);
        }
      });
    });
    this.union = dense ? CellSet.build(x0, z0, x1, z1, (x, z) => dense[(z - z0) * w + (x - x0)] >= 0) : CellSet.fromCells(list);
  }

  private first(k: number): number {
    return this.dense ? this.dense[k] : (this.sparse.get(k) ?? -1);
  }

  private index(x: number, z: number): number {
    const dx = x - this.x0;
    const dz = z - this.z0;
    return dx < 0 || dz < 0 || dx >= this.w || dz >= this.h ? -1 : dz * this.w + dx;
  }

  /** Roofs covering the cell, in group order. */
  owners(x: number, z: number): readonly number[] {
    const k = this.index(x, z);
    const f = k < 0 ? -1 : this.first(k);
    if (f < 0) return NONE;
    return this.more.get(k) ?? [f];
  }

  /** Whether a roof other than ri covers the cell. */
  other(x: number, z: number, ri: number): boolean {
    const k = this.index(x, z);
    const f = k < 0 ? -1 : this.first(k);
    return f >= 0 && (f !== ri || this.more.has(k));
  }
}

const NONE: readonly number[] = [];
const NO_OWNERS = new LayerOwners([], 0);

/** Number key of a cell (surface map, belly cells). */
function surfaceKey(x: number, y: number, z: number): number {
  return ((x + 8192) * 16384 + (y + 8192)) * 16384 + (z + 8192);
}

export interface GroupRender {
  blocks: RoofBlock[];
  /** Per roof: whether it ends in a single tip cell, and where. */
  tips: (readonly [number, number, number] | null)[];
  /** The roofs with their Krüppelwalm hips resolved for the group. */
  roofs: RoofDef[];
}

/**
 * Renders a group of roofs (one roof or several that touch) as the union of their layer
 * outlines. Returns the blocks in placing order: roof surface first, then gables, verges,
 * eaves and decorations (those only go into empty cells). `spires: false` leaves out the spires
 * (drawing a window of a group, where the caller sets them).
 */
export function renderRoofs(group: readonly RoofDef[], opts: { spires?: boolean } = {}): GroupRender {
  const roofs = resolveHips(group);
  const blocks: RoofBlock[] = [];
  const yLo = Math.min(...roofs.map((r) => r.yb));
  const yHi = Math.max(...roofs.map((r) => r.yb + r.layers.length - 1));
  const O: LayerOwners[] = [];
  for (let Y = yLo; Y <= yHi; Y++) O.push(new LayerOwners(roofs, Y));
  const ownersAt = (Y: number) => (Y < yLo || Y > yHi ? NO_OWNERS : O[Y - yLo]);
  const unionAt = (Y: number) => ownersAt(Y).union;
  const surface = new Map<number, RoofBlock>();
  const key = surfaceKey;
  const tips: (readonly [number, number, number] | null)[] = roofs.map(() => null);

  for (let Y = yLo; Y <= yHi; Y++) {
    const cur = unionAt(Y);
    const next = unionAt(Y + 1);
    const prev = unionAt(Y - 1);
    if (cur.isEmpty()) continue;
    // Belly: cells that a roof adds in this layer and that no roof covered below.
    const belly = new Set<number>();
    for (const r of roofs) {
      if (Y <= r.yb) continue;
      const here = layerOf(r, Y);
      const below = layerOf(r, Y - 1);
      here.forEach((x, z) => {
        if (!below.has(x, z) && !prev.has(x, z)) belly.add(key(x, 0, z));
      });
    }
    let bellyDist: ChebDistance | null = null;
    const inner: [number, number][] = [];
    const at = ownersAt(Y);
    cur.forEach((x, z) => {
      const owners = at.owners(x, z);
      const roof = owners[0];
      const add = (kind: RoofBlockKind, facing?: Facing) => {
        const b: RoofBlock = { x, y: Y, z, kind, facing, roof };
        blocks.push(b);
        surface.set(key(x, Y, z), b);
        return b;
      };
      if (belly.has(key(x, 0, z))) {
        let f = facingTowardsSet(x, z, (a, c) => prev.has(a, c), 'z');
        if (!f) {
          // Wide belly: face the neighbour that is closer to the layer below.
          bellyDist ??= new ChebDistance(prev, cur, 64);
          const d = bellyDist.get(x, z);
          f = facingTowardsSet(x, z, (a, c) => bellyDist!.get(a, c) < d, 'z');
          add('belly', f ?? 'north').wide = true;
          return;
        }
        add('belly', f ?? 'north');
        return;
      }
      if (!next.has(x, z)) {
        // Step edge.
        const f = facingTowardsSet(x, z, (a, c) => next.has(a, c), 'z');
        if (f) return add('stair', f);
        const closing = owners.filter((i) => Y - roofs[i].yb === roofs[i].layers.length - 1);
        if (closing.length === owners.length) {
          const r = roofs[closing[0]];
          const c = finalCell(r, r.full ? r.full[Y - r.yb] : layerOf(r, Y), x, z);
          const b: RoofBlock = { x, y: Y, z, kind: c.kind, facing: c.facing, roof: closing[0] };
          blocks.push(b);
          surface.set(key(x, Y, z), b);
          if (c.kind === 'tip') tips[closing[0]] = [x, Y, z];
          return;
        }
        return add('slab');
      }
      // Shell: a side towards the outside (in the directions the roofs shrink in).
      let dirs = 0;
      let thick = 1;
      let fill = false;
      for (const i of owners) {
        dirs |= roofs[i].dirs[Y - roofs[i].yb] ?? 15;
        thick = Math.max(thick, roofs[i].dicke);
        fill ||= roofs[i].fuellen;
      }
      for (const s of SIDES) {
        if (!(dirs & s.bit)) continue;
        for (let k = 1; k <= thick; k++) {
          if (!cur.has(x + s.dx * k, z + s.dz * k)) return add('full');
        }
      }
      if (fill) add('full');
      else inner.push([x, z]);
    });
    // Seal: an attic cell next to a stair or slab of the surface whose side towards it is
    // open (slanted edges, where stairs meet only diagonally) becomes a full block, so the roof
    // has no gaps to look through.
    const get = (x: number, z: number) => surface.get(key(x, Y, z));
    for (const [x, z] of inner) {
      for (const s of SIDES) {
        const n = get(x - s.dx, z - s.dz);
        if (!n || !opensTowards(n, s.facing, get)) continue;
        const b: RoofBlock = { x, y: Y, z, kind: 'full', roof: n.roof, seal: true };
        blocks.push(b);
        surface.set(key(x, Y, z), b);
        break;
      }
    }
  }

  // Gables: wall lines of gable roofs, under the next layer's outline, where still empty.
  for (const [ri, r] of roofs.entries()) {
    for (const [gi, g] of r.gables.entries()) {
      const [ox, oz] = FACING_STEP[g.out];
      for (let y = 0; y < r.layers.length; y++) {
        const Y = r.yb + y;
        const above = r.layers[y + 1] ?? CellSet.EMPTY;
        for (let t = g.lo; t <= g.hi; t++) {
          const [x, z] = g.axis === 'x' ? [t, g.fixed] : [g.fixed, t];
          if (!above.has(x, z) || surface.has(key(x, Y, z))) continue;
          // Gables inside the united roof body fall away: another roof passes over the cell, or
          // covers the cell in front of the gable (in this layer or the next).
          const inside = ownersAt(Y + 1).other(x, z, ri) || ownersAt(Y + 1).other(x + ox, z + oz, ri) || ownersAt(Y).other(x + ox, z + oz, ri);
          if (inside) continue;
          blocks.push({ x, y: Y, z, kind: 'gable', roof: ri, line: gi });
          surface.set(key(x, Y, z), blocks[blocks.length - 1]);
        }
      }
    }
  }

  // Verge: under each stair of the outermost column at the gable ends.
  for (const [ri, r] of roofs.entries()) {
    if (!r.kante) continue;
    for (const [vi, v] of r.verge.entries()) {
      for (let y = 1; y < r.layers.length; y++) {
        const Y = r.yb + y;
        r.layers[y].forEach((x, z) => {
          if ((v.axis === 'x' ? x : z) !== v.at) return;
          const b = surface.get(key(x, Y, z));
          if (!b || (b.kind !== 'stair' && b.kind !== 'ridgeStair')) return;
          if (surface.has(key(x, Y - 1, z))) return;
          if (ownersAt(Y - 1).other(x, z, ri)) return;
          const vb: RoofBlock = { x, y: Y - 1, z, kind: 'verge', facing: v.towards, roof: ri, line: vi };
          blocks.push(vb);
          surface.set(key(x, Y - 1, z), vb);
        });
      }
    }
  }

  // Eaves: under the cells of layer 0 outside the wall.
  for (const [ri, r] of roofs.entries()) {
    if (!r.traufe) continue;
    const dist = new ChebDistance(r.wall, r.layers[0] ?? CellSet.EMPTY, 32);
    (r.layers[0] ?? CellSet.EMPTY).forEach((x, z) => {
      if (r.wall.has(x, z) || !surface.has(key(x, r.yb, z))) return;
      const Y = r.yb - 1;
      if (surface.has(key(x, Y, z))) return;
      const d = dist.get(x, z);
      const f = facingTowardsSet(x, z, (a, c) => r.wall.has(a, c) || dist.get(a, c) < d, 'z') ?? 'north';
      const eb: RoofBlock = { x, y: Y, z, kind: 'eave', facing: f, slab: r.traufe === 'stufe', roof: ri };
      blocks.push(eb);
      surface.set(key(x, Y, z), eb);
    });
  }

  // Ridge decorations and spires: one layer above.
  for (const b of [...blocks]) {
    const r = roofs[b.roof];
    if (!r.hasRidgeDeco) continue;
    const isRidge = b.kind === 'ridge' || b.kind === 'tip' || (b.kind === 'ridgeStair' && (b.facing === 'south' || b.facing === 'east'));
    if (!isRidge) continue;
    if (surface.has(key(b.x, b.y + 1, b.z))) continue;
    const db: RoofBlock = { x: b.x, y: b.y + 1, z: b.z, kind: 'deco', roof: b.roof };
    blocks.push(db);
    surface.set(key(b.x, b.y + 1, b.z), db);
  }
  for (const [ri, r] of roofs.entries()) {
    const t = tips[ri];
    if (opts.spires === false || !r.hasTip || !t) continue;
    const [x, y, z] = t;
    const k = key(x, y + 1, z);
    const existing = surface.get(k);
    if (existing && existing.kind !== 'deco') continue;
    if (existing) blocks.splice(blocks.indexOf(existing), 1);
    const sb: RoofBlock = { x, y: y + 1, z, kind: 'spire', roof: ri };
    blocks.push(sb);
    surface.set(k, sb);
  }
  return { blocks, tips, roofs };
}

/** Kranzdach: ring roof outside a form, rising towards the wall it ends at. */
export function renderSkirt(
  wall: CellSet,
  breite: number,
  profile: RoofProfile,
  kante: boolean,
): { x: number; z: number; k: number; kind: 'stair' | 'belly' | 'slab' | 'full' | 'verge'; facing?: Facing }[] {
  const reach = breite + 16;
  const dist = new ChebDistance(wall, wall.dilate(reach), reach);
  const ringUpTo = (d: number) => (d < 1 ? CellSet.EMPTY : wall.dilate(d).minus(wall));
  const out: { x: number; z: number; k: number; kind: 'stair' | 'belly' | 'slab' | 'full' | 'verge'; facing?: Facing }[] = [];
  const layers: CellSet[] = [];
  for (let k = 0; k < 256; k++) {
    const a = insetAt(profile, k, breite);
    if (a === null) break;
    const O = ringUpTo(breite - a);
    if (O.isEmpty()) break;
    layers.push(O);
  }
  if (layers.length === 255) throw new TessError(0, 'Das Kranzdach schließt sich nicht.');
  const inWall = (x: number, z: number) => wall.has(x, z);
  for (let k = 0; k < layers.length; k++) {
    const cur = layers[k];
    const next = layers[k + 1] ?? CellSet.EMPTY;
    const prev = k > 0 ? layers[k - 1] : null;
    cur.forEach((x, z) => {
      if (prev && !prev.has(x, z)) {
        const f = facingTowardsSet(x, z, (a, c) => prev.has(a, c) || inWall(a, c), 'z') ?? 'north';
        out.push({ x, z, k, kind: 'belly', facing: f });
        return;
      }
      if (!next.has(x, z)) {
        const f = facingTowardsSet(x, z, (a, c) => next.has(a, c) || inWall(a, c), 'z');
        out.push(f ? { x, z, k, kind: 'stair', facing: f } : { x, z, k, kind: 'slab' });
        return;
      }
      for (const s of SIDES) {
        const nx = x + s.dx;
        const nz = z + s.dz;
        if (!cur.has(nx, nz) && !inWall(nx, nz)) {
          out.push({ x, z, k, kind: 'full' });
          return;
        }
      }
    });
  }
  if (kante && layers[0]) {
    layers[0].forEach((x, z) => {
      if (dist.get(x, z) !== breite) return;
      const f = facingTowardsSet(x, z, (a, c) => dist.get(a, c) < breite, 'z') ?? 'north';
      out.push({ x, z, k: -1, kind: 'verge', facing: f });
    });
  }
  return out;
}

