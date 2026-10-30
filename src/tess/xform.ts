import { makeState, type BlockState } from '../core/blockstate';
import { completeState } from './connect';
import type { Facing } from './geometry';

/**
 * Turning and mirroring (Bau-Sprache 2, section 10): `baue … drehung= spiegel=`, `spiegle` and
 * `ausrichtung`. A transform maps cells, not points: (x, z) → (a·x + b·z + tx, c·x + d·z + tz)
 * with an integer matrix of quarter turns and mirrors, y → y + ty. Turning by 90° maps (x, z)
 * to (−z, x), clockwise seen from above; `spiegel=x` maps x to −x.
 *
 * Forms, roofs and checks always work in absolute coordinates. Statements inside a module or a
 * mirrored `spiegle` run therefore map what they read (coordinates, sides, angles, axes, the
 * states written in the file) through the transform before they build. `ausrichtung` instead
 * maps the finished grid, before the connection pass.
 */
export class Xf {
  static readonly ID = new Xf(1, 0, 0, 1, 0, 0, 0);

  constructor(
    readonly a: number,
    readonly b: number,
    readonly c: number,
    readonly d: number,
    readonly tx: number,
    readonly ty: number,
    readonly tz: number,
  ) {}

  /** Turn by 0/90/180/270° clockwise (seen from above), after mirroring x or z. */
  static of(turn: number, mirror: 'x' | 'z' | null, tx = 0, ty = 0, tz = 0): Xf {
    let m = new Xf(1, 0, 0, 1, 0, 0, 0);
    if (mirror === 'x') m = new Xf(-1, 0, 0, 1, 0, 0, 0);
    else if (mirror === 'z') m = new Xf(1, 0, 0, -1, 0, 0, 0);
    const q = ((Math.round(turn / 90) % 4) + 4) % 4;
    let r = new Xf(1, 0, 0, 1, 0, 0, 0);
    for (let i = 0; i < q; i++) r = new Xf(0, -1, 1, 0, 0, 0, 0).then(r);
    return new Xf(1, 0, 0, 1, tx, ty, tz).then(r.then(m));
  }

  /** Mirror at x = axis (spiegle x=10: x' = 20 − x; x=10.5: x' = 21 − x). */
  static mirrorAt(axis: 'x' | 'z', twice: number): Xf {
    return axis === 'x' ? new Xf(-1, 0, 0, 1, twice, 0, 0) : new Xf(1, 0, 0, -1, 0, 0, twice);
  }

  /** this ∘ inner: inner first, then this. */
  then(inner: Xf): Xf {
    return new Xf(
      this.a * inner.a + this.b * inner.c,
      this.a * inner.b + this.b * inner.d,
      this.c * inner.a + this.d * inner.c,
      this.c * inner.b + this.d * inner.d,
      this.a * inner.tx + this.b * inner.tz + this.tx,
      inner.ty + this.ty,
      this.c * inner.tx + this.d * inner.tz + this.tz,
    );
  }

  get identity(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.tx === 0 && this.ty === 0 && this.tz === 0;
  }

  /** Whether directions turn or mirror (a pure shift does not). */
  get turns(): boolean {
    return !(this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1);
  }

  /** Mirrored: clockwise becomes counter-clockwise, door hinges swap. */
  get mirrored(): boolean {
    return this.a * this.d - this.b * this.c < 0;
  }

  /** Whether x and z swap (turn by 90° or 270°). */
  get swaps(): boolean {
    return this.a === 0;
  }

  map(x: number, y: number, z: number): [number, number, number] {
    return [this.a * x + this.b * z + this.tx, y + this.ty, this.c * x + this.d * z + this.tz];
  }

  mapXZ(x: number, z: number): [number, number] {
    return [this.a * x + this.b * z + this.tx, this.c * x + this.d * z + this.tz];
  }

  /** Direction vector (dx, dz) without the shift. */
  dir(dx: number, dz: number): [number, number] {
    return [this.a * dx + this.b * dz, this.c * dx + this.d * dz];
  }

  /** Compass angle (0 = north, clockwise). */
  angle(deg: number): number {
    const r = (deg * Math.PI) / 180;
    const [dx, dz] = this.dir(Math.sin(r), -Math.cos(r));
    const out = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const n = ((out % 360) + 360) % 360;
    // Keep whole degrees whole (no 89.99999).
    return Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) % 360 : n;
  }

  facing(f: Facing): Facing {
    const [dx, dz] = this.dir(...FACING_DIR[f]);
    return dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north';
  }

  axis(a: 'x' | 'z'): 'x' | 'z';
  axis(a: 'x' | 'y' | 'z'): 'x' | 'y' | 'z';
  axis(a: 'x' | 'y' | 'z'): 'x' | 'y' | 'z' {
    if (a === 'y' || !this.swaps) return a;
    return a === 'x' ? 'z' : 'x';
  }

  /**
   * A range along a local axis (lo … hi on x or z) in absolute terms: the axis it runs along
   * and its smallest and largest coordinate.
   */
  range(axis: 'x' | 'z', lo: number, hi: number, other = 0): { axis: 'x' | 'z'; lo: number; hi: number } {
    const p = axis === 'x' ? this.mapXZ(lo, other) : this.mapXZ(other, lo);
    const q = axis === 'x' ? this.mapXZ(hi, other) : this.mapXZ(other, hi);
    const ax = this.axis(axis);
    const i = ax === 'x' ? 0 : 1;
    return { axis: ax, lo: Math.min(p[i], q[i]), hi: Math.max(p[i], q[i]) };
  }

  inverse(): Xf {
    // Orthogonal integer matrix: the inverse is the transpose.
    const a = this.a, b = this.c, c = this.b, d = this.d;
    return new Xf(a, b, c, d, -(a * this.tx + b * this.tz), -this.ty, -(c * this.tx + d * this.tz));
  }
}

