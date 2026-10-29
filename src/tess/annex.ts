import { Args } from './args';
import { CellSet, ChebDistance, DIAGONALS, facingTowardsSet, sideBit } from './cells';
import type { Compiler, FormObj, Vec3 } from './compile';
import { BoxShape, DiscShape, PlanShape } from './forms';
import { axisOf, cw, DIR, opposite, type Facing } from './geometry';
import { Part } from './grid';
import { checkWindowArt, placeDoor, placeWindow, windowOpts, WINDOW_ARTS, type DoorOpts, type WindowArt } from './openings';
import type { RoleRef } from './palette';
import { insetAt, layerOf, parseRoofProfile, type GableWall, type RoofDef, type RoofProfile } from './roof';
import { asciiKey, TessError, type Statement } from './syntax';
import { cellAngle, heightOf, readSpots, SPOT_KEYS, type Spot, type Wall } from './wall';

/**
 * Anbauten (Bau-Sprache 2, 6.5): balconies, walkways around a form, oriels, dormers and corner
 * turrets. Outside the wall they only go into air; where something is in the way it stays and
 * the statement gets a hint with the obstacle's line. Default roles: boden=rahmen,
 * gelaender=rahmen:zaun, konsolen=rahmen, dachrolle=dach.
 */

const WHAT = {
  balkon: 'Der Balkon',
  umgang: 'Der Umgang',
  erker: 'Der Erker',
  gaube: 'Die Gaube',
  ecktuerme: 'Das Ecktürmchen',
};

/** A role option that may be switched off with `nein`. */
function optRole(c: Compiler, a: Args, key: string, def: string, member?: 'fence' | 'block'): RoleRef | null {
  const v = a.str(key) ?? def;
  if (['nein', 'aus', 'ohne'].includes(asciiKey(v))) return null;
  if (member === 'fence') return a.has(key) ? c.railRef(v) : c.memberRef(v, 'fence');
  return c.ref(v);
}

/** Front coordinate of a cell along a direction (larger = further out). */
const front = (x: number, z: number, out: Facing) => x * DIR[out][0] + z * DIR[out][1];

/** Cell of a column at a front coordinate, moving from the column's wall cell along `out`. */
function atFront(w: readonly number[], out: Facing, F: number): [number, number] {
  const [dx, dz] = DIR[out];
  const k = F - front(w[0], w[w.length - 1], out);
  return [w[0] + dx * k, w[w.length - 1] + dz * k];
}

// ---------------------------------------------------------------------------
// balkon

/** balkon <form> <seite> (y=|ebene=) [x=|z=|versatz=] b=<n> [tiefe=1..4] [boden=] [gelaender=] [konsolen=] [stuetzen=] [dach=] [tuer=ja] */
export function balconyCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), [...SPOT_KEYS, 'b', 'tiefe', 'boden', 'gelaender', 'konsolen', 'stuetzen', 'dach', 'tuer']);
  const f = c.bauteilForm(a);
  const b = a.requireInt('b', 1, 32, 'Die Breite des Balkons.');
  const spots = readSpots(c, a, f, { width: b, needHeight: true, what: WHAT.balkon });
  a.done();
  const depth = a.int('tiefe', 1, 1, 4);
  const floor = c.ref(a.str('boden') ?? 'rahmen');
  const rail = optRole(c, a, 'gelaender', 'rahmen:zaun', 'fence');
  const posts = a.has('stuetzen') ? c.ref(a.str('stuetzen')!) : null;
  const consoles = posts ? null : optRole(c, a, 'konsolen', 'rahmen');
  if (posts && a.has('konsolen')) throw new TessError(st.line, '„stuetzen=“ ersetzt die Konsolen; beides zusammen geht nicht.');
  const roof = a.has('dach') ? c.ref(a.str('dach')!) : null;
  const door = a.bool('tuer', false);
  for (const s of spots) balcony(c, f, s, { depth, floor, rail, consoles, posts, roof, door });
}

