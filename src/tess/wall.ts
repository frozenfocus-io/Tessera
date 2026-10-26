import type { Args } from './args';
import type { CellSet } from './cells';
import type { Compiler, Face, FormObj } from './compile';
import { PolygonShape } from './forms';
import { axisOf, ccw, cw, DIR, type Facing } from './geometry';
import { LIMIT_V2 } from './grid';
import { asciiKey, TessError } from './syntax';

/**
 * Where Bauteile sit on a wall (Bau-Sprache 2, 6.1). A side (n/o/s/w, on round forms also
 * no/so/sw/nw), an angle (`winkel=`) or a polygon side (`seite=k`) gives a direction from the
 * form's centre. The ray in that direction hits the outermost wall cell of the layer; "outside"
 * is the ray's direction rounded to the nearest main direction.
 *
 * Main directions use a face: one column per coordinate along the wall (x for n/s, z for o/w),
 * each with the outermost cell in that direction (as in version 1, so files keep their blocks).
 * Other directions walk along the ring of wall cells, sorted by angle, one column per cell.
 */

type Vec3 = [number, number, number];

/** A wall line: columns along the wall, each with its wall cell per layer. */
export interface Wall {
  form: FormObj;
  mode: 'face' | 'ring';
  /** Outward direction (rounded to a main direction). */
  out: Facing;
  /** Direction of increasing column numbers along the wall. */
  plus: Facing;
  /** Axis of the wall (logs in lintels lie along it). */
  axis: 'x' | 'z';
  /** Wall cell of a column in layer y (null where the wall has none). */
  cell(col: number, y: number): Vec3 | null;
  isCorner(col: number, y: number): boolean;
  /** Face mode: absolute coordinate range of the face at the reference layer. */
  tMin: number;
  tMax: number;
  /** Ring mode: column hit by the ray. */
  hit: number;
  /** Side as written (messages). */
  label: string;
}

/** One instance of a Bauteil: its wall, first column and reference height. */
export interface Spot {
  wall: Wall;
  start: number;
  width: number;
  y: number;
}

const SIDE_ANGLES: Record<string, number> = {
  n: 0,
  nord: 0,
  norden: 0,
  no: 45,
  nordost: 45,
  nordosten: 45,
  o: 90,
  ost: 90,
  osten: 90,
  so: 135,
  suedost: 135,
  suedosten: 135,
  s: 180,
  sued: 180,
  sueden: 180,
  sw: 225,
  suedwest: 225,
  suedwesten: 225,
  w: 270,
  west: 270,
  westen: 270,
  nw: 315,
  nordwest: 315,
  nordwesten: 315,
};

export function sideAngle(word: string): number | null {
  return SIDE_ANGLES[asciiKey(word)] ?? null;
}

const MAIN: Facing[] = ['north', 'east', 'south', 'west'];

/** Main direction of a compass angle that is a multiple of 90°, else null. */
export function mainOf(angle: number): Facing | null {
  const a = norm(angle);
  const k = Math.round(a / 90);
  return Math.abs(a - k * 90) < 1e-9 ? MAIN[k % 4] : null;
}

export function norm(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/** Compass angle of a cell centre around a point (0 = north, clockwise). */
export function cellAngle(x: number, z: number, px: number, pz: number): number {
  return norm((Math.atan2(x + 0.5 - px, -(z + 0.5 - pz)) * 180) / Math.PI);
}

/**
 * Outermost cell of a set along a ray from (px, pz) at a compass angle: the last cell of the
 * set the ray passes through (grid traversal, side steps only).
 */
export function rayHit(set: CellSet, px: number, pz: number, angle: number): [number, number] | null {
  if (set.isEmpty()) return null;
  const a = ((angle + 1e-7) * Math.PI) / 180;
  const dx = Math.sin(a);
  const dz = -Math.cos(a);
  let x = Math.floor(px);
  let z = Math.floor(pz);
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx);
  const tdz = Math.abs(1 / dz);
  let tx = dx > 0 ? (x + 1 - px) / dx : dx < 0 ? (px - x) / -dx : Infinity;
  let tz = dz > 0 ? (z + 1 - pz) / dz : dz < 0 ? (pz - z) / -dz : Infinity;
  let last: [number, number] | null = set.has(x, z) ? [x, z] : null;
  const lim = 4 * (set.w + set.h) + 8;
  for (let i = 0; i < lim; i++) {
    if (tx < tz) {
      x += stepX;
      tx += tdx;
    } else {
      z += stepZ;
      tz += tdz;
    }
    if (x < set.x0 - 1 && stepX < 0) break;
    if (x > set.x1 + 1 && stepX > 0) break;
    if (z < set.z0 - 1 && stepZ < 0) break;
    if (z > set.z1 + 1 && stepZ > 0) break;
    if (set.has(x, z)) last = [x, z];
  }
  return last;
}

