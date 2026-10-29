import { CellSet, SIDES } from './cells';
import type { Facing } from './geometry';
import { TessError } from './syntax';

/**
 * Cross-sections of the forms of Bau-Sprache 2. A form is a stack of layers; each layer's
 * outline comes from the form's shape and the wall profile's offset for that layer (positive
 * = outwards). Everything here is pure geometry: which cells are inside, where the corners are
 * and which wall pieces run straight in x or z (for timber frames).
 */

export type FormKind = 'box' | 'zylinder' | 'vieleck' | 'umriss' | 'grundriss' | 'kugel';

/** A straight wall piece: its cells in one row or column, sorted west→east or north→south. */
export interface Piece {
  /** Outward direction. */
  dir: Facing;
  /** Direction the piece runs in. */
  axis: 'x' | 'z';
  cells: [number, number][];
}

const EPS = 1e-9;

/** Cross-section of a form for a given profile offset. */
export abstract class Shape2D {
  /** Centre cell (Mittelzelle or the middle of the bounding box, rounded down). */
  abstract readonly cx: number;
  abstract readonly cz: number;
  /** Geometric centre point (cells have their centres at +0.5). */
  abstract readonly px: number;
  abstract readonly pz: number;
  abstract outline(v: number): CellSet;
  /** Corner cells (ecken=); empty when the form has none. */
  corners(_v: number, _outline: CellSet): CellSet {
    return CellSet.EMPTY;
  }
  /** Straight wall pieces for timber frames; null when the form has no straight walls. */
  pieces(_v: number, _outline: CellSet): Piece[] | null {
    return null;
  }
  /** Whether Bauteile look only at the half of the form facing their side (round forms). */
  get halfFaces(): boolean {
    return false;
  }
}

export class BoxShape extends Shape2D {
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly x1: number,
    readonly z1: number,
  ) {
    super();
  }
  get cx(): number {
    return Math.floor((this.x0 + this.x1) / 2);
  }
  get cz(): number {
    return Math.floor((this.z0 + this.z1) / 2);
  }
  get px(): number {
    return (this.x0 + this.x1 + 1) / 2;
  }
  get pz(): number {
    return (this.z0 + this.z1 + 1) / 2;
  }
  outline(v: number): CellSet {
    return CellSet.rect(this.x0 - v, this.z0 - v, this.x1 + v, this.z1 + v);
  }
  override corners(v: number): CellSet {
    const [a, b, c, d] = [this.x0 - v, this.z0 - v, this.x1 + v, this.z1 + v];
    if (c < a || d < b) return CellSet.EMPTY;
    return CellSet.fromCells([
      [a, b],
      [c, b],
      [a, d],
      [c, d],
    ]);
  }
  override pieces(v: number): Piece[] {
    const [a, b, c, d] = [this.x0 - v, this.z0 - v, this.x1 + v, this.z1 + v];
    if (c < a || d < b) return [];
    const row = (z: number): [number, number][] => Array.from({ length: c - a + 1 }, (_, i) => [a + i, z]);
    const col = (x: number): [number, number][] => Array.from({ length: d - b + 1 }, (_, i) => [x, b + i]);
    return [
      { dir: 'north', axis: 'x', cells: row(b) },
      { dir: 'south', axis: 'x', cells: row(d) },
      { dir: 'west', axis: 'z', cells: col(a) },
      { dir: 'east', axis: 'z', cells: col(c) },
    ];
  }
}