function balcony(
  c: Compiler,
  f: FormObj,
  s: Spot,
  o: { depth: number; floor: RoleRef; rail: RoleRef | null; consoles: RoleRef | null; posts: RoleRef | null; roof: RoleRef | null; door: boolean },
): void {
  const { wall, start, width: b, y } = s;
  const out = wall.out;
  const inward = opposite(out);
  const yf = y - 1;
  const what = WHAT.balkon;
  const cols: { t: number; w: Vec3 }[] = [];
  for (let i = -1; i <= b; i++) {
    const w = wall.cell(start + i, yf) ?? wall.cell(start + i, y);
    if (w) cols.push({ t: start + i, w });
  }
  const inner = cols.filter((q) => q.t >= start && q.t < start + b);
  if (!inner.length) {
    c.warn(`${what}: An dieser Stelle hat „${f.name}“ in y=${yf} keine Wand.`);
    return;
  }
  const fmax = Math.max(...inner.map((q) => front(q.w[0], q.w[2], out)));
  const F = fmax + o.depth;
  for (const { t, w } of inner) {
    const fw = front(w[0], w[2], out);
    const J = F - fw;
    for (let j = 1; j <= J; j++) {
      const [x, z] = atFront(w, out, fw + j);
      c.outPlace([x, yf, z], o.floor, o.floor.member, null, Part.Annex, 'y', what);
      const edge = j === J || t === start || t === start + b - 1;
      if (o.rail && edge) c.outPlace([x, y, z], o.rail, o.rail.member, null, Part.Annex, 'y', what);
      if (o.consoles) {
        // As 4.3: ring j (1 at the wall) gets its stair in layer yf-1-(J-j), full blocks above.
        const ys = yf - 1 - (J - j);
        c.outPlace([x, ys, z], o.consoles, 'stairs', { facing: inward, half: 'top' }, Part.Annex, undefined, what);
        for (let yy = ys + 1; yy <= yf - 1; yy++) c.outPlace([x, yy, z], o.consoles, 'block', null, Part.Annex, 'y', what);
      }
    }
  }
  if (o.posts) {
    for (const t of [start, start + b - 1]) {
      const q = inner.find((cc) => cc.t === t);
      if (!q) continue;
      const [x, z] = atFront(q.w, out, F);
      for (let yy = yf - 1; yy >= f.y0 && !c.grid.has(x, yy, z); yy--) c.place([x, yy, z], o.posts, o.posts.member, null, Part.Annex, 'y');
    }
  }
  if (o.roof) {
    // Lean-to roof from y+3 over the balcony plus 1, rising towards the wall.
    for (let k = 0; ; k++) {
      const Fk = F + 1 - k;
      let any = false;
      for (const { w } of cols) {
        const fw = front(w[0], w[2], out);
        if (Fk <= fw) continue;
        any = true;
        const [x, z] = atFront(w, out, Fk);
        c.outPlace([x, y + 3 + k, z], o.roof, 'stairs', { facing: inward, half: 'bottom' }, Part.Annex, undefined, what);
      }
      if (!any || k > 16) break;
    }
  }
  if (o.door) {
    const d: DoorOpts = { b: 1, h: 2, art: 'rechteck', door: c.ref('tuer'), frame: c.ref('rahmen'), transom: null, steps: 0, stepRole: null, canopy: null };
    placeDoor(c, f, { wall, start: start + Math.floor((b - 1) / 2), width: 1, y }, d);
  }
}

// ---------------------------------------------------------------------------
// umgang