const FACING_DIR: Record<Facing, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const HORIZONTAL = new Set(['north', 'east', 'south', 'west']);

/**
 * A block state turned and mirrored like its cell: facing, axis, the side flags of vines,
 * lichen, fences, walls and panes, sign and banner rotation, rail shapes, stair corners, door
 * hinges and chest halves. Connections are computed again afterwards (connectBlocks).
 */
export function turnState(s: BlockState, xf: Xf): BlockState {
  if (!xf.turns) return s;
  const p = s.props;
  const out: Record<string, string> = { ...p };
  let changed = false;
  const set = (k: string, v: string) => {
    if (out[k] !== v) {
      out[k] = v;
      changed = true;
    }
  };
  if (p.facing && HORIZONTAL.has(p.facing)) set('facing', xf.facing(p.facing as Facing));
  if (p.horizontal_facing && HORIZONTAL.has(p.horizontal_facing)) set('horizontal_facing', xf.facing(p.horizontal_facing as Facing));
  if (p.axis === 'x' || p.axis === 'z') set('axis', xf.axis(p.axis));
  // Side flags (vine, glow_lichen, fences, walls, panes, mushroom blocks, redstone): move with their side.
  const sides = (['north', 'east', 'south', 'west'] as const).filter((k) => k in p);
  if (sides.length) {
    for (const k of sides) delete out[k];
    for (const k of sides) out[xf.facing(k)] = p[k];
    changed = changed || sides.some((k) => out[k] !== p[k]);
  }
  if (p.rotation !== undefined && /^\d+$/.test(p.rotation)) {
    const r = Math.round(xf.angle((parseInt(p.rotation, 10) * 22.5 + 180) % 360) / 22.5);
    // Minecraft: rotation 0 faces south (the sign's text looks to the north); turn as an angle.
    set('rotation', String((((r - 8) % 16) + 16) % 16));
  }
  if (p.shape) {
    const rail = /^(ascending_)?(north|east|south|west)(?:_(north|east|south|west))?$/.exec(p.shape);
    if (rail && rail[1]) set('shape', `ascending_${xf.facing(rail[2] as Facing)}`);
    else if (rail && rail[3]) {
      const a = xf.facing(rail[2] as Facing);
      const b = xf.facing(rail[3] as Facing);
      const pair = [a, b].sort((x, y) => RAIL_ORDER.indexOf(x) - RAIL_ORDER.indexOf(y));
      set('shape', `${pair[0]}_${pair[1]}`);
    } else if (xf.mirrored && /_(left|right)$/.test(p.shape)) set('shape', p.shape.replace(/_(left|right)$/, (_, s) => (s === 'left' ? '_right' : '_left')));
  }
  if (xf.mirrored) {
    if (p.hinge === 'left' || p.hinge === 'right') set('hinge', p.hinge === 'left' ? 'right' : 'left');
    if (p.type === 'left' || p.type === 'right') set('type', p.type === 'left' ? 'right' : 'left');
  }
  if (p.orientation) {
    const m = /^([a-z]+)_([a-z]+)$/.exec(p.orientation);
    if (m) set('orientation', `${HORIZONTAL.has(m[1]) ? xf.facing(m[1] as Facing) : m[1]}_${HORIZONTAL.has(m[2]) ? xf.facing(m[2] as Facing) : m[2]}`);
  }
  return changed ? makeState(s.name, out) : s;
}

/** Rail shapes name north/south before east/west (north_south, south_east, north_west …). */
const RAIL_ORDER: Facing[] = ['north', 'south', 'east', 'west'];

/**
 * A state as written in the file (zeichen, block, spitze= …), turned with a module: states that
 * Tessera would complete by itself turn too (a stair without facing faces north, so it turns),
 * but only what was written or changes by turning is kept. Other defaults (the age of crops)
 * stay open for the command and the completion afterwards.
 */
export function turnWritten(s: BlockState, xf: Xf): BlockState {
  if (!xf.turns) return s;
  const full = completeState(s);
  const turned = turnState(full, xf);
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(turned.props)) if (k in s.props || full.props[k] !== v) props[k] = v;
  return makeState(s.name, props);
}
