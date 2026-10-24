import { CellSet, ChebDistance, DIAGONALS, facingTowardsSet, SIDES } from './cells';
import type { Facing } from './geometry';
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
}

export function layerOf(r: RoofDef, Y: number): CellSet {
  const i = Y - r.yb;
  return i >= 0 && i < r.layers.length ? r.layers[i] : CellSet.EMPTY;
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

/** A cell of a roof's last layer: ridge slab, tip, or a stair facing the middle. */
function finalCell(r: RoofDef, S: CellSet, x: number, z: number): { kind: RoofBlockKind; facing?: Facing } {
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

export interface GroupRender {
  blocks: RoofBlock[];
  /** Per roof: whether it ends in a single tip cell, and where. */
  tips: (readonly [number, number, number] | null)[];
}

/**
 * Renders a group of roofs (one roof or several that touch) as the union of their layer
 * outlines. Returns the blocks in placing order: roof surface first, then gables, verges,
 * eaves and decorations (those only go into empty cells).
 */
export function renderRoofs(roofs: readonly RoofDef[]): GroupRender {
  const blocks: RoofBlock[] = [];
  const yLo = Math.min(...roofs.map((r) => r.yb));
  const yHi = Math.max(...roofs.map((r) => r.yb + r.layers.length - 1));
  const U: CellSet[] = [];
  for (let Y = yLo; Y <= yHi; Y++) {
    let u = CellSet.EMPTY;
    for (const r of roofs) u = u.union(layerOf(r, Y));
    U.push(u);
  }
  const unionAt = (Y: number) => (Y < yLo || Y > yHi ? CellSet.EMPTY : U[Y - yLo]);
  const surface = new Map<string, RoofBlock>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const tips: (readonly [number, number, number] | null)[] = roofs.map(() => null);

  for (let Y = yLo; Y <= yHi; Y++) {
    const cur = unionAt(Y);
    const next = unionAt(Y + 1);
    const prev = unionAt(Y - 1);
    if (cur.isEmpty()) continue;
    // Belly: cells that a roof adds in this layer and that no roof covered below.
    const belly = new Set<string>();
    for (const r of roofs) {
      if (Y <= r.yb) continue;
      const here = layerOf(r, Y);
      const below = layerOf(r, Y - 1);
      here.forEach((x, z) => {
        if (!below.has(x, z) && !prev.has(x, z)) belly.add(`${x},${z}`);
      });
    }
    let bellyDist: ChebDistance | null = null;
    cur.forEach((x, z) => {
      const owners: number[] = [];
      for (let i = 0; i < roofs.length; i++) if (layerOf(roofs[i], Y).has(x, z)) owners.push(i);
      const roof = owners[0];
      const add = (kind: RoofBlockKind, facing?: Facing) => {
        const b: RoofBlock = { x, y: Y, z, kind, facing, roof };
        blocks.push(b);
        surface.set(key(x, Y, z), b);
      };
      if (belly.has(`${x},${z}`)) {
        let f = facingTowardsSet(x, z, (a, c) => prev.has(a, c), 'z');
        if (!f) {
          // Wide belly: face the neighbour that is closer to the layer below.
          bellyDist ??= new ChebDistance(prev, cur, 64);
          const d = bellyDist.get(x, z);
          f = facingTowardsSet(x, z, (a, c) => bellyDist!.get(a, c) < d, 'z');
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
          const c = finalCell(r, layerOf(r, Y), x, z);
          const b: RoofBlock = { x, y: Y, z, kind: c.kind, facing: c.facing, roof: closing[0] };
          blocks.push(b);
          surface.set(key(x, Y, z), b);
          if (c.kind === 'tip' && layerOf(r, Y).count === 1) tips[closing[0]] = [x, Y, z];
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
    });
  }

  // Gables: wall lines of gable roofs, under the next layer's outline, where still empty.
  for (const [ri, r] of roofs.entries()) {
    for (const g of r.gables) {
      const [ox, oz] = FACING_STEP[g.out];
      for (let y = 0; y < r.layers.length; y++) {
        const Y = r.yb + y;
        const above = r.layers[y + 1] ?? CellSet.EMPTY;
        for (let t = g.lo; t <= g.hi; t++) {
          const [x, z] = g.axis === 'x' ? [t, g.fixed] : [g.fixed, t];
          if (!above.has(x, z) || surface.has(key(x, Y, z))) continue;
          // Gables inside the united roof body fall away.
          const inside = roofs.some((o, oi) => oi !== ri && (layerOf(o, Y + 1).has(x, z) || layerOf(o, Y + 1).has(x + ox, z + oz)));
          if (inside) continue;
          blocks.push({ x, y: Y, z, kind: 'gable', roof: ri });
          surface.set(key(x, Y, z), blocks[blocks.length - 1]);
        }
      }
    }
  }

  // Verge: under each stair of the outermost column at the gable ends.
  for (const [ri, r] of roofs.entries()) {
    if (!r.kante) continue;
    for (const v of r.verge) {
      for (let y = 1; y < r.layers.length; y++) {
        const Y = r.yb + y;
        r.layers[y].forEach((x, z) => {
          if ((v.axis === 'x' ? x : z) !== v.at) return;
          const b = surface.get(key(x, Y, z));
          if (!b || b.kind !== 'stair') return;
          if (surface.has(key(x, Y - 1, z))) return;
          if (roofs.some((o, oi) => oi !== ri && layerOf(o, Y - 1).has(x, z))) return;
          const vb: RoofBlock = { x, y: Y - 1, z, kind: 'verge', facing: v.towards, roof: ri };
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
    if (!r.hasTip || !t) continue;
    const [x, y, z] = t;
    const k = key(x, y + 1, z);
    const existing = surface.get(k);
    if (existing && existing.kind !== 'deco') continue;
    if (existing) blocks.splice(blocks.indexOf(existing), 1);
    const sb: RoofBlock = { x, y: y + 1, z, kind: 'spire', roof: ri };
    blocks.push(sb);
    surface.set(k, sb);
  }
  return { blocks, tips };
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

export { DIAGONALS };