/** zylinder: r= (as version 1), d= (any width) or rx=/rz= (ellipse). */
export class DiscShape extends Shape2D {
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly mode: { r: number } | { d: number } | { rx: number; rz: number },
  ) {
    super();
  }
  private get even(): boolean {
    return 'd' in this.mode && this.mode.d % 2 === 0;
  }
  get px(): number {
    return this.even ? this.cx + 1 : this.cx + 0.5;
  }
  get pz(): number {
    return this.even ? this.cz + 1 : this.cz + 0.5;
  }
  override get halfFaces(): boolean {
    return true;
  }
  /** Radius field: r, (d-1)/2 or d/2, the larger of rx and rz for ellipses. */
  get radius(): number {
    const m = this.mode;
    if ('r' in m) return m.r;
    if ('d' in m) return m.d % 2 ? (m.d - 1) / 2 : m.d / 2;
    return Math.max(m.rx, m.rz);
  }
  outline(v: number): CellSet {
    const m = this.mode;
    const { cx, cz } = this;
    if ('r' in m || ('d' in m && m.d % 2 === 1)) {
      const r = ('r' in m ? m.r : (m.d - 1) / 2) + v;
      if (r < 0) return CellSet.EMPTY;
      const lim = (r + 0.5) * (r + 0.5);
      return CellSet.build(cx - r, cz - r, cx + r, cz + r, (x, z) => (x - cx) * (x - cx) + (z - cz) * (z - cz) <= lim);
    }
    if ('d' in m) {
      const d = m.d + 2 * v;
      if (d <= 0) return CellSet.EMPTY;
      const half = d / 2;
      const ox = cx + 1;
      const oz = cz + 1;
      const lim = half * half + EPS;
      const k = Math.ceil(half);
      return CellSet.build(ox - k, oz - k, ox + k, oz + k, (x, z) => (x + 0.5 - ox) ** 2 + (z + 0.5 - oz) ** 2 <= lim);
    }
    const rx = m.rx + v;
    const rz = m.rz + v;
    if (rx < 0 || rz < 0) return CellSet.EMPTY;
    const ax = rx + 0.5;
    const az = rz + 0.5;
    return CellSet.build(cx - rx, cz - rz, cx + rx, cz + rz, (x, z) => ((x - cx) / ax) ** 2 + ((z - cz) / az) ** 2 <= 1 + EPS);
  }
}