/** umgang <form> (y=|ebene=) [tiefe=1..4] [boden=] [gelaender=] [konsolen=] [stuetzen=R abstand=4] [dach=R] */
export function gallery(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['y', 'ebene', 'tiefe', 'boden', 'gelaender', 'konsolen', 'stuetzen', 'abstand', 'dach']);
  const f = c.bauteilForm(a);
  a.done();
  const y = heightOf(c, a, f, true, undefined, 'Die Höhe des Umgangs');
  const D = a.int('tiefe', 1, 1, 4);
  const floor = c.ref(a.str('boden') ?? 'rahmen');
  const rail = optRole(c, a, 'gelaender', 'rahmen:zaun', 'fence');
  const posts = a.has('stuetzen') ? c.ref(a.str('stuetzen')!) : null;
  if (a.has('abstand') && !posts) throw new TessError(st.line, '„abstand=“ gilt für die Stützen („stuetzen=“).');
  // With posts, the braces under them replace the corbels; konsolen= then gives their material.
  const consoleRole = optRole(c, a, 'konsolen', 'rahmen');
  const consoles = posts ? null : consoleRole;
  const braces = posts ? (consoleRole ?? c.ref('rahmen')) : null;
  const step = a.int('abstand', 4, 1, 256);
  const roof = a.has('dach') ? c.ref(a.str('dach')!) : null;
  const what = WHAT.umgang;
  const yo = Math.max(f.y0, Math.min(f.y1, y));
  const O = c.outlineAt(f, yo);
  const dist = new ChebDistance(O, O.dilate(D + 1), D + 1);
  const ring = O.dilate(D).minus(O);
  const inO = (x: number, z: number) => O.has(x, z);
  const towardsWall = (x: number, z: number): Facing => {
    const d = dist.get(x, z);
    return facingTowardsSet(x, z, (p, q) => (d === 1 ? inO(p, q) : dist.get(p, q) === d - 1), 'x') ?? 'north';
  };
  const { px, pz } = c.centrePoint(f);
  const outer = ring
    .list()
    .filter(([x, z]) => dist.get(x, z) === D)
    .sort((p, q) => cellAngle(p[0], p[1], px, pz) - cellAngle(q[0], q[1], px, pz));
  const postCells = new Set<string>();
  if (posts) for (const i of postIndices(outer, c.cornersAt(f, yo), px, pz, step)) postCells.add(`${outer[i][0]},${outer[i][1]}`);
  // Posts carry what is above them: the walkway's own roof (its outer ring lies in layer y+4),
  // else the first block within six layers; with nothing above they are three layers high.
  const postTop = (x: number, z: number): number => {
    if (roof) return y + 3;
    for (let yy = y; yy <= y + 6; yy++) if (c.grid.get(x, yy, z)) return yy - 1;
    return y + 2;
  };
  ring.forEach((x, z) => {
    c.outPlace([x, y - 1, z], floor, floor.member, null, Part.Annex, 'y', what);
    const d = dist.get(x, z);
    if (d === D) {
      if (postCells.has(`${x},${z}`)) {
        const top = postTop(x, z);
        for (let yy = y; yy <= top; yy++) c.outPlace([x, yy, z], posts!, posts!.member, null, Part.Annex, 'y', what);
      } else if (rail) c.outPlace([x, y, z], rail, rail.member, null, Part.Annex, 'y', what);
    }
    if (consoles) {
      const ys = y - 2 - (D - d);
      c.outPlace([x, ys, z], consoles, 'stairs', { facing: towardsWall(x, z), half: 'top' }, Part.Annex, undefined, what);
      for (let yy = ys + 1; yy <= y - 2; yy++) c.outPlace([x, yy, z], consoles, 'block', null, Part.Annex, 'y', what);
    }
  });
  // Braces under the posts: from the post's cell down towards the wall.
  if (posts) {
    for (const key of postCells) {
      let [x, z] = key.split(',').map(Number);
      for (let yy = y - 2; dist.get(x, z) >= 1 && dist.get(x, z) <= D; yy--) {
        const d = dist.get(x, z);
        const f2 = towardsWall(x, z);
        c.outPlace([x, yy, z], braces!, 'stairs', { facing: f2, half: 'top' }, Part.Annex, undefined, what);
        if (d === 1) break;
        // One ring closer per layer: straight towards the wall, at corners diagonally.
        const next = [DIR[f2], ...DIAGONALS].map(([dx, dz]) => [x + dx, z + dz]).find(([p, q]) => dist.get(p, q) === d - 1);
        if (!next) break;
        [x, z] = next;
      }
    }
  }
  if (roof) {
    const yr = y + 3;
    const profile: RoofProfile = { kind: 'list', elems: [{ dx: 1, dy: 1 }] };
    c.buildSkirt(f, yr, D + 1, profile, roof, false, 'Das Dach des Umgangs', c.outlineAt(f, Math.max(f.y0, Math.min(f.y1, yr))));
  }
}

/**
 * Posts on the outer ring of a walkway (ring sorted clockwise from north). Forms with corners get
 * a post at each corner (the ring cell in the corner's direction from the centre) and between
 * two corners evenly spaced posts at most `step` cells apart; round forms get evenly spaced posts
 * starting in the north.
 */
function postIndices(ring: [number, number][], corners: CellSet, px: number, pz: number, step: number): number[] {
  const L = ring.length;
  if (!L) return [];
  const angles = ring.map(([x, z]) => cellAngle(x, z, px, pz));
  const anchors = new Set<number>();
  corners.forEach((x, z) => {
    const a = cellAngle(x, z, px, pz);
    let best = 0;
    let bd = Infinity;
    angles.forEach((b, i) => {
      const d = Math.abs(((b - a + 540) % 360) - 180);
      if (d < bd - 1e-9) {
        bd = d;
        best = i;
      }
    });
    anchors.add(best);
  });
  const out = new Set<number>();
  const sorted = [...anchors].sort((p, q) => p - q);
  if (!sorted.length) {
    const n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) out.add(Math.round((i * L) / n) % L);
  } else {
    sorted.forEach((s, k) => {
      const gap = sorted.length === 1 ? L : (sorted[(k + 1) % sorted.length] - s + L) % L;
      const parts = Math.max(1, Math.ceil(gap / step));
      for (let j = 0; j < parts; j++) out.add((s + Math.round((j * gap) / parts)) % L);
    });
  }
  return [...out].sort((p, q) => p - q);
}

/** Dispatch helper (keeps compile.ts free of Anbau details). */
export function annexCmd(c: Compiler, st: Statement, fn: (c: Compiler, st: Statement) => void): void {
  fn(c, st);
}

// ---------------------------------------------------------------------------
// erker

