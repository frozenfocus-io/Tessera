import { Args } from './args';
import { facingTowardsSet } from './cells';
import type { Compiler, Vec3 } from './compile';
import { ccw, cw, DIR, opposite, parseSide, ringCells, type Facing } from './geometry';
import { Part } from './grid';
import type { RoleRef } from './palette';
import { asciiKey, TessError, type Statement } from './syntax';
import { cellAngle, heightOf, norm, sideAngle } from './wall';

/**
 * Arches, straight stairs and spiral stairs (Bau-Sprache 2, 6.6). Arches fill a few cells per
 * column above a curve between two legs; stairs rise one layer per step (slabs half a layer)
 * and face the way up; spiral stairs walk a ring inside a tower or around a form.
 */

const MAIN: readonly Facing[] = ['north', 'east', 'south', 'west'];

/** Main direction nearest to a compass angle (ties: n, o, s, w). */
export function nearestMain(angle: number): Facing {
  const a = norm(angle);
  let best: Facing = 'north';
  let bd = Infinity;
  MAIN.forEach((f, k) => {
    const d = Math.abs(norm(a - k * 90 + 180) - 180);
    if (d < bd - 1e-9) {
      bd = d;
      best = f;
    }
  });
  return best;
}

/** Walking direction from one cell to the next: the longer axis; diagonal steps use the tangent. */
function walkFacing(from: readonly number[], to: readonly number[], tangent: number): Facing {
  const dx = to[0] - from[0];
  const dz = to[to.length - 1] - from[from.length - 1];
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
  if (Math.abs(dz) > Math.abs(dx)) return dz > 0 ? 'south' : 'north';
  return nearestMain(tangent);
}

// ---------------------------------------------------------------------------
// bogen

/** Lower edge of an arch at u (0 … span) above the springing line. */
export function archEdge(art: 'rund' | 'spitz' | 'flach', span: number, h: number, u: number): number {
  const half = span / 2;
  switch (art) {
    case 'rund': {
      const t = (u - half) / half;
      return h * Math.sqrt(Math.max(0, 1 - t * t));
    }
    case 'spitz': {
      const cc = (half * half + h * h) / span;
      const v = u <= half ? u : span - u;
      return Math.sqrt(Math.max(0, cc * cc - (v - cc) * (v - cc)));
    }
    case 'flach': {
      const R = (half * half + h * h) / (2 * h);
      return h - R + Math.sqrt(Math.max(0, R * R - (u - half) * (u - half)));
    }
  }
}