/** Point inside a polygon (or on its edge, tolerance 1e-9). */
export function insidePolygon(px: number, pz: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    // On the edge?
    const ex = xi - xj;
    const ez = zi - zj;
    const len2 = ex * ex + ez * ez;
    if (len2 > 0) {
      const t = ((px - xj) * ex + (pz - zj) * ez) / len2;
      if (t >= -EPS && t <= 1 + EPS) {
        const qx = xj + t * ex - px;
        const qz = zj + t * ez - pz;
        if (qx * qx + qz * qz <= 1e-12) return true;
      }
    } else if (Math.abs(px - xi) <= EPS && Math.abs(pz - zi) <= EPS) return true;
    if (zi > pz !== zj > pz) {
      const x = ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

/** Nearest cell of a set to a point (cells have their centres at +0.5). */
function nearestCell(set: CellSet, px: number, pz: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  set.forEach((x, z) => {
    const d = (x + 0.5 - px) ** 2 + (z + 0.5 - pz) ** 2;
    if (d < bd - EPS) {
      bd = d;
      best = [x, z];
    }
  });
  return best;
}

/** vieleck: regular n-gon around the centre of cell (cx, cz), circumradius r + 0.5. */
export class PolygonShape extends Shape2D {
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly n: number,
    readonly r: number,
    /** Rotation in degrees (compass: 0 = north, clockwise). */
    readonly rotation: number,
  ) {
    super();
  }
  get px(): number {
    return this.cx + 0.5;
  }
  get pz(): number {
    return this.cz + 0.5;
  }
  override get halfFaces(): boolean {
    return true;
  }
  vertices(v: number): [number, number][] {
    const R = this.r + v + 0.5;
    const out: [number, number][] = [];
    for (let k = 0; k < this.n; k++) {
      const a = ((this.rotation + (360 * k) / this.n) * Math.PI) / 180;
      out.push([this.px + R * Math.sin(a), this.pz - R * Math.cos(a)]);
    }
    return out;
  }
  outline(v: number): CellSet {
    if (this.r + v < 0) return CellSet.EMPTY;
    const poly = this.vertices(v);
    const R = Math.ceil(this.r + v + 1);
    return CellSet.build(this.cx - R, this.cz - R, this.cx + R, this.cz + R, (x, z) => insidePolygon(x + 0.5, z + 0.5, poly));
  }
  override corners(v: number, outline: CellSet): CellSet {
    const out: [number, number][] = [];
    for (const [vx, vz] of this.vertices(v)) {
      const c: [number, number] = [Math.floor(vx), Math.floor(vz)];
      if (outline.has(c[0], c[1])) out.push(c);
      else {
        const n = nearestCell(outline, vx, vz);
        if (n) out.push(n);
      }
    }
    return CellSet.fromCells(out);
  }
  /** Sides whose outward normal points north, east, south or west. */
  override pieces(v: number, outline: CellSet): Piece[] {
    const verts = this.vertices(v);
    const out: Piece[] = [];
    for (let k = 0; k < this.n; k++) {
      const a = this.rotation + (360 * k) / this.n + 180 / this.n; // normal of side k
      const norm = ((a % 360) + 360) % 360;
      const idx = Math.round(norm / 90);
      if (Math.abs(norm - idx * 90) > 1e-6) continue;
      const dir = (['north', 'east', 'south', 'west', 'north'] as const)[idx];
      const [ax, az] = verts[k];
      const [bx, bz] = verts[(k + 1) % this.n];
      out.push(sidePiece(outline, dir, ax, az, bx, bz));
    }
    return out.filter((p) => p.cells.length > 0);
  }
}

/** Cells of a straight polygon side (from a to b, outward direction dir) in a cell outline. */
function sidePiece(outline: CellSet, dir: Facing, ax: number, az: number, bx: number, bz: number): Piece {
  const s = SIDES.find((q) => q.facing === dir)!;
  const along: 'x' | 'z' = dir === 'north' || dir === 'south' ? 'x' : 'z';
  const lo = along === 'x' ? Math.min(ax, bx) : Math.min(az, bz);
  const hi = along === 'x' ? Math.max(ax, bx) : Math.max(az, bz);
  const line = along === 'x' ? az : ax;
  const cells: [number, number][] = [];
  outline.forEach((x, z) => {
    if (outline.has(x + s.dx, z + s.dz)) return;
    const t = (along === 'x' ? x : z) + 0.5;
    if (t < lo - 1e-6 || t > hi + 1e-6) return;
    const depth = (along === 'x' ? z : x) + 0.5;
    if (Math.abs(depth - line) >= 1) return;
    cells.push([x, z]);
  });
  cells.sort((p, q) => (along === 'x' ? p[0] - q[0] : p[1] - q[1]));
  return { dir, axis: along, cells };
}

/**
 * Maximal straight runs on the boundary: for each side direction, runs of cells whose
 * neighbour in that direction is outside, in one row or column.
 */
export function boundaryRuns(outline: CellSet): Piece[] {
  const out: Piece[] = [];
  for (const s of SIDES) {
    const along: 'x' | 'z' = s.facing === 'north' || s.facing === 'south' ? 'x' : 'z';
    const lines = new Map<number, number[]>();
    outline.forEach((x, z) => {
      if (outline.has(x + s.dx, z + s.dz)) return;
      const key = along === 'x' ? z : x;
      const t = along === 'x' ? x : z;
      let list = lines.get(key);
      if (!list) lines.set(key, (list = []));
      list.push(t);
    });
    for (const [key, ts] of lines) {
      ts.sort((a, b) => a - b);
      let start = 0;
      for (let i = 1; i <= ts.length; i++) {
        if (i < ts.length && ts[i] === ts[i - 1] + 1) continue;
        const cells: [number, number][] = [];
        for (let j = start; j < i; j++) cells.push(along === 'x' ? [ts[j], key] : [key, ts[j]]);
        out.push({ dir: s.facing, axis: along, cells });
        start = i;
      }
    }
  }
  return out;
}

/** Convex corner cells of a cell outline: two outside side neighbours at right angles. */
function cellCorners(outline: CellSet): CellSet {
  const out: [number, number][] = [];
  outline.forEach((x, z) => {
    const m = outline.openSides(x, z);
    const ns = m & 5;
    const ew = m & 10;
    if (ns && ew) out.push([x, z]);
  });
  return CellSet.fromCells(out);
}

/** umriss: free polygon through cell centres, closed automatically. */
export class OutlineShape extends Shape2D {
  readonly base: CellSet;
  private readonly poly: [number, number][];
  constructor(
    readonly points: [number, number][],
    line: number,
  ) {
    super();
    this.poly = points.map(([x, z]) => [x + 0.5, z + 0.5]);
    const xs = points.map((p) => p[0]);
    const zs = points.map((p) => p[1]);
    this.base = CellSet.build(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), (x, z) => insidePolygon(x + 0.5, z + 0.5, this.poly));
    if (this.base.isEmpty()) throw new TessError(line, 'Der umriss schließt keine Zelle ein.');
  }
  get cx(): number {
    return Math.floor((this.base.x0 + this.base.x1) / 2);
  }
  get cz(): number {
    return Math.floor((this.base.z0 + this.base.z1) / 2);
  }
  get px(): number {
    return (this.base.x0 + this.base.x1 + 1) / 2;
  }
  get pz(): number {
    return (this.base.z0 + this.base.z1 + 1) / 2;
  }
  outline(v: number): CellSet {
    return v === 0 ? this.base : v > 0 ? this.base.dilate(v) : this.base.erode(-v);
  }
  /** Convex vertices, moved outwards by the offset (diagonally for right angles). */
  override corners(v: number, outline: CellSet): CellSet {
    const n = this.poly.length;
    const out: [number, number][] = [];
    // Orientation: sign of the area.
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = this.poly[i];
      const [x2, z2] = this.poly[(i + 1) % n];
      area += x1 * z2 - x2 * z1;
    }
    for (let i = 0; i < n; i++) {
      const [px, pz] = this.poly[i];
      const [ax, az] = this.poly[(i + n - 1) % n];
      const [bx, bz] = this.poly[(i + 1) % n];
      const cross = (px - ax) * (bz - pz) - (pz - az) * (bx - px);
      if (cross === 0 || Math.sign(cross) !== Math.sign(area)) continue; // straight or concave
      // Outward bisector: away from the two neighbours.
      const ux = (px - ax) / Math.hypot(px - ax, pz - az) - (bx - px) / Math.hypot(bx - px, bz - pz);
      const uz = (pz - az) / Math.hypot(px - ax, pz - az) - (bz - pz) / Math.hypot(bx - px, bz - pz);
      const m = Math.max(Math.abs(ux), Math.abs(uz)) || 1;
      const tx = px + (v * ux) / m;
      const tz = pz + (v * uz) / m;
      const c: [number, number] = [Math.floor(tx), Math.floor(tz)];
      if (outline.has(c[0], c[1])) out.push(c);
      else {
        const nc = nearestCell(outline, tx, tz);
        if (nc) out.push(nc);
      }
    }
    return CellSet.fromCells(out);
  }
  /** Straight boundary runs that lie on the axis-parallel sides of the polygon. */
  override pieces(v: number, outline: CellSet): Piece[] {
    const n = this.points.length;
    const edges: { dir: Facing; line: number; lo: number; hi: number }[] = [];
    for (let i = 0; i < n; i++) {
      const [ax, az] = this.points[i];
      const [bx, bz] = this.points[(i + 1) % n];
      if (ax !== bx && az !== bz) continue;
      if (ax === bx && az === bz) continue;
      const mx = (ax + bx) / 2 + 0.5;
      const mz = (az + bz) / 2 + 0.5;
      // Outward side: the probe just off the edge lies outside the polygon.
      let dir: Facing;
      if (az === bz) dir = insidePolygon(mx, mz - 0.25, this.poly) ? 'south' : 'north';
      else dir = insidePolygon(mx - 0.25, mz, this.poly) ? 'east' : 'west';
      const s = SIDES.find((q) => q.facing === dir)!;
      if (az === bz) edges.push({ dir, line: az + s.dz * v, lo: Math.min(ax, bx) - v, hi: Math.max(ax, bx) + v });
      else edges.push({ dir, line: ax + s.dx * v, lo: Math.min(az, bz) - v, hi: Math.max(az, bz) + v });
    }
    return boundaryRuns(outline).filter((p) => {
      const along = p.axis;
      const key = along === 'x' ? p.cells[0][1] : p.cells[0][0];
      const t0 = along === 'x' ? p.cells[0][0] : p.cells[0][1];
      const t1 = along === 'x' ? p.cells[p.cells.length - 1][0] : p.cells[p.cells.length - 1][1];
      return edges.some((e) => e.dir === p.dir && e.line === key && t1 >= e.lo && t0 <= e.hi);
    });
  }
}