/** erker <form> <seite> (y=|ebene=) [x=|z=|versatz=] b= h= [tiefe=2] [art=eckig|halbrund|dreieck] <rolle> [name=] [konsolen=R stufen=2] [dach=] [dachrolle=] [dachprofil=] */
export function orielCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), [...SPOT_KEYS, 'b', 'h', 'tiefe', 'art', 'name', 'konsolen', 'stufen', 'dach', 'dachrolle', 'dachprofil']);
  const f = c.bauteilForm(a);
  const b = a.requireInt('b', 2, 32, 'Die Breite des Erkers an der Wand.');
  const h = a.requireInt('h', 1, 64, 'Die Höhe des Erkers.');
  const spots = readSpots(c, a, f, { width: b, needHeight: true, what: WHAT.erker });
  const role = c.ref(a.word1('Die Rolle des Erkers'));
  a.done();
  const art = a.choice('art', ['eckig', 'halbrund', 'dreieck'] as const, 'eckig');
  if (art === 'halbrund' && b % 2 === 0) throw new TessError(st.line, 'Ein halbrunder Erker braucht eine ungerade Breite (Radius (b−1)/2).');
  if (art === 'dreieck' && b % 2 === 0) throw new TessError(st.line, 'Ein dreieckiger Erker braucht eine ungerade Breite (Spitze in der Mitte).');
  if (art === 'halbrund' && a.has('tiefe')) throw new TessError(st.line, 'Beim halbrunden Erker ergibt sich die Tiefe aus der Breite (Radius (b−1)/2).');
  const depth = a.int('tiefe', art === 'dreieck' ? (b + 1) / 2 : 2, 1, 16);
  const name = a.has('name') ? asciiKey(a.str('name')!) : null;
  if (name && spots.length > 1) throw new TessError(st.line, '„name=“ geht nur bei einem einzelnen Erker (ohne „anzahl=“).');
  const consoles = optRole(c, a, 'konsolen', 'rahmen');
  const stufen = a.int('stufen', 2, 0, 16);
  const defRoof = art === 'eckig' ? 'walm' : art === 'halbrund' ? 'kegel' : 'helm';
  const roofType = a.choice('dach', ['walm', 'kegel', 'helm', 'sattel', 'flach', 'nein'] as const, defRoof);
  const roofRole = a.str('dachrolle') ?? 'dach';
  const roofProfile = a.str('dachprofil');
  if (roofType === 'nein' && (a.has('dachrolle') || a.has('dachprofil'))) throw new TessError(st.line, '„dachrolle=“ und „dachprofil=“ gelten nur mit einem Dach.');
  for (const s of spots) oriel(c, f, s, { art, depth, role, name, consoles, stufen, roofType, roofRole, roofProfile, h });
}