/** bogen x,y,z x,y,z hoehe=<n> <rolle> [art=rund|spitz|flach] [dicke=1] [tiefe=1] */
export function archCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['hoehe', 'art', 'dicke', 'tiefe']);
  const p = a.coord('Der erste Bogenfuß');
  const q = a.coord('Der zweite Bogenfuß');
  const ref = c.ref(a.word1('Die Rolle'));
  a.done();
  if (p[1] !== q[1]) throw new TessError(st.line, `Die beiden Bogenfüße liegen nicht auf derselben Höhe (y=${p[1]} und y=${q[1]}).`);
  const alongX = p[2] === q[2] && p[0] !== q[0];
  const alongZ = p[0] === q[0] && p[2] !== q[2];
  if (!alongX && !alongZ) throw new TessError(st.line, 'Die beiden Bogenfüße müssen auf einer Linie in x- oder z-Richtung liegen.');
  const h = a.requireInt('hoehe', 1, 256, 'Die Höhe des Scheitels über den Bogenfüßen.');
  const art = a.choice('art', ['rund', 'spitz', 'flach'] as const, 'rund');
  const dicke = a.int('dicke', 1, 1, 64);
  const tiefe = a.int('tiefe', 1, 1, 64);
  const lo = alongX ? Math.min(p[0], q[0]) : Math.min(p[2], q[2]);
  const hi = alongX ? Math.max(p[0], q[0]) : Math.max(p[2], q[2]);
  const span = hi - lo;
  if (span < 2) throw new TessError(st.line, 'Zwischen den Bogenfüßen muss Platz sein (Abstand mindestens 2).');
  const [loDir, hiDir]: Facing[] = alongX ? ['west', 'east'] : ['north', 'south'];
  const low = Array.from({ length: span + 1 }, (_, u) => Math.floor(archEdge(art, span, h, u) + 1e-9));
  for (let u = 0; u <= span; u++) {
    const e = archEdge(art, span, h, u);
    const k0 = low[u];
    const stair = e - k0 >= 0.5 - 1e-9;
    // Where the edge climbs more than one cell to the next column towards the middle (steep
    // parts near the legs), the column reaches up to just below it, so the arch stays closed.
    const inner = u * 2 < span ? u + 1 : u * 2 > span ? u - 1 : -1;
    const fill = Math.max(dicke, inner >= 0 ? low[inner] - k0 : 0);
    for (let d = 0; d < tiefe; d++) {
      const x = alongX ? lo + u : p[0] + d;
      const z = alongX ? p[2] + d : lo + u;
      for (let k = 0; k < fill; k++) {
        const pos: Vec3 = [x, p[1] + k0 + k, z];
        if (k === 0 && stair) c.place(pos, ref, 'stairs', { facing: u * 2 < span ? loDir : hiDir, half: 'top' }, Part.Plain);
        else c.place(pos, ref, 'block', null, Part.Plain, alongX ? 'x' : 'z');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// treppe

/** treppe x,y,z richtung=<seite> laenge=<n> <rolle> [breite=1] [unterbau=voll|keiner|treppe] [gelaender=R] */
export function stairsCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['richtung', 'laenge', 'breite', 'unterbau', 'gelaender']);
  const [x, y, z] = a.coord('Die erste Stufe');
  const ref = c.ref(a.word1('Die Rolle'));
  a.done();
  const dirWord = a.str('richtung');
  if (!dirWord) throw new TessError(st.line, 'Bei „treppe“ fehlt „richtung=“ (n, o, s oder w): die Richtung, in die die Treppe ansteigt.');
  const side = parseSide(asciiKey(dirWord));
  if (!side) throw new TessError(st.line, `„richtung=${dirWord}“ ist keine Seite (n, o, s oder w).`);
  const dir = c.xf.facing(side);
  // breite= grows to the right of the rising direction; a mirror makes that the left.
  const mirrored = c.xf.mirrored;
  const n = a.requireInt('laenge', 1, 512, 'Die Zahl der Stufen.');
  const breite = a.int('breite', 1, 1, 64);
  const unterbau = a.choice('unterbau', ['voll', 'keiner', 'treppe'] as const, 'voll');
  const rail = a.has('gelaender') ? c.railRef(a.str('gelaender')!) : null;
  const [dx, dz] = DIR[dir];
  const [rx, rz] = DIR[mirrored ? ccw(dir) : cw(dir)];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < breite; j++) {
      const sx = x + dx * i + rx * j;
      const sz = z + dz * i + rz * j;
      const sy = y + i;
      if (unterbau === 'voll') for (let yy = y; yy < sy; yy++) c.place([sx, yy, sz], ref, 'block', null, Part.Plain, 'y');
      else if (unterbau === 'treppe' && i > 0) c.place([sx, sy - 1, sz], ref, 'stairs', { facing: opposite(dir), half: 'top' }, Part.Plain);
      c.place([sx, sy, sz], ref, 'stairs', { facing: dir, half: 'bottom' }, Part.Plain);
    }
    if (rail) {
      for (const j of [-1, breite]) {
        const p: Vec3 = [x + dx * i + rx * j, y + i + 1, z + dz * i + rz * j];
        c.outPlace(p, rail, rail.member, null, Part.Attachment, 'y', 'Das Geländer');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// wendeltreppe

interface Step {
  cells: [number, number][];
  layer: number;
  /** Slabs: bottom or top; null for stairs. */
  slab: 'bottom' | 'top' | null;
  facing: Facing;
  /** Cells ("x,z") that are landings (bottom slabs): their ring goes on within the same step. */
  landings?: Set<string>;
}

/** Layer and slab type of step k. */
function stepHeight(k: number, y0: number, schritt: number, slabs: boolean, firstOfGroup: (k: number) => boolean): { layer: number; slab: 'bottom' | 'top' | null; stair: boolean } {
  if (slabs) {
    const halves = Math.floor(k / schritt);
    return { layer: y0 + Math.floor(halves / 2), slab: halves % 2 === 0 ? 'bottom' : 'top', stair: false };
  }
  return { layer: y0 + Math.floor(k / schritt), slab: firstOfGroup(k) ? null : 'top', stair: firstOfGroup(k) };
}

/** Sorted ring cells (clockwise, compass angles) and the index nearest to an angle. */
function sortedRing(cells: [number, number][], px: number, pz: number): { cells: [number, number][]; angles: number[] } {
  const withA = cells.map((c) => ({ c, a: cellAngle(c[0], c[1], px, pz) })).sort((p, q) => p.a - q.a);
  return { cells: withA.map((w) => w.c), angles: withA.map((w) => w.a) };
}

/** Index of the first angle at or after `a` (clockwise), cyclic. */
function firstFrom(angles: number[], a: number): number {
  for (let i = 0; i < angles.length; i++) if (angles[i] >= a - 1e-9) return i;
  return 0;
}

/** Cells of extra rings assigned to the steps by angle (the nearest step of the same turn). */
function widen(steps: Step[], stepAngles: number[], ringAt: (layer: number, d: number) => { cells: [number, number][]; angles: number[] }, dists: number[], clockwise: boolean): void {
  const n = steps.length;
  // Unwrapped angles along the walk.
  const un: number[] = [];
  for (let k = 0; k < n; k++) {
    let a = stepAngles[k];
    if (k > 0) {
      const prev = un[k - 1];
      if (clockwise) while (a < prev - 1e-9) a += 360;
      else while (a > prev + 1e-9) a -= 360;
    }
    un.push(a);
  }
  for (let k = 0; k < n; k++) {
    const lo = k > 0 ? (un[k - 1] + un[k]) / 2 : un[k] - (n > 1 ? (un[1] - un[0]) / 2 : 180);
    const hi = k + 1 < n ? (un[k] + un[k + 1]) / 2 : un[k] + (n > 1 ? (un[k] - un[k - 1]) / 2 : 180);
    const [a0, a1] = clockwise ? [lo, hi] : [hi, lo];
    for (const d of dists) {
      const ring = ringAt(steps[k].layer, d);
      ring.cells.forEach((cell, i) => {
        let a = ring.angles[i];
        while (a < a0 - 1e-9) a += 360;
        while (a >= a0 + 360 - 1e-9) a -= 360;
        if (a >= a0 - 1e-9 && a < a1 - 1e-9) steps[k].cells.push(cell);
      });
    }
  }
}

/** wendeltreppe … (inner: around a point; aussen: around a form). */
export function spiralCmd(c: Compiler, st: Statement): void {
  const tokens = c.tokens(st);
  const outer = tokens.some((t) => t.kind === 'word' && asciiKey(t.text) === 'aussen');
  if (outer) return outerSpiral(c, st, tokens);
  const a = new Args(st, tokens, ['r', 'bis', 'richtung', 'start', 'breite', 'stufen', 'spindel', 'kopffreiheit']);
  const [x, y, z] = a.coord('Die Mitte unten');
  const ref = c.ref(a.word1('Die Rolle'));
  a.done();
  const r = a.requireInt('r', 1, 64, 'Der Radius des Laufrings (wie die Wand eines zylinders).');
  const bis = a.requireInt('bis', -4000, 4000, 'Die Lage, in der die Treppe ankommt.');
  if (bis < y) throw new TessError(st.line, `„bis=${bis}“ liegt unter dem Anfang (y=${y}).`);
  const clockwise = (a.choice('richtung', ['rechts', 'links'] as const, 'rechts') === 'rechts') !== c.xf.mirrored;
  const start = c.xf.angle(startAngle(a));
  const breite = a.int('breite', 1, 1, r);
  const slabs = a.choice('stufen', ['treppe', 'stufe'] as const, 'treppe') === 'stufe';
  const spindle = a.has('spindel') ? c.ref(a.str('spindel')!) : null;
  const head = a.int('kopffreiheit', 3, 0, 32);
  const px = x + 0.5;
  const pz = z + 0.5;
  // With breite > 1 the innermost ring sets the pace: it has the fewest cells, and no ring may rise
  // more than one layer from one cell to the next.
  const r0 = r - breite + 1;
  const ring = sortedRing(ringCells(r0).map(([dx, dz]) => [x + dx, z + dz]), px, pz);
  const n = ring.cells.length;
  const i0 = firstFrom(ring.angles, start);
  const steps: Step[] = [];
  const total = slabs ? 2 * (bis - y) + 2 : bis - y + 1;
  for (let k = 0; k < total; k++) {
    const i = (((clockwise ? i0 + k : i0 - k) % n) + n) % n;
    const iNext = (((clockwise ? i + 1 : i - 1) % n) + n) % n;
    const cell = ring.cells[i];
    const tangent = ring.angles[i] + (clockwise ? 90 : -90);
    const hgt = stepHeight(k, y, 1, slabs, () => true);
    steps.push({ cells: [cell], layer: hgt.layer, slab: hgt.slab, facing: walkFacing(cell, ring.cells[iNext], tangent) });
  }
  // The outer rings (radius r0+1 … r) have more cells than the pacing ring. Their cells join the
  // steps in walking order, spread evenly: cell J of a ring with m cells goes to step round(J·n/m).
  // So every step gets at least one cell of each ring and no ring rises more than one layer from
  // cell to cell. Where a ring has several cells in one step, all but the last are landings.
  for (let rr = r0 + 1; rr <= r; rr++) {
    const ringR = sortedRing(ringCells(rr).map(([dx, dz]) => [x + dx, z + dz]), px, pz);
    const m = ringR.cells.length;
    const j0 = firstFrom(ringR.angles, start);
    for (let J = 0; ; J++) {
      const k = Math.round((J * n) / m);
      if (k >= total) break;
      const cell = ringR.cells[(((clockwise ? j0 + J : j0 - J) % m) + m) % m];
      steps[k].cells.push(cell);
      if (!slabs && Math.round(((J + 1) * n) / m) === k) (steps[k].landings ??= new Set()).add(`${cell[0]},${cell[1]}`);
    }
  }
  // Headroom first (also through floors), then the steps and the spindle.
  if (head) {
    const stepCells = new Set(steps.flatMap((s) => s.cells.map(([cx, cz]) => `${cx},${s.layer},${cz}`)));
    for (const s of steps)
      for (const [cx, cz] of s.cells)
        for (let k = 1; k <= head; k++) {
          const yy = s.layer + k;
          if (!stepCells.has(`${cx},${yy},${cz}`)) c.clearCell([cx, yy, cz]);
        }
  }
  for (const s of steps) placeStep(c, s, ref, false, 'Die Wendeltreppe');
  if (spindle) for (let yy = y; yy <= bis; yy++) c.place([x, yy, z], spindle, spindle.member, null, Part.Structure, 'y');
}

function startAngle(a: Args): number {
  const w = a.str('start');
  if (w === undefined) return 0;
  const ang = sideAngle(w);
  if (ang === null) throw new TessError(a.line, `„start=${w}“ ist keine Seite (n, no, o, so, s, sw, w, nw).`);
  return ang;
}

function placeStep(c: Compiler, s: Step, ref: RoleRef, outside: boolean, what: string): void {
  for (const [x, z] of s.cells) {
    const p: Vec3 = [x, s.layer, z];
    const slab = s.slab ?? (s.landings?.has(`${x},${z}`) ? 'bottom' : null);
    if (slab) {
      if (outside) c.outPlace(p, ref, 'slab', { type: slab }, Part.Plain, undefined, what);
      else c.place(p, ref, 'slab', { type: slab }, Part.Plain);
    } else if (outside) c.outPlace(p, ref, 'stairs', { facing: s.facing, half: 'bottom' }, Part.Plain, undefined, what);
    else c.place(p, ref, 'stairs', { facing: s.facing, half: 'bottom' }, Part.Plain);
  }
}

/** wendeltreppe <form> aussen bis=<y> <rolle> [y=|ebene=] [breite=1] [richtung=] [start=] [stufen=] [gelaender=] [konsolen=] [schritt=1] */
function outerSpiral(c: Compiler, st: Statement, tokens: ReturnType<Compiler['tokens']>): void {
  const a = new Args(st, tokens, ['bis', 'y', 'ebene', 'breite', 'richtung', 'start', 'stufen', 'gelaender', 'konsolen', 'schritt'], ['aussen']);
  const f = c.bauteilForm(a);
  const ref = c.ref(a.word1('Die Rolle'));
  a.done();
  const y0 = heightOf(c, a, f, false, f.y0);
  const bis = a.requireInt('bis', -4000, 4000, 'Die Lage, in der die Treppe ankommt.');
  if (bis < y0) throw new TessError(st.line, `„bis=${bis}“ liegt unter dem Anfang (y=${y0}).`);
  const breite = a.int('breite', 1, 1, 8);
  const clockwise = (a.choice('richtung', ['rechts', 'links'] as const, 'rechts') === 'rechts') !== c.xf.mirrored;
  const start = c.xf.angle(startAngle(a));
  const slabs = a.choice('stufen', ['treppe', 'stufe'] as const, 'treppe') === 'stufe';
  const schritt = a.int('schritt', 1, 1, 16);
  const rail = a.has('gelaender') ? c.railRef(a.str('gelaender')!) : null;
  const consoles = a.has('konsolen') ? c.ref(a.str('konsolen')!) : ref;
  const { px, pz } = c.centrePoint(f);
  const rings = new Map<string, { cells: [number, number][]; angles: number[] }>();
  /** Cells at Chebyshev distance exactly d outside the form's outline in a layer. */
  const ringAt = (layer: number, d: number) => {
    const key = `${layer}|${d}`;
    let r = rings.get(key);
    if (!r) {
      const O = c.outlineAt(f, Math.max(f.y0, Math.min(f.y1, layer)));
      const set = O.dilate(d).minus(O.dilate(d - 1));
      rings.set(key, (r = sortedRing(set.list(), px, pz)));
    }
    return r;
  };
  const halvesTotal = slabs ? 2 * (bis - y0) + 2 : bis - y0 + 1;
  const total = halvesTotal * schritt;
  const steps: Step[] = [];
  const angles: number[] = [];
  let ang = start;
  for (let k = 0; k < total; k++) {
    const hgt = stepHeight(k, y0, schritt, slabs, (kk) => kk % schritt === 0);
    const ring = ringAt(hgt.layer, 1);
    if (!ring.cells.length) break;
    // Next cell after the current angle in walking direction.
    let i: number;
    if (clockwise) i = firstFrom(ring.angles, ang + 1e-6);
    else {
      i = -1;
      for (let j = ring.angles.length - 1; j >= 0; j--)
        if (ring.angles[j] <= ang - 1e-6) {
          i = j;
          break;
        }
      if (i < 0) i = ring.angles.length - 1;
    }
    if (k === 0) {
      // First step: the cell nearest to the start angle.
      let bd = Infinity;
      ring.angles.forEach((a2, j) => {
        const d = Math.abs(norm(a2 - start + 180) - 180);
        if (d < bd) {
          bd = d;
          i = j;
        }
      });
    }
    const cell = ring.cells[i];
    const nextI = clockwise ? (i + 1) % ring.cells.length : (i - 1 + ring.cells.length) % ring.cells.length;
    const tangent = ring.angles[i] + (clockwise ? 90 : -90);
    steps.push({ cells: [cell], layer: hgt.layer, slab: hgt.slab, facing: walkFacing(cell, ring.cells[nextI], tangent) });
    angles.push(ring.angles[i]);
    ang = ring.angles[i];
  }
  if (breite > 1) widen(steps, angles, ringAt, Array.from({ length: breite - 1 }, (_, i) => i + 2), clockwise);
  const what = 'Die Wendeltreppe';
  for (const s of steps) placeStep(c, s, ref, true, what);
  // Corbels under every step, towards the wall (the neighbour one ring further in).
  for (const s of steps) {
    if (s.layer - 1 < f.y0) continue; // the first steps stand on the ground
    const O = c.outlineAt(f, Math.max(f.y0, Math.min(f.y1, s.layer - 1)));
    for (const [x, z] of s.cells) {
      let d = 1;
      while (d < 16 && !O.dilate(d).has(x, z)) d++;
      const inner = d === 1 ? O : O.dilate(d - 1);
      const facing = facingTowardsSet(x, z, (p, q) => inner.has(p, q), 'x');
      if (!facing) continue;
      c.outPlace([x, s.layer - 1, z], consoles, 'stairs', { facing, half: 'top' }, Part.Attachment, undefined, what);
    }
  }
  if (rail) {
    const posts: Step[] = steps.map((s) => ({ ...s, cells: [] }));
    widen(posts, angles, ringAt, [breite + 1], clockwise);
    for (const s of posts) for (const [x, z] of s.cells) c.outPlace([x, s.layer + 1, z], rail, rail.member, null, Part.Attachment, 'y', 'Das Geländer');
  }
}