/** Outward main direction of an angle; on a tie (diagonals) the open side of the hit cell wins. */
function roundOut(angle: number, O: CellSet, hit: [number, number] | null): Facing {
  const a = norm(angle);
  let best: Facing[] = [];
  let bestD = Infinity;
  MAIN.forEach((f, k) => {
    const d = Math.min(Math.abs(a - k * 90), 360 - Math.abs(a - k * 90));
    if (d < bestD - 1e-9) {
      bestD = d;
      best = [f];
    } else if (Math.abs(d - bestD) <= 1e-9) best.push(f);
  });
  if (best.length > 1 && hit) {
    const open = best.filter((f) => !O.has(hit[0] + DIR[f][0], hit[1] + DIR[f][1]));
    if (open.length) best = open;
  }
  // Ties without an open side: n, o, s, w.
  return MAIN.find((f) => best.includes(f))!;
}

/** Face mode: wraps Compiler.faceAt for a main side. */
function faceWall(c: Compiler, f: FormObj, side: Facing, refY: number, label: string): Wall {
  const face: Face = c.faceAt(f, side, refY);
  return {
    form: f,
    mode: 'face',
    out: side,
    plus: face.axis === 'x' ? 'east' : 'south',
    axis: face.axis,
    cell: (t, y) => face.cell(t, y),
    isCorner: (t, y) => face.isCorner(t, y),
    tMin: face.tMin,
    tMax: face.tMax,
    hit: Math.floor((face.tMin + face.tMax) / 2),
    label,
  };
}

/** Ring mode: wall cells of the reference layer sorted by angle, starting where the ray hits. */
function ringWall(c: Compiler, f: FormObj, angle: number, refY: number, label: string): Wall {
  const O = c.outlineAt(f, refY);
  const { px, pz } = c.centrePoint(f);
  const dist = O.insideDistance();
  const ring: [number, number][] = [];
  O.forEach((x, z) => {
    if (O.at(dist, x, z) === 1) ring.push([x, z]);
  });
  if (!ring.length) throw new TessError(c.line, `„${f.name}“ hat in Lage y=${refY} keine Wand.`);
  ring.sort((p, q) => cellAngle(p[0], p[1], px, pz) - cellAngle(q[0], q[1], px, pz));
  const hitCell = rayHit(O, px, pz, angle);
  let hit = hitCell ? ring.findIndex(([x, z]) => x === hitCell[0] && z === hitCell[1]) : -1;
  if (hit < 0) {
    // Nearest by angle.
    let bd = Infinity;
    ring.forEach(([x, z], i) => {
      const d = Math.abs(norm(cellAngle(x, z, px, pz) - angle + 180) - 180);
      if (d < bd) {
        bd = d;
        hit = i;
      }
    });
  }
  const out = roundOut(angle, O, ring[hit]);
  const n = ring.length;
  const angles = ring.map(([x, z]) => cellAngle(x, z, px, pz));
  const refOffset = c.offsetAt(f, refY);
  const at = (col: number): [number, number] => ring[((col % n) + n) % n];
  const plus = cw(out);
  return {
    form: f,
    mode: 'ring',
    out,
    plus,
    axis: axisOf(plus),
    cell: (col, y) => {
      if (y === refY || (!f.sphere && c.offsetAt(f, y) === refOffset)) {
        const [x, z] = at(col);
        return [x, y, z];
      }
      const h = rayHit(c.outlineAt(f, y), px, pz, angles[((col % n) + n) % n]);
      return h ? [h[0], y, h[1]] : null;
    },
    isCorner: (col, y) => {
      const p = y === refY ? at(col) : null;
      if (p) return c.cornersAt(f, y).has(p[0], p[1]);
      const q = rayHit(c.outlineAt(f, y), px, pz, angles[((col % n) + n) % n]);
      return !!q && c.cornersAt(f, y).has(q[0], q[1]);
    },
    tMin: 0,
    tMax: n - 1,
    hit,
    label,
  };
}