/** grundriss: ASCII plan, every character except space and `.` is inside. */
export class PlanShape extends Shape2D {
  /** `round`: a round outline in cells (half-round oriel); like a zylinder it has no corners. */
  constructor(
    readonly base: CellSet,
    readonly round = false,
  ) {
    super();
  }
  get cx(): number {
    return Math.floor((this.base.x0 + this.base.x1) / 2);
  }
  get cz(): number {
    return Math.floor((this.base.z0 + this.base.z1) / 2);
  }
  get px(): number {
    return (this.base.x0 + this.base.x1 + 1) / 2;
  }
  get pz(): number {
    return (this.base.z0 + this.base.z1 + 1) / 2;
  }
  outline(v: number): CellSet {
    return v === 0 ? this.base : v > 0 ? this.base.dilate(v) : this.base.erode(-v);
  }
  override corners(_v: number, outline: CellSet): CellSet {
    return this.round ? CellSet.EMPTY : cellCorners(outline);
  }
  /** Straight runs of at least two cells; single steps belong to slanted walls. */
  override pieces(_v: number, outline: CellSet): Piece[] {
    return boundaryRuns(outline).filter((p) => p.cells.length >= 2);
  }
}

// ---------------------------------------------------------------------------
// Wall profile (Vorkragung, Verjüngung, Bauch)