function oriel(
  c: Compiler,
  f: FormObj,
  s: Spot,
  o: {
    art: 'eckig' | 'halbrund' | 'dreieck';
    depth: number;
    role: RoleRef;
    name: string | null;
    consoles: RoleRef | null;
    stufen: number;
    roofType: 'walm' | 'kegel' | 'helm' | 'sattel' | 'flach' | 'nein';
    roofRole: string;
    roofProfile: string | undefined;
    h: number;
  },
): void {
  const { wall, start, width: b, y } = s;
  const out = wall.out;
  const inward = opposite(out);
  const what = WHAT.erker;
  const mid = start + Math.floor((b - 1) / 2);
  const wm = wall.cell(mid, y);
  if (!wm) {
    c.warn(`${what}: An dieser Stelle hat „${f.name}“ in y=${y} keine Wand.`);
    return;
  }
  const W = front(wm[0], wm[2], out);
  const lateral: Facing = cw(out);
  const [lx, lz] = DIR[lateral];
  const [ox, oz] = DIR[out];
  /** Cell at lateral offset u from the middle column and depth d in front of the wall plane. */
  const cellAt = (u: number, d: number): [number, number] => {
    const k = W + d - front(wm[0], wm[2], out);
    return [wm[0] + lx * u + ox * k, wm[2] + lz * u + oz * k];
  };
  const r = (b - 1) / 2;
  const uLo = -Math.floor((b - 1) / 2);
  const uHi = uLo + b - 1;
  const inShape = (u: number, d: number): boolean => {
    if (d < 1 || u < uLo || u > uHi) return false;
    if (o.art === 'eckig') return d <= o.depth;
    if (o.art === 'halbrund') return u * u + d * d <= (r + 0.5) * (r + 0.5);
    const half = o.depth <= 1 ? r : (r * (o.depth - d)) / (o.depth - 1);
    return d <= o.depth && Math.abs(u) <= Math.round(half + 1e-9);
  };
  const cells: { u: number; d: number; x: number; z: number }[] = [];
  const maxD = o.art === 'halbrund' ? Math.ceil(r) + 1 : o.depth;
  for (let u = uLo; u <= uHi; u++) for (let d = 1; d <= maxD; d++) if (inShape(u, d)) cells.push({ u, d, ...xz(cellAt(u, d)) });
  const F = CellSet.fromCells(cells.map((q) => [q.x, q.z]));
  // Walls: cells with a side neighbour outside the shape that is in front of the wall plane.
  const isWall = (q: { u: number; d: number }) =>
    (!inShape(q.u + 1, q.d) && q.d >= 1) || !inShape(q.u - 1, q.d) || !inShape(q.u, q.d + 1) || (q.d > 1 && !inShape(q.u, q.d - 1));
  const y1 = y + o.h - 1;
  for (let yy = y; yy <= y1; yy++) {
    for (const q of cells) {
      const p: Vec3 = [q.x, yy, q.z];
      // The oriel is a form: its walls are plain walls (windows go into them without a hint).
      if (yy === y || isWall(q)) c.outPlace(p, o.role, o.role.member, null, Part.Plain, 'y', what);
    }
  }
  // Inside goes over into the building: clear the main wall behind the oriel's interior.
  for (const q of cells) {
    if (q.d !== 1 || isWall(q)) continue;
    const [bx, bz] = cellAt(q.u, 0);
    for (let yy = y + 1; yy <= y1; yy++) {
      if (!c.isWallCell(f, bx, yy, bz)) continue;
      for (const p of c.wallDepth(f, [bx, yy, bz], inward)) c.clearCell(p);
    }
  }
  // Corbels: each layer one step narrower towards the wall.
  if (o.consoles) {
    for (let k = 1; k <= o.stufen; k++) {
      const layer = cells.filter((q) => inShape(q.u, q.d + k - 1));
      for (const q of layer) {
        const outer = !inShape(q.u, q.d + k);
        const p: Vec3 = [q.x, y - k, q.z];
        if (outer) c.outPlace(p, o.consoles, 'stairs', { facing: inward, half: 'top' }, Part.Annex, undefined, what);
        else c.outPlace(p, o.consoles, 'block', null, Part.Annex, 'y', what);
      }
    }
  }
  // The oriel as a form (windows, fields). A half-round one is round: no corners, so windows may
  // span the steps of its front.
  const form = c.makeForm('grundriss', new PlanShape(F, o.art === 'halbrund'), y, y1, o.role, { name: o.name ?? '', annex: true });
  if (o.name) c.register(form);
  if (o.roofType === 'nein') return;
  // Roof: computed on the shape mirrored behind the wall plane, built only in front of it.
  const mirrored: [number, number][] = [];
  for (const q of cells) mirrored.push([q.x, q.z], cellAt(q.u, 1 - q.d));
  let shape;
  let kind: 'box' | 'zylinder' | 'grundriss';
  if (o.art === 'eckig') {
    const M = CellSet.fromCells(mirrored);
    shape = new BoxShape(M.x0, M.z0, M.x1, M.z1);
    kind = 'box';
  } else if (o.art === 'halbrund') {
    shape = new DiscShape(wm[0], wm[2], { r: Math.round(r) });
    kind = 'zylinder';
  } else {
    shape = new PlanShape(CellSet.fromCells(mirrored));
    kind = 'grundriss';
  }
  const rf = c.makeForm(kind, shape, y, y1, o.role);
  const pairs: Record<string, string | undefined> = { rolle: o.roofRole, profil: o.roofProfile };
  if (o.roofType === 'sattel') pairs.first = axisOf(out) === 'x' ? 'x' : 'z';
  if (o.roofType === 'sattel' && kind !== 'box') throw new TessError(c.line, 'Ein Satteldach passt nur auf einen eckigen Erker.');
  const def = c.roofOn(c.synthArgs(pairs), rf, o.roofType, { keep: (x, z) => front(x, z, out) >= W + 1, tag: 'dach' });
  form.roofTop = rf.roofTop;
  if (def) form.roofs.push(def);
}

function xz(p: [number, number]): { x: number; z: number } {
  return { x: p[0], z: p[1] };
}

// ---------------------------------------------------------------------------
// gaube