/** Wall for a direction (side word or angle) at a reference layer. */
export function wallFor(c: Compiler, f: FormObj, angle: number, refY: number, label: string): Wall {
  const main = mainOf(angle);
  if (main) return faceWall(c, f, main, refY, label);
  return ringWall(c, f, angle, refY, label);
}

/** Compass angle of the outward normal of polygon side k (side 0: normal nearest to north). */
export function polygonSideAngle(shape: PolygonShape, k: number): number {
  const normals = Array.from({ length: shape.n }, (_, i) => norm(shape.rotation + (360 * i) / shape.n + 180 / shape.n));
  let s0 = 0;
  let bd = Infinity;
  normals.forEach((a, i) => {
    const d = Math.min(a, 360 - a);
    if (d < bd - 1e-9) {
      bd = d;
      s0 = i;
    }
  });
  return normals[(((s0 + k) % shape.n) + shape.n) % shape.n];
}

export interface SpotOptions {
  /** Width of one instance in columns. */
  width: number;
  /** Whether a height (y= or ebene=) is required. */
  needHeight: boolean;
  /** Default height when none is given (absolute). */
  defaultY?: number;
  /** Default step between instances (start to start). */
  defaultStep?: number;
  /** Whether anzahl=/abstand= are allowed. */
  repeat?: boolean;
  /** Whether a side is optional (e.g. for Bauteile around the whole form). */
  what: string;
}

/** Keys of the placement options (6.1), to add to a command's allowed keys. */
export const SPOT_KEYS = ['x', 'z', 'versatz', 'y', 'ebene', 'winkel', 'seite', 'anzahl', 'abstand'];

/** Height from y= (absolute) or ebene= (relative to the form's lowest layer). */
export function heightOf(c: Compiler, a: Args, f: FormObj, need: boolean, def?: number, what = 'Die Höhe'): number {
  const hasY = a.has('y');
  const hasE = a.has('ebene');
  if (hasY && hasE) throw new TessError(a.line, '„y=“ und „ebene=“ schließen sich aus (y absolut, ebene relativ zur untersten Lage der Form).');
  if (hasY) return a.int('y', 0, -LIMIT_V2, LIMIT_V2);
  if (hasE) return f.y0 + a.int('ebene', 0, -LIMIT_V2, LIMIT_V2);
  if (need || def === undefined) throw new TessError(a.line, `${what} fehlt: „y=“ (absolut) oder „ebene=“ (relativ zur untersten Lage von „${f.name || f.kind}“).`);
  void c;
  return def;
}

/**
 * Reads side, position, height and repetition of a Bauteil (6.1) and returns its instances.
 * The side word is read from the positional arguments unless winkel=, seite= or (round forms)
 * anzahl= without a side is used.
 */