export interface ProfileEntry {
  y: number;
  v: number;
  /** Linear transition to the next entry. */
  lerp: boolean;
}

export function parseWallProfile(value: string, line: number): ProfileEntry[] {
  const out: ProfileEntry[] = [];
  for (const part of value.split(',')) {
    const m = /^(-?\d+):(-?\d+)(~?)$/.exec(part.trim());
    if (!m) throw new TessError(line, `„profil=${value}“: Einträge haben die Form Lage:Versatz, z. B. profil=0:2~,10:0,14:1 („${part}“ passt nicht).`);
    const y = parseInt(m[1], 10);
    if (y < 0) throw new TessError(line, `„profil=${value}“: Die Lage ${y} liegt unter der Form (Lagen zählen ab 0).`);
    if (out.length && y <= out[out.length - 1].y) throw new TessError(line, `„profil=${value}“: Die Lagen müssen aufsteigen (${y} nach ${out[out.length - 1].y}).`);
    out.push({ y, v: parseInt(m[2], 10), lerp: m[3] === '~' });
  }
  return out;
}

/** Rounds .5 away from zero. */
export function roundAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** Offset of layer L (relative to the lowest layer of the form). */
export function profileOffset(p: readonly ProfileEntry[], L: number): number {
  let k = -1;
  for (let i = 0; i < p.length; i++) if (p[i].y <= L) k = i;
  if (k < 0) return 0;
  const e = p[k];
  const next = p[k + 1];
  if (!e.lerp || !next) return e.v;
  return roundAway(e.v + ((next.v - e.v) * (L - e.y)) / (next.y - e.y));
}