/** gaube <form> <seite> [x=|z=|versatz=] [b=1] [h=2] [art=sattel|schlepp|spitz] [rolle=] [dachrolle=] [einzug=0] [fensterart=] [laeden=R] */
export function dormerCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), [...SPOT_KEYS.filter((k) => k !== 'y' && k !== 'ebene'), 'b', 'h', 'art', 'rolle', 'dachrolle', 'einzug', 'fensterart', 'laeden']);
  const f = c.bauteilForm(a);
  if (f.kind !== 'box') throw new TessError(st.line, 'Gauben gibt es auf box-Formen (an der Traufseite eines Dachs).');
  const roof = [...f.roofs].reverse().find((r) => r.layers.length > 1);
  if (!roof) throw new TessError(st.line, `Die Gaube braucht ein vorher gebautes Dach auf „${f.name}“ (dach … ${f.name}).`);
  const b = a.int('b', 1, 1, 16);
  const h = a.int('h', 2, 1, 16);
  const yb = roof.yb;
  const spots = readSpots(c, a, f, { width: b, needHeight: false, defaultY: yb, what: WHAT.gaube });
  a.done();
  const art = a.choice('art', ['sattel', 'schlepp', 'spitz'] as const, 'sattel');
  const role = a.has('rolle') ? c.ref(a.str('rolle')!) : f.role;
  const roofRole = c.ref(a.str('dachrolle') ?? 'dach');
  const einzug = a.int('einzug', 0, 0, 16);
  const fArt = a.choice<WindowArt>('fensterart', WINDOW_ARTS, 'rechteck');
  checkWindowArt(a, fArt, b, h, 'Das Gaubenfenster');
  const win = windowOpts(c, c.synthArgs({ laeden: a.str('laeden'), bank: 'nein', sturz: 'nein' }, ['laeden', 'bank', 'sturz'], []), f, fArt, b, h, 'Das Gaubenfenster');
  win.edgeCheck = false;
  for (const s of spots) {
    if (!(roof.dirs[0] & sideBit(s.wall.out))) throw new TessError(st.line, `Die Seite ${s.wall.label} ist keine Traufseite des Dachs aus Zeile ${c.grid.origins[roof.origin]?.line ?? '?'}; Gauben sitzen auf der Traufseite.`);
    dormer(c, f, roof, s, { b, h, art, role, roofRole, einzug, win });
  }
}

function dormer(
  c: Compiler,
  f: FormObj,
  roof: RoofDef,
  s: Spot,
  o: { b: number; h: number; art: 'sattel' | 'schlepp' | 'spitz'; role: RoleRef; roofRole: RoleRef; einzug: number; win: ReturnType<typeof windowOpts> },
): void {
  const { wall, start: t0 } = s;
  const out = wall.out;
  const yb = roof.yb;
  const ytop = yb + o.h; // front wall rows yb … yb+h
  const group = c.groupOf(roof);
  const roofs = group ? group.roofs : [roof];
  const union = (Y: number) => {
    let u = CellSet.EMPTY;
    for (const r of roofs) u = u.union(layerOf(r, Y));
    return u;
  };
  // Front plane: the wall plane of the side, moved inwards by einzug.
  const top = c.outlineAt(f, f.y1);
  const wallF = out === 'north' ? -top.z0 : out === 'south' ? top.z1 : out === 'west' ? -top.x0 : top.x1;
  const Ff = wallF - o.einzug;
  const [ox, oz] = DIR[out];
  const along: 'x' | 'z' = axisOf(out) === 'x' ? 'z' : 'x';
  const cellAt = (t: number, F: number): [number, number] => {
    if (along === 'x') return [t, F * oz];
    return [F * ox, t];
  };
  // Back end of the dormer: the ridge line of the main roof.
  const ridgeF = out === 'north' ? -Math.floor((top.z0 + top.z1) / 2) : out === 'south' ? Math.ceil((top.z0 + top.z1) / 2) : out === 'west' ? -Math.floor((top.x0 + top.x1) / 2) : Math.ceil((top.x0 + top.x1) / 2);
  const what = WHAT.gaube;
  const L0 = t0 - 1;
  const L1 = t0 + o.b;
  /** Depth (inwards from the front plane) of the main roof's surface in a column and layer. */
  const surface = (t: number, Y: number): number => {
    const U = union(Y);
    for (let d = 0; Ff - d >= ridgeF; d++) {
      const [x, z] = cellAt(t, Ff - d);
      if (U.has(x, z)) return d;
    }
    return Ff - ridgeF;
  };
  let tooHigh = false;
  for (let Y = yb; Y <= ytop; Y++) {
    for (let t = L0; t <= L1; t++) {
      const D = surface(t, Y);
      if (D >= Ff - ridgeF && !union(Y).has(...cellAt(t, ridgeF))) tooHigh = true;
      const cheek = t === L0 || t === L1;
      for (let d = 0; d <= D; d++) {
        const [x, z] = cellAt(t, Ff - d);
        const p: Vec3 = [x, Y, z];
        if (cheek || d === 0) c.place(p, o.role, o.role.member, null, Part.Annex, 'y');
        else c.clearCell(p);
      }
    }
  }
  if (tooHigh) c.warn(`${what} ragt über den First des Dachs; mach sie niedriger (h=) oder das Dach steiler.`);
  // Window in the front wall, above the lowest row (that one sits behind the eaves).
  const frontWall: Wall = {
    form: f,
    mode: 'face',
    out,
    plus: along === 'x' ? 'east' : 'south',
    axis: along,
    cell: (t, Y) => {
      const [x, z] = cellAt(t, Ff);
      return [x, Y, z];
    },
    isCorner: () => false,
    tMin: L0,
    tMax: L1,
    hit: t0,
    label: wall.label,
  };
  placeWindow(c, f, { wall: frontWall, start: t0, width: o.b, y: yb + 1 }, o.win);
  // Own roof, united with the main roof (5.3).
  const def = dormerRoof(c, o.art, { L0, L1, Ff, back: ridgeF, out, along, yb: ytop + 1 });
  c.addRoof(def, { role: o.roofRole, giebel: o.role, firstzier: null, spitze: null, form: f, line: c.line });
}