export function readSpots(c: Compiler, a: Args, f: FormObj, o: SpotOptions): Spot[] {
  const round = f.kind === 'zylinder' || f.kind === 'vieleck';
  const sideWord = a.peekWord() !== null && sideAngle(a.peekWord()!) !== null ? a.word1('Die Seite') : null;
  // On round forms anzahl= without a side word or seite= goes around the whole form; winkel= is then its start.
  const around = round && a.has('anzahl') && sideWord === null && !a.has('seite');
  if (sideWord === null && a.peekWord() !== null && !around && !a.has('winkel') && !a.has('seite')) {
    const w = a.peekWord()!;
    throw new TessError(a.line, `„${w}“ ist keine Seite. Erlaubt: n, o, s, w${f.kind === 'box' ? '' : ', no, so, sw, nw oder winkel=/seite='} (Norden = −z, Osten = +x).`);
  }
  const given = around ? 0 : [sideWord !== null, a.has('winkel'), a.has('seite')].filter(Boolean).length;
  if (given > 1) throw new TessError(a.line, 'Seite, „winkel=“ und „seite=“ schließen sich aus.');
  if (f.kind === 'box') {
    if (a.has('winkel') || a.has('seite')) throw new TessError(a.line, 'Bei einer box gibt es nur die Seiten n, o, s und w.');
    if (sideWord !== null && !mainOf(sideAngle(sideWord)!)) throw new TessError(a.line, `„${sideWord}“: Bei einer box gibt es nur die Seiten n, o, s und w.`);
  }
  if (a.has('seite') && f.kind !== 'vieleck') throw new TessError(a.line, '„seite=“ gibt es nur beim vieleck (Seite 0 zeigt am ehesten nach Norden, gezählt im Uhrzeigersinn).');
  const repeat = o.repeat !== false;
  if (!repeat && (a.has('anzahl') || a.has('abstand'))) throw new TessError(a.line, `„anzahl=“ und „abstand=“ gibt es bei „${a.cmd}“ nicht.`);
  const count = a.int('anzahl', 1, 1, 256);
  const y = heightOf(c, a, f, o.needHeight, o.defaultY);
  const label = sideWord ?? (a.has('seite') ? `seite=${a.str('seite')}` : a.has('winkel') ? `winkel=${a.str('winkel')}` : '');

  // Around the whole form: anzahl= without a side on round forms.
  if (given === 0) {
    if (!around) throw new TessError(a.line, `${o.what}: Die Seite fehlt (n, o, s, w${round ? ', no, so, sw, nw, winkel= oder anzahl= rundum' : ''}).`);
    if (a.has('abstand')) throw new TessError(a.line, '„abstand=“ gilt nur auf einer Seite; rundum verteilt „anzahl=“ gleichmäßig.');
    for (const k of ['x', 'z']) if (a.has(k)) throw new TessError(a.line, `„${k}=“ gibt es rundum nicht; nimm „versatz=“.`);
    const start = a.int('winkel', 0, -360, 360);
    const out: Spot[] = [];
    for (let i = 0; i < count; i++) {
      const ang = start + (360 * i) / count;
      const wall = wallFor(c, f, ang, y, `winkel=${Math.round(norm(ang) * 10) / 10}`);
      out.push({ wall, start: centredStart(a, wall, o.width, 1, o.width), width: o.width, y });
    }
    return out;
  }
  let angle: number;
  if (sideWord !== null) {
    angle = sideAngle(sideWord)!;
    if (!round && f.kind !== 'box' && !mainOf(angle)) {
      // umriss, grundriss: diagonals as angles are fine, too.
    }
  } else if (a.has('winkel')) angle = a.int('winkel', 0, -360, 360);
  else angle = polygonSideAngle(f.shape as PolygonShape, a.int('seite', 0, -64, 64));
  const wall = wallFor(c, f, angle, y, label);
  const step = a.int('abstand', o.defaultStep ?? o.width + 2, o.width + (repeat ? 0 : 0), 1024);
  if (a.has('abstand') && step < o.width) throw new TessError(a.line, `„abstand=${step}“ ist kleiner als die Breite ${o.width}.`);
  const first = centredStart(a, wall, o.width, count, step);
  return Array.from({ length: count }, (_, i) => ({ wall, start: first + i * step, width: o.width, y }));
}

/** First column: x=/z= (face mode), else centred on the side, moved by versatz= to the right (seen from outside). */
function centredStart(a: Args, wall: Wall, width: number, count: number, step: number): number {
  const span = (count - 1) * step + width;
  if (wall.mode === 'face') {
    const other = wall.axis === 'x' ? 'z' : 'x';
    if (a.has(other)) {
      throw new TessError(a.line, `Die Seite ${wall.label} läuft entlang ${wall.axis}; die Position wird mit „${wall.axis}=“ angegeben, nicht mit „${other}=“.`);
    }
    if (a.has(wall.axis)) {
      if (a.has('versatz')) throw new TessError(a.line, `„${wall.axis}=“ und „versatz=“ schließen sich aus.`);
      return a.int(wall.axis, 0, -LIMIT_V2, LIMIT_V2);
    }
  } else {
    for (const k of ['x', 'z']) if (a.has(k)) throw new TessError(a.line, `„${k}=“ gibt es nur an geraden Seiten (n, o, s, w); an Schrägen nimm „versatz=“.`);
  }
  const v = a.int('versatz', 0, -LIMIT_V2, LIMIT_V2);
  const right = ccw(wall.out);
  const sign = right === wall.plus ? 1 : -1;
  if (wall.mode === 'face') return Math.floor((wall.tMin + wall.tMax + 1 - span) / 2) + sign * v;
  return wall.hit - Math.floor((span - 1) / 2) + sign * v;
}