/** Roof of a dormer: sattel (ridge towards the main roof), schlepp (lean-to, 2/1) or spitz (hipped). */
function dormerRoof(
  c: Compiler,
  art: 'sattel' | 'schlepp' | 'spitz',
  g: { L0: number; L1: number; Ff: number; back: number; out: Facing; along: 'x' | 'z'; yb: number },
): RoofDef {
  const { L0, L1, Ff, back, out, along, yb } = g;
  const [ox, oz] = DIR[out];
  // Rectangle in (t, F) coordinates → cells.
  const rect = (t0: number, t1: number, f0: number, f1: number): CellSet => {
    if (t1 < t0 || f1 < f0) return CellSet.EMPTY;
    const xs = along === 'x' ? [t0, t1] : [f0 * ox, f1 * ox];
    const zs = along === 'x' ? [f0 * oz, f1 * oz] : [t0, t1];
    return CellSet.rect(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  };
  const profile: RoofProfile = parseRoofProfile(art === 'schlepp' ? '2/1' : '1/1', c.line);
  const layers: CellSet[] = [];
  const width = L1 - L0 + 2;
  const depthSpan = Ff + 1 - back;
  for (let i = 0; i < 64; i++) {
    const a = insetAt(profile, i, width)!;
    let O: CellSet;
    if (art === 'sattel') O = rect(L0 - 1 + a, L1 + 1 - a, back, Ff + 1);
    else if (art === 'schlepp') O = rect(L0 - 1, L1 + 1, back, Ff + 1 - a);
    else O = rect(L0 - 1 + a, L1 + 1 - a, back + a, Ff + 1 - a);
    if (O.isEmpty() || (art === 'schlepp' && a > depthSpan)) break;
    layers.push(O);
  }
  const lat = along === 'x' ? (['east', 'west'] as const) : (['south', 'north'] as const);
  const dirsNormal = art === 'sattel' ? sideBit(lat[0]) | sideBit(lat[1]) : art === 'schlepp' ? sideBit(out) : 15;
  const frontLine = Ff * (along === 'x' ? oz : ox);
  const gables: GableWall[] = [];
  const verge: RoofDef['verge'] = [];
  if (art === 'sattel') {
    gables.push({ axis: along, fixed: frontLine, lo: L0, hi: L1, out });
    verge.push({ axis: along === 'x' ? 'z' : 'x', at: (Ff + 1) * (along === 'x' ? oz : ox), towards: opposite(out) });
  } else if (art === 'schlepp') {
    const fa = Math.min(back, Ff) * (along === 'x' ? oz : ox);
    const fb = Math.max(back, Ff) * (along === 'x' ? oz : ox);
    gables.push({ axis: along === 'x' ? 'z' : 'x', fixed: L0, lo: Math.min(fa, fb), hi: Math.max(fa, fb), out: along === 'x' ? 'west' : 'north' });
    gables.push({ axis: along === 'x' ? 'z' : 'x', fixed: L1, lo: Math.min(fa, fb), hi: Math.max(fa, fb), out: along === 'x' ? 'east' : 'south' });
  }
  const base = layers[0] ?? CellSet.EMPTY;
  return {
    index: c.roofCount++,
    type: art === 'sattel' ? 'sattel' : art === 'schlepp' ? 'pult' : 'walm',
    origin: c.taggedOrigin('gaubendach'),
    seq: c.seq,
    yb,
    layers,
    dirs: layers.map(() => dirsNormal),
    crossAxis: art === 'sattel' ? along : art === 'schlepp' ? (along === 'x' ? 'z' : 'x') : null,
    base,
    wall: rect(L0, L1, back, Ff),
    gables,
    verge,
    kante: art === 'sattel',
    traufe: null,
    dicke: 1,
    fuellen: false,
    hasRidgeDeco: false,
    hasTip: false,
  };
}

// ---------------------------------------------------------------------------
// ecktuerme

const CORNER_ANGLES: Record<string, number> = { nw: 315, no: 45, so: 135, sw: 225, nordwest: 315, nordost: 45, suedost: 135, suedwest: 225 };

/** ecktuerme <form> [an=alle|nw,no,so,sw] r=<1..3> h= (y=|ebene=) <rolle> [einzug=1] [konsolen=R stufen=r] [dach=helm|kegel|walm] [dachrolle=] [dachprofil=] [biegung=] [spitze=] */
export function cornerTurretsCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['an', 'r', 'h', 'y', 'ebene', 'einzug', 'konsolen', 'stufen', 'dach', 'dachrolle', 'dachprofil', 'biegung', 'spitze']);
  const f = c.bauteilForm(a);
  const role = c.ref(a.word1('Die Rolle der Türmchen'));
  a.done();
  if (f.kind !== 'box' && f.kind !== 'umriss' && f.kind !== 'vieleck') throw new TessError(st.line, 'Ecktürmchen gibt es an box, umriss und vieleck (Formen mit Ecken).');
  const r = a.requireInt('r', 1, 3, 'Der Radius der Türmchen (1 bis 3).');
  const h = a.requireInt('h', 1, 256, 'Die Höhe der Türmchen.');
  const y = heightOf(c, a, f, true, undefined, 'Die Höhe der Türmchen');
  const einzug = a.int('einzug', 1, 0, 3);
  const consoles = optRole(c, a, 'konsolen', 'rahmen');
  const stufen = a.int('stufen', r, 0, 8);
  const roofType = a.choice('dach', ['helm', 'kegel', 'walm'] as const, 'helm');
  const pairs = { rolle: a.str('dachrolle') ?? 'dach', profil: a.str('dachprofil'), biegung: a.str('biegung'), spitze: a.str('spitze') };
  const refY = Math.max(f.y0, Math.min(f.y1, y));
  const O = c.outlineAt(f, refY);
  const { px, pz } = c.centrePoint(f);
  let corners = c.cornersAt(f, refY).list();
  const an = a.str('an');
  if (an !== undefined && asciiKey(an) !== 'alle') {
    const wanted = an.split(',').map((w) => {
      const ang = CORNER_ANGLES[asciiKey(w.trim())];
      if (ang === undefined) throw new TessError(st.line, `„an=${an}“: „${w}“ ist keine Ecke (nw, no, so, sw oder alle).`);
      return ang;
    });
    const angleOf = ([x, z]: [number, number]) => (Math.atan2(x + 0.5 - px, -(z + 0.5 - pz)) * 180) / Math.PI;
    corners = wanted.map((w) => {
      let best = corners[0];
      let bd = Infinity;
      for (const cc of corners) {
        const d = Math.abs(((angleOf(cc) - w + 540) % 360) - 180);
        if (d < bd) {
          bd = d;
          best = cc;
        }
      }
      return best;
    });
  }
  const what = WHAT.ecktuerme;
  for (const [cx, cz] of corners) {
    let sx = !O.has(cx - 1, cz) ? -1 : !O.has(cx + 1, cz) ? 1 : 0;
    let sz = !O.has(cx, cz - 1) ? -1 : !O.has(cx, cz + 1) ? 1 : 0;
    if (!sx) sx = cx + 0.5 >= px ? 1 : -1;
    if (!sz) sz = cz + 0.5 >= pz ? 1 : -1;
    const tx = cx + sx * (r - einzug);
    const tz = cz + sz * (r - einzug);
    const shape = new DiscShape(tx, tz, { r });
    const disc = shape.outline(0);
    const dist = disc.insideDistance();
    const inMain = (x: number, yy: number, z: number) => yy >= f.y0 && yy <= f.y1 && c.outlineAt(f, yy).has(x, z);
    /** Turret cells replace roof blocks (eaves) of the main form but nothing else. */
    const put = (p: Vec3, member: 'block' | 'stairs', props: Record<string, string> | null, axis?: 'x' | 'y' | 'z') => {
      const info = c.grid.cellInfo(p[0], p[1], p[2]);
      if (info && info.part === Part.Roof) c.clearCell(p);
      c.outPlace(p, role, member, props, Part.Annex, axis, what);
    };
    for (let yy = y; yy < y + h; yy++) {
      disc.forEach((x, z) => {
        if (inMain(x, yy, z)) return;
        const d = disc.at(dist, x, z);
        if (r >= 2 && d > 1) {
          const info = c.grid.cellInfo(x, yy, z);
          if (info && info.part === Part.Roof) c.clearCell([x, yy, z]);
          return;
        }
        put([x, yy, z], 'block', null, 'y');
      });
    }
    // Corbels as an upside-down cone.
    if (consoles) {
      for (let k = 1; k <= stufen; k++) {
        const ring = shape.outline(-(k - 1));
        const core = shape.outline(-k);
        ring.forEach((x, z) => {
          const yy = y - k;
          if (inMain(x, yy, z)) return;
          if (core.has(x, z)) c.outPlace([x, yy, z], consoles, 'block', null, Part.Annex, 'y', what);
          else {
            const facing = facingTowardsSet(x, z, (p, q) => (core.isEmpty() ? p === tx && q === tz : core.has(p, q)), 'x') ?? 'north';
            c.outPlace([x, yy, z], consoles, 'stairs', { facing, half: 'top' }, Part.Annex, undefined, what);
          }
        });
      }
    }
    const tf = c.makeForm('zylinder', shape, y, y + h - 1, role, { hollow: r >= 2 });
    c.roofOn(c.synthArgs(pairs), tf, roofType, { tag: 'dach' });
  }
}
